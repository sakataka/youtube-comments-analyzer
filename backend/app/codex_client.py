from __future__ import annotations

import json
import select
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

CODEX_MODEL = "gpt-6-astra"
CODEX_REASONING_EFFORT = "medium"


class CodexAppServerClient:
    def __init__(
        self,
        timeout_seconds: int = 180,
        *,
        output_schema: dict[str, Any] | None = None,
    ):
        self.timeout_seconds = timeout_seconds
        self.output_schema = output_schema

    def ask(self, prompt: str) -> str:
        codex = shutil.which("codex") or "/opt/homebrew/bin/codex"
        if not Path(codex).exists() and codex.startswith("/"):
            codex = "codex"
        process = subprocess.Popen(
            [codex, "app-server"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
        )
        assert process.stdin is not None
        assert process.stdout is not None
        stderr_lines: list[str] = []
        stderr_thread = drain_stderr(process, stderr_lines)
        deadline = time.monotonic() + self.timeout_seconds
        try:
            send_message(
                process.stdin,
                {
                    "method": "initialize",
                    "id": 0,
                    "params": {
                        "clientInfo": {
                            "name": "youtube_comment_mention_analyzer",
                            "title": "YouTube Comment Mention Analyzer",
                            "version": "0.1.0",
                        },
                        "capabilities": {"experimentalApi": True},
                    },
                },
            )
            send_message(process.stdin, {"method": "initialized", "params": {}})
            send_message(
                process.stdin,
                {
                    "method": "thread/start",
                    "id": 1,
                    "params": {
                        "model": CODEX_MODEL,
                        "ephemeral": True,
                        "environments": [],
                        "developerInstructions": (
                            "入力された分析だけを行い、ファイル、シェル、ネットワーク、外部ツールは使用しないでください。"
                            "要求された形式の最終回答だけを返してください。"
                        ),
                    },
                },
            )
            thread_id = wait_for_thread_id(process, deadline, stderr_lines)
            send_message(
                process.stdin,
                {
                    "method": "turn/start",
                    "id": 2,
                    "params": {
                        "threadId": thread_id,
                        "input": [{"type": "text", "text": prompt}],
                        "model": CODEX_MODEL,
                        "effort": CODEX_REASONING_EFFORT,
                        **({"outputSchema": self.output_schema} if self.output_schema else {}),
                    },
                },
            )
            return wait_for_turn_text(process, deadline, stderr_lines)
        finally:
            process.kill()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                pass
            stderr_thread.join(timeout=1)


def drain_stderr(process: subprocess.Popen[str], stderr_lines: list[str]) -> threading.Thread:
    def read_stderr() -> None:
        if process.stderr is None:
            return
        for line in process.stderr:
            if len(stderr_lines) < 80:
                stderr_lines.append(line.rstrip())

    thread = threading.Thread(target=read_stderr, daemon=True)
    thread.start()
    return thread


def send_message(stdin: Any, message: dict[str, Any]) -> None:
    stdin.write(json.dumps(message, ensure_ascii=False) + "\n")
    stdin.flush()


def format_stderr(stderr_lines: list[str]) -> str:
    stderr = "\n".join(line for line in stderr_lines if line).strip()
    return f"\nCodex stderr:\n{stderr}" if stderr else ""


def read_json_line(process: subprocess.Popen[str], deadline: float, stderr_lines: list[str]) -> dict[str, Any]:
    assert process.stdout is not None
    while time.monotonic() < deadline:
        ready, _, _ = select.select([process.stdout], [], [], min(0.25, max(0.0, deadline - time.monotonic())))
        if not ready:
            if process.poll() is not None:
                break
            continue
        line = process.stdout.readline()
        if not line:
            break
        try:
            return json.loads(line)
        except json.JSONDecodeError:
            continue
    raise RuntimeError(f"Codex App Serverから応答を取得できませんでした。{format_stderr(stderr_lines)}")


def wait_for_thread_id(process: subprocess.Popen[str], deadline: float, stderr_lines: list[str]) -> str:
    while time.monotonic() < deadline:
        message = read_json_line(process, deadline, stderr_lines)
        if "error" in message:
            raise RuntimeError(message["error"].get("message") or "Codex App Server error")
        if message.get("id") == 1:
            thread_id = message.get("result", {}).get("thread", {}).get("id")
            if thread_id:
                return thread_id
    raise RuntimeError(f"Codex App Serverからthread idを取得できませんでした。{format_stderr(stderr_lines)}")


def wait_for_turn_text(process: subprocess.Popen[str], deadline: float, stderr_lines: list[str]) -> str:
    answer = ""
    completed_answer = ""
    agent_completed = False
    while time.monotonic() < deadline:
        message = read_json_line(process, deadline, stderr_lines)
        if "error" in message:
            raise RuntimeError(message["error"].get("message") or "Codex App Server error")
        method = message.get("method")
        if method == "item/agentMessage/delta":
            answer += (
                message.get("params", {}).get("delta")
                or message.get("params", {}).get("textDelta")
                or message.get("params", {}).get("contentDelta")
                or ""
            )
        elif method == "item/completed":
            item = message.get("params", {}).get("item", {})
            completed_text = extract_completed_agent_text(item)
            if completed_text:
                agent_completed = True
                completed_answer = completed_text
                return (answer or completed_answer).strip()
        elif method == "thread/status/changed":
            status = message.get("params", {}).get("status", {})
            status_type = status.get("type") if isinstance(status, dict) else status
            if status_type == "idle" and ((answer or completed_answer).strip() or agent_completed):
                return (answer or completed_answer).strip()
        elif method == "turn/completed":
            return (answer or completed_answer).strip()
    raise RuntimeError(f"Codex App Serverのturnが時間内に完了しませんでした。{format_stderr(stderr_lines)}")


def extract_completed_agent_text(item: dict[str, Any]) -> str:
    if item.get("type") not in {"agent_message", "agentMessage"}:
        return ""
    text = item.get("text") or item.get("message")
    if isinstance(text, str):
        return text
    content = item.get("content")
    if isinstance(content, list):
        chunks = []
        for chunk in content:
            if isinstance(chunk, dict) and isinstance(chunk.get("text"), str):
                chunks.append(chunk["text"])
        return "".join(chunks)
    return ""



def parse_json_object(text: str) -> dict[str, Any]:
    stripped = text.strip()
    if stripped.startswith('```'):
        stripped = stripped.strip('`').removeprefix('json').strip()
    start, end = stripped.find('{'), stripped.rfind('}')
    if start < 0 or end < start:
        raise ValueError('AI応答にJSONオブジェクトがありません。')
    return json.loads(stripped[start:end + 1])

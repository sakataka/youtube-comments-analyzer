from __future__ import annotations

import os
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from dotenv import load_dotenv

from .pipeline import AnalysisStore
from .youtube import FetchConfig, YouTubeCommentClient, parse_youtube_video_id


ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")
DATA_DIR = Path(os.getenv("DATA_DIR") or ROOT_DIR / "data")
DB_PATH = Path(os.getenv("DATABASE_URL") or DATA_DIR / "app.sqlite3")
FIXTURE_PATH = ROOT_DIR / "fixtures" / "sample_comments_drawme.jsonl"

app = FastAPI(title="YouTube Comment Mention Analyzer")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1", "http://localhost"],
    allow_origin_regex=r"http://127\.0\.0\.1:\d+|http://localhost:\d+",
    allow_methods=["*"],
    allow_headers=["*"],
)

store = AnalysisStore(DB_PATH, DATA_DIR)
youtube_client = YouTubeCommentClient(DATA_DIR, FIXTURE_PATH)
job_executor = ThreadPoolExecutor(max_workers=1)


class InspectRequest(BaseModel):
    url: str
    fetch_metadata: bool = False


class RunCreateRequest(BaseModel):
    url: str
    max_comments: int = Field(default=5000, ge=1, le=5000)
    reply_fetch_mode: Literal["none", "inline_subset", "full"] = "full"
    fetch_order: Literal["relevance", "time"] = "relevance"
    force_refresh: bool = False


class CandidateActionsRequest(BaseModel):
    actions: list[dict[str, Any]]


class CommentActionsRequest(BaseModel):
    actions: list[dict[str, Any]]


class SentimentActionsRequest(BaseModel):
    actions: list[dict[str, Any]]


class DataActionRequest(BaseModel):
    action: Literal["archive_run", "delete_run", "archive_youtube_cache", "delete_youtube_cache"]
    run_id: str | None = None


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/settings")
def settings() -> dict[str, Any]:
    return {
        "youtube_api_key_configured": bool(os.getenv("YOUTUBE_API_KEY")),
        "youtube_api_key_env_name": "YOUTUBE_API_KEY",
        "data_dir": str(DATA_DIR),
        "max_comments": {"default": 5000, "min": 1, "max": 5000},
        "reply_fetch_modes": [
            {"value": "none", "label": "トップレベルのみ", "uses_extra_quota": False},
            {"value": "inline_subset", "label": "同梱返信だけ含める", "uses_extra_quota": False},
            {"value": "full", "label": "返信を追加取得して含める", "uses_extra_quota": True},
        ],
        "llm_provider": "codex_app_server",
    }


@app.get("/api/data/summary")
def data_summary() -> dict[str, Any]:
    youtube_cache = DATA_DIR / "youtube_cache"
    runs = DATA_DIR / "runs"
    return {
        "data_dir": str(DATA_DIR),
        "database_bytes": file_size(DB_PATH),
        "youtube_cache": directory_summary(youtube_cache),
        "runs": directory_summary(runs),
        "archive": directory_summary(DATA_DIR / "archive"),
        "total_bytes": directory_size(DATA_DIR),
        "run_count": store.count_runs(),
    }


@app.post("/api/data/actions")
def data_actions(request: DataActionRequest) -> dict[str, Any]:
    try:
        if request.action == "archive_run":
            if not request.run_id:
                raise HTTPException(status_code=400, detail="run_id is required")
            return store.archive_run(request.run_id)
        if request.action == "delete_run":
            if not request.run_id:
                raise HTTPException(status_code=400, detail="run_id is required")
            return store.delete_run(request.run_id)
        if request.action == "archive_youtube_cache":
            return store.archive_youtube_cache()
        if request.action == "delete_youtube_cache":
            return store.delete_youtube_cache()
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    raise HTTPException(status_code=400, detail=f"unknown action: {request.action}")


@app.get("/api/runs/{run_id}/export")
def export_run(run_id: str) -> dict[str, Any]:
    try:
        return store.export_run(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/videos/inspect")
def inspect_video(request: InspectRequest) -> dict[str, Any]:
    try:
        return youtube_client.inspect_video(request.url, request.fetch_metadata)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc


@app.post("/api/runs")
def create_run(request: RunCreateRequest) -> dict[str, str]:
    job_id = f"job_{uuid.uuid4().hex[:12]}"
    store.create_job(job_id, store.active_job_count() + 1)
    job_executor.submit(process_run_job, job_id, request)
    return {"job_id": job_id, "status": "queued"}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    try:
        return store.get_job(job_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def process_run_job(job_id: str, request: RunCreateRequest) -> None:
    store.update_job(job_id, status="running", stage="fetching_comments", progress=0.15, queue_position=1)
    try:
        bundle = youtube_client.fetch_video_bundle(
            request.url,
            FetchConfig(
                max_comments=request.max_comments,
                fetch_order=request.fetch_order,
                reply_fetch_mode=request.reply_fetch_mode,
                force_refresh=request.force_refresh,
            ),
        )
        store.update_job(job_id, stage="building_provisional_report", progress=0.55)
        run_id = store.create_run(bundle, request.model_dump())
        store.update_job(job_id, status="completed", stage="provisional_report_ready", progress=1.0, run_id=run_id)
    except ValueError as exc:
        store.update_job(job_id, status="failed", stage="failed", progress=1.0, error_message=str(exc))
    except RuntimeError as exc:
        store.update_job(job_id, status="failed", stage="failed", progress=1.0, error_message=f"YouTube API 取得に失敗しました: {exc}")
    except Exception as exc:
        store.update_job(job_id, status="failed", stage="failed", progress=1.0, error_message=f"分析 run の作成に失敗しました: {exc}")


@app.get("/api/runs")
def list_runs() -> dict[str, Any]:
    return {"runs": store.list_runs()}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    try:
        return store.get_run(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/runs/{run_id}/candidates")
def get_candidates(run_id: str) -> dict[str, Any]:
    try:
        return store.get_candidates(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/runs/{run_id}/candidate-actions")
def candidate_actions(run_id: str, request: CandidateActionsRequest) -> dict[str, str]:
    try:
        store.get_run_row(run_id)
        store.apply_candidate_actions(run_id, request.actions)
        return {"status": "ok"}
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/runs/{run_id}/comment-actions")
def comment_actions(run_id: str, request: CommentActionsRequest) -> dict[str, Any]:
    try:
        return store.apply_comment_actions(run_id, request.actions)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/runs/{run_id}/sentiment-actions")
def sentiment_actions(run_id: str, request: SentimentActionsRequest) -> dict[str, Any]:
    try:
        return store.apply_sentiment_actions(run_id, request.actions)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/runs/{run_id}/continue")
def continue_run(run_id: str) -> dict[str, Any]:
    try:
        store.classify_and_report(run_id)
        return store.get_run(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/runs/{run_id}/review/complete")
def complete_review(run_id: str) -> dict[str, Any]:
    try:
        return store.verify_review(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.post("/api/runs/{run_id}/llm-assist")
def llm_assist(run_id: str) -> dict[str, Any]:
    try:
        store.get_run_row(run_id)
        return store.run_llm_assist(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=f"Codex App Server 取得に失敗しました: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"LLM 応答の解析に失敗しました: {exc}") from exc


@app.post("/api/runs/{run_id}/ai-insight")
def ai_insight(run_id: str) -> dict[str, Any]:
    try:
        store.get_run_row(run_id)
        return store.run_ai_insight(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=f"Codex App Server 取得に失敗しました: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=502, detail=f"AI インサイト応答の解析に失敗しました: {exc}") from exc


@app.get("/api/runs/{run_id}/ai-insight")
def get_ai_insight(run_id: str) -> dict[str, Any]:
    try:
        store.get_run_row(run_id)
        insight = store.get_latest_ai_insight(run_id)
        if not insight:
            raise KeyError(f"ai insight not found: {run_id}")
        return insight
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/runs/{run_id}/report")
def get_report(run_id: str) -> dict[str, Any]:
    try:
        return store.get_latest_report(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/runs/{run_id}/comments")
def get_comments(
    run_id: str,
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    person_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    sentiment: Literal["positive", "neutral", "negative", "mixed", "unclear"] | None = Query(default=None),
    sort: Literal["source", "likes"] = Query(default="source"),
) -> dict[str, Any]:
    try:
        return store.get_comments_page(
            run_id,
            limit=limit,
            offset=offset,
            person_id=person_id,
            search=search,
            sentiment=sentiment,
            sort=sort,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def file_size(path: Path) -> int:
    return path.stat().st_size if path.exists() and path.is_file() else 0


def directory_size(path: Path) -> int:
    if not path.exists():
        return 0
    return sum(file.stat().st_size for file in path.rglob("*") if file.is_file())


def directory_summary(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"path": str(path), "bytes": 0, "file_count": 0}
    files = [file for file in path.rglob("*") if file.is_file()]
    return {
        "path": str(path),
        "bytes": sum(file.stat().st_size for file in files),
        "file_count": len(files),
    }

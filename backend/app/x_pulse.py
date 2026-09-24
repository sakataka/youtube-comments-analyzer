"""Optional X (Twitter) reactions through the local Grok CLI; one run per request."""
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

from . import jev
from .opinion_service import now

TIMEOUT_SECONDS = int(os.getenv('X_SEARCH_TIMEOUT_SECONDS') or 480)
POST_URL = re.compile(r'^https://(?:x|twitter)\.com/[A-Za-z0-9_]{1,15}/status/\d{5,25}(?:[/?#].*)?$')
POST = {'type': 'object', 'additionalProperties': False, 'required': ['url', 'author', 'postedAt', 'gist'], 'properties': {
    'url': {'type': 'string', 'description': '実在を確認した投稿の直接URL。'},
    'author': {'type': 'string', 'description': '表示名と@ハンドル。'},
    'postedAt': {'type': 'string', 'description': '投稿日（YYYY-MM-DD）。不明なら空文字。'},
    'gist': {'type': 'string', 'description': '投稿内容の要約。原文の長い引用はしない。'}}}
SCHEMA = {'type': 'object', 'additionalProperties': False, 'required': ['summary', 'tone', 'topics', 'comparison'], 'properties': {
    'summary': {'type': 'string', 'description': 'X上でこの動画・回がどう話題になっているかの全体像。2〜3文。見つからなければ空文字。'},
    'tone': {'type': 'string', 'description': 'X上の反応の温度感（好意的・批判的・賛否など）を1〜2文。件数や割合は推定しない。'},
    'topics': {'type': 'array', 'maxItems': 4, 'items': {'type': 'object', 'additionalProperties': False, 'required': ['title', 'summary', 'posts'], 'properties': {
        'title': {'type': 'string'}, 'summary': {'type': 'string', 'description': '何が、なぜ話題か。反応の傾向も含めて2〜3文。'},
        'posts': {'type': 'array', 'minItems': 1, 'maxItems': 3, 'items': POST}}}},
    'comparison': {'type': 'string', 'description': 'YouTubeコメントの話題と比べて、Xで目立つ点・Xにしかない論点を2〜3文。比較できなければ空文字。'}}}


def enabled(): return os.getenv('X_SEARCH', 'on') != 'off'


def executable():
    return next((p for p in (os.getenv('GROK_BIN'), shutil.which('grok'), str(Path.home() / '.grok/bin/grok')) if p and Path(p).exists()), None)


def prompt(state):
    video = state['video']
    people = [p['name'] for p in state.get('person_statistics', {}).get('people', [])[:8]]
    topics = [t['title'] for t in state.get('topics', [])]
    return f'''あなたは個人用のYouTubeコメント分析アプリの調査補助です。次のYouTube動画（番組の回）について、X（旧Twitter）でどんな反応があるかを調べてください。

動画タイトル: {video.get('title', '')}
チャンネル: {video.get('channel_title', '')}
公開日時: {video.get('published_at') or '不明'}
主な出演者・話題の人物（YouTubeコメントから抽出）: {'、'.join(people) or '不明'}
YouTubeコメントで見られた話題: {'、'.join(topics) or '未作成'}
調査日時: {now()}

- まずX検索（x_search）で、番組名・動画タイトルの特徴的な語・出演者名を組み合わせ、Top と Latest の両方で検索する。公開日時以降の投稿を優先する。
- この動画・この回に明確に関係する投稿だけを扱う。同じ出演者の別番組や別の回の話題は除外する。
- 宣伝・スパム・切り抜き転載の告知より、反響が大きい投稿、議論が起きている論点、当事者・公式の投稿を優先する。
- 投稿URLは実際に存在を確認したものだけを載せる。URL・日付・投稿者を推測しない。
- 投稿内容を事実として断定せず、「〜という投稿がある」という温度感で書く。件数・割合を推定しない。
- 反応が見つからなければ topics を空配列、各文字列を空文字にする。水増ししない。
- 日本語で、調べ終えた最後に指定のJSONを1回だけ返す。途中経過のJSONは出さない。'''


def json_objects(text):
    objects, depth, start, in_string, escaped = [], 0, -1, False, False
    for index, char in enumerate(text):
        if in_string:
            if escaped: escaped = False
            elif char == '\\': escaped = True
            elif char == '"': in_string = False
        elif char == '"': in_string = depth > 0
        elif char == '{':
            if depth == 0: start = index
            depth += 1
        elif char == '}' and depth > 0:
            depth -= 1
            if depth == 0:
                try: objects.append(json.loads(text[start:index + 1]))
                except json.JSONDecodeError: pass
    return objects


def parse_output(stdout):
    lines = [line for line in stdout.strip().splitlines() if line.strip()]
    try: envelope = json.loads(stdout)
    except json.JSONDecodeError: envelope = json.loads(lines[-1]) if lines else {}
    if envelope.get('type') == 'error': raise ValueError(str(envelope.get('message') or 'Grokでエラーが発生しました。'))
    payload = envelope.get('structured_output') or envelope.get('structuredOutput') or envelope.get('text')
    if isinstance(payload, dict): return payload
    if not isinstance(payload, str): raise ValueError('Grokの回答を取得できませんでした。')
    objects = json_objects(payload)
    if not objects: raise ValueError('Grokの回答にJSONが含まれていません。')
    return objects[-1]  # Grok may emit interim JSON before the final answer.


def sanitize(value):
    text = lambda v, n: v.strip()[:n] if isinstance(v, str) else ''
    topics = []
    for topic in (value.get('topics') if isinstance(value.get('topics'), list) else [])[:4]:
        if not isinstance(topic, dict): continue
        posts = [{'url': p['url'], 'author': text(p.get('author'), 100), 'postedAt': text(p.get('postedAt'), 20), 'gist': text(p.get('gist'), 400)}
                 for p in (topic.get('posts') or []) if isinstance(p, dict) and isinstance(p.get('url'), str) and POST_URL.match(p['url']) and text(p.get('gist'), 400)][:3]
        if posts and text(topic.get('title'), 100): topics.append({'title': text(topic['title'], 100), 'summary': text(topic.get('summary'), 600), 'posts': posts})
    return {'summary': text(value.get('summary'), 600), 'tone': text(value.get('tone'), 400), 'comparison': text(value.get('comparison'), 600), 'topics': topics}


def process(store, run_id, runner=None):
    state = store.get(run_id)
    previous = jev.restore_previous(state)
    result = state.setdefault('x_pulse', {})
    result.update(status='running', error=None)
    state.update(status='running', stage='x')
    store.save(state)
    started = time.monotonic()
    try:
        if not enabled(): raise ValueError('X_SEARCH=off のためX検索は無効です。')
        grok = executable()
        if not grok and runner is None: raise ValueError('Grok CLIが見つかりません。`grok login` 済みのGrok CLIが必要です。')
        command = [grok or 'grok', '-p', prompt(state), '--json-schema', json.dumps(SCHEMA, ensure_ascii=False), '--output-format', 'json', '--tools', 'x_search,web_search', '--always-approve', '--max-turns', '12']
        if os.getenv('GROK_MODEL'): command += ['-m', os.getenv('GROK_MODEL')]
        with tempfile.TemporaryDirectory() as cwd:
            stdout = (runner or run)(command + ['--cwd', cwd], cwd, lambda: store.stopped(run_id))
        result.update(sanitize(parse_output(stdout)), status='completed', observed_at=now())
    except InterruptedError as exc:
        result.update(status='stopped', error=str(exc))
    except (ValueError, json.JSONDecodeError, TimeoutError) as exc:
        result.update(status='failed', error=str(exc)[:300])
    except Exception as exc:
        result.update(status='failed', error=f'X検索に失敗しました：{str(exc)[:300]}')
    finally:
        result['elapsed_seconds'] = round(time.monotonic() - started, 1)
        state.update(status=previous[0], stage=previous[1], error_message=previous[2])
        store.save(state)


def run(command, cwd, stopped):
    child = subprocess.Popen(command, cwd=cwd, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    deadline = time.monotonic() + TIMEOUT_SECONDS
    try:
        while True:
            try:
                stdout, stderr = child.communicate(timeout=2)
                break
            except subprocess.TimeoutExpired:
                if stopped(): raise InterruptedError('停止しました。')
                if time.monotonic() >= deadline: raise TimeoutError(f'X検索が{TIMEOUT_SECONDS // 60}分以内に完了しませんでした。')
    finally:
        if child.poll() is None: child.kill(); child.communicate()
    if child.returncode and not stdout.strip(): raise ValueError((stderr.strip().splitlines() or [f'Grokが終了コード{child.returncode}で停止しました。'])[-1][:300])
    return stdout


def report(state):
    return {**state.get('x_pulse', {'status': 'not_started'}), 'enabled': enabled() and bool(executable())}

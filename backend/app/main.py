from __future__ import annotations

import os
import shutil
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Literal

from dotenv import load_dotenv
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from .codex_client import CODEX_MODEL, CODEX_REASONING_EFFORT
from .opinion_analysis import Observation
from .opinion_service import OpinionStore
from .youtube import YouTubeCommentClient

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / '.env')
DATA_DIR = Path(os.getenv('DATA_DIR') or ROOT_DIR / 'data')
DB_PATH = Path(os.getenv('DATABASE_URL') or DATA_DIR / 'app.sqlite3')
opinion_store = OpinionStore(DB_PATH)
youtube_client = YouTubeCommentClient(DATA_DIR, ROOT_DIR / 'fixtures' / 'sample_comments_drawme.jsonl')
job_executor = ThreadPoolExecutor(max_workers=1)
app = FastAPI(title='YouTube Comment Insights')
app.add_middleware(CORSMiddleware, allow_origins=['http://127.0.0.1', 'http://localhost'], allow_origin_regex=r'http://127\.0\.0\.1:\d+|http://localhost:\d+', allow_methods=['*'], allow_headers=['*'])


class RequestModel(BaseModel):
    model_config = ConfigDict(extra='forbid')


class RunCreateRequest(RequestModel):
    url: str = Field(min_length=1, max_length=4096)
    max_comments: int = Field(default=5000, ge=1, le=5000)
    reply_fetch_mode: Literal['none', 'full'] = 'full'
    force_refresh: bool = False


class OpinionAction(RequestModel):
    action: Literal['continue', 'stop', 'resume']


class TranscriptImport(RequestModel):
    content: str = Field(min_length=1, max_length=5_000_000)


class OpinionCorrection(RequestModel):
    comment_id: str = ''
    observations: list[Observation] | None = None
    rename_from: str | None = Field(default=None, max_length=160)
    rename_to: str | None = Field(default=None, min_length=1, max_length=160)


class DataAction(RequestModel):
    action: Literal['delete_run', 'delete_all_runs', 'archive_youtube_cache', 'delete_youtube_cache']
    run_id: str | None = None


@app.exception_handler(KeyError)
async def not_found(_request: Request, exc: KeyError) -> JSONResponse:
    return JSONResponse(status_code=404, content={'detail': str(exc)})


@app.exception_handler(ValueError)
async def bad_input(_request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=400, content={'detail': str(exc)})


@app.get('/api/health')
def health() -> dict[str, str]:
    return {'status': 'ok', 'report_schema': 'report.v3'}


@app.get('/api/settings')
def settings() -> dict[str, Any]:
    return {'youtube_api_key_configured': bool(os.getenv('YOUTUBE_API_KEY')), 'youtube_api_key_env_name': 'YOUTUBE_API_KEY', 'max_comments': {'default': 5000, 'min': 1, 'max': 5000}, 'reply_fetch_modes': [{'value': 'none', 'label': '親コメントのみ', 'uses_extra_quota': False}, {'value': 'full', 'label': '返信を追加取得する', 'uses_extra_quota': True}], 'llm_provider': 'codex_app_server', 'model': CODEX_MODEL, 'effort': CODEX_REASONING_EFFORT}


def directory_summary(path: Path) -> dict[str, Any]:
    files = [file for file in path.rglob('*') if file.is_file()] if path.exists() else []
    return {'bytes': sum(file.stat().st_size for file in files), 'file_count': len(files)}


@app.get('/api/data/summary')
def data_summary() -> dict[str, Any]:
    return {'youtube_cache': directory_summary(DATA_DIR / 'youtube_cache'), 'runs': {'bytes': DB_PATH.stat().st_size}, 'total_bytes': directory_summary(DATA_DIR)['bytes'], 'run_count': len(opinion_store.list_runs())}


@app.post('/api/data/actions')
def data_actions(request: DataAction) -> dict[str, Any]:
    if request.action == 'delete_run':
        if not request.run_id:
            raise ValueError('run_idが必要です。')
        return opinion_store.delete(request.run_id)
    if request.action == 'delete_all_runs':
        with opinion_store.lock:
            runs = opinion_store.list_runs()
            if any(run['status'] in ('running', 'queued') for run in runs):
                raise ValueError('実行中の分析は停止してから削除してください。')
            for run in runs:
                opinion_store.delete(run['run_id'])
        return {'status': 'deleted', 'deleted_count': len(runs)}
    cache = DATA_DIR / 'youtube_cache'
    if cache.exists():
        if request.action == 'archive_youtube_cache':
            from datetime import datetime
            archive = DATA_DIR / 'archive' / f'youtube_cache_{datetime.now().strftime("%Y%m%d_%H%M%S_%f")}'
            archive.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(cache), str(archive))
        else:
            shutil.rmtree(cache)
    return {'status': 'completed'}


def enqueue_opinion(run_id: str, action: str) -> dict[str, str]:
    opinion_store.queue(run_id, action)
    job_executor.submit(opinion_store.process, run_id, youtube_client, lambda *_: None)
    return {'run_id': run_id, 'status': 'queued'}


@app.post('/api/runs')
def create_run(request: RunCreateRequest) -> dict[str, str]:
    config = request.model_dump()
    seed = None if request.force_refresh else opinion_store.latest_seed(request.url, request.reply_fetch_mode)
    run_id = opinion_store.create(request.url, config, seed)
    return enqueue_opinion(run_id, 'resume' if seed else 'fetch')


@app.get('/api/runs')
def list_runs() -> dict[str, Any]:
    return {'runs': sorted(opinion_store.list_runs(), key=lambda run: run['created_at'], reverse=True)}


@app.get('/api/runs/{run_id}')
def get_run(run_id: str) -> dict[str, Any]:
    return opinion_store.run_info(run_id)


@app.get('/api/runs/{run_id}/report')
def get_report(run_id: str) -> dict[str, Any]:
    return opinion_store.report(run_id)


@app.get('/api/runs/{run_id}/export')
def export_run(run_id: str) -> dict[str, Any]:
    state = opinion_store.get(run_id)
    return {key: value for key, value in state.items() if key not in ('ai_cache', 'last_ai_key')}


@app.get('/api/runs/{run_id}/comments')
def get_comments(run_id: str, group_id: str | None = None, search: str | None = None, analysis_status: Literal['held'] | None = None, offset: int = Query(default=0, ge=0), limit: int = Query(default=30, ge=1, le=100)) -> dict[str, Any]:
    return opinion_store.comments_page(run_id, group_id, search, offset, limit, analysis_status)


@app.post('/api/runs/{run_id}/actions')
def opinion_action(run_id: str, request: OpinionAction) -> dict[str, Any]:
    if request.action == 'stop':
        opinion_store.stop(run_id)
        return {'status': 'stop_requested', 'run_id': run_id}
    return enqueue_opinion(run_id, request.action)


@app.post('/api/runs/{run_id}/transcript')
def import_transcript(run_id: str, request: TranscriptImport) -> dict[str, Any]:
    opinion_store.import_transcript(run_id, request.content)
    return enqueue_opinion(run_id, 'resume')


@app.post('/api/runs/{run_id}/opinion-corrections')
def correct_opinion(run_id: str, request: OpinionCorrection) -> dict[str, Any]:
    opinion_store.correct(run_id, request.comment_id, [obs.model_dump() for obs in request.observations] if request.observations is not None else None, request.rename_from, request.rename_to)
    return enqueue_opinion(run_id, 'resume')


@app.post('/api/runs/{run_id}/review/complete')
def complete_review(run_id: str) -> dict[str, Any]:
    with opinion_store.lock:
        state = opinion_store.get(run_id)
        if state['status'] != 'completed':
            raise ValueError('分析が完了してから確認済みにしてください。')
        state['human_reviewed'] = True
        opinion_store.save(state)
    return opinion_store.run_info(run_id)


@app.post('/api/runs/{run_id}/reanalyze')
def reanalyze_opinions(run_id: str) -> dict[str, Any]:
    seed = opinion_store.get(run_id)
    new_run = opinion_store.create(seed['url'], seed['config'], seed)
    return enqueue_opinion(new_run, 'resume')

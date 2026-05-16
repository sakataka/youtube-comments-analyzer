from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .pipeline import AnalysisStore
from .youtube import FetchConfig, YouTubeCommentClient, parse_youtube_video_id


ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("DATA_DIR", ROOT_DIR / "data"))
DB_PATH = Path(os.getenv("DATABASE_URL", DATA_DIR / "app.sqlite3"))
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


class InspectRequest(BaseModel):
    url: str


class RunCreateRequest(BaseModel):
    url: str
    max_comments: int = Field(default=1000, ge=1, le=1000)
    reply_fetch_mode: Literal["none", "inline_subset", "full"] = "none"
    fetch_order: Literal["relevance", "time"] = "relevance"
    use_llm: bool = False
    use_embeddings: bool = False


class CandidateActionsRequest(BaseModel):
    actions: list[dict[str, Any]]


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/videos/inspect")
def inspect_video(request: InspectRequest) -> dict[str, Any]:
    try:
        video_id = parse_youtube_video_id(request.url)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "video_id": video_id,
        "title": None,
        "channel_title": None,
        "comment_count_available": False,
        "note": "MVP-0 inspect は API quota を消費しないため metadata fetch を行いません",
    }


@app.post("/api/runs")
def create_run(request: RunCreateRequest) -> dict[str, str]:
    try:
        bundle = youtube_client.fetch_video_bundle(
            request.url,
            FetchConfig(
                max_comments=request.max_comments,
                fetch_order=request.fetch_order,
                reply_fetch_mode=request.reply_fetch_mode,
            ),
        )
        run_id = store.create_run(bundle, request.model_dump())
        return {"run_id": run_id, "status": "waiting_for_review"}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


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


@app.post("/api/runs/{run_id}/continue")
def continue_run(run_id: str) -> dict[str, Any]:
    try:
        store.classify_and_report(run_id)
        return store.get_run(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@app.get("/api/runs/{run_id}/report")
def get_report(run_id: str) -> dict[str, Any]:
    try:
        return store.get_latest_report(run_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

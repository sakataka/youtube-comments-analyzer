from __future__ import annotations

import json
import os
import re
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")


class YouTubeUrlError(ValueError):
    pass


def parse_youtube_video_id(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower()
    path_parts = [part for part in parsed.path.split("/") if part]

    video_id: str | None = None
    if host in {"www.youtube.com", "youtube.com", "m.youtube.com"}:
      if path_parts[:1] == ["watch"]:
          video_id = urllib.parse.parse_qs(parsed.query).get("v", [None])[0]
      elif len(path_parts) >= 2 and path_parts[0] in {"shorts", "embed"}:
          video_id = path_parts[1]
    elif host == "youtu.be" and path_parts:
      video_id = path_parts[0]

    if not video_id or not VIDEO_ID_RE.match(video_id):
        raise YouTubeUrlError("YouTube video_id を抽出できませんでした")
    return video_id


@dataclass(frozen=True)
class FetchConfig:
    max_comments: int = 1000
    fetch_order: str = "relevance"
    reply_fetch_mode: str = "none"


class YouTubeCommentClient:
    def __init__(self, data_dir: Path, fixture_path: Path):
        self.data_dir = data_dir
        self.fixture_path = fixture_path
        self.cache_dir = data_dir / "youtube_cache"

    def fetch_video_bundle(self, url: str, config: FetchConfig) -> dict[str, Any]:
        video_id = parse_youtube_video_id(url)
        cache_file = self._cache_file(video_id, config)
        if cache_file.exists():
            comments = self._read_jsonl(cache_file)
            metadata = self._read_metadata(cache_file)
            return self._bundle(url, video_id, metadata, comments, "cache")

        api_key = os.getenv("YOUTUBE_API_KEY")
        if api_key:
            bundle = self._fetch_live(api_key, url, video_id, config)
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            self._write_jsonl(cache_file, bundle["comments"])
            self._write_metadata(cache_file, bundle["video"])
            bundle["fetch_summary"]["source"] = "youtube_api"
            return bundle

        comments = self._read_jsonl(self.fixture_path)
        metadata = {
            "youtube_video_id": video_id,
            "url": url,
            "title": "Fixture: DRAW ME みりちゃむ 福留光帆 森脇梨々夏 風吹ケイ 立野沙紀 二瓶有加",
            "channel_title": "Fixture",
            "description": "YOUTUBE_API_KEY がない場合の deterministic seed data",
            "published_at": None,
        }
        return self._bundle(url, video_id, metadata, comments[: config.max_comments], "fixture")

    def _fetch_live(self, api_key: str, url: str, video_id: str, config: FetchConfig) -> dict[str, Any]:
        video = self._fetch_video_metadata(api_key, url, video_id)
        comments: list[dict[str, Any]] = []
        page_token: str | None = None
        source_order = 0
        while len(comments) < config.max_comments:
            query = {
                "key": api_key,
                "part": "snippet",
                "videoId": video_id,
                "maxResults": min(100, config.max_comments - len(comments)),
                "textFormat": "plainText",
                "order": config.fetch_order,
            }
            if page_token:
                query["pageToken"] = page_token
            payload = self._get_json("https://www.googleapis.com/youtube/v3/commentThreads", query)
            for item in payload.get("items", []):
                snippet = item["snippet"]["topLevelComment"]["snippet"]
                comments.append({
                    "comment_id": item["snippet"]["topLevelComment"]["id"],
                    "parent_comment_id": None,
                    "author_display_name": snippet.get("authorDisplayName"),
                    "author_channel_id": (snippet.get("authorChannelId") or {}).get("value"),
                    "text_original": snippet.get("textDisplay") or snippet.get("textOriginal") or "",
                    "like_count": snippet.get("likeCount") or 0,
                    "published_at": snippet.get("publishedAt"),
                    "updated_at": snippet.get("updatedAt"),
                    "is_reply": False,
                    "reply_count": item["snippet"].get("totalReplyCount") or 0,
                    "source_order": source_order,
                    "api_relevance_order": source_order if config.fetch_order == "relevance" else None,
                })
                source_order += 1
            page_token = payload.get("nextPageToken")
            if not page_token:
                break
        return self._bundle(url, video_id, video, comments, "youtube_api")

    def _fetch_video_metadata(self, api_key: str, url: str, video_id: str) -> dict[str, Any]:
        payload = self._get_json("https://www.googleapis.com/youtube/v3/videos", {
            "key": api_key,
            "part": "snippet",
            "id": video_id,
        })
        items = payload.get("items", [])
        if not items:
            raise RuntimeError("YouTube 動画メタデータを取得できませんでした")
        snippet = items[0]["snippet"]
        return {
            "youtube_video_id": video_id,
            "url": url,
            "title": snippet.get("title") or "",
            "channel_title": snippet.get("channelTitle") or "",
            "description": snippet.get("description") or "",
            "published_at": snippet.get("publishedAt"),
        }

    def _get_json(self, endpoint: str, query: dict[str, Any]) -> dict[str, Any]:
        request_url = f"{endpoint}?{urllib.parse.urlencode(query)}"
        with urllib.request.urlopen(request_url, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))

    def _cache_file(self, video_id: str, config: FetchConfig) -> Path:
        name = f"{config.fetch_order}_{config.reply_fetch_mode}_{config.max_comments}.jsonl"
        return self.cache_dir / video_id / name

    def _bundle(
        self,
        url: str,
        video_id: str,
        metadata: dict[str, Any],
        comments: list[dict[str, Any]],
        source: str,
    ) -> dict[str, Any]:
        fetched_at = datetime.now(timezone.utc).isoformat()
        video = {
            "youtube_video_id": video_id,
            "url": metadata.get("url") or url,
            "title": metadata.get("title") or "",
            "channel_title": metadata.get("channel_title") or "",
            "description": metadata.get("description") or "",
            "published_at": metadata.get("published_at"),
        }
        return {
            "video": video,
            "comments": comments,
            "fetch_summary": {
                "source": source,
                "fetched_at": fetched_at,
                "fetched_top_level_count": sum(1 for comment in comments if not comment.get("is_reply")),
                "fetched_reply_count": sum(1 for comment in comments if comment.get("is_reply")),
                "total_reply_count_from_threads": sum(int(comment.get("reply_count") or 0) for comment in comments),
                "total_like_count": sum(int(comment.get("like_count") or 0) for comment in comments),
            },
        }

    def _read_jsonl(self, path: Path) -> list[dict[str, Any]]:
        with path.open("r", encoding="utf-8") as handle:
            return [json.loads(line) for line in handle if line.strip()]

    def _write_jsonl(self, path: Path, rows: list[dict[str, Any]]) -> None:
        with path.open("w", encoding="utf-8") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def _read_metadata(self, cache_file: Path) -> dict[str, Any]:
        metadata_file = cache_file.with_suffix(".metadata.json")
        if not metadata_file.exists():
            return {}
        return json.loads(metadata_file.read_text(encoding="utf-8"))

    def _write_metadata(self, cache_file: Path, metadata: dict[str, Any]) -> None:
        cache_file.with_suffix(".metadata.json").write_text(
            json.dumps(metadata, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

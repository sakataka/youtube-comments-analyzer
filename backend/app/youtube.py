from __future__ import annotations

import json
import re
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

VIDEO_ID_RE = re.compile(r'^[A-Za-z0-9_-]{11}$')

class YouTubeUrlError(ValueError):
    pass


def parse_youtube_video_id(url: str) -> str:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme not in {"http", "https"}:
        raise YouTubeUrlError("httpまたはhttpsのYouTube URLを指定してください。")
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


def optional_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def comment_from_snippet(
    comment_id: str,
    snippet: dict[str, Any],
    source_order: int,
    parent_comment_id: str | None,
    is_reply: bool,
    reply_count: int = 0,
) -> dict[str, Any]:
    return {
        "comment_id": comment_id,
        "parent_comment_id": parent_comment_id,
        "author_display_name": snippet.get("authorDisplayName"),
        "author_channel_id": (snippet.get("authorChannelId") or {}).get("value"),
        "text_original": snippet.get("textDisplay") or snippet.get("textOriginal") or "",
        "like_count": snippet.get("likeCount") or 0,
        "published_at": snippet.get("publishedAt"),
        "updated_at": snippet.get("updatedAt"),
        "is_reply": is_reply,
        "reply_count": reply_count,
        "source_order": source_order,
    }


def top_level_comment_from_thread(item: dict[str, Any], source_order: int) -> dict[str, Any]:
    top_comment = item["snippet"]["topLevelComment"]
    return comment_from_snippet(
        comment_id=top_comment["id"],
        snippet=top_comment["snippet"],
        source_order=source_order,
        parent_comment_id=None,
        is_reply=False,
        reply_count=item["snippet"].get("totalReplyCount") or 0,
    )



class YouTubeCommentClient:
    def __init__(self, data_dir: Path, fixture_path: Path):
        self.data_dir = data_dir
        self.fixture_path = fixture_path
        self.cache_dir = data_dir / 'youtube_cache'

    def _read_jsonl(self, path: Path) -> list[dict[str, Any]]:
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

    def _fetch_video_metadata(self, api_key: str, url: str, video_id: str) -> dict[str, Any]:
        payload = self._get_json("https://www.googleapis.com/youtube/v3/videos", {
            "key": api_key,
            "part": "snippet,statistics",
            "id": video_id,
        })
        items = payload.get("items", [])
        if not items:
            raise RuntimeError("YouTube 動画メタデータを取得できませんでした")
        snippet = items[0]["snippet"]
        statistics = items[0].get("statistics", {})
        comment_count = optional_int(statistics.get("commentCount"))
        return {
            "youtube_video_id": video_id,
            "url": url,
            "title": snippet.get("title") or "",
            "channel_title": snippet.get("channelTitle") or "",
            "description": snippet.get("description") or "",
            "published_at": snippet.get("publishedAt"),
            "youtube_comment_count": comment_count,
            "comment_count_available": comment_count is not None,
            "youtube_view_count": optional_int(statistics.get("viewCount")),
            "youtube_like_count": optional_int(statistics.get("likeCount")),
        }

    def _get_json(self, endpoint: str, query: dict[str, Any]) -> dict[str, Any]:
        request_url = f"{endpoint}?{urllib.parse.urlencode(query)}"
        with urllib.request.urlopen(request_url, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))

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
    fetch_order: str,
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
        "api_relevance_order": source_order if fetch_order == "relevance" else None,
    }


def top_level_comment_from_thread(item: dict[str, Any], source_order: int, fetch_order: str) -> dict[str, Any]:
    top_comment = item["snippet"]["topLevelComment"]
    return comment_from_snippet(
        comment_id=top_comment["id"],
        snippet=top_comment["snippet"],
        source_order=source_order,
        fetch_order=fetch_order,
        parent_comment_id=None,
        is_reply=False,
        reply_count=item["snippet"].get("totalReplyCount") or 0,
    )


def inline_reply_comments_from_thread(
    item: dict[str, Any],
    first_source_order: int,
    fetch_order: str,
) -> list[dict[str, Any]]:
    parent_comment_id = item["snippet"]["topLevelComment"]["id"]
    replies = item.get("replies", {}).get("comments", [])
    output: list[dict[str, Any]] = []
    for offset, reply in enumerate(replies):
        output.append(
            comment_from_snippet(
                comment_id=reply["id"],
                snippet=reply["snippet"],
                source_order=first_source_order + offset,
                fetch_order=fetch_order,
                parent_comment_id=parent_comment_id,
                is_reply=True,
            )
        )
    return output


@dataclass(frozen=True)
class FetchConfig:
    max_comments: int = 1000
    fetch_order: str = "relevance"
    reply_fetch_mode: str = "none"
    force_refresh: bool = False


class YouTubeCommentClient:
    def __init__(self, data_dir: Path, fixture_path: Path):
        self.data_dir = data_dir
        self.fixture_path = fixture_path
        self.cache_dir = data_dir / "youtube_cache"

    def fetch_video_bundle(self, url: str, config: FetchConfig) -> dict[str, Any]:
        video_id = parse_youtube_video_id(url)
        cache_file = self._cache_file(video_id, config)
        if cache_file.exists() and not config.force_refresh:
            comments = self._read_jsonl(cache_file)
            metadata = self._read_metadata(cache_file)
            return self._bundle(url, video_id, metadata, comments, "cache")

        api_key = os.getenv("YOUTUBE_API_KEY")
        if api_key:
            cached_comments = self._read_jsonl(cache_file) if cache_file.exists() else []
            bundle = self._fetch_live(api_key, url, video_id, config)
            if cached_comments and config.force_refresh:
                bundle["comments"] = merge_comments(cached_comments, bundle["comments"], config.fetch_order)
                bundle = self._bundle(url, video_id, bundle["video"], bundle["comments"], "youtube_api_diff")
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            self._write_jsonl(cache_file, bundle["comments"])
            self._write_metadata(cache_file, bundle["video"])
            return bundle

        if cache_file.exists():
            comments = self._read_jsonl(cache_file)
            metadata = self._read_metadata(cache_file)
            return self._bundle(url, video_id, metadata, comments, "cache")

        comments = self._read_jsonl(self.fixture_path)
        metadata = {
            "youtube_video_id": video_id,
            "url": url,
            "title": "Fixture: DRAW ME みりちゃむ 福留光帆 森脇梨々夏 風吹ケイ 立野沙紀 二瓶有加",
            "channel_title": "Fixture",
            "description": "YOUTUBE_API_KEY がない場合の deterministic seed data",
            "published_at": None,
            "youtube_comment_count": None,
            "comment_count_available": False,
            "youtube_view_count": None,
            "youtube_like_count": None,
        }
        return self._bundle(url, video_id, metadata, comments[: config.max_comments], "fixture")

    def inspect_video(self, url: str, fetch_metadata: bool = False) -> dict[str, Any]:
        video_id = parse_youtube_video_id(url)
        if fetch_metadata:
            api_key = os.getenv("YOUTUBE_API_KEY")
            if not api_key:
                raise RuntimeError("YOUTUBE_API_KEY が未設定のため metadata を取得できません")
            metadata = self._fetch_video_metadata(api_key, url, video_id)
            return {**metadata, "video_id": video_id, "metadata_source": "youtube_api"}
        cache_root = self.cache_dir / video_id
        metadata_files = sorted(cache_root.glob("*.metadata.json")) if cache_root.exists() else []
        if metadata_files:
            metadata = json.loads(metadata_files[-1].read_text(encoding="utf-8"))
            return {**metadata, "video_id": video_id, "metadata_source": "cache"}
        return {
            "video_id": video_id,
            "youtube_video_id": video_id,
            "url": url,
            "title": None,
            "channel_title": None,
            "comment_count_available": False,
            "metadata_source": "none",
        }

    def _fetch_live(self, api_key: str, url: str, video_id: str, config: FetchConfig) -> dict[str, Any]:
        video = self._fetch_video_metadata(api_key, url, video_id)
        comments: list[dict[str, Any]] = []
        page_token: str | None = None
        source_order = 0
        while len(comments) < config.max_comments:
            query = {
                "key": api_key,
                "part": "snippet,replies" if config.reply_fetch_mode in {"inline_subset", "full"} else "snippet",
                "videoId": video_id,
                "maxResults": min(100, config.max_comments - len(comments)),
                "textFormat": "plainText",
                "order": config.fetch_order,
            }
            if page_token:
                query["pageToken"] = page_token
            payload = self._get_json("https://www.googleapis.com/youtube/v3/commentThreads", query)
            for item in payload.get("items", []):
                top_level = top_level_comment_from_thread(item, source_order, config.fetch_order)
                comments.append(top_level)
                source_order += 1
                if config.reply_fetch_mode == "inline_subset":
                    for reply in inline_reply_comments_from_thread(item, source_order, config.fetch_order):
                        if len(comments) >= config.max_comments:
                            break
                        comments.append(reply)
                        source_order += 1
                elif config.reply_fetch_mode == "full" and top_level["reply_count"] > 0:
                    replies = self._fetch_replies_live(
                        api_key=api_key,
                        parent_comment_id=top_level["comment_id"],
                        first_source_order=source_order,
                        fetch_order=config.fetch_order,
                        max_replies=config.max_comments - len(comments),
                    )
                    comments.extend(replies)
                    source_order += len(replies)
                if len(comments) >= config.max_comments:
                    break
            page_token = payload.get("nextPageToken")
            if not page_token:
                break
        return self._bundle(url, video_id, video, comments, "youtube_api")

    def _fetch_replies_live(
        self,
        api_key: str,
        parent_comment_id: str,
        first_source_order: int,
        fetch_order: str,
        max_replies: int,
    ) -> list[dict[str, Any]]:
        replies: list[dict[str, Any]] = []
        page_token: str | None = None
        while len(replies) < max_replies:
            query = {
                "key": api_key,
                "part": "snippet",
                "parentId": parent_comment_id,
                "maxResults": min(100, max_replies - len(replies)),
                "textFormat": "plainText",
            }
            if page_token:
                query["pageToken"] = page_token
            payload = self._get_json("https://www.googleapis.com/youtube/v3/comments", query)
            for item in payload.get("items", []):
                replies.append(
                    comment_from_snippet(
                        comment_id=item["id"],
                        snippet=item["snippet"],
                        source_order=first_source_order + len(replies),
                        fetch_order=fetch_order,
                        parent_comment_id=parent_comment_id,
                        is_reply=True,
                    )
                )
                if len(replies) >= max_replies:
                    break
            page_token = payload.get("nextPageToken")
            if not page_token:
                break
        return replies

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
            "youtube_comment_count": metadata.get("youtube_comment_count"),
            "comment_count_available": bool(metadata.get("comment_count_available")),
            "youtube_view_count": metadata.get("youtube_view_count"),
            "youtube_like_count": metadata.get("youtube_like_count"),
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


def merge_comments(
    cached_comments: list[dict[str, Any]],
    fresh_comments: list[dict[str, Any]],
    fetch_order: str,
) -> list[dict[str, Any]]:
    seen: set[str] = set()
    merged: list[dict[str, Any]] = []
    for comment in [*fresh_comments, *cached_comments]:
        comment_id = comment.get("comment_id")
        if not comment_id or comment_id in seen:
            continue
        seen.add(comment_id)
        merged.append(dict(comment))
    for index, comment in enumerate(merged):
        comment["source_order"] = index
        comment["api_relevance_order"] = index if fetch_order == "relevance" else None
    return merged

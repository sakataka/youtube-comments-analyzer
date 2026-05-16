import unittest
import tempfile
from pathlib import Path

from backend.app.youtube import (
    FetchConfig,
    YouTubeCommentClient,
    YouTubeUrlError,
    inline_reply_comments_from_thread,
    merge_comments,
    parse_youtube_video_id,
    top_level_comment_from_thread,
)


class YouTubeUrlParsingTest(unittest.TestCase):
    def test_supported_urls(self):
        urls = [
            "https://www.youtube.com/watch?v=vlpLbiqNhLo",
            "https://youtu.be/vlpLbiqNhLo",
            "https://www.youtube.com/shorts/vlpLbiqNhLo",
            "https://www.youtube.com/embed/vlpLbiqNhLo",
            "https://www.youtube.com/watch?v=vlpLbiqNhLo&t=10s",
            "https://www.youtube.com/watch?v=vlpLbiqNhLo&list=abc",
        ]
        for url in urls:
            with self.subTest(url=url):
                self.assertEqual(parse_youtube_video_id(url), "vlpLbiqNhLo")

    def test_rejects_invalid_urls(self):
        for url in ["https://www.youtube.com/playlist?list=abc", "not a url", "https://example.com/watch?v=vlpLbiqNhLo"]:
            with self.subTest(url=url):
                with self.assertRaises(YouTubeUrlError):
                    parse_youtube_video_id(url)

    def test_inline_reply_comment_mapping(self):
        item = {
            "snippet": {
                "totalReplyCount": 2,
                "topLevelComment": {
                    "id": "top-1",
                    "snippet": {
                        "authorDisplayName": "top author",
                        "authorChannelId": {"value": "channel-top"},
                        "textOriginal": "みりちゃむのトップコメント",
                        "likeCount": 3,
                        "publishedAt": "2026-01-01T00:00:00Z",
                        "updatedAt": "2026-01-01T00:00:00Z",
                    },
                },
            },
            "replies": {
                "comments": [
                    {
                        "id": "reply-1",
                        "snippet": {
                            "authorDisplayName": "reply author",
                            "authorChannelId": {"value": "channel-reply"},
                            "textOriginal": "返信の立野さん",
                            "likeCount": 1,
                            "publishedAt": "2026-01-01T00:01:00Z",
                            "updatedAt": "2026-01-01T00:01:00Z",
                        },
                    }
                ]
            },
        }
        top = top_level_comment_from_thread(item, 10, "relevance")
        replies = inline_reply_comments_from_thread(item, 11, "relevance")

        self.assertEqual(top["comment_id"], "top-1")
        self.assertFalse(top["is_reply"])
        self.assertEqual(top["reply_count"], 2)
        self.assertEqual(replies[0]["comment_id"], "reply-1")
        self.assertEqual(replies[0]["parent_comment_id"], "top-1")
        self.assertTrue(replies[0]["is_reply"])
        self.assertEqual(replies[0]["source_order"], 11)

    def test_full_reply_mode_fetches_replies_with_comments_list(self):
        class FakeClient(YouTubeCommentClient):
            def __init__(self, data_dir: Path):
                super().__init__(data_dir, data_dir / "missing.jsonl")
                self.endpoints: list[str] = []

            def _get_json(self, endpoint: str, query: dict):
                self.endpoints.append(endpoint)
                if endpoint.endswith("/videos"):
                    return {
                        "items": [
                            {
                                "snippet": {"title": "title", "channelTitle": "channel", "description": ""},
                                "statistics": {"commentCount": "3"},
                            }
                        ]
                    }
                if endpoint.endswith("/commentThreads"):
                    return {
                        "items": [
                            {
                                "snippet": {
                                    "totalReplyCount": 2,
                                    "topLevelComment": {
                                        "id": "top-1",
                                        "snippet": {
                                            "textOriginal": "みりちゃむ",
                                            "likeCount": 3,
                                            "publishedAt": "2026-01-01T00:00:00Z",
                                            "updatedAt": "2026-01-01T00:00:00Z",
                                        },
                                    },
                                }
                            }
                        ]
                    }
                if endpoint.endswith("/comments"):
                    return {
                        "items": [
                            {
                                "id": "reply-1",
                                "snippet": {
                                    "textOriginal": "返信1",
                                    "likeCount": 1,
                                    "publishedAt": "2026-01-01T00:01:00Z",
                                    "updatedAt": "2026-01-01T00:01:00Z",
                                },
                            },
                            {
                                "id": "reply-2",
                                "snippet": {
                                    "textOriginal": "返信2",
                                    "likeCount": 2,
                                    "publishedAt": "2026-01-01T00:02:00Z",
                                    "updatedAt": "2026-01-01T00:02:00Z",
                                },
                            },
                        ]
                    }
                raise AssertionError(endpoint)

        with tempfile.TemporaryDirectory() as tmp:
            client = FakeClient(Path(tmp))
            bundle = client._fetch_live(
                "fake-key",
                "https://www.youtube.com/watch?v=vlpLbiqNhLo",
                "vlpLbiqNhLo",
                FetchConfig(max_comments=10, reply_fetch_mode="full"),
            )

        self.assertEqual([comment["comment_id"] for comment in bundle["comments"]], ["top-1", "reply-1", "reply-2"])
        self.assertEqual(bundle["fetch_summary"]["fetched_reply_count"], 2)
        self.assertIn("https://www.googleapis.com/youtube/v3/comments", client.endpoints)

    def test_merge_comments_deduplicates_and_keeps_fresh_order(self):
        cached = [
            {"comment_id": "old", "source_order": 0, "api_relevance_order": 0},
            {"comment_id": "same", "source_order": 1, "api_relevance_order": 1},
        ]
        fresh = [
            {"comment_id": "new", "source_order": 0, "api_relevance_order": 0},
            {"comment_id": "same", "source_order": 1, "api_relevance_order": 1},
        ]

        merged = merge_comments(cached, fresh, "relevance")

        self.assertEqual([comment["comment_id"] for comment in merged], ["new", "same", "old"])
        self.assertEqual([comment["source_order"] for comment in merged], [0, 1, 2])


if __name__ == "__main__":
    unittest.main()

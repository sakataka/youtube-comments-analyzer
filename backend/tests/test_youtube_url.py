import unittest
import tempfile
from pathlib import Path

from backend.app.youtube import (
    FetchConfig,
    YouTubeCommentClient,
    YouTubeUrlError,
    inline_reply_comments_from_thread,
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

    def test_full_reply_mode_is_not_implemented_yet(self):
        with tempfile.TemporaryDirectory() as tmp:
            client = YouTubeCommentClient(Path(tmp), Path(tmp) / "missing.jsonl")
            with self.assertRaises(RuntimeError):
                client.fetch_video_bundle(
                    "https://www.youtube.com/watch?v=vlpLbiqNhLo",
                    FetchConfig(max_comments=10, reply_fetch_mode="full"),
                )


if __name__ == "__main__":
    unittest.main()

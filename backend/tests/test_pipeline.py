import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.candidate_extraction import extract_candidate_tokens
from backend.app.llm_assist import parse_llm_assist_json
from backend.app.mention_classification import alias_matches
from backend.app.pipeline import AnalysisStore
from backend.app.youtube import FetchConfig, YouTubeCommentClient


ROOT = Path(__file__).resolve().parents[2]


class PipelineTest(unittest.TestCase):
    def test_candidate_token_extraction(self):
        tokens = extract_candidate_tokens("福留光帆ちゃんとみりちゃむさん、風吹ケイ #NOBROCK")
        self.assertIn("福留光帆", tokens)
        self.assertIn("みりちゃむ", tokens)
        self.assertIn("風吹ケイ", tokens)
        self.assertIn("NOBROCK", tokens)

    def test_metadata_list_token_extraction(self):
        tokens = extract_candidate_tokens(
            "DRAW ME（みりちゃむ・福留光帆・森脇梨々夏・風吹ケイ・立野沙紀・二瓶有加）",
            include_metadata_lists=True,
            include_loose_metadata=True,
        )
        self.assertIn("みりちゃむ", tokens)
        self.assertIn("立野沙紀", tokens)
        self.assertNotIn("DRAW", tokens)

    def test_alias_match(self):
        self.assertTrue(alias_matches("福留さんの空気がいい", "福留"))
        self.assertTrue(alias_matches("みりちゃむの返し", "みりちゃむ"))
        self.assertFalse(alias_matches("これは普通の文章", "福留"))

    def test_fixture_to_report_without_api_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            client = YouTubeCommentClient(data_dir, ROOT / "fixtures" / "sample_comments_drawme.jsonl")
            bundle = client.fetch_video_bundle(
                "https://www.youtube.com/watch?v=vlpLbiqNhLo",
                FetchConfig(max_comments=1000, fetch_order="relevance", reply_fetch_mode="none"),
            )
            self.assertEqual(bundle["fetch_summary"]["source"], "fixture")
            store = AnalysisStore(data_dir / "app.sqlite3", data_dir)
            run_id = store.create_run(
                bundle,
                {
                    "max_comments": 1000,
                    "reply_fetch_mode": "none",
                    "fetch_order": "relevance",
                    "use_llm": False,
                    "use_embeddings": False,
                },
            )
            candidates = store.get_candidates(run_id)
            self.assertGreater(len(candidates["persons"]), 0)
            by_name = {person["display_name"]: person for person in candidates["persons"]}
            self.assertEqual(by_name["みりちゃむ"]["status"], "accepted")
            mirichamu_alias = by_name["みりちゃむ"]["aliases"][0]
            self.assertEqual(mirichamu_alias["mention_comment_count"], by_name["みりちゃむ"]["accepted_mention_comment_count"])
            self.assertIn("representative_comments", mirichamu_alias)
            saki_aliases = {alias["alias_text"] for alias in by_name["立野沙紀"]["aliases"]}
            self.assertIn("立野", saki_aliases)
            self.assertIn("沙紀", saki_aliases)
            self.assertNotIn("立野", by_name)
            store.apply_candidate_actions(
                run_id,
                [
                    {
                        "type": "merge_person",
                        "source_person_id": by_name["ニシダ"]["person_id"],
                        "target_person_id": by_name["みりちゃむ"]["person_id"],
                    }
                ],
            )
            merged_candidates = store.get_candidates(run_id)
            merged_by_name = {person["display_name"]: person for person in merged_candidates["persons"]}
            self.assertEqual(merged_by_name["ニシダ"]["status"], "rejected")
            self.assertIn("ニシダ", {alias["alias_text"] for alias in merged_by_name["みりちゃむ"]["aliases"]})
            if "バランス" in by_name:
                self.assertEqual(by_name["バランス"]["status"], "rejected")
            report = store.classify_and_report(run_id)
            self.assertEqual(report["schema_version"], "report.v1")
            self.assertEqual(report["sections"]["appeal_summary"]["status"], "skipped")
            self.assertGreater(len(report["rankings"]["mention_ranking"]), 0)
            mentioned_comments = [comment for comment in report["comments"] if comment["mentioned_persons"]]
            self.assertGreater(len(mentioned_comments), 0)
            target_comment = mentioned_comments[0]
            target_person = target_comment["mentioned_persons"][0]
            updated_report = store.apply_comment_actions(
                run_id,
                [
                    {
                        "type": "remove_mention",
                        "comment_id": target_comment["comment_id"],
                        "person_id": target_person["person_id"],
                    }
                ],
            )
            updated_comment = next(comment for comment in updated_report["comments"] if comment["comment_id"] == target_comment["comment_id"])
            self.assertNotIn(target_person["person_id"], {person["person_id"] for person in updated_comment["mentioned_persons"]})
            self.assertTrue((data_dir / "runs" / run_id / "report.json").exists())

    def test_inline_subset_replies_are_saved_and_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            store = AnalysisStore(data_dir / "app.sqlite3", data_dir)
            bundle = {
                "video": {
                    "youtube_video_id": "vlpLbiqNhLo",
                    "url": "https://www.youtube.com/watch?v=vlpLbiqNhLo",
                    "title": "Fixture: みりちゃむ",
                    "channel_title": "Fixture",
                    "description": "",
                    "published_at": None,
                    "youtube_comment_count": None,
                    "comment_count_available": False,
                    "youtube_view_count": None,
                    "youtube_like_count": None,
                },
                "comments": [
                    {
                        "comment_id": "top-1",
                        "parent_comment_id": None,
                        "author_display_name": "top",
                        "author_channel_id": "top-channel",
                        "text_original": "トップコメント",
                        "like_count": 1,
                        "published_at": None,
                        "updated_at": None,
                        "is_reply": False,
                        "reply_count": 1,
                        "source_order": 0,
                        "api_relevance_order": 0,
                    },
                    {
                        "comment_id": "reply-1",
                        "parent_comment_id": "top-1",
                        "author_display_name": "reply",
                        "author_channel_id": "reply-channel",
                        "text_original": "返信でみりちゃむに言及",
                        "like_count": 2,
                        "published_at": None,
                        "updated_at": None,
                        "is_reply": True,
                        "reply_count": 0,
                        "source_order": 1,
                        "api_relevance_order": 1,
                    },
                ],
                "fetch_summary": {
                    "source": "fixture",
                    "fetched_at": "2026-01-01T00:00:00+00:00",
                    "fetched_top_level_count": 1,
                    "fetched_reply_count": 1,
                    "total_reply_count_from_threads": 1,
                    "total_like_count": 3,
                },
            }
            run_id = store.create_run(
                bundle,
                {
                    "max_comments": 2,
                    "reply_fetch_mode": "inline_subset",
                    "fetch_order": "relevance",
                    "use_llm": False,
                    "use_embeddings": False,
                },
            )
            report = store.classify_and_report(run_id)
            self.assertEqual(report["fetch_summary"]["fetched_top_level_count"], 1)
            self.assertEqual(report["fetch_summary"]["fetched_reply_count"], 1)
            reply_comment = next(comment for comment in report["comments"] if comment["is_reply"])
            self.assertEqual(reply_comment["parent_comment_id"], "top-1")
            self.assertTrue(reply_comment["mentioned_persons"])

    def test_unknown_alias_suggestions(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            store = AnalysisStore(data_dir / "app.sqlite3", data_dir)
            bundle = {
                "video": {
                    "youtube_video_id": "vlpLbiqNhLo",
                    "url": "https://www.youtube.com/watch?v=vlpLbiqNhLo",
                    "title": "Fixture: みりちゃむ",
                    "channel_title": "Fixture",
                    "description": "",
                    "published_at": None,
                    "youtube_comment_count": None,
                    "comment_count_available": False,
                    "youtube_view_count": None,
                    "youtube_like_count": None,
                },
                "comments": [
                    {
                        "comment_id": "comment-1",
                        "parent_comment_id": None,
                        "author_display_name": "a",
                        "author_channel_id": "a",
                        "text_original": "みりちゃむもミッタンも好き",
                        "like_count": 3,
                        "published_at": None,
                        "updated_at": None,
                        "is_reply": False,
                        "reply_count": 0,
                        "source_order": 0,
                        "api_relevance_order": 0,
                    },
                    {
                        "comment_id": "comment-2",
                        "parent_comment_id": None,
                        "author_display_name": "b",
                        "author_channel_id": "b",
                        "text_original": "ミッタンの返しが良い",
                        "like_count": 2,
                        "published_at": None,
                        "updated_at": None,
                        "is_reply": False,
                        "reply_count": 0,
                        "source_order": 1,
                        "api_relevance_order": 1,
                    },
                ],
                "fetch_summary": {
                    "source": "fixture",
                    "fetched_at": "2026-01-01T00:00:00+00:00",
                    "fetched_top_level_count": 2,
                    "fetched_reply_count": 0,
                    "total_reply_count_from_threads": 0,
                    "total_like_count": 5,
                },
            }
            run_id = store.create_run(
                bundle,
                {
                    "max_comments": 2,
                    "reply_fetch_mode": "none",
                    "fetch_order": "relevance",
                    "use_llm": False,
                    "use_embeddings": False,
                },
            )
            report = store.classify_and_report(run_id)
            suggestions = {suggestion["token"]: suggestion for suggestion in report["alias_suggestions"]}

            self.assertIn("ミッタン", suggestions)
            self.assertEqual(suggestions["ミッタン"]["hit_count"], 2)
            self.assertEqual(suggestions["ミッタン"]["suggested_person_name"], "みりちゃむ")

    def test_llm_assist_prompt_and_cache_flow(self):
        class FakeLlmClient:
            def __init__(self):
                self.calls = 0

            def ask(self, prompt: str) -> str:
                self.calls += 1
                self.last_prompt = prompt
                return json.dumps(
                    {
                        "candidate_recommendations": [
                            {
                                "display_name": "みりちゃむ",
                                "recommendation": "accept",
                                "reason": "主要人物として明確",
                                "target_display_name": None,
                            }
                        ],
                        "alias_recommendations": [
                            {
                                "alias": "ミッタン",
                                "target_display_name": "みりちゃむ",
                                "confidence": "medium",
                                "reason": "同じ文脈で出現",
                            }
                        ],
                        "ambiguous_comments": [],
                        "notes": ["author情報なしで分析"],
                    },
                    ensure_ascii=False,
                )

        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            client = YouTubeCommentClient(data_dir, ROOT / "fixtures" / "sample_comments_drawme.jsonl")
            bundle = client.fetch_video_bundle(
                "https://www.youtube.com/watch?v=vlpLbiqNhLo",
                FetchConfig(max_comments=20, fetch_order="relevance", reply_fetch_mode="none"),
            )
            store = AnalysisStore(data_dir / "app.sqlite3", data_dir)
            run_id = store.create_run(
                bundle,
                {
                    "max_comments": 20,
                    "reply_fetch_mode": "none",
                    "fetch_order": "relevance",
                    "use_llm": False,
                    "use_embeddings": False,
                },
            )
            store.classify_and_report(run_id)
            fake = FakeLlmClient()
            result = store.run_llm_assist(run_id, client=fake)
            cached = store.run_llm_assist(run_id, client=fake)
            report = store.build_report(run_id)

            self.assertEqual(fake.calls, 1)
            self.assertEqual(cached["source"], "cache")
            self.assertEqual(result["alias_recommendations"][0]["alias"], "ミッタン")
            self.assertEqual(report["llm_assist"]["candidate_recommendations"][0]["display_name"], "みりちゃむ")
            self.assertNotIn("author_display_name", fake.last_prompt)

    def test_llm_assist_json_parser_accepts_fenced_json(self):
        parsed = parse_llm_assist_json(
            """```json
{"candidate_recommendations":[],"alias_recommendations":[],"ambiguous_comments":[],"notes":["ok"]}
```"""
        )
        self.assertEqual(parsed["schema_version"], "llm_assist.v1")


if __name__ == "__main__":
    unittest.main()

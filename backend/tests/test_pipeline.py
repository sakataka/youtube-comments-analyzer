import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.candidate_extraction import extract_candidate_tokens
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


if __name__ == "__main__":
    unittest.main()

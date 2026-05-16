import json
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.pipeline import AnalysisStore, alias_matches, extract_candidate_tokens
from backend.app.youtube import FetchConfig, YouTubeCommentClient


ROOT = Path(__file__).resolve().parents[2]


class PipelineTest(unittest.TestCase):
    def test_candidate_token_extraction(self):
        tokens = extract_candidate_tokens("福留光帆ちゃんとみりちゃむさん、風吹ケイ #NOBROCK")
        self.assertIn("福留光帆", tokens)
        self.assertIn("みりちゃむ", tokens)
        self.assertIn("風吹ケイ", tokens)
        self.assertIn("NOBROCK", tokens)

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
            report = store.classify_and_report(run_id)
            self.assertEqual(report["schema_version"], "report.v1")
            self.assertEqual(report["sections"]["appeal_summary"]["status"], "skipped")
            self.assertGreater(len(report["rankings"]["mention_ranking"]), 0)
            self.assertTrue((data_dir / "runs" / run_id / "report.json").exists())


if __name__ == "__main__":
    unittest.main()

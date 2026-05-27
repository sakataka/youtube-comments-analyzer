import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.alias_suggestions import extract_nickname_like_tokens
from backend.app.candidate_extraction import build_candidate_seeds, extract_candidate_tokens, extract_description_person_list_tokens
from backend.app.llm_assist import extract_completed_agent_text, parse_ai_insight_json, parse_llm_assist_json
from backend.app.mention_classification import alias_matches
from backend.app.pipeline import AnalysisStore
from backend.app.report_builder import build_comment_clusters, person_feature_words
from backend.app.text_filters import evaluation_terms, is_noise_keyword, keyword_tokens, person_alias_terms
from backend.app.youtube import FetchConfig, YouTubeCommentClient


ROOT = Path(__file__).resolve().parents[2]


class PipelineTest(unittest.TestCase):
    def store(self, db_path: Path, data_dir: Path) -> AnalysisStore:
        store = AnalysisStore(db_path, data_dir)
        self.addCleanup(store.close)
        return store

    def test_candidate_token_extraction(self):
        tokens = extract_candidate_tokens("福留光帆ちゃんとみりちゃむさん、風吹ケイ #NOBROCK")
        self.assertIn("福留光帆", tokens)
        self.assertIn("みりちゃむ", tokens)
        self.assertIn("風吹ケイ", tokens)
        self.assertNotIn("ちゃんとみりちゃむ", tokens)
        self.assertNotIn("NOBROCK", tokens)

    def test_video_inspect_uses_cached_metadata_without_api(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            metadata_dir = data_dir / "youtube_cache" / "vlpLbiqNhLo"
            metadata_dir.mkdir(parents=True)
            (metadata_dir / "relevance_none_10.metadata.json").write_text(
                json.dumps(
                    {
                        "youtube_video_id": "vlpLbiqNhLo",
                        "url": "https://www.youtube.com/watch?v=vlpLbiqNhLo",
                        "title": "cached title",
                        "channel_title": "cached channel",
                        "comment_count_available": True,
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            client = YouTubeCommentClient(data_dir, ROOT / "fixtures" / "sample_comments_drawme.jsonl")
            inspected = client.inspect_video("https://www.youtube.com/watch?v=vlpLbiqNhLo")
            self.assertEqual(inspected["metadata_source"], "cache")
            self.assertEqual(inspected["title"], "cached title")

    def test_metadata_list_token_extraction(self):
        tokens = extract_candidate_tokens(
            "DRAW ME（みりちゃむ・福留光帆・森脇梨々夏・風吹ケイ・立野沙紀・二瓶有加）",
            include_metadata_lists=True,
            include_loose_metadata=True,
        )
        self.assertIn("みりちゃむ", tokens)
        self.assertIn("立野沙紀", tokens)
        self.assertNotIn("DRAW", tokens)

    def test_candidate_seed_cutoff_skips_obvious_common_words(self):
        seeds = build_candidate_seeds(
            "DRAW ME（みりちゃむ・福留光帆）",
            "",
            [
                {"id": "c1", "text_original": "バランスとコメントが最高。みりちゃむさんも良い"},
                {"id": "c2", "text_original": "バランス良いしコメントも好き"},
                {"id": "c3", "text_original": "さんとみりちゃむの返しが良い"},
                {"id": "c4", "text_original": "しがうまいから何度も見たい"},
            ],
        )
        by_name = {seed.token: seed for seed in seeds}
        self.assertIn("みりちゃむ", by_name)
        self.assertIn("福留光帆", by_name)
        self.assertNotIn("バランス", by_name)
        self.assertNotIn("コメント", by_name)
        self.assertNotIn("さんとみりちゃむ", by_name)
        self.assertNotIn("しがうまいから", by_name)

    def test_candidate_tokens_use_morphology_for_honorific_names(self):
        tokens = extract_candidate_tokens("さくらさんとみりちゃむさんと新居さんが大喜利クリニックで共演")
        self.assertIn("さくら", tokens)
        self.assertIn("みりちゃむ", tokens)
        self.assertIn("新居", tokens)
        self.assertNotIn("さんとみりちゃむ", tokens)
        self.assertNotIn("大喜利クリニック", tokens)

    def test_candidate_tokens_split_prefixed_hiragana_honorific_nickname(self):
        tokens = extract_candidate_tokens("来てくれたねんねんちゃんがよかった")
        self.assertIn("ねんねん", tokens)
        self.assertNotIn("くれたねんねんちゃん", tokens)
        self.assertNotIn("たねんねんちゃん", tokens)
        self.assertNotIn("そしてねんねんちゃん", extract_candidate_tokens("そしてねんねんちゃんがよかった"))

    def test_alias_suggestion_tokens_skip_prefixed_hiragana_honorific_nickname(self):
        tokens = extract_nickname_like_tokens("説明してくれたねんねんさんがすごい")
        self.assertIn("ねんねん", tokens)
        self.assertNotIn("てくれたねんねん", tokens)
        self.assertNotIn("くれたねんねん", tokens)
        self.assertNotIn("そしてねんねんちゃん", extract_nickname_like_tokens("そしてねんねんちゃんがすごい"))

    def test_description_guest_list_is_strong_person_context(self):
        description = """説明文です。

＜ゲスト＞
新居歩美（ドラマチックレコード）｜https://example.com/a
賀屋壮也（かが屋）｜https://example.com/b
さくらもも（ToiToiToi） https://example.com/c
岸上いお（Peel the Apple） https://example.com/d

＜再生リスト＞
大喜利地獄
"""
        tokens = extract_description_person_list_tokens(description)
        self.assertEqual(tokens, ["新居歩美", "賀屋壮也", "さくらもも", "岸上いお"])
        seeds = build_candidate_seeds(
            "【大喜利地獄】新居歩美がインタビュー全部大喜利で答えちゃうドッキリ",
            description,
            [
                {"id": "c1", "text_original": "新居さんとさくらさんが良かった"},
                {"id": "c2", "text_original": "岸上さんも賀屋さんもすごい"},
            ],
        )
        by_name = {seed.token: seed for seed in seeds}
        self.assertEqual(by_name["さくらもも"].status, "accepted")
        self.assertEqual(by_name["岸上いお"].status, "accepted")
        self.assertEqual(by_name["さくら"].parent_token, "さくらもも")
        self.assertNotIn("さくらも", by_name)
        self.assertEqual(by_name["岸上"].parent_token, "岸上いお")
        self.assertEqual(by_name["新居"].parent_token, "新居歩美")
        self.assertNotIn("大喜利地獄", by_name)

    def test_noise_keyword_filter(self):
        for term in ["ですよ", "でした", "ってる", "してる", "すぎる"]:
            self.assertTrue(is_noise_keyword(term), term)
        for term in ["みりちゃむ", "ミッタン", "キングボンビー", "スマブラ"]:
            self.assertFalse(is_noise_keyword(term), term)

    def test_keyword_tokens_use_morphology_to_skip_function_words(self):
        tokens = keyword_tokens("みりちゃむの返し最高ですよでしたしてる")
        self.assertIn("返し", tokens)
        self.assertIn("最高", tokens)
        self.assertNotIn("みりちゃむ", tokens)
        self.assertNotIn("です", tokens)
        self.assertNotIn("よ", tokens)
        self.assertNotIn("でし", tokens)
        self.assertNotIn("た", tokens)
        self.assertNotIn("てる", tokens)

    def test_person_alias_terms_and_evaluation_terms_are_separated(self):
        aliases = person_alias_terms("みりちゃむの返し最高。立野沙紀さんもミッタンも好き")
        self.assertIn("みりちゃむ", aliases)
        self.assertIn("立野沙紀", aliases)
        self.assertIn("ミッタン", aliases)
        self.assertNotIn("最高", aliases)
        terms = evaluation_terms("みりちゃむの返し最高。ミッタンも好きだけど苦手な人もいる")
        self.assertIn({"term": "最高", "polarity": "positive"}, terms)
        self.assertIn({"term": "好き", "polarity": "positive"}, terms)
        self.assertIn({"term": "苦手", "polarity": "negative"}, terms)

    def test_person_feature_words_exclude_noise_terms(self):
        words = person_feature_words(
            [
                {"text_original": "ミッタン ですよ でした してる 返し 良い"},
                {"text_original": "ミッタンの返し最高"},
            ],
            ["ミッタン"],
        )
        terms = {word["term"] for word in words}
        self.assertIn("返し", terms)
        self.assertNotIn("ですよ", terms)
        self.assertNotIn("でした", terms)
        self.assertNotIn("してる", terms)

    def test_alias_match(self):
        self.assertTrue(alias_matches("福留さんの空気がいい", "福留"))
        self.assertTrue(alias_matches("みりちゃむの返し", "みりちゃむ"))
        self.assertFalse(alias_matches("これは普通の文章", "福留"))

    def test_fixture_to_report_without_api_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            client = YouTubeCommentClient(data_dir, ROOT / "fixtures" / "sample_comments_drawme.jsonl")
            with patch.dict("os.environ", {"YOUTUBE_FIXTURE_FALLBACK": "1"}, clear=False):
                bundle = client.fetch_video_bundle(
                    "https://www.youtube.com/watch?v=vlpLbiqNhLo",
                    FetchConfig(max_comments=1000, fetch_order="relevance", reply_fetch_mode="none"),
                )
            self.assertEqual(bundle["fetch_summary"]["source"], "fixture")
            store = self.store(data_dir / "app.sqlite3", data_dir)
            run_id = store.create_run(
                bundle,
                {
                    "max_comments": 1000,
                    "cluster_count": 8,
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
            store.apply_candidate_actions(
                run_id,
                [
                    {
                        "type": "split_merged_person",
                        "person_id": merged_by_name["ニシダ"]["person_id"],
                    }
                ],
            )
            split_candidates = store.get_candidates(run_id)
            split_by_name = {person["display_name"]: person for person in split_candidates["persons"]}
            self.assertEqual(split_by_name["ニシダ"]["status"], "accepted")
            self.assertIn("ニシダ", {alias["alias_text"] for alias in split_by_name["ニシダ"]["aliases"]})
            self.assertNotIn("ニシダ", {alias["alias_text"] for alias in split_by_name["みりちゃむ"]["aliases"]})
            alias_to_delete = split_by_name["ニシダ"]["aliases"][0]["alias_id"]
            store.apply_candidate_actions(run_id, [{"type": "delete_alias", "alias_id": alias_to_delete}])
            deleted_alias_candidates = store.get_candidates(run_id)
            deleted_by_name = {person["display_name"]: person for person in deleted_alias_candidates["persons"]}
            self.assertNotIn(alias_to_delete, {alias["alias_id"] for alias in deleted_by_name["ニシダ"]["aliases"]})
            if "バランス" in by_name:
                self.assertEqual(by_name["バランス"]["status"], "rejected")
            report = store.classify_and_report(run_id)
            self.assertEqual(report["schema_version"], "report.v1")
            self.assertEqual(report["sections"]["appeal_summary"]["status"], "available")
            self.assertGreater(len(report["appeal_summary"]["people"]), 0)
            self.assertIn("category_counts", report["appeal_summary"]["people"][0])
            self.assertIn("tone_counts", report["appeal_summary"]["people"][0])
            self.assertIn("evidence_comments", report["appeal_summary"]["people"][0])
            self.assertIn("feature_words", report["appeal_summary"]["people"][0])
            self.assertIn("evaluation_summary", report["appeal_summary"]["people"][0])
            self.assertEqual(report["sections"]["cooccurrence"]["status"], "available")
            self.assertIn("pairs", report["cooccurrence"])
            self.assertIn("matrix", report["cooccurrence"])
            self.assertEqual(report["sections"]["clusters"]["status"], "available")
            self.assertGreaterEqual(report["clusters"]["requested_cluster_count"], 5)
            self.assertGreater(len(report["clusters"]["clusters"]), 0)
            self.assertEqual(report["sections"]["quality_review"]["status"], "available")
            self.assertIn("low_confidence_comments", report["quality_review"])
            self.assertIn("human_review_items", report["quality_review"])
            self.assertGreater(len(report["rankings"]["mention_ranking"]), 0)
            ranking_row = report["rankings"]["mention_ranking"][0]
            self.assertIn("top_comment_mention_count", ranking_row)
            self.assertIn("single_mention_count", ranking_row)
            self.assertIn("multi_mention_count", ranking_row)
            self.assertIn("raw_like_sum", ranking_row)
            self.assertGreaterEqual(ranking_row["raw_like_sum"], 0)
            mentioned_comments = [comment for comment in report["comments"] if comment["mentioned_persons"]]
            self.assertGreater(len(mentioned_comments), 0)
            target_comment = mentioned_comments[0]
            target_person = target_comment["mentioned_persons"][0]
            first_page = store.get_comments_page(run_id, limit=5, offset=0)
            self.assertEqual(first_page["limit"], 5)
            self.assertEqual(len(first_page["comments"]), 5)
            self.assertEqual(first_page["total"], len(report["comments"]))
            person_page = store.get_comments_page(run_id, limit=20, offset=0, person_id=target_person["person_id"])
            self.assertGreater(person_page["total"], 0)
            self.assertTrue(
                all(
                    target_person["person_id"] in {person["person_id"] for person in comment["mentioned_persons"]}
                    for comment in person_page["comments"]
                )
            )
            search_page = store.get_comments_page(run_id, limit=10, offset=0, search=target_comment["text_original"][:4])
            self.assertGreater(search_page["total"], 0)
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
            self.assertTrue((data_dir / "runs" / run_id / "normalized_comments.jsonl").exists())
            self.assertTrue((data_dir / "runs" / run_id / "aliases.json").exists())
            self.assertTrue((data_dir / "runs" / run_id / "clusters.json").exists())
            self.assertTrue((data_dir / "runs" / run_id / "appeal_labels.json").exists())
            self.assertGreater(store.conn.execute("select count(*) from appeal_labels where analysis_run_id = ?", (run_id,)).fetchone()[0], 0)
            self.assertGreater(store.conn.execute("select count(*) from clusters where analysis_run_id = ?", (run_id,)).fetchone()[0], 0)
            exported = store.export_run(run_id)
            self.assertEqual(exported["schema_version"], "run_export.v1")
            self.assertIn("report.json", exported["artifacts"])
            self.assertIn("normalized_comments.jsonl", exported["artifacts"])
            self.assertIn("aliases.json", exported["artifacts"])

    def test_inline_subset_replies_are_saved_and_reported(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            store = self.store(data_dir / "app.sqlite3", data_dir)
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

    def test_run_archive_and_delete(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            client = YouTubeCommentClient(data_dir, ROOT / "fixtures" / "sample_comments_drawme.jsonl")
            with patch.dict("os.environ", {"YOUTUBE_FIXTURE_FALLBACK": "1"}, clear=False):
                bundle = client.fetch_video_bundle(
                    "https://www.youtube.com/watch?v=vlpLbiqNhLo",
                    FetchConfig(max_comments=10, fetch_order="relevance", reply_fetch_mode="none"),
                )
            store = self.store(data_dir / "app.sqlite3", data_dir)
            run_id = store.create_run(
                bundle,
                {
                    "max_comments": 10,
                    "reply_fetch_mode": "none",
                    "fetch_order": "relevance",
                    "use_llm": False,
                    "use_embeddings": False,
                },
            )
            self.assertTrue((data_dir / "runs" / run_id / "raw_comments.jsonl").exists())
            listed_run = next(row for row in store.list_runs() if row["run_id"] == run_id)
            direct_run = store.get_run(run_id)
            self.assertEqual(listed_run["video"], direct_run["video"])
            self.assertEqual(listed_run["fetch_summary"], direct_run["fetch_summary"])
            self.assertEqual(store.count_runs(), 1)
            archived = store.archive_run(run_id)
            self.assertEqual(archived["status"], "archived")
            self.assertFalse((data_dir / "runs" / run_id).exists())
            self.assertTrue((data_dir / "archive" / "runs" / run_id).exists())
            self.assertNotIn(run_id, {row["run_id"] for row in store.list_runs()})
            self.assertEqual(store.count_runs(), 0)
            deleted = store.delete_run(run_id)
            self.assertEqual(deleted["status"], "deleted")
            self.assertFalse((data_dir / "archive" / "runs" / run_id).exists())

    def test_youtube_cache_archive_and_delete(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            cache_dir = data_dir / "youtube_cache" / "vlpLbiqNhLo"
            cache_dir.mkdir(parents=True)
            (cache_dir / "relevance_none_10.jsonl").write_text("{}", encoding="utf-8")
            store = self.store(data_dir / "app.sqlite3", data_dir)
            archived = store.archive_youtube_cache()
            self.assertEqual(archived["status"], "archived")
            self.assertFalse((data_dir / "youtube_cache").exists())
            self.assertTrue(Path(archived["archive_path"]).exists())
            (data_dir / "youtube_cache").mkdir()
            (data_dir / "youtube_cache" / "tmp.jsonl").write_text("{}", encoding="utf-8")
            deleted = store.delete_youtube_cache()
            self.assertEqual(deleted["status"], "deleted")
            self.assertFalse((data_dir / "youtube_cache").exists())

    def test_running_runs_are_marked_recoverable_on_startup(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            store = self.store(data_dir / "app.sqlite3", data_dir)
            store.conn.execute(
                "insert into videos values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("video_x", "vlpLbiqNhLo", "https://www.youtube.com/watch?v=vlpLbiqNhLo", "title", "channel", "", None, None, 0, None, None, "now"),
            )
            store.conn.execute(
                "insert into comment_snapshots values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("snapshot_x", "video_x", "relevance", 1, 0, "none", 0, 0, 0, "fixture", "now"),
            )
            store.conn.execute(
                "insert into analysis_runs values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                ("run_x", "video_x", "snapshot_x", "running", "fetching", 0.2, "{}", "now", "now", None, None),
            )
            store.conn.commit()
            restarted = self.store(data_dir / "app.sqlite3", data_dir)
            run = restarted.get_run("run_x")
            self.assertEqual(run["status"], "failed_recoverable")
            self.assertEqual(run["stage"], "recovered_after_restart")

    def test_unknown_alias_suggestions(self):
        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            store = self.store(data_dir / "app.sqlite3", data_dir)
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
                    {
                        "comment_id": "comment-3",
                        "parent_comment_id": None,
                        "author_display_name": "c",
                        "author_channel_id": "c",
                        "text_original": "ですよでしたしてる",
                        "like_count": 1,
                        "published_at": None,
                        "updated_at": None,
                        "is_reply": False,
                        "reply_count": 0,
                        "source_order": 2,
                        "api_relevance_order": 2,
                    },
                ],
                "fetch_summary": {
                    "source": "fixture",
                    "fetched_at": "2026-01-01T00:00:00+00:00",
                    "fetched_top_level_count": 3,
                    "fetched_reply_count": 0,
                    "total_reply_count_from_threads": 0,
                    "total_like_count": 6,
                },
            }
            run_id = store.create_run(
                bundle,
                {
                    "max_comments": 3,
                    "reply_fetch_mode": "none",
                    "fetch_order": "relevance",
                    "use_llm": False,
                    "use_embeddings": False,
                },
            )
            report = store.classify_and_report(run_id)
            suggestions = {suggestion["token"]: suggestion for suggestion in report["alias_suggestions"]}

            self.assertIn("ミッタン", suggestions)
            self.assertNotIn("います", suggestions)
            self.assertNotIn("という", suggestions)
            self.assertNotIn("ですよ", suggestions)
            self.assertNotIn("でした", suggestions)
            self.assertNotIn("してる", suggestions)
            self.assertEqual(suggestions["ミッタン"]["hit_count"], 2)
            self.assertEqual(suggestions["ミッタン"]["suggested_person_name"], "みりちゃむ")
            cluster_terms = {
                keyword["term"]
                for cluster in report["clusters"]["clusters"]
                for keyword in cluster["top_keywords"]
            }
            self.assertNotIn("ですよ", cluster_terms)
            self.assertNotIn("でした", cluster_terms)
            self.assertNotIn("してる", cluster_terms)

    def test_comment_clusters_place_other_last(self):
        comments = [
            {"id": "c1", "text_original": "分類できない話題", "like_count": 10},
            {"id": "c2", "text_original": "分類できない雑談", "like_count": 9},
            {"id": "c3", "text_original": "掛け合いとツッコミが良い", "like_count": 1},
        ]
        clusters = build_comment_clusters(comments, {}, 2)["clusters"]
        self.assertNotEqual(clusters[0]["cluster_id"], "other")
        self.assertEqual(clusters[-1]["cluster_id"], "other")

    def test_llm_assist_prompt_and_cache_flow(self):
        class FakeLlmClient:
            def __init__(self, comment_id: str):
                self.calls = 0
                self.comment_id = comment_id

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
                        "ambiguous_comments": [
                            {
                                "comment_id": self.comment_id,
                                "suggested_display_name": "別人物",
                                "confidence": "medium",
                                "reason": "辞書判定と異なる可能性",
                            }
                        ],
                        "notes": ["author情報なしで分析"],
                    },
                    ensure_ascii=False,
                )

        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            client = YouTubeCommentClient(data_dir, ROOT / "fixtures" / "sample_comments_drawme.jsonl")
            with patch.dict("os.environ", {"YOUTUBE_FIXTURE_FALLBACK": "1"}, clear=False):
                bundle = client.fetch_video_bundle(
                    "https://www.youtube.com/watch?v=vlpLbiqNhLo",
                    FetchConfig(max_comments=20, fetch_order="relevance", reply_fetch_mode="none"),
                )
            store = self.store(data_dir / "app.sqlite3", data_dir)
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
            base_report = store.build_report(run_id)
            fake = FakeLlmClient(base_report["comments"][0]["comment_id"])
            result = store.run_llm_assist(run_id, client=fake)
            cached = store.run_llm_assist(run_id, client=fake)
            report = store.build_report(run_id)

            self.assertEqual(fake.calls, 1)
            self.assertEqual(cached["source"], "cache")
            self.assertEqual(store.conn.execute("select count(*) from llm_cache").fetchone()[0], 1)
            self.assertEqual(result["alias_recommendations"][0]["alias"], "ミッタン")
            self.assertEqual(report["llm_assist"]["candidate_recommendations"][0]["display_name"], "みりちゃむ")
            self.assertEqual(store.get_latest_report(run_id)["llm_assist"]["alias_recommendations"][0]["alias"], "ミッタン")
            self.assertIn("ai_dictionary_conflicts", report["quality_review"])
            self.assertGreater(len(report["quality_review"]["ai_dictionary_conflicts"]), 0)
            self.assertNotIn("author_display_name", fake.last_prompt)

    def test_llm_assist_json_parser_accepts_fenced_json(self):
        parsed = parse_llm_assist_json(
            """```json
{"candidate_recommendations":[],"alias_recommendations":[],"ambiguous_comments":[],"notes":["ok"]}
```"""
        )
        self.assertEqual(parsed["schema_version"], "llm_assist.v1")

    def test_ai_insight_prompt_and_cache_flow(self):
        class FakeInsightClient:
            def __init__(self):
                self.calls = 0

            def ask(self, prompt: str) -> str:
                self.calls += 1
                self.last_prompt = prompt
                return json.dumps(
                    {
                        "headline": "コメント欄は主要人物への好意的反応が中心",
                        "summary": "上位ランキングとクラスタから、人物別の反応と掛け合いへの言及が目立つ。",
                        "insights": [
                            {
                                "title": "上位人物に反応が集中",
                                "detail": "mention_ranking の上位にコメントが集まっている。",
                                "evidence": ["みりちゃむの言及数が上位"],
                            }
                        ],
                        "watch_points": ["取得範囲が全コメントを代表しているか確認する"],
                        "suggested_next_questions": ["上位コメント内だけで傾向が変わるか"],
                    },
                    ensure_ascii=False,
                )

        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            client = YouTubeCommentClient(data_dir, ROOT / "fixtures" / "sample_comments_drawme.jsonl")
            with patch.dict("os.environ", {"YOUTUBE_FIXTURE_FALLBACK": "1"}, clear=False):
                bundle = client.fetch_video_bundle(
                    "https://www.youtube.com/watch?v=vlpLbiqNhLo",
                    FetchConfig(max_comments=20, fetch_order="relevance", reply_fetch_mode="none"),
                )
            store = self.store(data_dir / "app.sqlite3", data_dir)
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
            fake = FakeInsightClient()
            result = store.run_ai_insight(run_id, client=fake)
            cached = store.run_ai_insight(run_id, client=fake)
            latest = store.get_latest_ai_insight(run_id)

            self.assertEqual(fake.calls, 1)
            self.assertEqual(cached["source"], "cache")
            self.assertEqual(result["schema_version"], "ai_insight.v1")
            self.assertEqual(latest["headline"], "コメント欄は主要人物への好意的反応が中心")
            self.assertTrue((data_dir / "runs" / run_id / "ai_insight.json").exists())
            self.assertIn("mention_ranking", fake.last_prompt)
            self.assertNotIn("author_display_name", fake.last_prompt)

    def test_ai_insight_json_parser_accepts_fenced_json(self):
        parsed = parse_ai_insight_json(
            """```json
{"headline":"h","summary":"s","insights":[],"watch_points":["w"],"suggested_next_questions":[]}
```"""
        )
        self.assertEqual(parsed["schema_version"], "ai_insight.v1")

    def test_llm_assist_failure_is_saved_as_degraded_report_section(self):
        class FailingLlmClient:
            def ask(self, prompt: str) -> str:
                raise RuntimeError("codex app server timeout")

        with tempfile.TemporaryDirectory() as tmp:
            data_dir = Path(tmp)
            client = YouTubeCommentClient(data_dir, ROOT / "fixtures" / "sample_comments_drawme.jsonl")
            with patch.dict("os.environ", {"YOUTUBE_FIXTURE_FALLBACK": "1"}, clear=False):
                bundle = client.fetch_video_bundle(
                    "https://www.youtube.com/watch?v=vlpLbiqNhLo",
                    FetchConfig(max_comments=20, fetch_order="relevance", reply_fetch_mode="none"),
                )
            store = self.store(data_dir / "app.sqlite3", data_dir)
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
            result = store.run_llm_assist(run_id, client=FailingLlmClient())
            report = store.build_report(run_id)

            self.assertEqual(result["status"], "failed")
            self.assertEqual(store.get_latest_report(run_id)["llm_assist"]["status"], "failed")
            self.assertEqual(report["sections"]["mention_ranking"]["status"], "available")
            self.assertEqual(report["sections"]["llm_assist"]["status"], "failed")
            self.assertIn("codex app server timeout", report["sections"]["llm_assist"]["reason"])

    def test_completed_agent_text_accepts_app_server_item_shapes(self):
        self.assertEqual(
            extract_completed_agent_text({"type": "agentMessage", "text": '{"ok": true}'}),
            '{"ok": true}',
        )
        self.assertEqual(
            extract_completed_agent_text(
                {
                    "type": "agent_message",
                    "content": [{"type": "text", "text": '{"ok": true}'}],
                }
            ),
            '{"ok": true}',
        )
        self.assertEqual(extract_completed_agent_text({"type": "userMessage", "text": "ignore"}), "")


if __name__ == "__main__":
    unittest.main()

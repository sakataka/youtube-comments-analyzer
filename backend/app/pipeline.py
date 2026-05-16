from __future__ import annotations

import json
import math
import re
import sqlite3
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .text import normalize_alias, normalize_text


HONORIFIC_RE = re.compile(r"([一-龥々ぁ-んァ-ヶA-Za-z0-9ー]{2,16}?)(さん|ちゃん|くん|君|氏|様)")
KATAKANA_RE = re.compile(r"[ァ-ヶー]{3,16}")
KANJI_KATAKANA_RE = re.compile(r"[一-龥々]{1,8}[ァ-ヶー]{2,12}")
HASHTAG_RE = re.compile(r"#([一-龥々ぁ-んァ-ヶA-Za-z0-9_ー]{2,24})")
BRACKET_CONTENT_RE = re.compile(r"[【\[\(（]([^】\]\)）]{2,160})[】\]\)）]")
METADATA_TOKEN_RE = re.compile(r"[一-龥々ぁ-んァ-ヶA-Za-z0-9_ー]{2,24}")
METADATA_SPLIT_RE = re.compile(r"[、,／/・\s]+")
GENERIC_TOKEN_STOPWORDS = {
    "コメント",
    "リアクション",
    "バランス",
    "チャンネル",
    "サンプル",
    "バラエティ",
    "トーク",
    "メンバー",
    "エピソード",
    "アイドル",
    "ランキング",
    "リリイベ",
    "ノブロック",
    "ゲスト",
    "ドッキリ",
    "シリーズ",
    "リスト",
    "リリースイベント",
    "オンラインショップ",
    "オンラインストア",
    "ショップ",
    "ストア",
    "NOBROCK",
    "YouTube",
    "youtube",
}
GENERIC_TOKEN_KEYWORDS = (
    "コメント",
    "チャンネル",
    "バラエティ",
    "ランキング",
    "エピソード",
    "メンバー",
    "アイドル",
    "リリイベ",
    "ノブロック",
    "ゲスト",
    "ドッキリ",
    "シリーズ",
    "リスト",
    "リリースイベント",
    "オンライン",
    "ショップ",
    "ストア",
    "公式",
    "番組",
    "企画",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        create table if not exists videos (
          id text primary key,
          youtube_video_id text not null,
          url text not null,
          title text not null,
          channel_title text not null,
          description text,
          published_at text,
          fetched_at text not null
        );
        create table if not exists comment_snapshots (
          id text primary key,
          video_id text not null,
          fetch_order text not null,
          max_comments_requested integer not null,
          max_comments_fetched integer not null,
          reply_fetch_mode text not null,
          fetched_top_level_count integer not null,
          fetched_reply_count integer not null,
          total_reply_count_from_threads integer not null,
          source text not null,
          fetched_at text not null
        );
        create table if not exists comments (
          id text primary key,
          video_id text not null,
          comment_snapshot_id text not null,
          youtube_comment_id text not null,
          parent_comment_id text,
          author_display_name text,
          author_channel_id text,
          text_original text not null,
          text_normalized text not null,
          like_count integer not null,
          published_at text,
          updated_at text,
          is_reply integer not null,
          reply_count integer not null,
          source_order integer not null,
          api_relevance_order integer,
          fetched_at text not null
        );
        create table if not exists analysis_runs (
          id text primary key,
          video_id text not null,
          comment_snapshot_id text not null,
          status text not null,
          stage text not null,
          progress real not null,
          config_json text not null,
          created_at text not null,
          started_at text,
          completed_at text,
          error_message text
        );
        create table if not exists persons (
          id text primary key,
          analysis_run_id text not null,
          display_name text not null,
          canonical_name text not null,
          entity_type text not null,
          status text not null,
          confidence real not null,
          reason text not null,
          created_by text not null
        );
        create table if not exists aliases (
          id text primary key,
          analysis_run_id text not null,
          person_id text not null,
          alias_text text not null,
          normalized_alias text not null,
          source text not null,
          hit_count integer not null,
          confidence real not null,
          status text not null,
          is_ambiguous integer not null,
          representative_comment_ids_json text not null
        );
        create table if not exists comment_mentions (
          id text primary key,
          analysis_run_id text not null,
          comment_id text not null,
          person_id text not null,
          alias_id text,
          matched_text text not null,
          match_method text not null,
          confidence real not null,
          evidence_json text not null
        );
        create table if not exists reports (
          id text primary key,
          analysis_run_id text not null,
          report_json text not null,
          created_at text not null
        );
        create table if not exists candidate_action_logs (
          id text primary key,
          analysis_run_id text not null,
          action_type text not null,
          payload_json text not null,
          created_at text not null
        );
        create table if not exists comment_mention_overrides (
          id text primary key,
          analysis_run_id text not null,
          comment_id text not null,
          person_id text not null,
          action_type text not null,
          created_at text not null
        );
        """
    )
    conn.commit()


class AnalysisStore:
    def __init__(self, db_path: Path, data_dir: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.data_dir = data_dir
        init_db(self.conn)

    def create_run(self, bundle: dict[str, Any], config: dict[str, Any]) -> str:
        now = utc_now()
        video_id = new_id("video")
        snapshot_id = new_id("snapshot")
        run_id = new_id("run")
        video = bundle["video"]
        fetch = bundle["fetch_summary"]
        self.conn.execute(
            "insert into videos values (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                video_id,
                video["youtube_video_id"],
                video["url"],
                video["title"],
                video["channel_title"],
                video.get("description"),
                video.get("published_at"),
                now,
            ),
        )
        self.conn.execute(
            "insert into comment_snapshots values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                snapshot_id,
                video_id,
                config["fetch_order"],
                config["max_comments"],
                len(bundle["comments"]),
                config["reply_fetch_mode"],
                fetch["fetched_top_level_count"],
                fetch["fetched_reply_count"],
                fetch["total_reply_count_from_threads"],
                fetch["source"],
                fetch["fetched_at"],
            ),
        )
        for index, comment in enumerate(bundle["comments"]):
            comment_id = new_id("comment")
            self.conn.execute(
                "insert into comments values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    comment_id,
                    video_id,
                    snapshot_id,
                    comment.get("comment_id") or comment_id,
                    comment.get("parent_comment_id"),
                    comment.get("author_display_name"),
                    comment.get("author_channel_id"),
                    comment.get("text_original") or "",
                    normalize_text(comment.get("text_original") or ""),
                    int(comment.get("like_count") or 0),
                    comment.get("published_at"),
                    comment.get("updated_at"),
                    1 if comment.get("is_reply") else 0,
                    int(comment.get("reply_count") or 0),
                    int(comment.get("source_order") if comment.get("source_order") is not None else index),
                    comment.get("api_relevance_order"),
                    fetch["fetched_at"],
                ),
            )
        run_config = {
            "schema_version": "analysis_config.v1",
            "comment_snapshot_id": snapshot_id,
            "max_comments": config["max_comments"],
            "reply_fetch_mode": config["reply_fetch_mode"],
            "fetch_order": config["fetch_order"],
            "top_comment_definition": "like_count_desc",
            "top_comment_count": 50,
            "like_weight_formula": "1 + log1p(like_count)",
            "llm_enabled": bool(config["use_llm"]),
            "embedding_enabled": bool(config["use_embeddings"]),
            "prompt_version": "2026-05-16.mvp0",
        }
        self.conn.execute(
            "insert into analysis_runs values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                run_id,
                video_id,
                snapshot_id,
                "running",
                "extracting_candidates",
                0.45,
                json.dumps(run_config, ensure_ascii=False),
                now,
                now,
                None,
                None,
            ),
        )
        self.conn.commit()
        self.extract_candidates(run_id)
        self._write_run_artifact(run_id, "raw_comments.jsonl", bundle["comments"], jsonl=True)
        return run_id

    def extract_candidates(self, run_id: str) -> None:
        run = self.get_run_row(run_id)
        comments = self.comments_for_snapshot(run["comment_snapshot_id"])
        title = self.conn.execute("select title, description from videos where id = ?", (run["video_id"],)).fetchone()
        frequencies: Counter[str] = Counter()
        source_kinds: dict[str, set[str]] = defaultdict(set)
        representative_ids: dict[str, list[str]] = defaultdict(list)

        metadata_inputs = [
            (title["title"], True, "metadata_title"),
            (title["description"] or "", False, "metadata_description"),
        ]
        for text, include_loose_metadata, source_kind in metadata_inputs:
            for token in extract_candidate_tokens(
                text,
                include_metadata_lists=True,
                include_loose_metadata=include_loose_metadata,
            ):
                frequencies[token] += 12
                source_kinds[token].add(source_kind)

        for comment in comments:
            seen_in_comment: set[str] = set()
            for token in extract_candidate_tokens(comment["text_original"]):
                normalized = normalize_alias(token)
                if normalized not in seen_in_comment:
                    frequencies[token] += 1
                    source_kinds[token].add("comment")
                    seen_in_comment.add(normalized)
                if len(representative_ids[token]) < 3:
                    representative_ids[token].append(comment["id"])

        inserted_persons: dict[str, str] = {}
        metadata_person_tokens = [
            token
            for token in frequencies
            if "metadata_title" in source_kinds[token]
            and not is_generic_candidate(token)
            and len(normalize_alias(token)) > 1
        ]
        ordered_tokens = unique_ordered_tokens([
            *[token for token, _ in candidate_frequency_order(Counter({token: frequencies[token] for token in metadata_person_tokens}))],
            *[token for token, _ in candidate_frequency_order(frequencies)],
        ])

        for token in ordered_tokens[:32]:
            count = frequencies[token]
            normalized = normalize_alias(token)
            generic = is_generic_candidate(token)
            from_title_metadata = "metadata_title" in source_kinds[token]
            from_description_metadata = "metadata_description" in source_kinds[token]
            parent_token = find_metadata_parent_token(token, metadata_person_tokens)
            if parent_token and parent_token in inserted_persons:
                self._insert_alias(
                    run_id=run_id,
                    person_id=inserted_persons[parent_token],
                    token=token,
                    normalized=normalized,
                    source="+".join(sorted(source_kinds[token])) or "comment",
                    hit_count=count,
                    confidence=min(0.88, 0.58 + count / 50),
                    status="accepted",
                    representative_ids=representative_ids[token],
                )
                continue
            if len(normalized) <= 1 or generic:
                status = "rejected"
                confidence = 0.2
            elif from_title_metadata:
                status = "accepted"
                confidence = min(0.95, 0.68 + count / 30)
            else:
                status = "candidate"
                confidence = min(0.7, 0.38 + count / 40)
            alias_status = "accepted" if status == "accepted" else "pending"
            if status == "rejected":
                alias_status = "rejected"
            person_id = new_id("person")
            alias_id = new_id("alias")
            self.conn.execute(
                "insert into persons values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    person_id,
                    run_id,
                    token,
                    normalized,
                    guess_entity_type(token),
                    status,
                    confidence,
                    candidate_reason(source_kinds[token], generic),
                    "rule",
                ),
            )
            self.conn.execute(
                "insert into aliases values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    alias_id,
                    run_id,
                    person_id,
                    token,
                    normalized,
                    "+".join(sorted(source_kinds[token])) or "comment",
                    count,
                    confidence,
                    alias_status,
                    1 if len(normalized) <= 2 else 0,
                    json.dumps(representative_ids[token], ensure_ascii=False),
                ),
            )
            inserted_persons[token] = person_id
            if from_title_metadata and status == "accepted":
                for alias_token in derived_name_aliases(token):
                    alias_normalized = normalize_alias(alias_token)
                    self._insert_alias(
                        run_id=run_id,
                        person_id=person_id,
                        token=alias_token,
                        normalized=alias_normalized,
                        source="name_part",
                        hit_count=frequencies.get(alias_token, 0),
                        confidence=0.72,
                        status="accepted",
                        representative_ids=representative_ids.get(alias_token, []),
                    )

        self.conn.execute(
            "update analysis_runs set status = ?, stage = ?, progress = ? where id = ?",
            ("waiting_for_review", "extracting_candidates", 0.72, run_id),
        )
        self.conn.commit()
        self._write_run_artifact(run_id, "person_candidates.json", self.get_candidates(run_id))

    def _insert_alias(
        self,
        run_id: str,
        person_id: str,
        token: str,
        normalized: str,
        source: str,
        hit_count: int,
        confidence: float,
        status: str,
        representative_ids: list[str],
    ) -> None:
        existing = self.conn.execute(
            "select id from aliases where analysis_run_id = ? and person_id = ? and normalized_alias = ?",
            (run_id, person_id, normalized),
        ).fetchone()
        if existing:
            return
        self.conn.execute(
            "insert into aliases values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                new_id("alias"),
                run_id,
                person_id,
                token,
                normalized,
                source,
                hit_count,
                confidence,
                status,
                1 if len(normalized) <= 2 else 0,
                json.dumps(representative_ids, ensure_ascii=False),
            ),
        )

    def apply_candidate_actions(self, run_id: str, actions: list[dict[str, Any]]) -> None:
        for action in actions:
            action_type = action["type"]
            if action_type == "accept_person":
                self.conn.execute("update persons set status = 'accepted' where id = ? and analysis_run_id = ?", (action["person_id"], run_id))
                self.conn.execute("update aliases set status = 'accepted' where person_id = ? and analysis_run_id = ?", (action["person_id"], run_id))
            elif action_type == "reject_person":
                self.conn.execute("update persons set status = 'rejected' where id = ? and analysis_run_id = ?", (action["person_id"], run_id))
                self.conn.execute("update aliases set status = 'rejected' where person_id = ? and analysis_run_id = ?", (action["person_id"], run_id))
            elif action_type == "accept_alias":
                self.conn.execute("update aliases set status = 'accepted' where id = ? and analysis_run_id = ?", (action["alias_id"], run_id))
                self.conn.execute(
                    "update persons set status = 'accepted' where id = (select person_id from aliases where id = ?) and analysis_run_id = ?",
                    (action["alias_id"], run_id),
                )
            elif action_type == "reject_alias":
                self.conn.execute("update aliases set status = 'rejected' where id = ? and analysis_run_id = ?", (action["alias_id"], run_id))
            elif action_type == "add_alias":
                alias_text = action["alias_text"].strip()
                if not alias_text:
                    continue
                self.conn.execute(
                    "insert into aliases values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        new_id("alias"),
                        run_id,
                        action["person_id"],
                        alias_text,
                        normalize_alias(alias_text),
                        "user",
                        0,
                        0.9,
                        "accepted",
                        0,
                        "[]",
                    ),
                )
            elif action_type == "update_display_name":
                self.conn.execute(
                    "update persons set display_name = ? where id = ? and analysis_run_id = ?",
                    (action["display_name"], action["person_id"], run_id),
                )
            self.conn.execute(
                "insert into candidate_action_logs values (?, ?, ?, ?, ?)",
                (new_id("action"), run_id, action_type, json.dumps(action, ensure_ascii=False), utc_now()),
            )
        self.conn.commit()

    def classify_and_report(self, run_id: str) -> dict[str, Any]:
        run = self.get_run_row(run_id)
        self.conn.execute("delete from comment_mentions where analysis_run_id = ?", (run_id,))
        aliases = self.conn.execute(
            """
            select a.*, p.status as person_status
            from aliases a
            join persons p on p.id = a.person_id
            where a.analysis_run_id = ? and a.status = 'accepted' and p.status = 'accepted'
            """,
            (run_id,),
        ).fetchall()
        comments = self.comments_for_snapshot(run["comment_snapshot_id"])
        for comment in comments:
            mentioned_persons: set[str] = set()
            for alias in aliases:
                if alias["person_id"] in mentioned_persons:
                    continue
                if alias_matches(comment["text_normalized"], alias["normalized_alias"]):
                    mentioned_persons.add(alias["person_id"])
                    self.conn.execute(
                        "insert into comment_mentions values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (
                            new_id("mention"),
                            run_id,
                            comment["id"],
                            alias["person_id"],
                            alias["id"],
                            alias["alias_text"],
                            "alias_normalized",
                            0.9 if len(alias["normalized_alias"]) > 2 else 0.62,
                            json.dumps({"comment_id": comment["id"], "alias": alias["alias_text"]}, ensure_ascii=False),
                        ),
                    )
        self.apply_comment_mention_overrides(run_id)
        report = self.build_report(run_id)
        self.conn.execute(
            "insert into reports values (?, ?, ?, ?)",
            (new_id("report"), run_id, json.dumps(report, ensure_ascii=False), utc_now()),
        )
        self.conn.execute(
            "update analysis_runs set status = ?, stage = ?, progress = ?, completed_at = ? where id = ?",
            ("completed", "completed", 1.0, utc_now(), run_id),
        )
        self.conn.commit()
        self._write_run_artifact(run_id, "mentions.jsonl", self.get_mentions(run_id), jsonl=True)
        self._write_run_artifact(run_id, "report.json", report)
        return report

    def apply_comment_actions(self, run_id: str, actions: list[dict[str, Any]]) -> dict[str, Any]:
        self.get_run_row(run_id)
        for action in actions:
            action_type = action["type"]
            if action_type not in {"add_mention", "remove_mention"}:
                continue
            comment_id = action["comment_id"]
            person_id = action["person_id"]
            self.conn.execute(
                "insert into comment_mention_overrides values (?, ?, ?, ?, ?, ?)",
                (new_id("override"), run_id, comment_id, person_id, action_type, utc_now()),
            )
        self.apply_comment_mention_overrides(run_id)
        report = self.build_report(run_id)
        self.conn.execute(
            "insert into reports values (?, ?, ?, ?)",
            (new_id("report"), run_id, json.dumps(report, ensure_ascii=False), utc_now()),
        )
        self.conn.commit()
        self._write_run_artifact(run_id, "mentions.jsonl", self.get_mentions(run_id), jsonl=True)
        self._write_run_artifact(run_id, "report.json", report)
        return report

    def apply_comment_mention_overrides(self, run_id: str) -> None:
        overrides = self.conn.execute(
            "select * from comment_mention_overrides where analysis_run_id = ? order by created_at asc",
            (run_id,),
        ).fetchall()
        for override in overrides:
            if override["action_type"] == "remove_mention":
                self.conn.execute(
                    "delete from comment_mentions where analysis_run_id = ? and comment_id = ? and person_id = ?",
                    (run_id, override["comment_id"], override["person_id"]),
                )
            elif override["action_type"] == "add_mention":
                existing = self.conn.execute(
                    "select id from comment_mentions where analysis_run_id = ? and comment_id = ? and person_id = ?",
                    (run_id, override["comment_id"], override["person_id"]),
                ).fetchone()
                if existing:
                    continue
                self.conn.execute(
                    "insert into comment_mentions values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        new_id("mention"),
                        run_id,
                        override["comment_id"],
                        override["person_id"],
                        None,
                        "manual",
                        "manual_override",
                        1.0,
                        json.dumps({"comment_id": override["comment_id"], "source": "manual_override"}, ensure_ascii=False),
                    ),
                )

    def build_report(self, run_id: str) -> dict[str, Any]:
        run = self.get_run_row(run_id)
        video = self.conn.execute("select * from videos where id = ?", (run["video_id"],)).fetchone()
        snapshot = self.conn.execute("select * from comment_snapshots where id = ?", (run["comment_snapshot_id"],)).fetchone()
        comments = self.comments_for_snapshot(run["comment_snapshot_id"])
        mentions = self.conn.execute(
            """
            select m.person_id, p.display_name, m.comment_id, c.text_original, c.like_count
            from comment_mentions m
            join persons p on p.id = m.person_id
            join comments c on c.id = m.comment_id
            where m.analysis_run_id = ?
            """,
            (run_id,),
        ).fetchall()
        by_person: dict[str, list[sqlite3.Row]] = defaultdict(list)
        names: dict[str, str] = {}
        mentions_by_comment: dict[str, dict[str, str]] = defaultdict(dict)
        for mention in mentions:
            by_person[mention["person_id"]].append(mention)
            names[mention["person_id"]] = mention["display_name"]
            mentions_by_comment[mention["comment_id"]][mention["person_id"]] = mention["display_name"]
        ranking = []
        total_comments = max(1, len(comments))
        for person_id, rows in by_person.items():
            unique_by_comment = {row["comment_id"]: row for row in rows}
            representatives = sorted(unique_by_comment.values(), key=lambda row: row["like_count"], reverse=True)[:3]
            ranking.append({
                "person_id": person_id,
                "display_name": names[person_id],
                "mention_comment_count": len(unique_by_comment),
                "mention_rate": len(unique_by_comment) / total_comments,
                "like_weighted_score": sum(1 + math.log1p(max(0, int(row["like_count"]))) for row in unique_by_comment.values()),
                "representative_comments": [
                    {
                        "comment_id": row["comment_id"],
                        "text_original": row["text_original"],
                        "like_count": row["like_count"],
                    }
                    for row in representatives
                ],
            })
        ranking.sort(key=lambda row: (row["mention_comment_count"], row["like_weighted_score"]), reverse=True)
        return {
            "schema_version": "report.v1",
            "run_id": run_id,
            "video": {
                "youtube_video_id": video["youtube_video_id"],
                "url": video["url"],
                "title": video["title"],
                "channel_title": video["channel_title"],
            },
            "fetch_summary": {
                "source": snapshot["source"],
                "fetched_at": snapshot["fetched_at"],
                "fetched_top_level_count": snapshot["fetched_top_level_count"],
                "fetched_reply_count": snapshot["fetched_reply_count"],
                "total_like_count": sum(int(comment["like_count"]) for comment in comments),
                "max_comments_requested": snapshot["max_comments_requested"],
                "fetch_order": snapshot["fetch_order"],
                "reply_fetch_mode": snapshot["reply_fetch_mode"],
            },
            "analysis_config": json.loads(run["config_json"]),
            "persons": self.get_candidates(run_id)["persons"],
            "rankings": {"mention_ranking": ranking},
            "comments": [
                {
                    "comment_id": comment["id"],
                    "text_original": comment["text_original"],
                    "like_count": comment["like_count"],
                    "mentioned_persons": [
                        {"person_id": person_id, "display_name": display_name}
                        for person_id, display_name in sorted(mentions_by_comment[comment["id"]].items(), key=lambda item: item[1])
                    ],
                }
                for comment in comments
            ],
            "sections": {
                "mention_ranking": {"status": "available"},
                "person_candidates": {"status": "available"},
                "raw_comments": {"status": "available"},
                "appeal_summary": {"status": "skipped", "reason": "LLM disabled in MVP-0"},
                "ambiguous_classification": {"status": "skipped", "reason": "LLM disabled in MVP-0"},
                "cooccurrence": {"status": "skipped", "reason": "MVP-2 scope"},
                "clusters": {"status": "skipped", "reason": "Embeddings disabled in MVP-0"},
            },
        }

    def get_candidates(self, run_id: str) -> dict[str, Any]:
        run = self.get_run_row(run_id)
        comments = self.comments_for_snapshot(run["comment_snapshot_id"])
        persons = self.conn.execute("select * from persons where analysis_run_id = ? order by confidence desc", (run_id,)).fetchall()
        output = []
        for person in persons:
            aliases = self.conn.execute("select * from aliases where person_id = ? order by hit_count desc", (person["id"],)).fetchall()
            accepted_alias_hit_total = sum(int(alias["hit_count"]) for alias in aliases if alias["status"] == "accepted")
            all_alias_hit_total = sum(int(alias["hit_count"]) for alias in aliases)
            accepted_aliases = [alias for alias in aliases if alias["status"] == "accepted" and person["status"] == "accepted"]
            accepted_mention_comment_count = sum(
                1
                for comment in comments
                if any(alias_matches(comment["text_normalized"], alias["normalized_alias"]) for alias in accepted_aliases)
            )
            output.append({
                "person_id": person["id"],
                "display_name": person["display_name"],
                "entity_type": person["entity_type"],
                "status": person["status"],
                "confidence": person["confidence"],
                "reason": person["reason"],
                "accepted_alias_hit_total": accepted_alias_hit_total,
                "all_alias_hit_total": all_alias_hit_total,
                "accepted_mention_comment_count": accepted_mention_comment_count,
                "aliases": [
                    {
                        "alias_id": alias["id"],
                        "alias_text": alias["alias_text"],
                        "normalized_alias": alias["normalized_alias"],
                        "hit_count": alias["hit_count"],
                        "confidence": alias["confidence"],
                        "source": alias["source"],
                        "status": alias["status"],
                        "is_ambiguous": bool(alias["is_ambiguous"]),
                        "representative_comment_ids": json.loads(alias["representative_comment_ids_json"]),
                    }
                    for alias in aliases
                ],
            })
        return {"run_id": run_id, "persons": output}

    def get_run(self, run_id: str) -> dict[str, Any]:
        run = self.get_run_row(run_id)
        snapshot = self.conn.execute("select * from comment_snapshots where id = ?", (run["comment_snapshot_id"],)).fetchone()
        return {
            "run_id": run["id"],
            "status": run["status"],
            "stage": run["stage"],
            "progress": run["progress"],
            "error_message": run["error_message"],
            "fetch_summary": {
                "source": snapshot["source"],
                "max_comments_requested": snapshot["max_comments_requested"],
                "max_comments_fetched": snapshot["max_comments_fetched"],
                "fetch_order": snapshot["fetch_order"],
                "reply_fetch_mode": snapshot["reply_fetch_mode"],
                "fetched_at": snapshot["fetched_at"],
            },
        }

    def get_run_row(self, run_id: str) -> sqlite3.Row:
        run = self.conn.execute("select * from analysis_runs where id = ?", (run_id,)).fetchone()
        if not run:
            raise KeyError(f"run not found: {run_id}")
        return run

    def get_latest_report(self, run_id: str) -> dict[str, Any]:
        row = self.conn.execute(
            "select report_json from reports where analysis_run_id = ? order by created_at desc limit 1",
            (run_id,),
        ).fetchone()
        if not row:
            raise KeyError(f"report not found: {run_id}")
        return json.loads(row["report_json"])

    def list_runs(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("select * from analysis_runs order by created_at desc limit 50").fetchall()
        return [self.get_run(row["id"]) for row in rows]

    def comments_for_snapshot(self, snapshot_id: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            "select * from comments where comment_snapshot_id = ? order by source_order asc",
            (snapshot_id,),
        ).fetchall()

    def get_mentions(self, run_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute("select * from comment_mentions where analysis_run_id = ?", (run_id,)).fetchall()
        return [dict(row) for row in rows]

    def _write_run_artifact(self, run_id: str, filename: str, payload: Any, jsonl: bool = False) -> None:
        run_dir = self.data_dir / "runs" / run_id
        run_dir.mkdir(parents=True, exist_ok=True)
        path = run_dir / filename
        if jsonl:
            with path.open("w", encoding="utf-8") as handle:
                for row in payload:
                    handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        else:
            path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def extract_candidate_tokens(
    text: str,
    include_metadata_lists: bool = False,
    include_loose_metadata: bool = False,
) -> list[str]:
    if not text:
        return []
    tokens: list[str] = []
    tokens.extend(match.group(1) for match in HONORIFIC_RE.finditer(text))
    tokens.extend(match.group(0) for match in KANJI_KATAKANA_RE.finditer(text))
    tokens.extend(match.group(0) for match in KATAKANA_RE.finditer(text))
    tokens.extend(match.group(1) for match in HASHTAG_RE.finditer(text))
    if include_metadata_lists:
        tokens.extend(extract_metadata_list_tokens(text, include_loose_metadata))
    cleaned: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        cleaned_token = clean_candidate_token(token)
        if not cleaned_token or cleaned_token in seen:
            continue
        cleaned.append(cleaned_token)
        seen.add(cleaned_token)
    return cleaned


def extract_metadata_list_tokens(text: str, include_loose_metadata: bool = False) -> list[str]:
    candidates: list[str] = []
    for match in BRACKET_CONTENT_RE.finditer(text):
        content = match.group(1)
        for part in METADATA_SPLIT_RE.split(content):
            candidates.extend(token for token in METADATA_TOKEN_RE.findall(part) if contains_japanese(token))
    for hashtag in HASHTAG_RE.finditer(text):
        candidates.append(hashtag.group(1))
    if include_loose_metadata:
        for part in METADATA_SPLIT_RE.split(text):
            candidates.extend(
                token
                for token in METADATA_TOKEN_RE.findall(part)
                if contains_japanese(token) and 3 <= len(token) <= 12
            )
    return candidates


def clean_candidate_token(token: str) -> str:
    token = token.strip()
    token = re.split(r"[、。・／/\s]+", token)[-1]
    token = re.sub(r"^[とてもはがのにをで]+", "", token)
    token = re.sub(r"[、。・／/]+$", "", token)
    return token


def is_generic_candidate(token: str) -> bool:
    normalized_stopwords = {normalize_alias(word) for word in GENERIC_TOKEN_STOPWORDS}
    if token in GENERIC_TOKEN_STOPWORDS or normalize_alias(token) in normalized_stopwords:
        return True
    return any(keyword in token for keyword in GENERIC_TOKEN_KEYWORDS)


def contains_japanese(token: str) -> bool:
    return bool(re.search(r"[一-龥々ぁ-んァ-ヶ]", token))


def candidate_frequency_order(frequencies: Counter[str]) -> list[tuple[str, int]]:
    return sorted(frequencies.items(), key=lambda item: (item[1], len(normalize_alias(item[0]))), reverse=True)


def unique_ordered_tokens(tokens: list[str]) -> list[str]:
    output: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        if token in seen:
            continue
        output.append(token)
        seen.add(token)
    return output


def find_metadata_parent_token(token: str, metadata_person_tokens: list[str]) -> str | None:
    normalized = normalize_alias(token)
    if len(normalized) <= 1:
        return None
    candidates = [
        parent
        for parent in metadata_person_tokens
        if parent != token and normalized in normalize_alias(parent)
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda parent: len(normalize_alias(parent)))


def derived_name_aliases(token: str) -> list[str]:
    aliases: list[str] = []
    kanji_match = re.fullmatch(r"[一-龥々]{4,5}", token)
    if kanji_match:
        aliases.append(token[:2])
        aliases.append(token[2:])
    mixed_match = re.fullmatch(r"([一-龥々]{1,4})([ァ-ヶー]{2,8})", token)
    if mixed_match:
        aliases.extend([mixed_match.group(1), mixed_match.group(2)])
    return [alias for alias in unique_ordered_tokens(aliases) if alias and alias != token]


def candidate_reason(source_kinds: set[str], generic: bool) -> str:
    if generic:
        return "一般語または番組・企画名寄りの表現として自動除外"
    has_metadata = bool({"metadata_title", "metadata_description"} & source_kinds)
    if has_metadata and "comment" in source_kinds:
        return "タイトル・概要欄とコメント内の両方から候補化"
    if "metadata_title" in source_kinds:
        return "タイトルの列挙から候補化"
    if "metadata_description" in source_kinds:
        return "タイトル・概要欄・ハッシュタグの列挙から候補化"
    return "コメント内の頻出表記から候補化"


def guess_entity_type(token: str) -> str:
    if any(word in token.lower() for word in ["tv", "channel", "チャンネル"]):
        return "channel"
    if any(word in token for word in ["コンビ", "組"]):
        return "duo"
    return "person"


def alias_matches(normalized_comment: str, normalized_alias_value: str) -> bool:
    if not normalized_alias_value:
        return False
    if len(normalized_alias_value) <= 2:
        return bool(re.search(rf"(?<![a-z0-9]){re.escape(normalized_alias_value)}(さん|ちゃん|くん|君|氏|様)?", normalized_comment))
    return normalized_alias_value in normalized_comment

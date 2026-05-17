from __future__ import annotations

import json
import shutil
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .text import normalize_alias, normalize_text
from .alias_suggestions import build_alias_suggestions
from .candidate_extraction import build_candidate_seeds, extract_candidate_tokens
from .llm_assist import (
    CodexAppServerClient,
    INSIGHT_PROMPT_VERSION,
    LlmClient,
    PROMPT_VERSION,
    ai_insight_cache_key,
    build_ai_insight_prompt,
    build_llm_assist_prompt,
    llm_cache_key,
    parse_ai_insight_json,
    parse_llm_assist_json,
    read_cached_llm_assist,
    write_cached_llm_assist,
)
from .mention_classification import alias_match_confidence, alias_matches
from .report_builder import build_report_payload, fetch_coverage_summary


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def build_failed_llm_assist(input_hash: str, exc: Exception) -> dict[str, Any]:
    return {
        "schema_version": "llm_assist.v1",
        "prompt_version": PROMPT_VERSION,
        "provider": "codex_app_server",
        "source": "codex_app_server",
        "input_hash": input_hash,
        "status": "failed",
        "error_message": str(exc),
        "candidate_recommendations": [],
        "alias_recommendations": [],
        "ambiguous_comments": [],
        "notes": [],
    }


def build_failed_ai_insight(input_hash: str, exc: Exception) -> dict[str, Any]:
    return {
        "schema_version": "ai_insight.v1",
        "prompt_version": INSIGHT_PROMPT_VERSION,
        "provider": "codex_app_server",
        "source": "codex_app_server",
        "input_hash": input_hash,
        "status": "failed",
        "error_message": str(exc),
        "headline": "",
        "summary": "",
        "insights": [],
        "watch_points": [],
        "suggested_next_questions": [],
    }


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
          youtube_comment_count integer,
          comment_count_available integer not null default 0,
          youtube_view_count integer,
          youtube_like_count integer,
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
        create table if not exists llm_assists (
          id text primary key,
          analysis_run_id text not null,
          input_hash text not null,
          prompt_version text not null,
          provider text not null,
          status text not null,
          result_json text not null,
          raw_text text,
          created_at text not null
        );
        create table if not exists ai_insights (
          id text primary key,
          analysis_run_id text not null,
          input_hash text not null,
          prompt_version text not null,
          provider text not null,
          status text not null,
          result_json text not null,
          raw_text text,
          created_at text not null
        );
        create table if not exists llm_cache (
          input_hash text primary key,
          prompt_version text not null,
          provider text not null,
          result_json text not null,
          raw_text text,
          created_at text not null
        );
        create table if not exists appeal_labels (
          id text primary key,
          analysis_run_id text not null,
          person_id text not null,
          category text not null,
          label text not null,
          count integer not null,
          representative_comment_ids_json text not null
        );
        create table if not exists clusters (
          id text primary key,
          analysis_run_id text not null,
          cluster_id text not null,
          label text not null,
          comment_count integer not null,
          top_keywords_json text not null,
          representative_comments_json text not null,
          summary text not null
        );
        """
    )
    ensure_column(conn, "videos", "youtube_comment_count", "integer")
    ensure_column(conn, "videos", "comment_count_available", "integer not null default 0")
    ensure_column(conn, "videos", "youtube_view_count", "integer")
    ensure_column(conn, "videos", "youtube_like_count", "integer")
    conn.commit()


def ensure_column(conn: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {row[1] for row in conn.execute(f"pragma table_info({table})")}
    if column not in columns:
        conn.execute(f"alter table {table} add column {column} {definition}")


class AnalysisStore:
    def __init__(self, db_path: Path, data_dir: Path):
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.data_dir = data_dir
        init_db(self.conn)
        self.recover_running_runs()

    def close(self) -> None:
        self.conn.close()

    def __enter__(self) -> "AnalysisStore":
        return self

    def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
        self.close()

    def recover_running_runs(self) -> None:
        now = utc_now()
        self.conn.execute(
            """
            update analysis_runs
            set status = 'failed_recoverable', stage = 'recovered_after_restart', progress = 0, error_message = ?, completed_at = ?
            where status in ('running', 'queued')
            """,
            ("サーバー再起動により実行中 job を復旧対象にしました", now),
        )
        self.conn.commit()

    def create_run(self, bundle: dict[str, Any], config: dict[str, Any]) -> str:
        now = utc_now()
        video_id = new_id("video")
        snapshot_id = new_id("snapshot")
        run_id = new_id("run")
        video = bundle["video"]
        fetch = bundle["fetch_summary"]
        self.conn.execute(
            """
            insert into videos (
              id,
              youtube_video_id,
              url,
              title,
              channel_title,
              description,
              published_at,
              youtube_comment_count,
              comment_count_available,
              youtube_view_count,
              youtube_like_count,
              fetched_at
            ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                video_id,
                video["youtube_video_id"],
                video["url"],
                video["title"],
                video["channel_title"],
                video.get("description"),
                video.get("published_at"),
                video.get("youtube_comment_count"),
                1 if video.get("comment_count_available") else 0,
                video.get("youtube_view_count"),
                video.get("youtube_like_count"),
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
        self._write_run_artifact(run_id, "normalized_comments.jsonl", self.normalized_comments_for_snapshot(snapshot_id), jsonl=True)
        return run_id

    def extract_candidates(self, run_id: str) -> None:
        run = self.get_run_row(run_id)
        comments = self.comments_for_snapshot(run["comment_snapshot_id"])
        title = self.conn.execute("select title, description from videos where id = ?", (run["video_id"],)).fetchone()
        inserted_persons: dict[str, str] = {}
        for seed in build_candidate_seeds(title["title"], title["description"] or "", comments):
            if seed.parent_token and seed.parent_token in inserted_persons:
                self._insert_alias(
                    run_id=run_id,
                    person_id=inserted_persons[seed.parent_token],
                    token=seed.token,
                    normalized=seed.normalized,
                    source=seed.source,
                    hit_count=seed.hit_count,
                    confidence=min(0.88, 0.58 + seed.hit_count / 50),
                    status="accepted",
                    representative_ids=seed.representative_ids,
                )
                continue
            person_id = new_id("person")
            alias_id = new_id("alias")
            self.conn.execute(
                "insert into persons values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    person_id,
                    run_id,
                    seed.token,
                    seed.normalized,
                    seed.entity_type,
                    seed.status,
                    seed.confidence,
                    seed.reason,
                    "rule",
                ),
            )
            self.conn.execute(
                "insert into aliases values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    alias_id,
                    run_id,
                    person_id,
                    seed.token,
                    seed.normalized,
                    seed.source,
                    seed.hit_count,
                    seed.confidence,
                    seed.alias_status,
                    1 if seed.is_ambiguous else 0,
                    json.dumps(seed.representative_ids, ensure_ascii=False),
                ),
            )
            inserted_persons[seed.token] = person_id
            for alias_seed in seed.derived_aliases:
                self._insert_alias(
                    run_id=run_id,
                    person_id=person_id,
                    token=alias_seed.token,
                    normalized=alias_seed.normalized,
                    source="name_part",
                    hit_count=alias_seed.hit_count,
                    confidence=0.72,
                    status="accepted",
                    representative_ids=alias_seed.representative_ids,
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
            elif action_type == "delete_alias":
                self.conn.execute("delete from aliases where id = ? and analysis_run_id = ?", (action["alias_id"], run_id))
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
            elif action_type == "merge_person":
                source_person_id = action["source_person_id"]
                target_person_id = action["target_person_id"]
                if source_person_id == target_person_id:
                    continue
                self.merge_person_aliases(run_id, source_person_id, target_person_id)
            elif action_type == "split_merged_person":
                self.split_merged_person(run_id, action["person_id"])
            self.conn.execute(
                "insert into candidate_action_logs values (?, ?, ?, ?, ?)",
                (new_id("action"), run_id, action_type, json.dumps(action, ensure_ascii=False), utc_now()),
            )
        self.conn.commit()

    def merge_person_aliases(self, run_id: str, source_person_id: str, target_person_id: str) -> None:
        target = self.conn.execute(
            "select id from persons where id = ? and analysis_run_id = ?",
            (target_person_id, run_id),
        ).fetchone()
        source = self.conn.execute(
            "select id from persons where id = ? and analysis_run_id = ?",
            (source_person_id, run_id),
        ).fetchone()
        if not target or not source:
            return
        source_aliases = self.conn.execute(
            "select * from aliases where person_id = ? and analysis_run_id = ?",
            (source_person_id, run_id),
        ).fetchall()
        for alias in source_aliases:
            duplicate = self.conn.execute(
                """
                select id from aliases
                where analysis_run_id = ? and person_id = ? and normalized_alias = ?
                """,
                (run_id, target_person_id, alias["normalized_alias"]),
            ).fetchone()
            if duplicate:
                self.conn.execute("delete from aliases where id = ? and analysis_run_id = ?", (alias["id"], run_id))
            else:
                self.conn.execute(
                    "update aliases set person_id = ?, status = 'accepted' where id = ? and analysis_run_id = ?",
                    (target_person_id, alias["id"], run_id),
                )
        self.conn.execute(
            "update persons set status = 'rejected', reason = ? where id = ? and analysis_run_id = ?",
            ("別の人物候補に統合済み", source_person_id, run_id),
        )

    def split_merged_person(self, run_id: str, person_id: str) -> None:
        person = self.conn.execute(
            "select * from persons where id = ? and analysis_run_id = ?",
            (person_id, run_id),
        ).fetchone()
        if not person or person["reason"] != "別の人物候補に統合済み":
            return
        merge_log = self.conn.execute(
            """
            select payload_json from candidate_action_logs
            where analysis_run_id = ? and action_type = 'merge_person'
            order by created_at desc
            """,
            (run_id,),
        ).fetchall()
        target_person_id = None
        for row in merge_log:
            payload = json.loads(row["payload_json"])
            if payload.get("source_person_id") == person_id:
                target_person_id = payload.get("target_person_id")
                break
        normalized_person = normalize_alias(person["canonical_name"] or person["display_name"])
        if target_person_id:
            self.conn.execute(
                """
                update aliases
                set person_id = ?, status = 'accepted'
                where analysis_run_id = ? and person_id = ? and normalized_alias = ?
                """,
                (person_id, run_id, target_person_id, normalized_person),
            )
        has_alias = self.conn.execute(
            "select id from aliases where analysis_run_id = ? and person_id = ? and normalized_alias = ?",
            (run_id, person_id, normalized_person),
        ).fetchone()
        if not has_alias:
            self._insert_alias(
                run_id=run_id,
                person_id=person_id,
                token=person["display_name"],
                normalized=normalized_person,
                source="split_restore",
                hit_count=0,
                confidence=0.72,
                status="accepted",
                representative_ids=[],
            )
        self.conn.execute(
            "update persons set status = 'accepted', reason = ? where id = ? and analysis_run_id = ?",
            ("統合解除により復元", person_id, run_id),
        )

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
                            alias_match_confidence(alias["normalized_alias"]),
                            json.dumps({"comment_id": comment["id"], "alias": alias["alias_text"]}, ensure_ascii=False),
                        ),
                    )
        self.apply_comment_mention_overrides(run_id)
        report = self.build_report(run_id)
        self.conn.execute(
            "insert into reports values (?, ?, ?, ?)",
            (new_id("report"), run_id, json.dumps(report, ensure_ascii=False), utc_now()),
        )
        self.save_report_sections(run_id, report)
        self.conn.execute(
            "update analysis_runs set status = ?, stage = ?, progress = ?, completed_at = ? where id = ?",
            ("completed", "completed", 1.0, utc_now(), run_id),
        )
        self.conn.commit()
        self._write_run_artifact(run_id, "mentions.jsonl", self.get_mentions(run_id), jsonl=True)
        self._write_run_artifact(run_id, "report.json", report)
        self._write_run_artifact(run_id, "aliases.json", self.get_candidates(run_id)["persons"])
        self._write_run_artifact(run_id, "clusters.json", report["clusters"])
        self._write_run_artifact(run_id, "appeal_labels.json", report["appeal_summary"])
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
        self.save_report_sections(run_id, report)
        self.conn.commit()
        self._write_run_artifact(run_id, "mentions.jsonl", self.get_mentions(run_id), jsonl=True)
        self._write_run_artifact(run_id, "report.json", report)
        self._write_run_artifact(run_id, "aliases.json", self.get_candidates(run_id)["persons"])
        self._write_run_artifact(run_id, "clusters.json", report["clusters"])
        self._write_run_artifact(run_id, "appeal_labels.json", report["appeal_summary"])
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
            select m.person_id, p.display_name, m.comment_id, c.text_original, c.like_count, m.confidence, m.match_method
            from comment_mentions m
            join persons p on p.id = m.person_id
            join comments c on c.id = m.comment_id
            where m.analysis_run_id = ?
            """,
            (run_id,),
        ).fetchall()
        persons = self.get_candidates(run_id)["persons"]
        return build_report_payload(
            run_id=run_id,
            video=video,
            snapshot=snapshot,
            comments=comments,
            mentions=mentions,
            analysis_config=json.loads(run["config_json"]),
            persons=persons,
            alias_suggestions=build_alias_suggestions(comments, persons),
            llm_assist=self.get_latest_llm_assist(run_id),
        )

    def run_llm_assist(self, run_id: str, client: LlmClient | None = None) -> dict[str, Any]:
        report = self.build_report(run_id)
        prompt = build_llm_assist_prompt(report)
        cache_key = llm_cache_key(prompt)
        cache_dir = self.data_dir / "llm_cache"
        cached = read_cached_llm_assist(cache_dir, cache_key)
        cached = cached or self.read_llm_cache(cache_key)
        if cached:
            result = {**cached, "source": "cache", "input_hash": cache_key}
            self.save_llm_assist(run_id, cache_key, result, raw_text=None, status="completed")
            self._write_run_artifact(run_id, "llm_assist.json", result)
            self.persist_report(run_id, self.build_report(run_id))
            return result

        active_client = client or CodexAppServerClient()
        raw_text = None
        try:
            raw_text = active_client.ask(prompt)
            parsed = parse_llm_assist_json(raw_text)
        except Exception as exc:
            result = build_failed_llm_assist(cache_key, exc)
            self.save_llm_assist(run_id, cache_key, result, raw_text=raw_text, status="failed")
            self._write_run_artifact(run_id, "llm_assist.json", result)
            self.persist_report(run_id, self.build_report(run_id))
            return result
        result = {**parsed, "source": "codex_app_server", "input_hash": cache_key}
        write_cached_llm_assist(cache_dir, cache_key, result)
        self.write_llm_cache(cache_key, result, raw_text)
        self.save_llm_assist(run_id, cache_key, result, raw_text=raw_text, status="completed")
        self._write_run_artifact(run_id, "llm_assist.json", result)
        self.persist_report(run_id, self.build_report(run_id))
        return result

    def run_ai_insight(self, run_id: str, client: LlmClient | None = None) -> dict[str, Any]:
        self.get_latest_report(run_id)
        report = self.build_report(run_id)
        prompt = build_ai_insight_prompt(report)
        cache_key = ai_insight_cache_key(prompt)
        cache_dir = self.data_dir / "llm_cache"
        cached = read_cached_llm_assist(cache_dir, cache_key)
        cached = cached or self.read_llm_cache(cache_key)
        if cached:
            result = {**cached, "source": "cache", "input_hash": cache_key}
            self.save_ai_insight(run_id, cache_key, result, raw_text=None, status="completed")
            self._write_run_artifact(run_id, "ai_insight.json", result)
            return result

        active_client = client or CodexAppServerClient()
        raw_text = None
        try:
            raw_text = active_client.ask(prompt)
            parsed = parse_ai_insight_json(raw_text)
        except Exception as exc:
            result = build_failed_ai_insight(cache_key, exc)
            self.save_ai_insight(run_id, cache_key, result, raw_text=raw_text, status="failed")
            self._write_run_artifact(run_id, "ai_insight.json", result)
            return result
        result = {**parsed, "source": "codex_app_server", "input_hash": cache_key, "status": "completed"}
        write_cached_llm_assist(cache_dir, cache_key, result)
        self.write_llm_cache(cache_key, result, raw_text)
        self.save_ai_insight(run_id, cache_key, result, raw_text=raw_text, status="completed")
        self._write_run_artifact(run_id, "ai_insight.json", result)
        return result

    def save_llm_assist(
        self,
        run_id: str,
        input_hash: str,
        result: dict[str, Any],
        raw_text: str | None,
        status: str,
    ) -> None:
        self.conn.execute(
            "insert into llm_assists values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                new_id("llm"),
                run_id,
                input_hash,
                result.get("prompt_version") or "",
                result.get("provider") or "codex_app_server",
                status,
                json.dumps(result, ensure_ascii=False),
                raw_text,
                utc_now(),
            ),
        )
        self.conn.commit()

    def save_ai_insight(
        self,
        run_id: str,
        input_hash: str,
        result: dict[str, Any],
        raw_text: str | None,
        status: str,
    ) -> None:
        self.conn.execute(
            "insert into ai_insights values (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                new_id("insight"),
                run_id,
                input_hash,
                result.get("prompt_version") or "",
                result.get("provider") or "codex_app_server",
                status,
                json.dumps(result, ensure_ascii=False),
                raw_text,
                utc_now(),
            ),
        )
        self.conn.commit()

    def read_llm_cache(self, input_hash: str) -> dict[str, Any] | None:
        row = self.conn.execute("select result_json from llm_cache where input_hash = ?", (input_hash,)).fetchone()
        return json.loads(row["result_json"]) if row else None

    def write_llm_cache(self, input_hash: str, result: dict[str, Any], raw_text: str | None) -> None:
        self.conn.execute(
            """
            insert or replace into llm_cache values (?, ?, ?, ?, ?, ?)
            """,
            (
                input_hash,
                result.get("prompt_version") or "",
                result.get("provider") or "codex_app_server",
                json.dumps(result, ensure_ascii=False),
                raw_text,
                utc_now(),
            ),
        )
        self.conn.commit()

    def get_latest_llm_assist(self, run_id: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "select result_json from llm_assists where analysis_run_id = ? order by created_at desc limit 1",
            (run_id,),
        ).fetchone()
        if not row:
            return None
        return json.loads(row["result_json"])

    def get_latest_ai_insight(self, run_id: str) -> dict[str, Any] | None:
        row = self.conn.execute(
            "select result_json from ai_insights where analysis_run_id = ? order by created_at desc limit 1",
            (run_id,),
        ).fetchone()
        if not row:
            return None
        return json.loads(row["result_json"])

    def get_candidates(self, run_id: str) -> dict[str, Any]:
        run = self.get_run_row(run_id)
        comments = self.comments_for_snapshot(run["comment_snapshot_id"])
        comments_by_id = {comment["id"]: comment for comment in comments}
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
                        "mention_comment_count": sum(
                            1
                            for comment in comments
                            if alias_matches(comment["text_normalized"], alias["normalized_alias"])
                        ),
                        "confidence": alias["confidence"],
                        "source": alias["source"],
                        "status": alias["status"],
                        "is_ambiguous": bool(alias["is_ambiguous"]),
                        "representative_comment_ids": json.loads(alias["representative_comment_ids_json"]),
                        "representative_comments": [
                            {
                                "comment_id": comment_id,
                                "text_original": comments_by_id[comment_id]["text_original"],
                                "like_count": comments_by_id[comment_id]["like_count"],
                            }
                            for comment_id in json.loads(alias["representative_comment_ids_json"])
                            if comment_id in comments_by_id
                        ],
                    }
                    for alias in aliases
                ],
            })
        return {"run_id": run_id, "persons": output}

    def get_run(self, run_id: str) -> dict[str, Any]:
        run = self.get_run_row(run_id)
        snapshot = self.conn.execute("select * from comment_snapshots where id = ?", (run["comment_snapshot_id"],)).fetchone()
        video = self.conn.execute("select * from videos where id = ?", (run["video_id"],)).fetchone()
        return {
            "run_id": run["id"],
            "status": run["status"],
            "stage": run["stage"],
            "progress": run["progress"],
            "error_message": run["error_message"],
            "created_at": run["created_at"],
            "video": {
                "youtube_video_id": video["youtube_video_id"],
                "url": video["url"],
                "title": video["title"],
                "channel_title": video["channel_title"],
                "youtube_comment_count": video["youtube_comment_count"],
                "comment_count_available": bool(video["comment_count_available"]),
                "youtube_view_count": video["youtube_view_count"],
                "youtube_like_count": video["youtube_like_count"],
            },
            "fetch_summary": {
                "source": snapshot["source"],
                "max_comments_requested": snapshot["max_comments_requested"],
                "max_comments_fetched": snapshot["max_comments_fetched"],
                "fetched_top_level_count": snapshot["fetched_top_level_count"],
                "fetched_reply_count": snapshot["fetched_reply_count"],
                "fetch_order": snapshot["fetch_order"],
                "reply_fetch_mode": snapshot["reply_fetch_mode"],
                "fetched_at": snapshot["fetched_at"],
                "coverage": fetch_coverage_summary(video, snapshot),
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
        report = json.loads(row["report_json"])
        latest_llm_assist = self.get_latest_llm_assist(run_id)
        if latest_llm_assist and report.get("llm_assist") != latest_llm_assist:
            report = self.build_report(run_id)
            self.persist_report(run_id, report)
        return report

    def get_comments_page(
        self,
        run_id: str,
        limit: int = 100,
        offset: int = 0,
        person_id: str | None = None,
        search: str | None = None,
    ) -> dict[str, Any]:
        run = self.get_run_row(run_id)
        where = ["c.comment_snapshot_id = ?"]
        params: list[Any] = [run["comment_snapshot_id"]]
        query = normalize_text((search or "").strip())
        if query:
            where.append("c.text_normalized like ?")
            params.append(f"%{query}%")
        if person_id == "unassigned":
            where.append(
                """
                not exists (
                  select 1 from comment_mentions m
                  where m.analysis_run_id = ? and m.comment_id = c.id
                )
                """
            )
            params.append(run_id)
        elif person_id:
            where.append(
                """
                exists (
                  select 1 from comment_mentions m
                  where m.analysis_run_id = ? and m.comment_id = c.id and m.person_id = ?
                )
                """
            )
            params.extend([run_id, person_id])
        where_sql = " and ".join(where)
        total = self.conn.execute(f"select count(*) as count from comments c where {where_sql}", params).fetchone()["count"]
        rows = self.conn.execute(
            f"""
            select c.*
            from comments c
            where {where_sql}
            order by c.source_order asc
            limit ? offset ?
            """,
            [*params, limit, offset],
        ).fetchall()
        comment_ids = [row["id"] for row in rows]
        mentions_by_comment: dict[str, list[dict[str, Any]]] = {comment_id: [] for comment_id in comment_ids}
        if comment_ids:
            placeholders = ",".join("?" for _ in comment_ids)
            mention_rows = self.conn.execute(
                f"""
                select m.comment_id, m.person_id, p.display_name, m.confidence, m.match_method
                from comment_mentions m
                join persons p on p.id = m.person_id
                where m.analysis_run_id = ? and m.comment_id in ({placeholders})
                order by p.display_name asc
                """,
                [run_id, *comment_ids],
            ).fetchall()
            for mention in mention_rows:
                mentions_by_comment.setdefault(mention["comment_id"], []).append({
                    "person_id": mention["person_id"],
                    "display_name": mention["display_name"],
                    "confidence": mention["confidence"],
                    "match_method": mention["match_method"],
                })
        return {
            "run_id": run_id,
            "total": total,
            "limit": limit,
            "offset": offset,
            "comments": [
                {
                    "comment_id": comment["id"],
                    "text_original": comment["text_original"],
                    "like_count": comment["like_count"],
                    "is_reply": bool(comment["is_reply"]),
                    "parent_comment_id": comment["parent_comment_id"],
                    "mentioned_persons": mentions_by_comment.get(comment["id"], []),
                }
                for comment in rows
            ],
        }

    def persist_report(self, run_id: str, report: dict[str, Any]) -> None:
        self.conn.execute(
            "insert into reports values (?, ?, ?, ?)",
            (new_id("report"), run_id, json.dumps(report, ensure_ascii=False), utc_now()),
        )
        self.save_report_sections(run_id, report)
        self.conn.commit()
        self._write_run_artifact(run_id, "report.json", report)
        self._write_run_artifact(run_id, "clusters.json", report["clusters"])
        self._write_run_artifact(run_id, "appeal_labels.json", report["appeal_summary"])

    def export_run(self, run_id: str) -> dict[str, Any]:
        run = self.get_run(run_id)
        try:
            report = self.get_latest_report(run_id)
        except KeyError:
            report = None
        artifact_dir = self.data_dir / "runs" / run_id
        artifacts = {}
        for name in [
            "raw_comments.jsonl",
            "normalized_comments.jsonl",
            "person_candidates.json",
            "aliases.json",
            "mentions.jsonl",
            "report.json",
            "clusters.json",
            "appeal_labels.json",
            "llm_assist.json",
            "ai_insight.json",
        ]:
            path = artifact_dir / name
            if path.exists():
                artifacts[name] = {"path": str(path), "bytes": path.stat().st_size}
        return {
            "schema_version": "run_export.v1",
            "run": run,
            "report": report,
            "artifacts": artifacts,
        }

    def list_runs(self) -> list[dict[str, Any]]:
        rows = self.conn.execute("select * from analysis_runs where status != 'archived' order by created_at desc limit 50").fetchall()
        return [self.get_run(row["id"]) for row in rows]

    def archive_run(self, run_id: str) -> dict[str, Any]:
        self.get_run_row(run_id)
        source = self.data_dir / "runs" / run_id
        archive = self.data_dir / "archive" / "runs" / run_id
        if source.exists():
            archive.parent.mkdir(parents=True, exist_ok=True)
            if archive.exists():
                shutil.rmtree(archive)
            shutil.move(str(source), str(archive))
        self.conn.execute(
            "update analysis_runs set status = 'archived', stage = 'archived', completed_at = ? where id = ?",
            (utc_now(), run_id),
        )
        self.conn.commit()
        return {"status": "archived", "run_id": run_id, "archive_path": str(archive)}

    def delete_run(self, run_id: str) -> dict[str, Any]:
        run = self.get_run_row(run_id)
        snapshot_id = run["comment_snapshot_id"]
        video_id = run["video_id"]
        for table in [
            "reports",
            "comment_mentions",
            "candidate_action_logs",
            "comment_mention_overrides",
            "llm_assists",
            "ai_insights",
            "appeal_labels",
            "clusters",
            "aliases",
            "persons",
        ]:
            self.conn.execute(f"delete from {table} where analysis_run_id = ?", (run_id,))
        self.conn.execute("delete from analysis_runs where id = ?", (run_id,))
        self.conn.execute("delete from comments where comment_snapshot_id = ?", (snapshot_id,))
        self.conn.execute("delete from comment_snapshots where id = ?", (snapshot_id,))
        self.conn.execute("delete from videos where id = ?", (video_id,))
        self.conn.commit()
        for path in [self.data_dir / "runs" / run_id, self.data_dir / "archive" / "runs" / run_id]:
            if path.exists():
                shutil.rmtree(path)
        return {"status": "deleted", "run_id": run_id}

    def archive_youtube_cache(self) -> dict[str, Any]:
        source = self.data_dir / "youtube_cache"
        archive = self.data_dir / "archive" / "youtube_cache" / utc_now().replace(":", "-")
        if not source.exists():
            return {"status": "skipped", "reason": "youtube_cache not found", "archive_path": str(archive)}
        archive.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(source), str(archive))
        return {"status": "archived", "archive_path": str(archive)}

    def delete_youtube_cache(self) -> dict[str, Any]:
        source = self.data_dir / "youtube_cache"
        if source.exists():
            shutil.rmtree(source)
        return {"status": "deleted", "path": str(source)}

    def comments_for_snapshot(self, snapshot_id: str) -> list[sqlite3.Row]:
        return self.conn.execute(
            "select * from comments where comment_snapshot_id = ? order by source_order asc",
            (snapshot_id,),
        ).fetchall()

    def normalized_comments_for_snapshot(self, snapshot_id: str) -> list[dict[str, Any]]:
        return [
            {
                "comment_id": comment["id"],
                "youtube_comment_id": comment["youtube_comment_id"],
                "text_original": comment["text_original"],
                "text_normalized": comment["text_normalized"],
                "is_reply": bool(comment["is_reply"]),
                "parent_comment_id": comment["parent_comment_id"],
            }
            for comment in self.comments_for_snapshot(snapshot_id)
        ]

    def get_mentions(self, run_id: str) -> list[dict[str, Any]]:
        rows = self.conn.execute("select * from comment_mentions where analysis_run_id = ?", (run_id,)).fetchall()
        return [dict(row) for row in rows]

    def save_report_sections(self, run_id: str, report: dict[str, Any]) -> None:
        self.conn.execute("delete from appeal_labels where analysis_run_id = ?", (run_id,))
        self.conn.execute("delete from clusters where analysis_run_id = ?", (run_id,))
        for person in report.get("appeal_summary", {}).get("people", []):
            for label in person.get("category_counts", []):
                self.conn.execute(
                    "insert into appeal_labels values (?, ?, ?, ?, ?, ?, ?)",
                    (
                        new_id("appeal"),
                        run_id,
                        person["person_id"],
                        label["category"],
                        label["label"],
                        int(label["count"]),
                        json.dumps(label.get("representative_comment_ids") or [], ensure_ascii=False),
                    ),
                )
        for cluster in report.get("clusters", {}).get("clusters", []):
            self.conn.execute(
                "insert into clusters values (?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    new_id("cluster"),
                    run_id,
                    cluster["cluster_id"],
                    cluster["label"],
                    int(cluster["comment_count"]),
                    json.dumps(cluster.get("top_keywords") or [], ensure_ascii=False),
                    json.dumps(cluster.get("representative_comments") or [], ensure_ascii=False),
                    cluster.get("summary") or "",
                ),
            )

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

from __future__ import annotations

import copy
import hashlib
import json
import uuid
from collections.abc import Callable
from typing import Any

from .llm_assist import (
    SENTIMENT_OUTPUT_SCHEMA,
    CodexAppServerClient,
    LlmClient,
    build_sentiment_review_prompt,
    parse_sentiment_review_json,
    sentiment_cache_key,
)
from .local_sentiment import LocalSentimentClassifier
from .pipeline import AnalysisStore, build_failed_llm_assist
from .sentiment import classify_sentiment, integrate_sentiment


ProgressCallback = Callable[[str, float], None]


class SentimentReanalysisService:
    def __init__(self, store: AnalysisStore, classifier: LocalSentimentClassifier):
        self.store = store
        self.classifier = classifier

    def reanalyze(
        self,
        run_id: str,
        include_ai: bool = True,
        client: LlmClient | None = None,
        progress: ProgressCallback | None = None,
    ) -> dict[str, Any]:
        notify = progress or (lambda _stage, _progress: None)
        generation_id = f"sentiment_{uuid.uuid4().hex[:12]}"
        notify("sentiment_preparing", 0.1)
        prepared = self.store.prepare_sentiment_targets(run_id)
        targets = self._build_targets(prepared)

        notify("sentiment_local_model", 0.25)
        predictions = self.classifier.predict([target["rule"]["scope_text"] for target in targets])
        results: list[dict[str, Any]] = []
        for target in targets:
            local = dict(predictions.get(target["rule"]["scope_text"]) or {"status": "failed", "error": "missing prediction"})
            local["confidence_threshold"] = self.classifier.config.confidence_threshold
            integrated = integrate_sentiment(target["rule"], local, self.classifier.config.confidence_threshold)
            integrated["evidence"]["integration"]["generation_id"] = generation_id
            integrated["evidence"]["integration"]["target_type"] = target["target_type"]
            integrated["evidence"]["integration"]["target_id"] = target.get("target_id")
            results.append({
                **integrated,
                "comment_id": target["comment_id"],
                "target_type": target["target_type"],
                "target_id": target.get("target_id"),
                "like_count": target["like_count"],
            })
        self._mark_ai_capacity(results)

        notify("sentiment_persisting_local", 0.55)
        report = self.store.replace_sentiment_results(run_id, results)
        if not include_ai:
            notify("sentiment_completed", 1.0)
            return report

        review_items = self._select_ai_items(report.get("sentiment", {}).get("review_items", []))
        if not review_items:
            notify("sentiment_completed", 1.0)
            return report

        notify("sentiment_ai_assist", 0.65)
        recommendations, failures, aggregate = self._run_ai_batches(report, review_items, client)
        failure_reason = "; ".join(failures) if failures else None
        notify("sentiment_persisting_ai", 0.92)
        report = self.store.apply_ai_sentiment_results(
            run_id,
            generation_id,
            recommendations,
            attempted_targets=[
                (item["comment_id"], item["target_type"], item.get("target_id"))
                for item in review_items
            ],
            failure_reason=failure_reason,
        )
        aggregate_hash = hashlib.sha256("\n".join(aggregate["input_hashes"]).encode("utf-8")).hexdigest()
        aggregate.update({
            "input_hash": aggregate_hash,
            "status": "failed" if failures and not recommendations else "partial_failed" if failures else "completed",
            "error_message": failure_reason,
        })
        self.store.save_llm_assist(
            run_id,
            aggregate_hash,
            aggregate,
            raw_text=None,
            status=aggregate["status"],
        )
        self.store._write_run_artifact(run_id, "llm_assist.json", aggregate)
        notify("sentiment_completed", 1.0)
        return report

    def _build_targets(self, prepared: dict[str, Any]) -> list[dict[str, Any]]:
        output: list[dict[str, Any]] = []
        for comment in prepared["comments"]:
            mentions = prepared["mentions_by_comment"].get(comment["id"], [])
            overall_rule = classify_sentiment(comment["text_original"])
            output.append({
                "comment_id": comment["id"],
                "target_type": "video",
                "target_id": None,
                "target_display_name": None,
                "like_count": int(comment["like_count"]),
                "rule": overall_rule,
            })
            for mention in mentions:
                rule = classify_sentiment(comment["text_original"], mention["aliases"])
                if len(mentions) > 1 and "multiple_targets" not in rule["ambiguity_flags"]:
                    rule["ambiguity_flags"].append("multiple_targets")
                    rule["needs_ai"] = True
                    rule["confidence"] = min(float(rule["confidence"]), 0.68)
                output.append({
                    "comment_id": comment["id"],
                    "target_type": "person",
                    "target_id": mention["person_id"],
                    "target_display_name": mention["display_name"],
                    "like_count": int(comment["like_count"]),
                    "rule": rule,
                })
        return output

    def _mark_ai_capacity(self, results: list[dict[str, Any]]) -> None:
        eligible = [result for result in results if result["needs_ai"]]
        priority = {
            "rule_model_conflict": 0,
            "local_model_failed": 1,
            "low_model_confidence": 2,
            "mixed_candidate": 3,
            "input_truncated": 4,
            "ambiguous_expression": 5,
        }
        eligible.sort(key=lambda item: (
            min((priority.get(reason, 99) for reason in item["review_reasons"]), default=99),
            -item["like_count"],
        ))
        selected_comments: set[str] = set()
        for result in eligible:
            if result["comment_id"] in selected_comments:
                continue
            if len(selected_comments) < self.classifier.config.ai_max_comments:
                selected_comments.add(result["comment_id"])
        for result in eligible:
            if result["comment_id"] not in selected_comments:
                reasons = result["evidence"]["integration"]["review_reasons"]
                if "ai_capacity_deferred" not in reasons:
                    reasons.append("ai_capacity_deferred")

    def _select_ai_items(self, review_items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        selected_comments: list[str] = []
        selected: list[dict[str, Any]] = []
        for item in review_items:
            if "ai_capacity_deferred" in (item.get("review_reasons") or []):
                continue
            comment_id = item["comment_id"]
            if comment_id not in selected_comments:
                if len(selected_comments) >= self.classifier.config.ai_max_comments:
                    continue
                selected_comments.append(comment_id)
            selected.append(item)
        return selected

    def _run_ai_batches(
        self,
        report: dict[str, Any],
        review_items: list[dict[str, Any]],
        client: LlmClient | None,
    ) -> tuple[list[dict[str, Any]], list[str], dict[str, Any]]:
        active_client = client or CodexAppServerClient(effort="low", output_schema=SENTIMENT_OUTPUT_SCHEMA)
        comments: list[str] = []
        for item in review_items:
            if item["comment_id"] not in comments:
                comments.append(item["comment_id"])
        recommendations: list[dict[str, Any]] = []
        failures: list[str] = []
        input_hashes: list[str] = []
        raw_results: list[dict[str, Any]] = []
        batch_size = self.classifier.config.ai_batch_comments
        for start in range(0, len(comments), batch_size):
            batch_comments = set(comments[start : start + batch_size])
            batch_report = copy.deepcopy(report)
            batch_report["sentiment"]["review_items"] = [
                item for item in review_items if item["comment_id"] in batch_comments
            ]
            prompt = build_sentiment_review_prompt(batch_report)
            cache_key = sentiment_cache_key(prompt)
            input_hashes.append(cache_key)
            cached = self.store.read_llm_cache(cache_key)
            if cached:
                parsed = {**cached, "source": "cache", "input_hash": cache_key}
            else:
                raw_text = None
                try:
                    raw_text = active_client.ask(prompt)
                    parsed = {**parse_sentiment_review_json(raw_text), "source": "codex_app_server", "input_hash": cache_key}
                    self.store.write_llm_cache(cache_key, parsed, raw_text)
                except Exception as exc:
                    parsed = build_failed_llm_assist(cache_key, exc)
                    failures.append(str(exc))
            raw_results.append(parsed)
            recommendations.extend(parsed.get("sentiment_recommendations") or [])
        aggregate = {
            "schema_version": "sentiment_review.v1",
            "prompt_version": raw_results[0].get("prompt_version") if raw_results else "",
            "provider": "codex_app_server",
            "source": "batched",
            "input_hashes": input_hashes,
            "candidate_recommendations": _unique_dicts(raw_results, "candidate_recommendations"),
            "alias_recommendations": _unique_dicts(raw_results, "alias_recommendations"),
            "ambiguous_comments": _unique_dicts(raw_results, "ambiguous_comments"),
            "sentiment_recommendations": recommendations,
            "notes": [note for result in raw_results for note in result.get("notes", [])],
        }
        return recommendations, failures, aggregate


def _unique_dicts(results: list[dict[str, Any]], key: str) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    seen: set[str] = set()
    for result in results:
        for item in result.get(key) or []:
            fingerprint = json.dumps(item, ensure_ascii=False, sort_keys=True)
            if fingerprint not in seen:
                output.append(item)
                seen.add(fingerprint)
    return output

from __future__ import annotations

import argparse
import json
import resource
import sys
import time
from dataclasses import replace
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.local_sentiment import LocalSentimentClassifier, load_local_sentiment_config


LABELS = ("positive", "neutral", "negative")
CANDIDATES = [
    {
        "model_id": "LoneWolfgang/bert-for-japanese-twitter-sentiment",
        "revision": "81e5f6f9ef184b27acc908917eb6c182b28109cf",
        "license": "Apache-2.0",
        "domain": "Japanese social media",
        "label_by_index": ("negative", "neutral", "positive"),
    },
    {
        "model_id": "christian-phu/bert-finetuned-japanese-sentiment",
        "revision": "d5bdcb2a681719bcddb3532d4aa60e1d5797f051",
        "license": "CC-BY-SA-4.0",
        "domain": "Japanese Amazon reviews",
        "label_by_index": ("negative", "neutral", "positive"),
    },
    {
        "model_id": "lxyuan/distilbert-base-multilingual-cased-sentiments-student",
        "revision": "cf991100d706c13c0a080c097134c05b7f436c45",
        "license": "Apache-2.0",
        "domain": "Multilingual general sentiment",
        "label_by_index": ("positive", "neutral", "negative"),
    },
]


def load_fixture(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def class_metrics(rows: list[dict[str, Any]], prediction_key: str = "prediction") -> dict[str, Any]:
    per_label: dict[str, dict[str, float | int]] = {}
    matrix = {expected: {actual: 0 for actual in LABELS} for expected in LABELS}
    for row in rows:
        if row["label"] in LABELS and row[prediction_key] in LABELS:
            matrix[row["label"]][row[prediction_key]] += 1
    for label in LABELS:
        tp = sum(row["label"] == label and row[prediction_key] == label for row in rows)
        fp = sum(row["label"] != label and row[prediction_key] == label for row in rows)
        fn = sum(row["label"] == label and row[prediction_key] != label for row in rows)
        precision = tp / max(tp + fp, 1)
        recall = tp / max(tp + fn, 1)
        f1 = 2 * precision * recall / max(precision + recall, 1e-12)
        per_label[label] = {"precision": precision, "recall": recall, "f1": f1, "support": sum(row["label"] == label for row in rows)}
    return {
        "per_label": per_label,
        "macro_f1": sum(float(values["f1"]) for values in per_label.values()) / len(LABELS),
        "confusion_matrix": matrix,
    }


def choose_threshold(rows: list[dict[str, Any]]) -> dict[str, Any]:
    best: dict[str, Any] | None = None
    precision_only: dict[str, Any] | None = None
    for step in range(50, 96):
        threshold = step / 100
        accepted = [row for row in rows if row["confidence"] >= threshold]
        if not accepted:
            continue
        correct = sum(row["prediction"] == row["label"] for row in accepted)
        precision = correct / len(accepted)
        coverage = len(accepted) / len(rows)
        class_precisions = []
        for label in LABELS:
            predicted = [row for row in accepted if row["prediction"] == label]
            class_precisions.append(sum(row["label"] == label for row in predicted) / len(predicted) if predicted else 1.0)
        candidate = {
            "threshold": threshold,
            "accepted_precision": precision,
            "minimum_class_precision": min(class_precisions),
            "coverage": coverage,
        }
        if precision >= 0.9 and min(class_precisions) >= 0.8:
            if precision_only is None or coverage > precision_only["coverage"]:
                precision_only = candidate
            if coverage >= 0.5 and (best is None or coverage > best["coverage"]):
                best = candidate
    if best:
        return {**best, "mode": "automatic"}
    if precision_only:
        return {**precision_only, "mode": "automatic_low_coverage"}
    return {"threshold": 1.01, "accepted_precision": None, "minimum_class_precision": None, "coverage": 0.0, "mode": "advice_only"}


def evaluate_candidate(candidate: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, Any]:
    base = load_local_sentiment_config()
    config = replace(
        base,
        model_id=candidate["model_id"],
        revision=candidate["revision"],
        license=candidate["license"],
        label_by_index=candidate["label_by_index"],
    )
    classifier = LocalSentimentClassifier(config)
    texts = [row["text"] for row in rows]
    rss_before = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    started = time.perf_counter()
    predictions = classifier.predict(texts)
    cold_seconds = time.perf_counter() - started
    failure = next((value.get("error") for value in predictions.values() if value.get("status") == "failed"), None)
    if failure:
        return {**candidate, "status": "failed", "error": failure}

    classifier.clear_memory_cache()
    warm_started = time.perf_counter()
    warm_predictions = classifier.predict(texts)
    warm_seconds = time.perf_counter() - warm_started
    evaluated = [
        {
            **row,
            "prediction": predictions[row["text"]]["label"],
            "confidence": predictions[row["text"]]["confidence"],
            "probabilities": predictions[row["text"]]["probabilities"],
        }
        for row in rows
    ]
    calibration = [row for row in evaluated if row["split"] == "calibration" and row["label"] in LABELS]
    holdout = [row for row in evaluated if row["split"] == "holdout" and row["label"] in LABELS]
    threshold = choose_threshold(calibration)
    accepted_holdout = [row for row in holdout if row["confidence"] >= threshold["threshold"]]
    holdout_precision = (
        sum(row["prediction"] == row["label"] for row in accepted_holdout) / len(accepted_holdout)
        if accepted_holdout else None
    )
    complex_errors = [
        {"id": row["id"], "expected": row["label"], "actual": row["prediction"], "phenomena": row["phenomena"]}
        for row in evaluated
        if row["prediction"] != row["label"] and set(row["phenomena"]) & {"rhetorical_question", "quote", "idiom", "double_negation"}
    ]
    peak_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return {
        **candidate,
        "status": "completed",
        "device": classifier.status()["device"],
        "calibration": class_metrics(calibration),
        "holdout": class_metrics(holdout),
        "threshold": threshold,
        "holdout_accepted_precision": holdout_precision,
        "complex_error_count": len(complex_errors),
        "complex_errors": complex_errors,
        "performance": {
            "cold_seconds": cold_seconds,
            "warm_seconds": warm_seconds,
            "warm_texts_per_second": len(texts) / max(warm_seconds, 1e-9),
            "peak_rss_delta_bytes": max(0, peak_rss - rss_before),
        },
        "predictions": evaluated,
        "warm_prediction_count": len(warm_predictions),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, default=ROOT / "fixtures" / "sentiment_hybrid_eval.jsonl")
    parser.add_argument("--output", type=Path, default=Path("/tmp/youtube-comments-analyzer-sentiment-evaluation.json"))
    args = parser.parse_args()
    rows = load_fixture(args.fixture)
    results = [evaluate_candidate(candidate, rows) for candidate in CANDIDATES]
    eligible = [result for result in results if result.get("status") == "completed"]
    eligible.sort(key=lambda result: (
        -result["calibration"]["macro_f1"],
        result["complex_error_count"],
        -result["threshold"]["coverage"],
        -result["performance"]["warm_texts_per_second"],
    ))
    selected = None
    for result in eligible:
        precision = result["holdout_accepted_precision"]
        if precision is None or precision >= 0.85:
            selected = {
                "model_id": result["model_id"],
                "revision": result["revision"],
                "license": result["license"],
                "confidence_threshold": result["threshold"]["threshold"],
                "selection_reason": "macro_f1_then_complex_errors_then_coverage_then_speed",
            }
            break
    if selected is None and eligible:
        selected = {
            "model_id": eligible[0]["model_id"],
            "revision": eligible[0]["revision"],
            "license": eligible[0]["license"],
            "confidence_threshold": 1.01,
            "selection_reason": "all_holdout_gates_failed_advice_only",
        }
    payload = {
        "schema_version": "sentiment_model_evaluation.v1",
        "fixture": str(args.fixture),
        "fixture_count": len(rows),
        "selected": selected,
        "results": results,
        "excluded": [{
            "model_family": "WRIME-derived models",
            "reason": "WRIME is CC BY-NC-ND 4.0; known candidate also lacks three-class labels and sufficient model metadata",
        }],
    }
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"output": str(args.output), "selected": selected}, ensure_ascii=False))


if __name__ == "__main__":
    main()

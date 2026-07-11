from __future__ import annotations

import re
from collections import Counter
from typing import Any, Iterable


SENTIMENT_LABELS = ("positive", "neutral", "negative", "mixed", "unclear")
POSITIVE_TERMS = (
    "好き",
    "最高",
    "良い",
    "いい",
    "素敵",
    "尊敬",
    "面白",
    "おもしろ",
    "かわい",
    "可愛",
    "綺麗",
    "きれい",
    "すご",
    "推し",
    "上手",
    "うまい",
    "嬉し",
    "感動",
)
NEGATIVE_TERMS = (
    "嫌い",
    "苦手",
    "つまら",
    "無理",
    "怖い",
    "ひどい",
    "炎上",
    "嫌",
    "下手",
    "うざ",
    "不快",
    "残念",
)
NEGATION_SUFFIXES = ("ない", "なく", "なかった", "じゃない", "ではない", "ません", "ぬ")
UNCERTAINTY_MARKERS = ("けど", "ただ", "一方", "？", "?", "笑", "w", "草", "皮肉")
CLAUSE_SPLIT = re.compile(r"[。！!？?\n]|(?:、|,)(?=.{0,24}(?:さん|ちゃん|くん|君|氏))")


def classify_sentiment(text: str, target_aliases: Iterable[str] = ()) -> dict[str, Any]:
    source = text.strip()
    aliases = [alias for alias in target_aliases if alias]
    scoped = target_scope(source, aliases)
    positive_evidence: list[str] = []
    negative_evidence: list[str] = []

    for term in POSITIVE_TERMS:
        for index in term_positions(scoped, term):
            if is_negated(scoped, index + len(term)):
                negative_evidence.append(f"{term}…否定")
            else:
                positive_evidence.append(term)

    for term in NEGATIVE_TERMS:
        for index in term_positions(scoped, term):
            if is_negated(scoped, index + len(term)):
                positive_evidence.append(f"{term}…否定")
            else:
                negative_evidence.append(term)

    positive_evidence = unique(positive_evidence)
    negative_evidence = unique(negative_evidence)
    if positive_evidence and negative_evidence:
        label = "mixed"
        confidence = 0.76
    elif positive_evidence:
        label = "positive"
        confidence = 0.86
    elif negative_evidence:
        label = "negative"
        confidence = 0.86
    elif len(scoped) < 8:
        label = "unclear"
        confidence = 0.35
    else:
        label = "neutral"
        confidence = 0.58

    has_uncertainty = any(marker in scoped for marker in UNCERTAINTY_MARKERS)
    needs_ai = label in {"unclear", "mixed"} or has_uncertainty
    if needs_ai:
        confidence = min(confidence, 0.68)
    return {
        "label": label,
        "confidence": round(confidence, 2),
        "method": "rule",
        "evidence": [*positive_evidence, *negative_evidence],
        "needs_ai": needs_ai,
        "scope_text": scoped[:500],
    }


def target_scope(text: str, aliases: list[str]) -> str:
    if not aliases:
        return text
    clauses = [clause.strip() for clause in CLAUSE_SPLIT.split(text) if clause.strip()]
    matched = [clause for clause in clauses if any(alias in clause for alias in aliases)]
    return "。".join(matched) if matched else text


def term_positions(text: str, term: str) -> list[int]:
    output: list[int] = []
    start = 0
    while True:
        index = text.find(term, start)
        if index < 0:
            return output
        output.append(index)
        start = index + len(term)


def is_negated(text: str, end: int) -> bool:
    suffix = text[end : end + 7]
    return any(marker in suffix for marker in NEGATION_SUFFIXES)


def unique(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def sentiment_distribution(labels: Iterable[str]) -> dict[str, Any]:
    counts = Counter(label if label in SENTIMENT_LABELS else "unclear" for label in labels)
    total = sum(counts.values())
    return {
        "total": total,
        "counts": {label: counts[label] for label in SENTIMENT_LABELS},
        "rates": {
            label: round(counts[label] / total, 4) if total else 0.0
            for label in SENTIMENT_LABELS
        },
    }

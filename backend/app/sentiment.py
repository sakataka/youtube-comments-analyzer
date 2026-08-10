from __future__ import annotations

import re
from collections import Counter
from typing import Any, Iterable


SENTIMENT_LABELS = ("positive", "neutral", "negative", "mixed", "unclear")
MODEL_LABELS = ("positive", "neutral", "negative")
POSITIVE_TERMS = (
    "好き", "最高", "良い", "いい", "素敵", "尊敬", "面白", "おもしろ", "かわい", "可愛",
    "綺麗", "きれい", "すご", "推し", "上手", "うまい", "嬉し", "感動",
)
NEGATIVE_TERMS = (
    "嫌い", "苦手", "つまら", "無理", "怖い", "ひどい", "炎上", "嫌", "下手", "うざ", "不快", "残念",
)
NEGATION_SUFFIXES = ("ない", "なく", "なかった", "じゃない", "ではない", "ません", "ぬ")
CONTRAST_MARKERS = ("けど", "だけど", "しかし", "ただ", "一方", "なのに", "より")
CLAUSE_SPLIT = re.compile(r"[。！!？?\n]|(?:、|,)(?=.{0,24}(?:さん|ちゃん|くん|君|氏))")
QUOTE_PATTERN = re.compile(r"「[^」]*」|『[^』]*』|“[^”]*”|\"[^\"]*\"|'[^']*'")
RHETORICAL_NEGATION = re.compile(r"(?:く|くなって|じゃ|では)?ない(?:か|の)(?:[.…。！？?!]*)$")
FEASIBILITY_PATTERN = re.compile(r"(?:実現|実際|現実|可能|でき|出来|企画|成立|やる|する).{0,16}無理|無理.{0,16}(?:実現|可能|でき|出来|企画|成立)")


def classify_sentiment(text: str, target_aliases: Iterable[str] = ()) -> dict[str, Any]:
    source = text.strip()
    aliases = [alias for alias in target_aliases if alias]
    scoped, scope_type = target_scope_details(source, aliases)
    quote_ranges = [(match.start(), match.end()) for match in QUOTE_PATTERN.finditer(scoped)]
    ambiguity_flags = detect_ambiguity(scoped, quote_ranges)
    matched_terms: list[dict[str, Any]] = []
    positive_evidence: list[str] = []
    negative_evidence: list[str] = []
    negations: list[str] = []

    for polarity, terms in (("positive", POSITIVE_TERMS), ("negative", NEGATIVE_TERMS)):
        for term in terms:
            for index in term_positions(scoped, term):
                quoted = any(start <= index < end for start, end in quote_ranges)
                idiom = term == "下手" and scoped[index : index + 3] == "下手に"
                feasibility = term == "無理" and bool(FEASIBILITY_PATTERN.search(scoped))
                negated = is_negated(scoped, index + len(term))
                rhetorical = negated and bool(RHETORICAL_NEGATION.search(scoped[index + len(term) :]))
                effective = polarity
                ignored_reason = None
                if quoted:
                    ignored_reason = "quoted"
                elif idiom:
                    ignored_reason = "idiom"
                    if "idiom" not in ambiguity_flags:
                        ambiguity_flags.append("idiom")
                elif feasibility:
                    ignored_reason = "feasibility"
                    if "feasibility" not in ambiguity_flags:
                        ambiguity_flags.append("feasibility")
                elif rhetorical:
                    effective = polarity
                    if "rhetorical_question" not in ambiguity_flags:
                        ambiguity_flags.append("rhetorical_question")
                elif negated:
                    effective = "negative" if polarity == "positive" else "positive"
                if negated:
                    negations.append(scoped[index : min(len(scoped), index + len(term) + 12)])
                matched_terms.append({
                    "term": term,
                    "polarity": polarity,
                    "effective_polarity": effective,
                    "negated": negated,
                    "quoted": quoted,
                    "ignored_reason": ignored_reason,
                })
                if ignored_reason:
                    continue
                evidence = f"{term}…反語" if rhetorical else f"{term}…否定" if negated else term
                if effective == "positive":
                    positive_evidence.append(evidence)
                else:
                    negative_evidence.append(evidence)

    positive_evidence = unique(positive_evidence)
    negative_evidence = unique(negative_evidence)
    if positive_evidence and negative_evidence:
        label, confidence = "mixed", 0.76
    elif positive_evidence:
        label, confidence = "positive", 0.86
    elif negative_evidence:
        label, confidence = "negative", 0.86
    elif len(scoped) < 8:
        label, confidence = "unclear", 0.35
    else:
        label, confidence = "neutral", 0.58

    needs_ai = label in {"unclear", "mixed"} or bool(ambiguity_flags)
    if needs_ai:
        confidence = min(confidence, 0.68)
    return {
        "label": label,
        "confidence": round(confidence, 4),
        "method": "rule",
        "evidence": [*positive_evidence, *negative_evidence],
        "matched_terms": matched_terms,
        "negations": unique(negations),
        "ambiguity_flags": unique(ambiguity_flags),
        "needs_ai": needs_ai,
        "scope_text": scoped[:1000],
        "scope_type": scope_type,
    }


def detect_ambiguity(text: str, quote_ranges: list[tuple[int, int]]) -> list[str]:
    flags: list[str] = []
    if RHETORICAL_NEGATION.search(text):
        flags.append("rhetorical_question")
    elif "？" in text or "?" in text:
        flags.append("question")
    if quote_ranges:
        flags.append("quote")
    clauses = [clause.strip() for clause in CLAUSE_SPLIT.split(text) if clause.strip()]
    if len(clauses) > 1:
        flags.append("multiple_clauses")
    if any(marker in text for marker in CONTRAST_MARKERS):
        flags.append("contrast")
    return flags


def integrate_sentiment(
    rule: dict[str, Any],
    local: dict[str, Any] | None,
    confidence_threshold: float,
) -> dict[str, Any]:
    flags = list(rule.get("ambiguity_flags") or [])
    blocking_flags = [flag for flag in flags if flag != "multiple_clauses"]
    rule_has_polarity = any(
        item.get("effective_polarity") in {"positive", "negative"} and not item.get("ignored_reason")
        for item in rule.get("matched_terms") or []
    )
    local_error = not local or bool(local.get("error"))
    review_reasons: list[str] = []

    if local_error:
        if rule["label"] in MODEL_LABELS and not blocking_flags:
            label, confidence, method, needs_ai, reason = (
                rule["label"], rule["confidence"], "rule", False, "local_model_unavailable_rule_confirmed",
            )
        else:
            label, confidence, method, needs_ai, reason = (
                "unclear", min(float(rule["confidence"]), 0.68), "rule", True, "local_model_unavailable_ambiguous",
            )
            review_reasons.append("local_model_failed")
    else:
        local_label = str(local["label"])
        local_confidence = float(local["confidence"])
        if local.get("input_truncated"):
            review_reasons.append("input_truncated")
        if local_confidence < confidence_threshold:
            review_reasons.append("low_model_confidence")
        if rule["label"] == "mixed":
            review_reasons.append("mixed_candidate")
        if blocking_flags:
            review_reasons.append("ambiguous_expression")
        if rule_has_polarity and rule["label"] in MODEL_LABELS and rule["label"] != local_label:
            review_reasons.append("rule_model_conflict")

        if review_reasons:
            label = "unclear"
            confidence = min(float(rule["confidence"]), local_confidence, 0.68)
            method = "hybrid"
            needs_ai = True
            reason = review_reasons[0]
        elif rule_has_polarity and rule["label"] == local_label:
            label, confidence, method, needs_ai, reason = (
                local_label, local_confidence, "hybrid", False, "rule_model_agreement",
            )
        else:
            label, confidence, method, needs_ai, reason = (
                local_label, local_confidence, "local_model", False, "local_model_clear",
            )

    evidence = {
        "schema_version": "sentiment_evidence.v2",
        "rule": {
            "label": rule["label"],
            "confidence": rule["confidence"],
            "matched_terms": rule.get("matched_terms") or [],
            "negations": rule.get("negations") or [],
            "scope_text": rule.get("scope_text") or "",
            "scope_type": rule.get("scope_type") or "full",
            "ambiguity_flags": flags,
        },
        "local_model": local or {"status": "failed", "error": "unavailable"},
        "integration": {
            "label": label,
            "reason": reason,
            "needs_ai": needs_ai,
            "review_reasons": unique(review_reasons),
        },
    }
    return {
        "label": label,
        "confidence": round(float(confidence), 4),
        "method": method,
        "evidence": evidence,
        "needs_ai": needs_ai,
        "review_reasons": unique(review_reasons),
    }


def target_scope_details(text: str, aliases: list[str]) -> tuple[str, str]:
    if not aliases:
        return text, "full"
    clauses = [clause.strip() for clause in CLAUSE_SPLIT.split(text) if clause.strip()]
    matched = [clause for clause in clauses if any(alias in clause for alias in aliases)]
    return ("。".join(matched), "target_clauses") if matched else (text, "full_fallback")


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
    suffix = text[end : end + 12]
    return any(marker in suffix for marker in NEGATION_SUFFIXES)


def unique(values: list[Any]) -> list[Any]:
    output: list[Any] = []
    for value in values:
        if value not in output:
            output.append(value)
    return output


def sentiment_distribution(labels: Iterable[str]) -> dict[str, Any]:
    counts = Counter(label if label in SENTIMENT_LABELS else "unclear" for label in labels)
    total = sum(counts.values())
    return {
        "total": total,
        "counts": {label: counts[label] for label in SENTIMENT_LABELS},
        "rates": {label: round(counts[label] / total, 4) if total else 0.0 for label in SENTIMENT_LABELS},
    }

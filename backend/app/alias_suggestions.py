from __future__ import annotations

import re
from collections import Counter, defaultdict
from typing import Any

from .candidate_extraction import is_generic_candidate
from .mention_classification import alias_matches
from .text import normalize_alias
from .text_filters import is_noise_keyword, person_alias_terms


NICKNAME_TOKEN_RE = re.compile(r"[ァ-ヶー]{3,12}|[ぁ-んー]{3,12}|[一-龥々]{2,6}(?:ちゃん|さん|くん|君)")
SUGGESTION_STOPWORDS = {
    "それぞれ",
    "みんな",
}


def build_alias_suggestions(
    comments: list[Any],
    persons: list[dict[str, Any]],
    limit: int = 24,
) -> list[dict[str, Any]]:
    accepted_persons = [person for person in persons if person["status"] == "accepted"]
    known_aliases = {
        alias["normalized_alias"]
        for person in persons
        for alias in person["aliases"]
        if alias["status"] == "accepted"
    }
    person_aliases = {
        person["person_id"]: [
            alias["normalized_alias"]
            for alias in person["aliases"]
            if alias["status"] == "accepted"
        ]
        for person in accepted_persons
    }
    person_names = {person["person_id"]: person["display_name"] for person in accepted_persons}

    counts: Counter[str] = Counter()
    display_tokens: dict[str, str] = {}
    representatives: dict[str, list[Any]] = defaultdict(list)
    cooccurrence: dict[str, Counter[str]] = defaultdict(Counter)

    for comment in comments:
        normalized_comment = comment["text_normalized"]
        mentioned_person_ids = [
            person_id
            for person_id, aliases in person_aliases.items()
            if any(alias_matches(normalized_comment, alias) for alias in aliases)
        ]
        seen_tokens: set[str] = set()
        for token in extract_nickname_like_tokens(comment["text_original"]):
            normalized_token = normalize_alias(token)
            if not should_suggest_alias_token(normalized_token, token, known_aliases):
                continue
            if normalized_token in seen_tokens:
                continue
            seen_tokens.add(normalized_token)
            counts[normalized_token] += 1
            display_tokens.setdefault(normalized_token, token)
            if len(representatives[normalized_token]) < 3:
                representatives[normalized_token].append(comment)
            for person_id in mentioned_person_ids:
                cooccurrence[normalized_token][person_id] += 1

    suggestions = []
    for normalized_token, count in counts.most_common():
        if count < 2 and not cooccurrence[normalized_token]:
            continue
        suggested_person_id = None
        suggested_person_name = None
        if cooccurrence[normalized_token]:
            suggested_person_id, _ = cooccurrence[normalized_token].most_common(1)[0]
            suggested_person_name = person_names.get(suggested_person_id)
        suggestions.append({
            "token": display_tokens[normalized_token],
            "normalized_alias": normalized_token,
            "hit_count": count,
            "suggested_person_id": suggested_person_id,
            "suggested_person_name": suggested_person_name,
            "reason": suggestion_reason(count, suggested_person_name),
            "representative_comments": [
                {
                    "comment_id": comment["id"],
                    "text_original": comment["text_original"],
                    "like_count": comment["like_count"],
                    "is_reply": bool(comment["is_reply"]),
                }
                for comment in representatives[normalized_token]
            ],
        })
        if len(suggestions) >= limit:
            break
    return suggestions


def extract_nickname_like_tokens(text: str) -> list[str]:
    output: list[str] = []
    output.extend(person_alias_terms(text))
    for match in NICKNAME_TOKEN_RE.finditer(text):
        token = match.group(0).strip()
        token = re.sub(r"(さん|ちゃん|くん|君)$", "", token)
        token = re.sub(r"[はがもにをでとの]$", "", token)
        if token:
            output.append(token)
    return output


def should_suggest_alias_token(normalized_token: str, token: str, known_aliases: set[str]) -> bool:
    if not normalized_token or normalized_token in known_aliases:
        return False
    if len(normalized_token) < 2 or len(normalized_token) > 12:
        return False
    if is_noise_keyword(token) or normalized_token in {normalize_alias(word) for word in SUGGESTION_STOPWORDS}:
        return False
    if is_generic_candidate(token):
        return False
    if re.search(r"\d", normalized_token):
        return False
    if re.fullmatch(r"[ぁ-んー]+", normalized_token) and len(normalized_token) <= 2:
        return False
    return True


def suggestion_reason(hit_count: int, suggested_person_name: str | None) -> str:
    if suggested_person_name:
        return f"{hit_count}件出現し、{suggested_person_name} への言及コメントと共起"
    return f"{hit_count}件出現。既存 alias には未登録"

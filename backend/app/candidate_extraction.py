from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from .text import normalize_alias
from .text_filters import is_noise_keyword, person_alias_terms


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


@dataclass(frozen=True)
class DerivedAliasSeed:
    token: str
    normalized: str
    hit_count: int
    representative_ids: list[str]


@dataclass(frozen=True)
class CandidateSeed:
    token: str
    normalized: str
    source: str
    hit_count: int
    confidence: float
    status: str
    alias_status: str
    is_ambiguous: bool
    reason: str
    entity_type: str
    representative_ids: list[str]
    parent_token: str | None
    derived_aliases: list[DerivedAliasSeed]


def build_candidate_seeds(
    title: str,
    description: str,
    comments: list[Any],
    limit: int = 32,
) -> list[CandidateSeed]:
    frequencies: Counter[str] = Counter()
    source_kinds: dict[str, set[str]] = defaultdict(set)
    representative_ids: dict[str, list[str]] = defaultdict(list)

    metadata_inputs = [
        (title, True, "metadata_title"),
        (description, False, "metadata_description"),
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

    return [
        build_candidate_seed(token, frequencies, source_kinds, representative_ids, metadata_person_tokens)
        for token in ordered_tokens[:limit]
    ]


def build_candidate_seed(
    token: str,
    frequencies: Counter[str],
    source_kinds: dict[str, set[str]],
    representative_ids: dict[str, list[str]],
    metadata_person_tokens: list[str],
) -> CandidateSeed:
    count = frequencies[token]
    normalized = normalize_alias(token)
    generic = is_generic_candidate(token)
    from_title_metadata = "metadata_title" in source_kinds[token]
    parent_token = find_metadata_parent_token(token, metadata_person_tokens)

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

    derived_aliases = [
        DerivedAliasSeed(
            token=alias_token,
            normalized=normalize_alias(alias_token),
            hit_count=frequencies.get(alias_token, 0),
            representative_ids=representative_ids.get(alias_token, []),
        )
        for alias_token in derived_name_aliases(token)
    ]
    return CandidateSeed(
        token=token,
        normalized=normalized,
        source="+".join(sorted(source_kinds[token])) or "comment",
        hit_count=count,
        confidence=confidence,
        status=status,
        alias_status=alias_status,
        is_ambiguous=len(normalized) <= 2,
        reason=candidate_reason(source_kinds[token], generic),
        entity_type=guess_entity_type(token),
        representative_ids=representative_ids[token],
        parent_token=parent_token,
        derived_aliases=derived_aliases if from_title_metadata and status == "accepted" else [],
    )


def extract_candidate_tokens(
    text: str,
    include_metadata_lists: bool = False,
    include_loose_metadata: bool = False,
) -> list[str]:
    if not text:
        return []
    tokens: list[str] = []
    tokens.extend(person_alias_terms(text))
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
        if not cleaned_token or cleaned_token in seen or is_noise_keyword(cleaned_token):
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
    if is_noise_keyword(token):
        return True
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

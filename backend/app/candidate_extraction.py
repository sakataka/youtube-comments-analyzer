from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from .text import normalize_alias
from .text_filters import honorific_person_alias_terms, is_noise_keyword, is_person_alias_like, person_alias_terms


HONORIFIC_RE = re.compile(
    r"([一-龥々]{2,6}|[一-龥々]{1,4}[ァ-ヶー]{2,8}|[ァ-ヶー]{3,16}|[ぁ-んー]{2,8}(?:ちゃむ|ちゃん|たん|りん|ぽん|ぴょん|みん|っち|ちん|きゅん|にゃん))(さん|ちゃん|くん|君|氏|様)"
)
KATAKANA_RE = re.compile(r"[ァ-ヶー]{3,16}")
KANJI_KATAKANA_RE = re.compile(r"[一-龥々]{1,8}[ァ-ヶー]{2,12}")
HASHTAG_RE = re.compile(r"#([一-龥々ぁ-んァ-ヶA-Za-z0-9_ー]{2,24})")
BRACKET_CONTENT_RE = re.compile(r"[【\[\(（]([^】\]\)）]{2,160})[】\]\)）]")
METADATA_TOKEN_RE = re.compile(r"[一-龥々ぁ-んァ-ヶA-Za-z0-9_ー]{2,24}")
METADATA_SPLIT_RE = re.compile(r"[、,／/・\s]+")
METADATA_PERSON_LIST_HEADING_RE = re.compile(r"^[＜<【\[]?\s*(ゲスト|出演|出演者|出演メンバー|登場人物|参加者|キャスト)\s*[＞>】\]]?\s*$")
URL_TOKEN_RE = re.compile(r"https?://\S+")

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

    for token in extract_candidate_tokens(title, include_metadata_lists=True):
        frequencies[token] += 12
        source_kinds[token].add("metadata_title")

    for token in extract_description_person_list_tokens(description):
        frequencies[token] += 12
        source_kinds[token].add("metadata_description")

    for comment in comments:
        seen_in_comment: set[str] = set()
        honorific_aliases = {normalize_alias(token) for token in honorific_person_alias_terms(comment["text_original"])}
        for token in extract_candidate_tokens(comment["text_original"]):
            normalized = normalize_alias(token)
            if normalized not in seen_in_comment:
                frequencies[token] += 1
                source_kinds[token].add("comment")
                if normalized in honorific_aliases:
                    source_kinds[token].add("comment_honorific")
                seen_in_comment.add(normalized)
            if len(representative_ids[token]) < 3:
                representative_ids[token].append(comment["id"])

    metadata_person_tokens = [
        token
        for token in frequencies
        if {"metadata_title", "metadata_description"} & source_kinds[token]
        and not is_generic_candidate(token)
        and len(normalize_alias(token)) > 1
    ]
    ordered_tokens = unique_ordered_tokens([
        *[token for token, _ in candidate_frequency_order(Counter({token: frequencies[token] for token in metadata_person_tokens}))],
        *[token for token, _ in candidate_frequency_order(frequencies)],
    ])

    filtered_tokens = [
        token
        for token in ordered_tokens
        if should_keep_candidate_token(token, frequencies, source_kinds[token], metadata_person_tokens)
    ]

    return [
        build_candidate_seed(token, frequencies, source_kinds, representative_ids, metadata_person_tokens)
        for token in filtered_tokens[:limit]
    ]


def should_keep_candidate_token(
    token: str,
    frequencies: Counter[str],
    source_kinds: set[str],
    metadata_person_tokens: list[str],
) -> bool:
    normalized = normalize_alias(token)
    if len(normalized) <= 1:
        return False
    if looks_like_sentence_fragment(token):
        return False
    if is_generic_candidate(token):
        return False
    if "metadata_title" in source_kinds or "metadata_description" in source_kinds:
        return True
    if find_metadata_parent_token(token, metadata_person_tokens):
        return True
    if "comment_honorific" in source_kinds:
        return True
    return frequencies[token] >= 2


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
    from_strong_metadata = bool({"metadata_title", "metadata_description"} & source_kinds[token])
    parent_token = find_metadata_parent_token(token, metadata_person_tokens)

    if len(normalized) <= 1 or generic:
        status = "rejected"
        confidence = 0.2
    elif from_strong_metadata:
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
        derived_aliases=derived_aliases if from_strong_metadata and status == "accepted" else [],
    )


def extract_candidate_tokens(
    text: str,
    include_metadata_lists: bool = False,
    include_loose_metadata: bool = False,
) -> list[str]:
    if not text:
        return []
    trusted_aliases = person_alias_terms(text)
    trusted_normalized = {normalize_alias(token) for token in trusted_aliases}
    tokens: list[str] = []
    tokens.extend(trusted_aliases)
    tokens.extend(match.group(1) for match in HASHTAG_RE.finditer(text))
    if include_metadata_lists:
        tokens.extend(extract_metadata_list_tokens(text, include_loose_metadata))
    cleaned: list[str] = []
    seen: set[str] = set()
    for token in tokens:
        cleaned_token = clean_candidate_token(token)
        if not cleaned_token or cleaned_token in seen or is_noise_keyword(cleaned_token):
            continue
        if normalize_alias(cleaned_token) not in trusted_normalized and not is_person_alias_like(cleaned_token):
            continue
        cleaned.append(cleaned_token)
        seen.add(cleaned_token)
    return cleaned


def extract_description_person_list_tokens(text: str) -> list[str]:
    if not text:
        return []
    candidates: list[str] = []
    in_people_block = False
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            if in_people_block:
                break
            continue
        if METADATA_PERSON_LIST_HEADING_RE.match(line):
            in_people_block = True
            continue
        if not in_people_block:
            continue
        if line.startswith(("▼", "＜", "<", "【", "#")) or URL_TOKEN_RE.search(line):
            if URL_TOKEN_RE.search(line):
                line = URL_TOKEN_RE.sub("", line).strip()
            else:
                break
        name_part = clean_metadata_person_name(line)
        if name_part:
            candidates.append(name_part)
    return unique_ordered_tokens(candidates)


def clean_metadata_person_name(line: str) -> str:
    name = re.split(r"[（(｜|]", line, maxsplit=1)[0].strip()
    name = re.sub(r"^[・\-—\s]+", "", name)
    name = re.sub(r"\s+", " ", name).strip()
    if not contains_japanese(name):
        return ""
    if is_generic_candidate(name):
        return ""
    if len(normalize_alias(name)) <= 1 or len(name) > 24:
        return ""
    return name


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


def looks_like_person_name(token: str) -> bool:
    return bool(
        re.fullmatch(r"[一-龥々]{2,5}", token)
        or re.fullmatch(r"[ぁ-んァ-ヶー]{3,10}", token)
        or re.fullmatch(r"[一-龥々]{1,4}[ァ-ヶー]{2,8}", token)
    )


def looks_like_sentence_fragment(token: str) -> bool:
    if re.search(r"[ぁ-ん](?:が|を|に|で|と|から|まで|より)[ぁ-ん]", token):
        return True
    return token.startswith(("さん", "ちゃん", "くん")) or token.endswith(("から", "いる", "する", "して", "した"))


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

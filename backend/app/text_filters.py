from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass

from .text import normalize_alias

try:
    from sudachipy import dictionary, tokenizer
except ImportError:  # pragma: no cover - dependency is installed in normal setup
    dictionary = None
    tokenizer = None


NOISE_KEYWORDS = {
    "です",
    "ですよ",
    "ます",
    "ました",
    "でした",
    "だよ",
    "だね",
    "ですね",
    "なの",
    "ってる",
    "してる",
    "すぎる",
    "すぎて",
    "みたい",
    "みたいな",
    "ところ",
    "感じ",
    "これ",
    "それ",
    "今回",
    "動画",
    "コメント",
    "ちゃん",
    "さん",
    "くん",
    "めっちゃ",
    "なんか",
    "ほんと",
    "やっぱり",
    "ありがとう",
    "ありがとうございます",
    "めちゃくちゃ",
    "ちゃんと",
    "だった",
    "ったら",
    "として",
    "からの",
    "がいい",
    "らしい",
    "グループ",
    "ゲーム",
    "デビュー",
    "コロナ",
    "ティッシュ",
    "ドローミー",
}

NOISE_KEYWORD_PARTS = (
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
    "オンライン",
    "ショップ",
    "ストア",
    "公式",
    "番組",
    "企画",
)


@dataclass(frozen=True)
class JapaneseToken:
    surface: str
    normalized: str
    pos: tuple[str, ...]


_SUDACHI_TOKENIZER = dictionary.Dictionary().create() if dictionary and tokenizer else None
_SUDACHI_MODE = tokenizer.Tokenizer.SplitMode.C if tokenizer else None
_NORMALIZED_NOISE_KEYWORDS = {normalize_alias(word) for word in NOISE_KEYWORDS}
_FUNCTION_POS = {"助詞", "助動詞", "補助記号", "記号", "空白"}
_CONTENT_POS = {"名詞", "動詞", "形容詞", "形状詞"}
_NON_INDEPENDENT_POS2 = {"非自立可能"}
_TOKEN_RE = re.compile(r"[一-龥々ぁ-んァ-ヶーA-Za-z]{2,24}")
_HONORIFIC_TERM_RE = re.compile(r"([一-龥々ぁ-んァ-ヶA-Za-z0-9ー]{2,16}?)(さん|ちゃん|くん|君|氏|様)")
_NICKNAME_TERM_RE = re.compile(r"[ァ-ヶー]{3,16}|[ぁ-んー]{3,12}")
_KANJI_NAME_RE = re.compile(r"[一-龥々]{2,6}")
_KANJI_KATAKANA_NAME_RE = re.compile(r"[一-龥々]{1,8}[ァ-ヶー]{2,12}")
EVALUATION_KEYWORDS = {
    "positive": ("好き", "最高", "良い", "いい", "素敵", "尊敬", "面白い", "面白", "かわいい", "可愛い", "綺麗", "すごい", "推し"),
    "negative": ("嫌い", "苦手", "つまらない", "つまら", "無理", "怖い", "ひどい", "嫌"),
}


def analyze_japanese(text: str) -> list[JapaneseToken]:
    if not text or not _SUDACHI_TOKENIZER or not _SUDACHI_MODE:
        return []
    return [
        JapaneseToken(
            surface=morpheme.surface(),
            normalized=morpheme.normalized_form(),
            pos=tuple(morpheme.part_of_speech()),
        )
        for morpheme in _SUDACHI_TOKENIZER.tokenize(text, _SUDACHI_MODE)
    ]


def is_noise_keyword(term: str) -> bool:
    normalized = normalize_alias(term)
    if not normalized:
        return True
    if normalized in _NORMALIZED_NOISE_KEYWORDS:
        return True
    if re.fullmatch(r"\d+", normalized):
        return True
    if re.fullmatch(r"[ぁ-んー]+", normalized) and len(normalized) <= 2:
        return True
    tokens = analyze_japanese(term)
    if tokens and is_noise_token_sequence(tokens, normalized):
        return True
    return any(part in term or normalize_alias(part) in normalized for part in NOISE_KEYWORD_PARTS)


def is_noise_token_sequence(tokens: list[JapaneseToken], normalized_term: str) -> bool:
    content_tokens = [token for token in tokens if normalize_alias(token.surface)]
    if not content_tokens:
        return True
    if all(is_function_token(token) for token in content_tokens):
        if re.fullmatch(r"[ぁ-んー]+", normalized_term) and len(normalized_term) >= 3:
            return False
        return True
    return False


def is_function_token(token: JapaneseToken) -> bool:
    if not token.pos:
        return False
    if token.pos[0] in _FUNCTION_POS:
        return True
    return len(token.pos) > 1 and token.pos[1] in _NON_INDEPENDENT_POS2


def is_content_keyword_token(token: JapaneseToken) -> bool:
    normalized = normalize_alias(token.surface)
    if not normalized or is_noise_keyword(token.surface):
        return False
    if token.pos and token.pos[0] in _CONTENT_POS:
        return True
    return False


def keyword_tokens(text: str) -> list[str]:
    analyzed = analyze_japanese(text)
    if analyzed:
        tokens = [token.surface for token in analyzed if is_content_keyword_token(token) and not is_person_alias_like(token.surface)]
    else:
        tokens = _TOKEN_RE.findall(text)
    return filter_keywords(tokens)


def is_person_alias_like(term: str) -> bool:
    normalized = normalize_alias(term)
    if not normalized or is_noise_keyword(term):
        return False
    if re.search(r"\d", normalized):
        return False
    if _HONORIFIC_TERM_RE.fullmatch(term):
        return True
    if _KANJI_KATAKANA_NAME_RE.fullmatch(term):
        return True
    if _NICKNAME_TERM_RE.fullmatch(term):
        return True
    tokens = analyze_japanese(term)
    if tokens and all(is_person_name_token(token) for token in tokens):
        return True
    return bool(_KANJI_NAME_RE.fullmatch(term) and len(normalized) >= 3)


def is_person_name_token(token: JapaneseToken) -> bool:
    return len(token.pos) >= 4 and token.pos[0] == "名詞" and token.pos[1] == "固有名詞" and token.pos[2] == "人名"


def person_alias_terms(text: str) -> list[str]:
    terms: list[str] = []
    terms.extend(match.group(1) for match in _HONORIFIC_TERM_RE.finditer(text))
    terms.extend(match.group(0) for match in _KANJI_KATAKANA_NAME_RE.finditer(text))
    terms.extend(match.group(0) for match in _NICKNAME_TERM_RE.finditer(text))
    analyzed = analyze_japanese(text)
    name_buffer: list[str] = []
    for token in analyzed:
        if is_person_name_token(token):
            name_buffer.append(token.surface)
            continue
        if name_buffer:
            terms.append("".join(name_buffer))
            name_buffer = []
    if name_buffer:
        terms.append("".join(name_buffer))
    cleaned = [clean_person_alias_term(term) for term in terms]
    return filter_keywords([term for term in cleaned if is_person_alias_like(term)])


def clean_person_alias_term(term: str) -> str:
    return re.sub(r"[はがもにをでとの]$", "", term.strip())


def evaluation_terms(text: str) -> list[dict[str, str]]:
    terms = []
    for polarity, keywords in EVALUATION_KEYWORDS.items():
        for keyword in keywords:
            if keyword in text:
                terms.append({"term": keyword, "polarity": polarity})
    unique: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for term in terms:
        key = (term["term"], term["polarity"])
        if key in seen:
            continue
        unique.append(term)
        seen.add(key)
    return unique


def filter_keywords(terms: Iterable[str], excluded_terms: Iterable[str] = ()) -> list[str]:
    excluded = {normalize_alias(term) for term in excluded_terms if term}
    output: list[str] = []
    seen: set[str] = set()
    for term in terms:
        normalized = normalize_alias(term)
        if normalized in seen or normalized in excluded:
            continue
        if is_noise_keyword(term):
            continue
        output.append(term)
        seen.add(normalized)
    return output

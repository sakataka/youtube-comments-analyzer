from __future__ import annotations

import re
import unicodedata


URL_RE = re.compile(r"https?://\S+")
SPACE_RE = re.compile(r"\s+")


def normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    normalized = URL_RE.sub(" <url> ", normalized)
    normalized = normalized.lower()
    normalized = SPACE_RE.sub(" ", normalized)
    return normalized.strip()


def normalize_alias(value: str) -> str:
    value = normalize_text(value)
    return re.sub(r"(さん|ちゃん|くん|君|氏|様)$", "", value).strip()

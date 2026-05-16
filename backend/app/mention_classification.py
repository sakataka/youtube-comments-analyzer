from __future__ import annotations

import re


def alias_matches(normalized_comment: str, normalized_alias_value: str) -> bool:
    if not normalized_alias_value:
        return False
    if len(normalized_alias_value) <= 2:
        return bool(re.search(rf"(?<![a-z0-9]){re.escape(normalized_alias_value)}(さん|ちゃん|くん|君|氏|様)?", normalized_comment))
    return normalized_alias_value in normalized_comment


def alias_match_confidence(normalized_alias_value: str) -> float:
    return 0.9 if len(normalized_alias_value) > 2 else 0.62

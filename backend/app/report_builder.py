from __future__ import annotations

import math
from collections import defaultdict
from itertools import combinations
from typing import Any

from .text import normalize_alias
from .text_filters import evaluation_terms, is_noise_keyword, keyword_tokens


APPEAL_CATEGORIES = [
    ("funny", "面白さ", ["面白", "おもしろ", "笑", "草", "爆笑", "最高", "ツッコミ", "ボケ"]),
    ("kindness", "優しさ", ["優し", "助け", "フォロー", "気遣", "尊敬", "素敵", "いい人"]),
    ("talk_skill", "トーク力", ["トーク", "返し", "コメント", "回し", "平場", "エピソード", "切り返"]),
    ("visual", "ビジュアル", ["可愛", "かわい", "綺麗", "きれい", "美人", "ビジュ", "顔"]),
    ("effort", "頑張り", ["頑張", "がんば", "努力", "成長", "一生懸命", "本気"]),
    ("reaction", "リアクション", ["リアクション", "反応", "泣", "笑顔", "表情", "空気"]),
]

TONE_KEYWORDS = {
    "positive": ["好き", "最高", "良い", "いい", "素敵", "尊敬", "面白", "かわい", "可愛", "綺麗", "すご", "推し"],
    "negative": ["嫌い", "苦手", "つまら", "無理", "怖い", "ひどい", "炎上", "嫌"],
}

CLUSTER_DEFINITIONS = [
    ("humor", "笑い・ツッコミ", ["面白", "おもしろ", "笑", "草", "ツッコミ", "ボケ", "キングボンビー"]),
    ("praise", "称賛・好意", ["好き", "最高", "良い", "いい", "素敵", "尊敬", "かわい", "可愛", "綺麗", "すご"]),
    ("relationship", "掛け合い・関係性", ["絡み", "コンビ", "フォロー", "助け", "支え", "バランス", "空気"]),
    ("talk", "トーク・エピソード", ["トーク", "エピソード", "返し", "平場", "コメント", "話"]),
    ("growth", "成長・頑張り", ["成長", "頑張", "がんば", "努力", "本気", "デビュー"]),
    ("appearance", "ビジュアル", ["かわい", "可愛", "綺麗", "きれい", "美人", "ビジュ", "顔"]),
    ("scene", "場面・引用", [":", "：", "Fire", "だぁ", "泣", "ゲーム", "スマブラ"]),
    ("concern", "注意・違和感", ["嫌", "苦手", "怖い", "無理", "つまら", "ひどい"]),
]

def like_count_distribution(comments: list[Any]) -> list[dict[str, int | str]]:
    buckets = [
        ("0", 0, 0),
        ("1-4", 1, 4),
        ("5-9", 5, 9),
        ("10-49", 10, 49),
        ("50+", 50, None),
    ]
    output: list[dict[str, int | str]] = []
    for label, lower, upper in buckets:
        count = sum(
            1
            for comment in comments
            if int(comment["like_count"]) >= lower and (upper is None or int(comment["like_count"]) <= upper)
        )
        output.append({"label": label, "count": count})
    return output


def fetch_coverage_summary(video: Any, snapshot: Any) -> dict[str, Any]:
    youtube_count = video["youtube_comment_count"]
    fetched_count = int(snapshot["max_comments_fetched"])
    requested_count = int(snapshot["max_comments_requested"])
    available = bool(video["comment_count_available"])
    if not available or youtube_count is None:
        status = "unknown"
        message = "YouTube 側のコメント総数は未取得です。古い cache または fixture では未表示になります。"
    elif fetched_count >= int(youtube_count):
        status = "complete_or_near_complete"
        message = "YouTube 表示コメント数に対して、今回取得分は概ね到達しています。"
    elif fetched_count >= requested_count:
        status = "limited_by_request"
        message = "YouTube 表示コメント数より少ないですが、今回の最大取得件数に到達しています。"
    else:
        status = "limited_by_api_or_availability"
        message = "YouTube 表示コメント数より取得件数が少ないため、API の取得可能範囲や公開状態の影響がありえます。"
    return {
        "status": status,
        "message": message,
        "youtube_comment_count": youtube_count,
        "comment_count_available": available,
        "fetched_comment_count": fetched_count,
        "max_comments_requested": requested_count,
    }


def build_mention_ranking(
    mentions: list[Any],
    comments: list[Any],
    top_comment_count: int,
) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]]]:
    by_person: dict[str, list[Any]] = defaultdict(list)
    names: dict[str, str] = {}
    mentions_by_comment: dict[str, dict[str, str]] = defaultdict(dict)
    for mention in mentions:
        by_person[mention["person_id"]].append(mention)
        names[mention["person_id"]] = mention["display_name"]
        mentions_by_comment[mention["comment_id"]][mention["person_id"]] = mention["display_name"]

    denominator = max(1, len(comments))
    top_comment_ids = {
        comment["id"]
        for comment in sorted(comments, key=lambda row: int(row["like_count"]), reverse=True)[:top_comment_count]
    }
    ranking = []
    for person_id, rows in by_person.items():
        unique_by_comment = {row["comment_id"]: row for row in rows}
        representatives = sorted(unique_by_comment.values(), key=lambda row: row["like_count"], reverse=True)[:3]
        comment_ids = set(unique_by_comment)
        ranking.append({
            "person_id": person_id,
            "display_name": names[person_id],
            "mention_comment_count": len(unique_by_comment),
            "mention_rate": len(unique_by_comment) / denominator,
            "top_comment_mention_count": len(comment_ids & top_comment_ids),
            "single_mention_count": sum(1 for comment_id in comment_ids if len(mentions_by_comment[comment_id]) == 1),
            "multi_mention_count": sum(1 for comment_id in comment_ids if len(mentions_by_comment[comment_id]) > 1),
            "raw_like_sum": sum(max(0, int(row["like_count"])) for row in unique_by_comment.values()),
            "like_weighted_score": sum(1 + math.log1p(max(0, int(row["like_count"]))) for row in unique_by_comment.values()),
            "representative_comments": [
                {
                    "comment_id": row["comment_id"],
                    "text_original": row["text_original"],
                    "like_count": row["like_count"],
                }
                for row in representatives
            ],
        })
    ranking.sort(key=lambda row: (row["mention_comment_count"], row["like_weighted_score"]), reverse=True)
    return ranking, mentions_by_comment


def build_mention_details_by_comment(mentions: list[Any]) -> dict[str, list[dict[str, Any]]]:
    by_comment: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for mention in mentions:
        by_comment[mention["comment_id"]].append({
            "person_id": mention["person_id"],
            "display_name": mention["display_name"],
            "confidence": float(mention["confidence"]),
            "match_method": mention["match_method"],
        })
    for rows in by_comment.values():
        rows.sort(key=lambda row: row["display_name"])
    return by_comment


def build_appeal_summary(mentions: list[Any]) -> dict[str, Any]:
    by_person: dict[str, dict[str, Any]] = {}
    for mention in mentions:
        person_id = mention["person_id"]
        person = by_person.setdefault(
            person_id,
            {
                "person_id": person_id,
                "display_name": mention["display_name"],
                "comments_by_id": {},
            },
        )
        person["comments_by_id"].setdefault(
            mention["comment_id"],
            {
                "comment_id": mention["comment_id"],
                "text_original": mention["text_original"],
                "like_count": int(mention["like_count"]),
            },
        )

    people = []
    for person in by_person.values():
        comments = list(person["comments_by_id"].values())
        category_counts = appeal_category_counts(comments)
        tone_counts = tone_count_summary(comments)
        evaluation_summary = build_person_evaluation_summary(comments, person["display_name"])
        dominant_categories = [category for category in category_counts if category["count"] > 0][:3]
        evidence_comments = sorted(comments, key=lambda comment: int(comment["like_count"]), reverse=True)[:4]
        negative_count = tone_counts["negative"]
        people.append({
            "person_id": person["person_id"],
            "display_name": person["display_name"],
            "comment_count": len(comments),
            "category_counts": category_counts,
            "tone_counts": tone_counts,
            "dominant_tone": dominant_tone(tone_counts),
            "summary": appeal_summary_text(person["display_name"], dominant_categories, tone_counts),
            "feature_words": person_feature_words(comments, [person["display_name"]]),
            "evaluation_summary": evaluation_summary,
            "evidence_comments": evidence_comments,
            "negative_note": negative_note_text(negative_count, len(comments)),
        })
    people.sort(key=lambda person: person["comment_count"], reverse=True)
    return {"people": people}


def appeal_category_counts(comments: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows = []
    for category_id, label, keywords in APPEAL_CATEGORIES:
        matched_comments = [
            comment
            for comment in comments
            if any(keyword in comment["text_original"] for keyword in keywords)
        ]
        rows.append({
            "category": category_id,
            "label": label,
            "count": len(matched_comments),
            "representative_comment_ids": [comment["comment_id"] for comment in matched_comments[:3]],
        })
    rows.sort(key=lambda row: row["count"], reverse=True)
    return rows


def tone_count_summary(comments: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"positive": 0, "neutral": 0, "mixed": 0, "negative": 0, "unclear": 0}
    for comment in comments:
        text = comment["text_original"]
        positive = any(keyword in text for keyword in TONE_KEYWORDS["positive"])
        negative = any(keyword in text for keyword in TONE_KEYWORDS["negative"])
        if positive and negative:
            counts["mixed"] += 1
        elif positive:
            counts["positive"] += 1
        elif negative:
            counts["negative"] += 1
        elif len(text.strip()) < 8:
            counts["unclear"] += 1
        else:
            counts["neutral"] += 1
    return counts


def build_person_evaluation_summary(comments: list[dict[str, Any]], display_name: str) -> dict[str, Any]:
    counts = {"positive": 0, "negative": 0}
    evidence = []
    for comment in comments:
        terms = evaluation_terms(comment["text_original"])
        if not terms:
            continue
        for term in terms:
            counts[term["polarity"]] += 1
        if len(evidence) < 5:
            evidence.append({
                "comment_id": comment["comment_id"],
                "text_original": comment["text_original"],
                "like_count": comment["like_count"],
                "terms": terms,
            })
    dominant = "positive" if counts["positive"] >= counts["negative"] else "negative"
    if counts["positive"] == 0 and counts["negative"] == 0:
        dominant = "none"
    return {
        "target_display_name": display_name,
        "counts": counts,
        "dominant": dominant,
        "evidence_comments": evidence,
    }


def dominant_tone(tone_counts: dict[str, int]) -> str:
    priority = {"positive": 4, "mixed": 3, "neutral": 2, "negative": 1, "unclear": 0}
    return max(tone_counts.items(), key=lambda item: (item[1], priority[item[0]]))[0]


def appeal_summary_text(display_name: str, dominant_categories: list[dict[str, Any]], tone_counts: dict[str, int]) -> str:
    if dominant_categories:
        category_text = "、".join(category["label"] for category in dominant_categories)
        return f"{display_name} は {category_text} への言及が目立ちます。tone は {dominant_tone(tone_counts)} が中心です。"
    return f"{display_name} は明確な魅力カテゴリがまだ少ないため、根拠コメントの追加確認が必要です。"


def negative_note_text(negative_count: int, total_count: int) -> str | None:
    if negative_count < 3:
        return None
    rate = negative_count / max(total_count, 1)
    if rate < 0.08:
        return None
    return f"negative 判定が {negative_count} 件あります。過度に強調せず、代表コメントで文脈確認してください。"


def person_feature_words(comments: list[dict[str, Any]], excluded_terms: list[str]) -> list[dict[str, Any]]:
    counts: defaultdict[str, int] = defaultdict(int)
    document_counts: defaultdict[str, int] = defaultdict(int)
    excluded = {normalize_alias(term) for term in excluded_terms}
    for comment in comments:
        seen_in_comment: set[str] = set()
        for token in keyword_tokens(comment["text_original"]):
            normalized = normalize_alias(token)
            if normalized in excluded:
                continue
            counts[token] += 1
            if normalized not in seen_in_comment:
                document_counts[token] += 1
                seen_in_comment.add(normalized)
    total_docs = max(len(comments), 1)
    rows = []
    for term, count in counts.items():
        doc_count = document_counts[term]
        score = count * (1 + math.log(total_docs / max(doc_count, 1)))
        rows.append({
            "term": term,
            "count": count,
            "document_count": doc_count,
            "score": round(score, 4),
        })
    rows.sort(key=lambda row: (row["score"], row["count"]), reverse=True)
    return rows[:12]


def build_cooccurrence(mentions: list[Any]) -> dict[str, Any]:
    comments: dict[str, dict[str, Any]] = {}
    for mention in mentions:
        comment = comments.setdefault(
            mention["comment_id"],
            {
                "comment_id": mention["comment_id"],
                "text_original": mention["text_original"],
                "like_count": int(mention["like_count"]),
                "persons": {},
            },
        )
        comment["persons"][mention["person_id"]] = mention["display_name"]

    pairs: dict[tuple[str, str], dict[str, Any]] = {}
    for comment in comments.values():
        person_items = sorted(comment["persons"].items(), key=lambda item: item[1])
        for left, right in combinations(person_items, 2):
            key = tuple(sorted([left[0], right[0]]))
            pair = pairs.setdefault(
                key,
                {
                    "person_a_id": key[0],
                    "person_b_id": key[1],
                    "person_a_name": comment["persons"][key[0]],
                    "person_b_name": comment["persons"][key[1]],
                    "comment_ids": set(),
                    "like_weighted_score": 0.0,
                    "representative_comments": [],
                    "category_votes": defaultdict(int),
                },
            )
            if comment["comment_id"] in pair["comment_ids"]:
                continue
            pair["comment_ids"].add(comment["comment_id"])
            pair["like_weighted_score"] += 1 + math.log1p(max(0, int(comment["like_count"])))
            pair["representative_comments"].append({
                "comment_id": comment["comment_id"],
                "text_original": comment["text_original"],
                "like_count": comment["like_count"],
            })
            pair["category_votes"][relationship_category(comment["text_original"])] += 1

    pair_rows = []
    for pair in pairs.values():
        representative_comments = sorted(pair["representative_comments"], key=lambda item: item["like_count"], reverse=True)[:3]
        category = max(pair["category_votes"].items(), key=lambda item: item[1])[0]
        pair_rows.append({
            "person_a_id": pair["person_a_id"],
            "person_a_name": pair["person_a_name"],
            "person_b_id": pair["person_b_id"],
            "person_b_name": pair["person_b_name"],
            "cooccurrence_comment_count": len(pair["comment_ids"]),
            "like_weighted_score": round(pair["like_weighted_score"], 4),
            "relationship_category": category,
            "representative_comments": representative_comments,
        })
    pair_rows.sort(key=lambda row: (row["cooccurrence_comment_count"], row["like_weighted_score"]), reverse=True)
    return {
        "pairs": pair_rows,
        "matrix": build_cooccurrence_matrix(pair_rows),
    }


def relationship_category(text: str) -> str:
    if any(keyword in text for keyword in ["ツッコミ", "ボケ", "絡み", "掛け合", "コンビ"]):
        return "掛け合い"
    if any(keyword in text for keyword in ["助け", "フォロー", "優し", "支え", "尊敬"]):
        return "支え合い"
    if any(keyword in text for keyword in ["似て", "同じ", "対照", "バランス", "違い"]):
        return "比較"
    return "同時言及"


def build_cooccurrence_matrix(pair_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    names = sorted({row["person_a_name"] for row in pair_rows} | {row["person_b_name"] for row in pair_rows})
    counts = {
        (row["person_a_name"], row["person_b_name"]): row["cooccurrence_comment_count"]
        for row in pair_rows
    }
    return [
        {
            "source": source,
            "targets": [
                {
                    "target": target,
                    "count": 0 if source == target else counts.get((source, target), counts.get((target, source), 0)),
                }
                for target in names
            ],
        }
        for source in names
    ]


def build_comment_clusters(
    comments: list[Any],
    mentions_by_comment: dict[str, dict[str, str]],
    requested_cluster_count: int,
) -> dict[str, Any]:
    cluster_count = min(12, max(5, int(requested_cluster_count or 8)))
    buckets: dict[str, dict[str, Any]] = {
        cluster_id: {
            "cluster_id": cluster_id,
            "label": label,
            "comments": [],
            "keywords": keywords,
        }
        for cluster_id, label, keywords in CLUSTER_DEFINITIONS
    }
    buckets["other"] = {"cluster_id": "other", "label": "その他・要確認", "comments": [], "keywords": []}

    for comment in comments:
        cluster_id = best_cluster_id(comment["text_original"])
        buckets[cluster_id]["comments"].append(comment)

    non_empty = [bucket for bucket in buckets.values() if bucket["comments"]]
    non_empty.sort(key=lambda bucket: len(bucket["comments"]), reverse=True)
    selected = non_empty[:cluster_count]
    overflow = non_empty[cluster_count:]
    if overflow:
        other = next((bucket for bucket in selected if bucket["cluster_id"] == "other"), None)
        if not other:
            other = {"cluster_id": "other", "label": "その他・要確認", "comments": [], "keywords": []}
            selected.append(other)
        for bucket in overflow:
            other["comments"].extend(bucket["comments"])

    clusters = []
    for bucket in selected:
        bucket_comments = bucket["comments"]
        top_persons = top_cluster_persons(bucket_comments, mentions_by_comment)
        top_keywords = top_cluster_keywords(bucket_comments, bucket["keywords"])
        clusters.append({
            "cluster_id": bucket["cluster_id"],
            "label": bucket["label"],
            "comment_count": len(bucket_comments),
            "top_persons": top_persons,
            "top_keywords": top_keywords,
            "summary": cluster_summary_text(bucket["label"], top_persons, top_keywords),
            "representative_comments": [
                {
                    "comment_id": comment["id"],
                    "text_original": comment["text_original"],
                    "like_count": comment["like_count"],
                }
                for comment in sorted(bucket_comments, key=lambda item: int(item["like_count"]), reverse=True)[:4]
            ],
        })
    clusters.sort(key=cluster_display_sort_key)
    return {
        "method": "keyword_features",
        "requested_cluster_count": cluster_count,
        "clusters": clusters,
    }


def cluster_display_sort_key(cluster: dict[str, Any]) -> tuple[int, int]:
    return (1 if cluster["cluster_id"] == "other" else 0, -int(cluster["comment_count"]))


def best_cluster_id(text: str) -> str:
    scores = []
    for cluster_id, _label, keywords in CLUSTER_DEFINITIONS:
        score = sum(1 for keyword in keywords if keyword in text)
        scores.append((score, cluster_id))
    score, cluster_id = max(scores, key=lambda item: item[0])
    return cluster_id if score > 0 else "other"


def top_cluster_persons(comments: list[Any], mentions_by_comment: dict[str, dict[str, str]]) -> list[dict[str, Any]]:
    counts: defaultdict[str, int] = defaultdict(int)
    for comment in comments:
        for display_name in mentions_by_comment.get(comment["id"], {}).values():
            counts[display_name] += 1
    return [
        {"display_name": display_name, "count": count}
        for display_name, count in sorted(counts.items(), key=lambda item: item[1], reverse=True)[:5]
    ]


def top_cluster_keywords(comments: list[Any], seed_keywords: list[str]) -> list[dict[str, Any]]:
    counts: defaultdict[str, int] = defaultdict(int)
    for keyword in seed_keywords:
        if keyword and not is_noise_keyword(keyword):
            counts[keyword] += 1
    for comment in comments:
        for token in keyword_tokens(comment["text_original"]):
            counts[token] += 1
    return [
        {"term": term, "count": count}
        for term, count in sorted(counts.items(), key=lambda item: item[1], reverse=True)[:8]
    ]


def cluster_summary_text(label: str, top_persons: list[dict[str, Any]], top_keywords: list[dict[str, Any]]) -> str:
    person_text = "、".join(person["display_name"] for person in top_persons[:3]) or "特定人物なし"
    keyword_text = "、".join(keyword["term"] for keyword in top_keywords[:3]) or "特徴語なし"
    return f"{label} に関するコメント群です。主な人物は {person_text}、主な語は {keyword_text} です。"


def build_quality_review(
    comments: list[Any],
    mention_details_by_comment: dict[str, list[dict[str, Any]]],
    llm_assist: dict[str, Any] | None,
) -> dict[str, Any]:
    comments_by_id = {comment["id"]: comment for comment in comments}
    low_confidence_comments = []
    for comment_id, mentions in mention_details_by_comment.items():
        low_mentions = [mention for mention in mentions if mention["confidence"] < 0.75]
        if not low_mentions:
            continue
        comment = comments_by_id.get(comment_id)
        if not comment:
            continue
        low_confidence_comments.append(review_comment_payload(comment, low_mentions, "低 confidence の alias マッチ"))

    llm_rows = []
    conflict_rows = []
    if llm_assist and llm_assist.get("status") != "failed":
        for item in llm_assist.get("ambiguous_comments") or []:
            comment = comments_by_id.get(item.get("comment_id"))
            if not comment:
                continue
            current_mentions = mention_details_by_comment.get(comment["id"], [])
            row = {
                **review_comment_payload(comment, current_mentions, item.get("reason") or "LLM ambiguous classification"),
                "suggested_display_name": item.get("suggested_display_name"),
                "llm_confidence": item.get("confidence"),
            }
            llm_rows.append(row)
            suggested = item.get("suggested_display_name")
            if suggested and suggested not in {mention["display_name"] for mention in current_mentions}:
                conflict_rows.append(row)

    human_review_items = []
    seen: set[str] = set()
    for row in [*conflict_rows, *low_confidence_comments, *llm_rows]:
        if row["comment_id"] in seen:
            continue
        human_review_items.append(row)
        seen.add(row["comment_id"])

    return {
        "low_confidence_comments": sorted(low_confidence_comments, key=lambda row: row["like_count"], reverse=True)[:50],
        "llm_ambiguous_comments": llm_rows[:50],
        "ai_dictionary_conflicts": conflict_rows[:50],
        "human_review_items": human_review_items[:50],
    }


def review_comment_payload(comment: Any, mentions: list[dict[str, Any]], reason: str) -> dict[str, Any]:
    return {
        "comment_id": comment["id"],
        "text_original": comment["text_original"],
        "like_count": int(comment["like_count"]),
        "is_reply": bool(comment["is_reply"]),
        "reason": reason,
        "mentioned_persons": mentions,
    }


def build_report_payload(
    run_id: str,
    video: Any,
    snapshot: Any,
    comments: list[Any],
    mentions: list[Any],
    analysis_config: dict[str, Any],
    persons: list[dict[str, Any]],
    alias_suggestions: list[dict[str, Any]],
    llm_assist: dict[str, Any] | None,
    sentiment: dict[str, Any],
    review_status: str,
) -> dict[str, Any]:
    top_comment_count = int(analysis_config.get("top_comment_count", 50))
    ranking, mentions_by_comment = build_mention_ranking(mentions, comments, top_comment_count)
    mention_details_by_comment = build_mention_details_by_comment(mentions)
    appeal_summary = build_appeal_summary(mentions)
    cooccurrence = build_cooccurrence(mentions)
    clusters = build_comment_clusters(comments, mentions_by_comment, int(analysis_config.get("cluster_count", 8)))
    llm_section = llm_section_status(llm_assist)
    quality_review = build_quality_review(comments, mention_details_by_comment, llm_assist)
    sentiment_by_person = {
        item["person_id"]: item for item in sentiment.get("per_person", [])
    }
    for row in ranking:
        row["sentiment"] = sentiment_by_person.get(row["person_id"], {}).get(
            "distribution",
            {
                "total": 0,
                "counts": {label: 0 for label in ["positive", "neutral", "negative", "mixed", "unclear"]},
                "rates": {label: 0.0 for label in ["positive", "neutral", "negative", "mixed", "unclear"]},
            },
        )
    sentiment_review_count = int(sentiment.get("review_item_count") or len(sentiment.get("review_items") or []))
    return {
        "schema_version": "report.v2",
        "run_id": run_id,
        "review": {
            "status": review_status,
            "is_verified": review_status == "verified",
            "pending_item_count": len(quality_review["human_review_items"]) + sentiment_review_count,
        },
        "video": {
            "youtube_video_id": video["youtube_video_id"],
            "url": video["url"],
            "title": video["title"],
            "channel_title": video["channel_title"],
            "published_at": video["published_at"],
            "youtube_comment_count": video["youtube_comment_count"],
            "comment_count_available": bool(video["comment_count_available"]),
            "youtube_view_count": video["youtube_view_count"],
            "youtube_like_count": video["youtube_like_count"],
        },
        "fetch_summary": {
            "source": snapshot["source"],
            "fetched_at": snapshot["fetched_at"],
            "fetched_top_level_count": snapshot["fetched_top_level_count"],
            "fetched_reply_count": snapshot["fetched_reply_count"],
            "max_comments_fetched": snapshot["max_comments_fetched"],
            "total_like_count": sum(int(comment["like_count"]) for comment in comments),
            "like_count_distribution": like_count_distribution(comments),
            "max_comments_requested": snapshot["max_comments_requested"],
            "fetch_order": snapshot["fetch_order"],
            "reply_fetch_mode": snapshot["reply_fetch_mode"],
            "coverage": fetch_coverage_summary(video, snapshot),
        },
        "analysis_config": analysis_config,
        "persons": persons,
        "alias_suggestions": alias_suggestions,
        "llm_assist": llm_assist,
        "appeal_summary": appeal_summary,
        "cooccurrence": cooccurrence,
        "clusters": clusters,
        "topics": {
            "method": "keyword_categories",
            "items": clusters["clusters"],
            "note": "固定キーワードによる話題カテゴリです。意味的クラスタリングではありません。",
        },
        "sentiment": sentiment,
        "quality_review": quality_review,
        "rankings": {"mention_ranking": ranking},
        "evidence": {
            "comments_endpoint": f"/api/runs/{run_id}/comments",
            "comment_count": len(comments),
        },
        "sections": {
            "mention_ranking": {"status": "available"},
            "person_candidates": {"status": "available"},
            "alias_suggestions": {"status": "available"},
            "raw_comments": {"status": "available"},
            "llm_assist": llm_section,
            "appeal_summary": {"status": "available"},
            "ambiguous_classification": (
                llm_section
                if llm_section["status"] == "failed"
                else {"status": "available" if llm_assist else "skipped", "reason": None if llm_assist else "LLM assist not run"}
            ),
            "quality_review": {"status": "available"},
            "cooccurrence": {"status": "available"},
            "clusters": {"status": "available"},
            "sentiment": {"status": "available", "method": "hybrid"},
        },
    }


def llm_section_status(llm_assist: dict[str, Any] | None) -> dict[str, str | None]:
    if not llm_assist:
        return {"status": "skipped", "reason": "Not run yet"}
    if llm_assist.get("status") == "failed":
        return {"status": "failed", "reason": llm_assist.get("error_message") or "LLM assist failed"}
    return {"status": "available", "reason": None}

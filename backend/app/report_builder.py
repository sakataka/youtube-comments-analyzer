from __future__ import annotations

import math
from collections import defaultdict
from typing import Any


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


def build_mention_ranking(mentions: list[Any], total_comments: int) -> tuple[list[dict[str, Any]], dict[str, dict[str, str]]]:
    by_person: dict[str, list[Any]] = defaultdict(list)
    names: dict[str, str] = {}
    mentions_by_comment: dict[str, dict[str, str]] = defaultdict(dict)
    for mention in mentions:
        by_person[mention["person_id"]].append(mention)
        names[mention["person_id"]] = mention["display_name"]
        mentions_by_comment[mention["comment_id"]][mention["person_id"]] = mention["display_name"]

    denominator = max(1, total_comments)
    ranking = []
    for person_id, rows in by_person.items():
        unique_by_comment = {row["comment_id"]: row for row in rows}
        representatives = sorted(unique_by_comment.values(), key=lambda row: row["like_count"], reverse=True)[:3]
        ranking.append({
            "person_id": person_id,
            "display_name": names[person_id],
            "mention_comment_count": len(unique_by_comment),
            "mention_rate": len(unique_by_comment) / denominator,
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


def build_report_payload(
    run_id: str,
    video: Any,
    snapshot: Any,
    comments: list[Any],
    mentions: list[Any],
    analysis_config: dict[str, Any],
    persons: list[dict[str, Any]],
) -> dict[str, Any]:
    ranking, mentions_by_comment = build_mention_ranking(mentions, len(comments))
    return {
        "schema_version": "report.v1",
        "run_id": run_id,
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
        "rankings": {"mention_ranking": ranking},
        "comments": [
            {
                "comment_id": comment["id"],
                "text_original": comment["text_original"],
                "like_count": comment["like_count"],
                "is_reply": bool(comment["is_reply"]),
                "parent_comment_id": comment["parent_comment_id"],
                "mentioned_persons": [
                    {"person_id": person_id, "display_name": display_name}
                    for person_id, display_name in sorted(mentions_by_comment[comment["id"]].items(), key=lambda item: item[1])
                ],
            }
            for comment in comments
        ],
        "sections": {
            "mention_ranking": {"status": "available"},
            "person_candidates": {"status": "available"},
            "raw_comments": {"status": "available"},
            "appeal_summary": {"status": "skipped", "reason": "LLM disabled in MVP-0"},
            "ambiguous_classification": {"status": "skipped", "reason": "LLM disabled in MVP-0"},
            "cooccurrence": {"status": "skipped", "reason": "MVP-2 scope"},
            "clusters": {"status": "skipped", "reason": "Embeddings disabled in MVP-0"},
        },
    }

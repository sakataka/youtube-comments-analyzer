"""Checkpointed, parent-first comment acquisition. Cursors never imply completeness."""
from __future__ import annotations

import os
from typing import Any, Callable

from .youtube import YouTubeCommentClient, top_level_comment_from_thread, comment_from_snippet


def fetch_round(state: dict[str, Any], client: YouTubeCommentClient, checkpoint: Callable[[], None], stopped: Callable[[], bool]) -> None:
    fetch = state['fetch']
    comments = state['comments']
    known = {item['comment_id']: item for item in comments}
    budget = max(0, fetch.get('round_target', len(comments) + state['config']['max_comments']) - len(comments))
    count = 0
    key = os.getenv('YOUTUBE_API_KEY')
    if not state.get('video', {}).get('title'):
        if key:
            state['video'] = client._fetch_video_metadata(key, state['url'], state['video']['youtube_video_id'])
            fetch['source'] = 'youtube_api'
        else:
            # Fixture is opt-in and visibly marked. Saved snapshots are reused by the store.
            if os.getenv('YOUTUBE_FIXTURE_FALLBACK') != '1':
                raise RuntimeError('YOUTUBE_API_KEYが未設定です。設定後に再開してください。')
            state['video'].update(title='Fixture: コメント分析の動作確認', channel_title='Fixture', description='テスト専用。実動画の反応ではありません。')
            fetch['source'] = 'fixture'
            fetch['fixture_rows'] = client._read_jsonl(client.fixture_path)
        checkpoint()
    if 'fixture_rows' in fetch:
        rows = fetch['fixture_rows']
        if state['config']['reply_fetch_mode'] == 'none':
            rows = [row for row in rows if not row.get('is_reply')]
        rows = sorted(rows, key=lambda row: (row.get('published_at') or '', row['comment_id']), reverse=True)
        rows.sort(key=lambda row: bool(row.get('is_reply')))
        remaining = [row for row in rows if row['comment_id'] not in known]
        for row in remaining[:budget]:
            comments.append(row)
        done = len(remaining) <= budget
        fetch.update(parents_done=done, replies_done=done, stop_reason='cache_only' if fetch.get('cache_only') else 'api_exhausted' if done else 'batch_limit')
        checkpoint()
        return
    if not key:
        raise RuntimeError('続きの取得にはYOUTUBE_API_KEYが必要です。保存済み結果は保持されています。')

    def add(items: list[dict[str, Any]]) -> None:
        nonlocal count
        for item in items:
            existing = known.get(item['comment_id'])
            if existing is None:
                comments.append(item)
                known[item['comment_id']] = item
                count += 1
            else:
                existing.update(item)

    # API maxResults matches remaining budget, so no unpersisted page tail is lost.
    while not fetch['parents_done'] and count < budget and not stopped():
        query = {'key': key, 'part': 'snippet', 'videoId': state['video']['youtube_video_id'], 'order': 'time', 'textFormat': 'plainText', 'maxResults': min(100, budget - count)}
        if fetch.get('parent_cursor'):
            query['pageToken'] = fetch['parent_cursor']
        payload = client._get_json('https://www.googleapis.com/youtube/v3/commentThreads', query)
        add([top_level_comment_from_thread(item, len(comments) + i) for i, item in enumerate(payload.get('items', []))])
        cursor = payload.get('nextPageToken')
        if cursor and cursor == fetch.get('parent_cursor'):
            raise RuntimeError('YouTube APIのページが進まないため停止しました。')
        fetch['parent_cursor'] = cursor
        fetch['parents_done'] = not cursor
        checkpoint()
    if state['config']['reply_fetch_mode'] == 'none':
        fetch['replies_done'] = True
    elif fetch['parents_done']:
        parents = [row for row in comments if not row.get('is_reply') and row.get('reply_count', 0) > 0]
        while fetch['reply_index'] < len(parents) and count < budget and not stopped():
            parent = parents[fetch['reply_index']]
            query = {'key': key, 'part': 'snippet', 'parentId': parent['comment_id'], 'textFormat': 'plainText', 'maxResults': min(100, budget - count)}
            if fetch.get('reply_cursor'):
                query['pageToken'] = fetch['reply_cursor']
            payload = client._get_json('https://www.googleapis.com/youtube/v3/comments', query)
            add([comment_from_snippet(item['id'], item['snippet'], len(comments) + i, parent['comment_id'], True) for i, item in enumerate(payload.get('items', []))])
            cursor = payload.get('nextPageToken')
            if cursor and cursor == fetch.get('reply_cursor'):
                raise RuntimeError('返信ページが進まないため停止しました。')
            fetch['reply_cursor'] = cursor
            if not cursor:
                fetch['reply_index'] += 1
            checkpoint()
        fetch['replies_done'] = fetch['reply_index'] >= len(parents)
    fetch['stop_reason'] = 'user_stop' if stopped() else 'api_exhausted' if fetch['parents_done'] and fetch['replies_done'] else 'batch_limit'
    checkpoint()

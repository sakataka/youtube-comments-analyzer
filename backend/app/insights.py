"""AI-free views: visible top vs all, video moments, posting timeline, notable comments."""
import re
from datetime import datetime

TOP_N = 20
NOTABLE_N = 5
TIMESTAMP = re.compile(r'(?<![\d:])(?:(\d{1,2}):)?(\d{1,3}):(\d{2})(?![\d:])')
MOMENT_BINS = (30, 60, 120, 300, 600, 1200)
ELAPSED_BINS = ((0, 1, '1時間以内'), (1, 6, '1〜6時間'), (6, 24, '6〜24時間'), (24, 72, '1〜3日'), (72, 168, '3〜7日'), (168, None, '7日以降'))
NEGATIVE_TONES = ('very_negative', 'negative', 'mixed')
INDEX_TIMESTAMPS = 4  # chapter lists, not reactions to one scene


def parse_time(value):
    try: return datetime.fromisoformat(value.replace('Z', '+00:00')) if value else None
    except ValueError: return None


def timestamps(text, limit=None):
    """Seconds referenced as m:ss / h:mm:ss; implausible values are ignored."""
    output = []
    for hours, minutes, seconds in TIMESTAMP.findall(text):
        minutes, seconds = int(minutes), int(seconds)
        if seconds >= 60 or (hours and minutes >= 60): continue
        value = int(hours or 0) * 3600 + minutes * 60 + seconds
        if value <= (limit + 5 if limit else 6 * 3600) and value not in output: output.append(value)
    return output


def moment_seconds(text, limit=None):
    found = timestamps(text, limit)
    return found if len(found) < INDEX_TIMESTAMPS else []


def likes(row): return int(row.get('like_count') or 0)


def top_parents(rows): return sorted((r for r in rows if not r.get('is_reply')), key=lambda r: (-likes(r), r['comment_id']))[:TOP_N]


def item(row, lookup, video_id, metric):
    parent = lookup.get(row.get('parent_comment_id'), {}).get('text_original')
    return {'comment_id': row['comment_id'], 'text': row['text_original'], 'like_count': likes(row), 'reply_count': int(row.get('reply_count') or 0), 'is_reply': bool(row.get('is_reply')), 'published_at': row.get('published_at'), 'parent_text': parent[:300] if parent else None, 'metric': metric, 'url': f'https://www.youtube.com/watch?v={video_id}&lc={row["comment_id"]}'}


def visible_vs_all(state, rows, top):
    total_likes = sum(map(likes, rows))
    parents = [r for r in rows if not r.get('is_reply')]
    result = {'top_n': len(top), 'parents': len(parents), 'top_like_share': sum(map(likes, top)) / total_likes if total_likes else 0, 'zero_like_parents': sum(not likes(r) for r in parents), 'people': []}
    local = state.get('local', {})
    if local.get('status') == 'completed' and local.get('rows'):
        labels = local['rows']
        def shares(subset, weight=lambda r: 1):
            total = sum(weight(r) for r in subset if r['comment_id'] in labels)
            return {v: sum(weight(r) for r in subset if labels.get(r['comment_id'], [None])[0] == v) / total if total else 0 for v in ('positive', 'neutral', 'negative')}
        result['sentiment'] = {'all': shares(rows), 'top': shares(top), 'likes': shares(rows, likes)}
    stats = state.get('person_statistics', {})
    if state.get('people_status') != 'completed' or not stats.get('people'): return result
    assignments, top_ids = stats.get('assignments', {}), {r['comment_id'] for r in top}
    for person in stats['people'][:8]:
        ids = {cid for cid, people in assignments.items() if person['id'] in people}
        result['people'].append({'id': person['id'], 'name': person['name'], 'all_rate': len(ids) / max(1, len(rows)), 'top_count': len(ids & top_ids), 'top_rate': len(ids & top_ids) / max(1, len(top)), 'like_share': sum(likes(r) for r in rows if r['comment_id'] in ids) / total_likes if total_likes else 0})
    return result


def moments(state, rows, lookup):
    limit = state['video'].get('duration_seconds')
    found = [(r, timestamps(r['text_original'], limit)) for r in rows]
    index_comments = sum(len(t) >= INDEX_TIMESTAMPS for _, t in found)
    found = [(r, t) for r, t in found if 0 < len(t) < INDEX_TIMESTAMPS]
    if not found: return {'comment_count': 0, 'index_comments': index_comments, 'bin_seconds': None, 'bins': [], 'duration_seconds': limit}
    end = max(limit or 0, max(max(t) for _, t in found) + 1)
    size = next((s for s in MOMENT_BINS if end / s <= 40), MOMENT_BINS[-1])
    bins = [{'start': i * size, 'end': (i + 1) * size, 'comment_count': 0, 'likes': 0, 'sample': None} for i in range(-(-end // size))]
    for row, seconds in found:
        for index in {s // size for s in seconds}:
            b = bins[index]; b['comment_count'] += 1; b['likes'] += likes(row)
            if b['sample'] is None or likes(row) > b['sample']['like_count']: b['sample'] = item(row, lookup, state['video']['youtube_video_id'], None)
    return {'comment_count': len(found), 'index_comments': index_comments, 'bin_seconds': size, 'bins': bins, 'duration_seconds': limit}


def timeline(state, rows):
    published = parse_time(state['video'].get('published_at'))
    if not published: return {'bins': [], 'undated': len(rows)}
    bins = [{'label': label, 'start_hours': start, 'end_hours': end, 'comment_count': 0, 'replies': 0, 'likes': 0} for start, end, label in ELAPSED_BINS]
    undated = 0
    for row in rows:
        posted = parse_time(row.get('published_at'))
        if not posted: undated += 1; continue
        hours = max(0, (posted - published).total_seconds() / 3600)
        b = next(b for b in bins if b['end_hours'] is None or hours < b['end_hours'])
        b['comment_count'] += 1; b['replies'] += bool(row.get('is_reply')); b['likes'] += likes(row)
    return {'bins': bins, 'undated': undated}


def notable(state, rows, lookup, top):
    video_id, top_ids = state['video']['youtube_video_id'], {r['comment_id'] for r in top}
    fetched = parse_time(state.get('fetch', {}).get('fetched_at')) or parse_time(state.get('updated_at'))
    def per_hour(row):
        posted = parse_time(row.get('published_at'))
        return likes(row) / max(1, (fetched - posted).total_seconds() / 3600) if fetched and posted else 0
    discussion = sorted((r for r in rows if not r.get('is_reply') and int(r.get('reply_count') or 0) >= 2), key=lambda r: (-int(r.get('reply_count') or 0), -likes(r), r['comment_id']))
    rising = sorted((r for r in rows if r['comment_id'] not in top_ids and likes(r) >= 3 and per_hour(r)), key=lambda r: (-per_hour(r), r['comment_id']))
    replies = sorted((r for r in rows if r.get('is_reply') and likes(r) >= 2), key=lambda r: (-likes(r), r['comment_id']))
    groups = [
        {'id': 'top', 'title': 'いいね上位', 'description': 'YouTubeの人気順で上に出やすい、いいね数の多い親コメントです。', 'items': [item(r, lookup, video_id, f'いいね {likes(r)}') for r in top[:NOTABLE_N]]},
        {'id': 'discussion', 'title': '返信でやりとりが多い', 'description': '返信の多い親コメント。意見が分かれたり話が広がった投稿です。', 'items': [item(r, lookup, video_id, f'返信 {r.get("reply_count")}件') for r in discussion[:NOTABLE_N]]},
        {'id': 'rising', 'title': '上位の外で伸びている', 'description': f'いいね上位{TOP_N}件に入らない投稿を、投稿から取得までの1時間あたりいいね数で並べました。新しい投稿ほど上位に見えにくい分を補います。', 'items': [item(r, lookup, video_id, f'1時間あたり {per_hour(r):.1f}いいね') for r in rising[:NOTABLE_N]]},
        {'id': 'replies', 'title': '返信の中で支持された', 'description': '折りたたまれて見落としやすい返信のうち、いいねの多いものです。', 'items': [item(r, lookup, video_id, f'いいね {likes(r)}') for r in replies[:NOTABLE_N]]},
    ]
    jev = state.get('jev', {})
    if jev.get('version') == 'sentiment-v2' and jev.get('rows'):
        tones = {r['comment_id']: r['tone'] for r in jev['rows'] if r['tone'] in NEGATIVE_TONES}
        critical = sorted((lookup[cid] for cid in tones if cid in lookup and likes(lookup[cid])), key=lambda r: (-likes(r), r['comment_id']))
        groups.append({'id': 'critical', 'title': '否定・賛否混在なのに支持された', 'description': 'Jev分類済みの範囲で、ネガティブまたは賛否混在と分類され、いいねを集めた投稿です。分類は暫定値を含みます。', 'items': [item(r, lookup, video_id, f'いいね {likes(r)}') for r in critical[:NOTABLE_N]]})
    return [g for g in groups if g['items']]


def build(state):
    rows = state['comments']
    lookup = {r['comment_id']: r for r in rows}
    top = top_parents(rows)
    return {'visible': visible_vs_all(state, rows, top), 'moments': moments(state, rows, lookup), 'timeline': timeline(state, rows), 'notable': notable(state, rows, lookup, top)}

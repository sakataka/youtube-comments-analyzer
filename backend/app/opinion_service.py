from __future__ import annotations

import copy
import json
import sqlite3
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .opinion_analysis import aggregate, analyze_comments, digest, group_opinions, prepare_background, Observation
from .opinion_fetch import fetch_round
from .transcripts import fetch_transcript, parse_subtitles
from .youtube import parse_youtube_video_id


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class OpinionStore:
    """SQLite snapshots commit comments, cursors and per-part results together."""
    def __init__(self, path: Path):
        self.lock = threading.RLock()
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(path, check_same_thread=False, timeout=30)
        self.conn.execute('create table if not exists runs (id text primary key, state_json text not null, stop_requested integer not null default 0)')
        for run_id, raw in self.conn.execute('select id, state_json from runs').fetchall():
            state = json.loads(raw)
            if state['status'] in ('running', 'queued'):
                state.update(status='paused', stage='interrupted', error_message='サーバー再起動により停止しました。保存済み部分から再開できます。')
                self.conn.execute('update runs set state_json = ? where id = ?', (json.dumps(state, ensure_ascii=False), run_id))
        self.conn.commit()

    def exists(self, run_id: str) -> bool:
        with self.lock:
            return self.conn.execute('select 1 from runs where id = ?', (run_id,)).fetchone() is not None

    def get(self, run_id: str) -> dict[str, Any]:
        with self.lock:
            row = self.conn.execute('select state_json from runs where id = ?', (run_id,)).fetchone()
            if row is None:
                raise KeyError(f'run not found: {run_id}')
            return json.loads(row[0])

    def save(self, state: dict[str, Any]) -> None:
        state['updated_at'] = now()
        with self.lock:
            self.conn.execute('update runs set state_json = ? where id = ?', (json.dumps(state, ensure_ascii=False), state['run_id']))
            self.conn.commit()

    def create(self, url: str, config: dict[str, Any], seed: dict[str, Any] | None = None) -> str:
        video_id = parse_youtube_video_id(url)
        url = f'https://www.youtube.com/watch?v={video_id}'
        run_id = f'run_{uuid.uuid4().hex[:12]}'
        state = {'run_id': run_id, 'url': url, 'video': {'youtube_video_id': video_id, 'url': url, 'title': '', 'channel_title': ''}, 'config': config,
                 'status': 'paused', 'stage': 'created', 'created_at': now(), 'updated_at': now(), 'human_reviewed': False,
                 'fetch': {'source': 'pending', 'parents_done': False, 'replies_done': False, 'parent_cursor': None, 'reply_cursor': None, 'reply_index': 0, 'fetched_at': now()},
                 'comments': [], 'transcript': {'status': 'pending', 'segments': []}, 'analyses': {}, 'groups': [], 'ai_cache': {},
                 'usage': {'calls': 0, 'input_characters': 0, 'output_characters': 0, 'elapsed_seconds': 0, 'tokens': None}}
        if seed:
            for key in ('video', 'comments', 'fetch', 'transcript'):
                state[key] = copy.deepcopy(seed[key])
            state['source_run_id'] = seed.get('run_id')
        with self.lock:
            self.conn.execute('insert into runs (id, state_json) values (?, ?)', (run_id, json.dumps(state, ensure_ascii=False)))
            self.conn.commit()
        return run_id

    def latest_seed(self, url: str, reply_mode: str) -> dict[str, Any] | None:
        video_id = parse_youtube_video_id(url)
        with self.lock:
            rows = self.conn.execute('select state_json from runs order by rowid desc').fetchall()
        for (raw,) in rows:
            state = json.loads(raw)
            if state['video']['youtube_video_id'] == video_id and state['comments'] and state['status'] not in ('running', 'queued') and state['config']['reply_fetch_mode'] == reply_mode:
                return state
        return None

    def queue(self, run_id: str, action: str) -> None:
        with self.lock:
            state = self.get(run_id)
            if state['status'] in ('running', 'queued'):
                raise ValueError('この分析はすでに実行中です。')
            if action == 'continue' and not aggregate(state)['can_continue']:
                raise ValueError('続きの取得はありません。取得済み範囲を再分析できます。')
            state.update(status='queued', stage='queued', error_message=None, pending_action=action)
            self.conn.execute('update runs set stop_requested = 0 where id = ?', (run_id,))
            self.save(state)

    def stop(self, run_id: str) -> None:
        with self.lock:
            self.get(run_id)
            self.conn.execute('update runs set stop_requested = 1 where id = ?', (run_id,))
            self.conn.commit()

    def stopped(self, run_id: str) -> bool:
        with self.lock:
            row = self.conn.execute('select stop_requested from runs where id = ?', (run_id,)).fetchone()
            return row is None or bool(row[0])

    def report(self, run_id: str) -> dict[str, Any]:
        return aggregate(self.get(run_id))

    def run_info(self, run_id: str) -> dict[str, Any]:
        state = self.get(run_id)
        report = aggregate(state)
        return {'run_id': run_id, 'schema_version': 'report.v3', 'status': state['status'], 'stage': state['stage'], 'progress': report['analysis']['processed'] / max(1, report['coverage']['fetched']), 'error_message': state.get('error_message'), 'review_status': 'verified' if state['human_reviewed'] else 'provisional', 'created_at': state['created_at'], 'video': state['video'], 'fetch_summary': {'max_comments_fetched': len(state['comments']), 'max_comments_requested': state['config']['max_comments'], 'reply_fetch_mode': state['config']['reply_fetch_mode']}}

    def list_runs(self) -> list[dict[str, Any]]:
        with self.lock:
            ids = [row[0] for row in self.conn.execute('select id from runs').fetchall()]
        return [self.run_info(run_id) for run_id in ids]

    def delete(self, run_id: str) -> dict[str, Any]:
        with self.lock:
            state = self.get(run_id)
            if state['status'] in ('running', 'queued'):
                raise ValueError('実行中の分析は停止してから削除してください。')
            self.conn.execute('delete from runs where id = ?', (run_id,))
            self.conn.commit()
        return {'status': 'deleted', 'run_id': run_id}

    def import_transcript(self, run_id: str, content: str) -> None:
        segments = parse_subtitles(content)
        with self.lock:
            state = self.get(run_id)
            if state['status'] in ('running', 'queued'):
                raise ValueError('字幕の変更前に分析を停止してください。')
            state['transcript'] = {'status': 'available', 'source': 'import', 'automatic': None, 'language': 'unknown', 'segments': segments}
            state.update(analyses={}, groups=[], human_reviewed=False, status='paused', stage='transcript_changed')
            self.save(state)

    def comments_page(self, run_id: str, group_id: str | None, search: str | None, offset: int, limit: int, analysis_status: str | None = None) -> dict[str, Any]:
        state = self.get(run_id)
        comments = state['comments']
        atoms = {obs['id']: obs for result in state['analyses'].values() for obs in result['observations']}
        holds = {atoms[mid]['comment_id']: hold['reason'] for hold in state.get('group_holds', []) for mid in hold['member_ids'] if mid in atoms} if state.get('grouped_hash') == digest(state['analyses']) else {}
        unclear = {item['comment_id'] for item in state['analyses'].values() if item['outcome'] == 'unclear' or any(obs['stance'] == 'unclear' for obs in item['observations'])} | holds.keys()
        if analysis_status == 'held':
            comments = [row for row in comments if row['comment_id'] in unclear]
        if group_id:
            group = next((g for g in state['groups'] if g['id'] == group_id), None)
            if not group or state.get('grouped_hash') != digest(state['analyses']):
                raise KeyError('この意見は更新されました。レポートを読み直してください。')
            ids = {atoms[mid]['comment_id'] for mid in group['member_ids'] if mid in atoms}
            comments = [row for row in comments if row['comment_id'] in ids]
        if search:
            comments = [row for row in comments if search.casefold() in row['text_original'].casefold()]
        by_id = {row['comment_id']: row for row in state['comments']}
        subtitles = {row['id']: row for row in state['transcript'].get('segments', [])}
        output = []
        for row in comments[offset:offset + limit]:
            observations = [obs for obs in atoms.values() if obs['comment_id'] == row['comment_id']]
            parent = by_id.get(row.get('parent_comment_id'))
            output.append({**{k: row.get(k) for k in ('comment_id', 'text_original', 'like_count', 'published_at', 'is_reply')}, 'parent_text': parent['text_original'] if parent else None, 'review_reason': holds.get(row['comment_id']), 'analysis_status': 'held' if row['comment_id'] in unclear else 'analyzed' if any(item['comment_id'] == row['comment_id'] for item in state['analyses'].values()) else 'pending', 'observations': observations, 'subtitles': [subtitles[sid] for sid in dict.fromkeys(sid for obs in observations for sid in obs['subtitle_ids']) if sid in subtitles], 'url': f"https://www.youtube.com/watch?v={state['video']['youtube_video_id']}&lc={row['comment_id']}"})
        return {'comments': output, 'total': len(comments), 'offset': offset, 'limit': limit}

    def correct(self, run_id: str, comment_id: str, observations: list[dict[str, Any]] | None = None, rename_from: str | None = None, rename_to: str | None = None) -> None:
        with self.lock:
            state = self.get(run_id)
            if state['status'] in ('running', 'queued'):
                raise ValueError('修正前に分析を停止してください。')
            if rename_from and rename_to:
                matching_names = {name for name, canonical in state.get('canonical_targets', {}).items() if canonical == rename_from} | {rename_from}
                if not any(obs['target'] in matching_names for result in state['analyses'].values() for obs in result['observations']):
                    raise ValueError('修正元の対象が存在しません。')
                state['human_targets'] = list(set(state.get('human_targets', [])) | {rename_to})
                for result in state['analyses'].values():
                    for obs in result['observations']:
                        if obs['target'] in matching_names:
                            obs['target'] = rename_to
            elif observations is not None:
                rows = [result for result in state['analyses'].values() if result['comment_id'] == comment_id]
                comment = next((row for row in state['comments'] if row['comment_id'] == comment_id), None)
                if not rows or not comment:
                    raise ValueError('分析済みのコメントを選んでください。')
                parsed = [Observation.model_validate(obs).model_dump() for obs in observations]
                subtitle_ids = {s['id'] for s in state['transcript'].get('segments', [])}
                for obs in parsed:
                    if obs['quote'] not in comment['text_original'] or not set(obs['subtitle_ids']) <= subtitle_ids:
                        raise ValueError('根拠が原文と一致しません。')
                    obs.update(id=digest([comment_id, obs, 'human'])[:20], comment_id=comment_id)
                state['human_targets'] = list(set(state.get('human_targets', [])) | {obs['target'] for obs in parsed})
                for row in rows:
                    row.update(observations=[], outcome='no_opinion', human_corrected=True)
                rows[0].update(observations=parsed, outcome='analyzed' if parsed else 'no_opinion')
            else:
                raise ValueError('修正内容がありません。')
            state.update(groups=[], human_reviewed=False, status='paused', stage='correction_saved')
            self.save(state)

    def process(self, run_id: str, youtube: Any, progress: Any, client: Any = None, transcript_loader: Any = fetch_transcript) -> None:
        state = self.get(run_id)
        started = time.monotonic()
        base_seconds = state['usage']['elapsed_seconds']
        def stopped() -> bool:
            return self.stopped(run_id)
        def checkpoint() -> None:
            state['usage']['elapsed_seconds'] = round(base_seconds + time.monotonic() - started, 1)
            self.save(state)
            progress(state['stage'], state['status'])
        try:
            if stopped():
                raise InterruptedError('開始前に停止しました。')
            state.update(status='running', error_message=None)
            action = state.get('pending_action', 'resume')
            if action in ('fetch', 'continue') or (action == 'resume' and (state.get('fetch_incomplete') or state['fetch']['source'] == 'pending')):
                if action in ('fetch', 'continue') or 'round_target' not in state['fetch']:
                    state['fetch']['round_target'] = len(state['comments']) + state['config']['max_comments']
                state.update(stage='fetching', fetch_incomplete=True)
                checkpoint()
                fetch_round(state, youtube, checkpoint, stopped)
                if stopped():
                    raise InterruptedError('取得を停止しました。')
                state['fetch_incomplete'] = False
            if stopped():
                raise InterruptedError('停止しました。')
            state['stage'] = 'subtitles'
            checkpoint()
            if state['transcript']['status'] == 'pending':
                state['transcript'] = {'status': 'unavailable', 'reason': 'fixtureには字幕がありません。', 'segments': []} if state['fetch']['source'] == 'fixture' else transcript_loader(state['url'])
            state['stage'] = 'background'
            checkpoint()
            prepare_background(state, checkpoint, stopped, client)
            state['stage'] = 'reading'
            checkpoint()
            analyze_comments(state, checkpoint, stopped, client)
            state['stage'] = 'grouping'
            checkpoint()
            group_opinions(state, checkpoint, stopped, client)
            if stopped():
                raise InterruptedError('停止しました。')
            state.update(status='completed', stage='completed', human_reviewed=False)
        except InterruptedError as exc:
            state.update(status='paused', stage='paused', error_message=str(exc))
        except Exception as exc:
            # A syntactically valid but semantically rejected response must be retryable.
            if isinstance(exc, ValueError) and state.get('last_ai_key'):
                state['ai_cache'].pop(state['last_ai_key'], None)
            state.update(status='failed', error_message=str(exc))
        finally:
            checkpoint()

import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.opinion_service import OpinionStore
from backend.app.opinion_analysis import aggregate, analyze_comments, digest, prepare_background
from backend.app.opinion_fetch import fetch_round
from backend.app.transcripts import parse_subtitles
from backend.tests.opinion_fakes import FakeOpinionClient

URL = 'https://www.youtube.com/watch?v=vlpLbiqNhLo'


def comment(cid, text, likes=0, parent=None, author='person'):
    return {'comment_id': cid, 'text_original': text, 'like_count': likes, 'is_reply': bool(parent), 'parent_comment_id': parent, 'reply_count': 0, 'published_at': '2026-01-01T00:00:00Z', 'author_channel_id': author, 'author_display_name': 'PRIVATE AUTHOR'}


def seed(rows):
    return {'video': {'youtube_video_id': 'vlpLbiqNhLo', 'url': URL, 'title': '評価用動画', 'description': '', 'channel_title': 'Test'}, 'comments': rows, 'fetch': {'source': 'fixture', 'parents_done': True, 'replies_done': True, 'reply_index': 0, 'stop_reason': 'api_exhausted'}, 'transcript': {'status': 'unavailable', 'segments': []}}


class OpinionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'test.sqlite'
        self.store = OpinionStore(self.path)
        self.addCleanup(self.store.conn.close)
        self.client = FakeOpinionClient()

    def create(self, rows):
        return self.store.create(URL, {'max_comments': 5000, 'reply_fetch_mode': 'full'}, seed(rows))

    def run_analysis(self, run_id, client=None):
        self.store.queue(run_id, 'resume')
        self.store.process(run_id, None, lambda *_: None, client or self.client)
        return self.store.report(run_id)

    def test_denominators_parent_reply_top_and_grounded_summary(self):
        rows = [comment(str(i), '面白い' if i < 8 else '苦手', 100 if i == 9 else i, author=str(i % 3)) for i in range(10)]
        rows += [comment('r', '苦手', 1000, parent='0')]
        report = self.run_analysis(self.create(rows))
        self.assertEqual(report['status'], 'completed')
        self.assertEqual(report['analysis']['processed'], 11)
        negative = next(g for g in report['groups'] if g['stance'] == 'negative')
        self.assertEqual((negative['comment_count'], negative['parent_count'], negative['reply_count']), (3, 2, 1))
        self.assertEqual((negative['top_count'], negative['top_denominator']), (1, 1))
        self.assertAlmostEqual(negative['parent_rate'], .2)
        self.assertAlmostEqual(negative['rate'], 3 / 11)
        self.assertEqual(negative['difference_pp'], 80)
        self.assertTrue(negative['counter_group_ids'])
        self.assertEqual(report['concentration']['unique_authors'], 4)
        self.assertNotIn('PRIVATE AUTHOR', ''.join(self.client.prompts))
        self.assertNotIn('author_channel_id', ''.join(self.client.prompts))
        self.assertIn('3件', ' '.join(row['text'] for row in report['summary']))

    def test_missing_output_not_counted_and_retry_not_poisoned_by_cache(self):
        class Missing(FakeOpinionClient):
            def ask(self, prompt):
                result = json.loads(super().ask(prompt))
                if 'comments' in result:
                    result['comments'].pop()
                return json.dumps(result)
        run = self.create([comment('a', '良い'), comment('b', '苦手')])
        report = self.run_analysis(run, Missing())
        self.assertEqual(report['status'], 'failed')
        self.assertEqual(report['analysis']['processed'], 0)
        self.assertEqual(report['analysis']['unprocessed'], 2)
        self.assertEqual(self.run_analysis(run)['status'], 'completed')

    def test_invented_quote_rejected(self):
        class Invented(FakeOpinionClient):
            def ask(self, prompt):
                result = json.loads(super().ask(prompt))
                if 'comments' in result:
                    result['comments'][0]['observations'][0]['quote'] = '存在しない引用'
                return json.dumps(result)
        report = self.run_analysis(self.create([comment('a', '良い')]), Invented())
        self.assertEqual(report['status'], 'failed')
        self.assertEqual(report['groups'], [])

    def test_restart_retains_completed_batches_and_only_new_comments_are_read(self):
        run = self.create([comment('a', '良い')])
        self.run_analysis(run)
        original_calls = self.client.calls
        self.run_analysis(run)
        self.assertEqual(self.client.calls, original_calls)
        state = self.store.get(run)
        state['comments'].append(comment('b', '苦手'))
        self.store.save(state)
        self.run_analysis(run)
        extraction_inputs = [json.loads(p.split('\ninput:\n')[1])['comments'] for p in self.client.prompts if '"comments":' in p]
        self.assertEqual([[p['comment_id'] for p in batch] for batch in extraction_inputs], [['a'], ['b']])
        self.store.queue(run, 'resume')
        restarted = OpinionStore(self.path)
        self.addCleanup(restarted.conn.close)
        self.assertEqual(restarted.get(run)['status'], 'paused')
        self.assertEqual(restarted.report(run)['analysis']['processed'], 2)

    def test_stop_checkpoint_and_active_deletion_guard(self):
        run = self.create([comment(str(i), '良い') for i in range(50)])
        self.store.queue(run, 'resume')
        with self.assertRaises(ValueError):
            self.store.delete(run)
        def progress(stage, _):
            if stage == 'reading' and self.store.get(run)['analyses']:
                self.store.stop(run)
        self.store.process(run, None, progress, self.client)
        self.assertEqual(self.store.get(run)['status'], 'paused')
        self.assertGreater(self.store.report(run)['analysis']['processed'], 0)
        self.assertEqual(self.run_analysis(run)['analysis']['processed'], 50)

    def test_subtitles_import_invalidates_results_and_preserves_old_run(self):
        run = self.create([comment('a', '良い')])
        self.run_analysis(run)
        before = self.store.get(run)
        clone = self.store.create(URL, before['config'], before)
        self.store.import_transcript(clone, 'WEBVTT\n\n00:00:01.000 --> 00:00:04.000\n背景の発言\n')
        self.assertEqual(self.store.report(clone)['analysis']['processed'], 0)
        self.assertEqual(self.store.report(run)['analysis']['processed'], 1)
        self.assertEqual(self.run_analysis(clone)['transcript']['segment_count'], 1)

    def test_human_correction_survives_resume(self):
        run = self.create([comment('a', '良い')])
        self.run_analysis(run)
        observation = copy.deepcopy(next(iter(self.store.get(run)['analyses'].values()))['observations'][0])
        observation.pop('id'); observation.pop('comment_id')
        observation.update(stance='unclear', opinion='判断できない', emotions=['unclear'])
        self.store.correct(run, 'a', [observation])
        report = self.run_analysis(run)
        self.assertEqual(report['analysis']['held'], 1)
        self.assertEqual(report['groups'][0]['stance'], 'unclear')

    def test_long_comments_are_not_truncated(self):
        run = self.create([comment('a', 'あ' * 13000)])
        report = self.run_analysis(run)
        state = self.store.get(run)
        self.assertEqual(len(state['analyses']), 3)
        self.assertEqual(sum(len(row['observations'][0]['quote']) for row in state['analyses'].values()), 13000)
        self.assertEqual(report['analysis']['processed'], 1)
        self.assertEqual(report['groups'][0]['comment_count'], 1)

    def test_empty_and_reply_only_counts(self):
        report = self.run_analysis(self.create([]))
        self.assertEqual(report['status'], 'completed')
        self.assertEqual(report['groups'], [])
        report = self.run_analysis(self.create([comment('r', '良い', parent='missing')]))
        self.assertEqual(report['groups'][0]['top_denominator'], 0)
        self.assertEqual(report['analysis']['context_incomplete'], 1)

    def test_parent_first_paging_resume_and_reply_budget(self):
        class Api:
            def __init__(self): self.requests = []
            def _get_json(self, endpoint, query):
                self.requests.append((endpoint, query.copy()))
                if 'commentThreads' in endpoint:
                    index = 0 if not query.get('pageToken') else 1
                    return {'items': [{'snippet': {'totalReplyCount': 3 if index == 0 else 0, 'topLevelComment': {'id': f'p{index}', 'snippet': {'textDisplay': '良い'}}}}], **({'nextPageToken': 'next'} if index == 0 else {})}
                offset = int(query.get('pageToken', 0))
                size = min(query['maxResults'], 3 - offset)
                return {'items': [{'id': f'r{i}', 'snippet': {'textDisplay': '返信'}} for i in range(offset, offset + size)], **({'nextPageToken': str(offset + size)} if offset + size < 3 else {})}
        api = Api()
        run = self.create([])
        state = self.store.get(run)
        state['config']['max_comments'] = 2
        state['fetch'].update(source='youtube_api', parents_done=False, replies_done=False, parent_cursor=None, reply_cursor=None)
        with patch.dict('os.environ', {'YOUTUBE_API_KEY': 'test'}):
            for _ in range(3):
                fetch_round(state, api, lambda: self.store.save(state), lambda: False)
        self.assertEqual([row['comment_id'] for row in state['comments']], ['p0', 'p1', 'r0', 'r1', 'r2'])
        self.assertTrue(state['fetch']['parents_done'] and state['fetch']['replies_done'])
        self.assertEqual(api.requests[0][1]['order'], 'time')
        self.assertEqual(len([r for r in api.requests if 'commentThreads' in r[0]]), 2)

    def test_audit_hold_keeps_supported_groups_and_exposes_reason(self):
        class AuditHold(FakeOpinionClient):
            def ask(self, prompt):
                result = json.loads(super().ask(prompt))
                payload = json.loads(prompt.split('\ninput:\n', 1)[1])
                if 'supported' in result and payload['group']['stance'] == 'negative':
                    self_context = payload['context']
                    assert 'video' in self_context and payload['sources'][0]['text']
                    result = {'supported': False, 'reason': '対象を確定できない'}
                return json.dumps(result)
        run = self.create([comment('a', '良い'), comment('b', '苦手')])
        report = self.run_analysis(run, AuditHold())
        self.assertEqual(report['status'], 'completed')
        self.assertEqual(report['analysis']['held'], 1)
        self.assertEqual(len(report['summary']), 1)
        held = self.store.comments_page(run, None, None, 0, 30, 'held')
        self.assertEqual(held['total'], 1)
        self.assertEqual(held['comments'][0]['review_reason'], '対象を確定できない')

    def test_parent_arrival_invalidates_reply_interpretation(self):
        run = self.create([comment('r', '良い', parent='p')])
        self.run_analysis(run)
        state = self.store.get(run)
        state['comments'].append(comment('p', '新しく取得した親'))
        self.store.save(state)
        report = self.run_analysis(run)
        self.assertEqual(report['analysis']['context_incomplete'], 0)
        input_text = '\n'.join(self.client.prompts)
        self.assertIn('新しく取得した親', input_text)
        self.assertGreater(sum('"parent_text": "新しく取得した親"' in prompt for prompt in self.client.prompts), 0)

    def test_likes_update_reaggregates_without_ai_reading_again(self):
        run = self.create([comment('a', '良い', 10), comment('b', '苦手', 0)])
        self.run_analysis(run)
        calls = self.client.calls
        state = self.store.get(run)
        state['comments'][1]['like_count'] = 20
        self.store.save(state)
        report = self.run_analysis(run)
        self.assertEqual(calls, self.client.calls)
        negative = next(group for group in report['groups'] if group['stance'] == 'negative')
        self.assertEqual(negative['top_count'], 1)

    def test_fetch_failure_resumes_after_persisted_page(self):
        run = self.create([])
        state = self.store.get(run)
        state['fetch'].update(source='youtube_api', parents_done=False, replies_done=False)
        self.store.save(state)
        class FailOnSecondPage:
            def __init__(self): self.fail = True; self.tokens = []
            def _get_json(self, endpoint, query):
                self.tokens.append(query.get('pageToken'))
                if query.get('pageToken') == 'second' and self.fail:
                    self.fail = False
                    raise RuntimeError('quota test')
                if query.get('pageToken') == 'second': return {'items': []}
                return {'items': [{'snippet': {'totalReplyCount': 0, 'topLevelComment': {'id': 'a', 'snippet': {'textDisplay': '良い'}}}}], 'nextPageToken': 'second'}
        api = FailOnSecondPage()
        with patch.dict('os.environ', {'YOUTUBE_API_KEY': 'test'}):
            self.store.queue(run, 'continue')
            self.store.process(run, api, lambda *_: None, self.client)
            self.assertEqual(self.store.get(run)['status'], 'failed')
            self.assertEqual(len(self.store.get(run)['comments']), 1)
            self.store.queue(run, 'resume')
            self.store.process(run, api, lambda *_: None, self.client)
        self.assertEqual(api.tokens, [None, 'second', 'second'])
        self.assertEqual(self.store.report(run)['analysis']['processed'], 1)

    def test_aliases_are_unified_across_different_opinions(self):
        class AliasClient(FakeOpinionClient):
            def ask(self, prompt):
                result = json.loads(super().ask(prompt))
                payload = json.loads(prompt.split('\ninput:\n', 1)[1])
                if 'comments' in result:
                    for item in result['comments']:
                        part = next(part for part in payload['comments'] if part['part_id'] == item['part_id'])
                        item['observations'][0]['target'] = 'アリスさん' if 'アリスさん' in part['text'] else 'アリスちゃん'
                if 'mappings' in result:
                    result['mappings'] = [{'source': item['source'], 'target': 'アリス', 'evidence_comment_ids': [item['examples'][0]['comment_id']]} for item in payload['targets']]
                return json.dumps(result)
        run = self.create([comment('a', 'アリスさんは良い'), comment('b', 'アリスちゃんは苦手')])
        report = self.run_analysis(run, AliasClient())
        self.assertEqual(report['status'], 'completed')
        self.assertEqual(len(report['targets']), 1)
        self.assertEqual(report['targets'][0]['name'], 'アリス')
        self.assertEqual(report['targets'][0]['comment_count'], 2)
        self.assertEqual(len(report['groups']), 2)
        self.store.correct(run, '', rename_from='アリス', rename_to='確認した名前')
        self.assertEqual(self.run_analysis(run)['targets'][0]['name'], '確認した名前')

    def test_target_name_not_in_sources_is_rejected(self):
        class InventedName(FakeOpinionClient):
            def ask(self, prompt):
                result = json.loads(super().ask(prompt))
                if 'comments' in result:
                    result['comments'][0]['observations'][0]['target'] = '原文にない本名'
                return json.dumps(result)
        report = self.run_analysis(self.create([comment('a', '良い')]), InventedName())
        self.assertEqual(report['status'], 'failed')
        self.assertEqual(report['analysis']['processed'], 0)

    def test_explicit_human_name_correction_is_preserved(self):
        run = self.create([comment('a', '良い')])
        self.run_analysis(run)
        self.store.correct(run, '', rename_from='動画', rename_to='人が確認した企画名')
        report = self.run_analysis(run)
        self.assertEqual(report['groups'][0]['target'], '人が確認した企画名')

    def test_human_evaluation_cannot_pass_unreviewed_packet(self):
        from backend.tools.evaluate_opinions import score
        result = score({'videos': [], 'records': []}, [])
        self.assertFalse(result['passed'])
        self.assertTrue(any('300' in blocker for blocker in result['blockers']))

    def test_bad_subtitle_and_vtt_srt_json(self):
        with self.assertRaises(ValueError): parse_subtitles('plain text without timestamps')
        self.assertEqual(parse_subtitles('1\n00:00:01,000 --> 00:00:02,000\nHello')[0]['start'], 1)
        self.assertEqual(parse_subtitles('{"events":[{"tStartMs":1000,"dDurationMs":1000,"segs":[{"utf8":"hi"}]}]}')[0]['text'], 'hi')

    def test_source_subtitles_never_count_as_comments(self):
        run = self.create([comment('a', '良い')])
        self.store.import_transcript(run, 'WEBVTT\n\n00:00:00.000 --> 00:01:00.000\n多くの人が苦手と言っている\n')
        report = self.run_analysis(run)
        self.assertEqual(report['coverage']['fetched'], 1)
        self.assertEqual(report['groups'][0]['comment_count'], 1)


if __name__ == '__main__':
    unittest.main()

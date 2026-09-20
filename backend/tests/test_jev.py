import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.app import jev
from backend.app.lightweight import LightweightStore
from backend.tests.test_opinions import comment, seed, URL


def fake_response(*args, **kwargs):
    return {'answers': {'kind': {'type': 'choice', 'choice': 'question', 'confidence': 0.9}, 'tone': {'type': 'choice', 'choice': 'positive', 'confidence': 0.5}}, 'usage': {'input_tokens': 100, 'output_tokens': 20}}

class JevTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = LightweightStore(Path(self.tmp.name) / 'test.sqlite3')
        self.key = patch('backend.app.jev.api_key', return_value='test-only')
        self.key.start()
    def tearDown(self):
        self.key.stop(); self.store.conn.close(); self.tmp.cleanup()
    def create(self, n=3):
        run = self.store.create(URL, {'max_comments': 5000, 'reply_fetch_mode': 'full'}, seed([comment(str(i), '質問です' + str(i)) for i in range(n)]))
        state = self.store.get(run)
        state.update(status='completed', stage='completed', summary_status='completed', topics=[{'id': 'keep'}])
        self.store.save(state)
        return run
    def test_limit_cache_and_summary_preserved(self):
        run = self.create(530)
        with patch('backend.app.jev.evaluate', side_effect=fake_response) as call:
            self.store.queue(run, 'jev'); self.store.process(run, None, None)
            self.assertEqual(call.call_count, 500)
            state = self.store.get(run)
            self.assertEqual(state['topics'], [{'id': 'keep'}])
            self.assertEqual(state['status'], 'completed')
            self.assertEqual(state['jev']['rows'][0]['tone'], 'positive')
            self.assertEqual(state['jev']['usage']['input_tokens'], 50000)
            self.store.queue(run, 'jev'); self.store.process(run, None, None)
            self.assertEqual(call.call_count, 500)
            self.assertEqual(self.store.get(run)['jev']['cache_hits'], 500)
    def test_stop_preserves_completed_result_and_retry(self):
        run = self.create()
        def evaluate(*args, **kwargs):
            self.store.stop(run)
            return fake_response()
        self.store.queue(run, 'jev')
        with patch.object(jev, 'MAX_CONCURRENCY', 1): jev.process(self.store, run, evaluate)
        result = self.store.get(run)['jev']
        self.assertEqual(result['status'], 'stopped'); self.assertEqual(len(result['rows']), 1)
        self.store.queue(run, 'jev')
        with patch('backend.app.jev.evaluate', side_effect=fake_response) as call:
            self.store.process(run, None, None)
            self.assertEqual(call.call_count, 2)
    def test_invalid_response_keeps_prior_rows(self):
        run = self.create(); self.store.queue(run, 'jev')
        with patch.object(jev, 'MAX_CONCURRENCY', 1), patch('backend.app.jev.evaluate', side_effect=[fake_response(), {'answers': {}}]):
            self.store.process(run, None, None)
        state = self.store.get(run)
        self.assertEqual(state['jev']['status'], 'failed'); self.assertEqual(len(state['jev']['rows']), 1)
        self.assertEqual(state['summary_status'], 'completed')
    def test_key_missing_does_not_queue(self):
        run = self.create()
        with patch('backend.app.jev.api_key', return_value=''):
            with self.assertRaises(ValueError): self.store.queue(run, 'jev')
        self.assertEqual(self.store.get(run)['status'], 'completed')
    def test_payload_excludes_identity_and_bounds_text(self):
        run = self.create(); state = self.store.get(run); row = state['comments'][0]
        row.update(text_original='文' * 3000, author_name='SECRET', author_id='SECRET')
        body = jev.payload(state, row, {})
        self.assertEqual(len(body['state']['comment']), 2000)
        self.assertNotIn('SECRET', str(body)); self.assertNotIn('comment_id', str(body))
    def test_nonfinite_confidence_rejected(self):
        raw = fake_response(); raw['answers']['kind']['confidence'] = float('nan')
        with self.assertRaises(ValueError): jev.validated(raw)
    def test_failure_does_not_echo_secrets(self):
        run = self.create(); self.store.queue(run, 'jev')
        with patch('backend.app.jev.evaluate', side_effect=RuntimeError('SECRET')):
            self.store.process(run, None, None)
        self.assertNotIn('SECRET', str(self.store.get(run)['jev']))
    def test_interrupted_run_can_retry(self):
        run = self.create(); self.store.queue(run, 'jev')
        state = self.store.get(run); state['jev'] = {'status': 'running'}; self.store.save(state)
        other = LightweightStore(Path(self.tmp.name) / 'test.sqlite3')
        try:
            self.assertEqual(other.get(run)['jev']['status'], 'stopped')
            other.queue(run, 'jev')
        finally: other.conn.close()

    def test_neutral_mixed_and_uncertain_are_distinct(self):
        for tone in ('neutral', 'mixed', 'very_positive', 'very_negative'):
            raw = fake_response()
            raw['answers']['tone'].update(choice=tone, confidence=0.9)
            self.assertEqual(jev.validated(raw)['tone'], tone)
        raw['answers']['tone']['confidence'] = 0.2
        self.assertEqual(jev.validated(raw)['tone'], 'very_negative')
        self.assertEqual(jev.validated(raw)['tone_raw'], 'very_negative')

    def test_old_prompt_cache_not_reused(self):
        run = self.create(1)
        state = self.store.get(run)
        state['jev_cache'] = {'old-schema': {'tone': 'positive'}}
        self.store.save(state)
        self.store.queue(run, 'jev')
        with patch('backend.app.jev.evaluate', side_effect=fake_response) as call:
            self.store.process(run, None, None)
        self.assertEqual(call.call_count, 1)
        self.assertEqual(self.store.get(run)['jev']['version'], 'sentiment-v2')

    def test_top_500_selected_and_ordered(self):
        run = self.create(505)
        state = self.store.get(run)
        for i, row in enumerate(state['comments']): row['like_count'] = i
        self.store.save(state)
        self.store.queue(run, 'jev'); jev.process(self.store, run, fake_response)
        rows = self.store.get(run)['jev']['rows']
        self.assertEqual([r['comment_id'] for r in rows], [str(i) for i in range(504, 4, -1)])

    def test_ten_inflight_stop_drains_and_resume_uses_cache(self):
        run = self.create(30)
        barrier = threading.Barrier(10)
        lock = threading.Lock()
        active = peak = calls = 0
        def evaluate(*args, **kwargs):
            nonlocal active, peak, calls
            with lock:
                active += 1; calls += 1; peak = max(peak, active)
            barrier.wait(timeout=5)
            self.store.stop(run)
            with lock: active -= 1
            return fake_response()
        self.store.queue(run, 'jev'); jev.process(self.store, run, evaluate)
        result = self.store.get(run)['jev']
        self.assertEqual((peak, calls), (10, 10))
        self.assertEqual((result['status'], len(result['rows'])), ('stopped', 10))
        self.store.queue(run, 'jev')
        with patch('backend.app.jev.evaluate', side_effect=fake_response) as call:
            jev.process(self.store, run)
        self.assertEqual(call.call_count, 20)
        self.assertEqual(self.store.get(run)['jev']['cache_hits'], 10)

    def test_failure_drains_inflight_successes_without_more_requests(self):
        run = self.create(30)
        barrier = threading.Barrier(10)
        lock = threading.Lock()
        calls = 0
        def evaluate(*args, **kwargs):
            nonlocal calls
            with lock:
                calls += 1; number = calls
            barrier.wait(timeout=5)
            if number == 1: raise ValueError('HTTP 429')
            time.sleep(0.05)
            return fake_response()
        self.store.queue(run, 'jev'); jev.process(self.store, run, evaluate)
        result = self.store.get(run)['jev']
        self.assertEqual(calls, 10)
        self.assertEqual((result['status'], len(result['rows'])), ('failed', 9))
        self.assertEqual(result['usage']['input_tokens'], 900)

    def test_deadline_stops_new_requests_but_preserves_inflight(self):
        run = self.create(30)
        def evaluate(*args, **kwargs):
            time.sleep(0.05)
            return fake_response()
        self.store.queue(run, 'jev')
        with patch.object(jev, 'TIME_LIMIT_SECONDS', 0.02): jev.process(self.store, run, evaluate)
        result = self.store.get(run)['jev']
        self.assertEqual(result['status'], 'timed_out')
        self.assertGreater(len(result['rows']), 0)
        self.assertLessEqual(result['usage']['calls'], 10)

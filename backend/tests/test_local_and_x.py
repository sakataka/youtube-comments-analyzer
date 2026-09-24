import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.app import local_models, x_pulse
from backend.app.lightweight import LightweightStore
from backend.app.person_statistics import compute_statistics, clean_dictionary
from backend.tests.test_opinions import comment, seed, URL

POLARITY = {'好き': 0.8, '嫌い': -0.8, '？': -0.2}


def fake_infer(texts, stopped=lambda: False):
    """Polarity from keywords; joy when positive so emotions are exercised without a model."""
    fake_infer.calls.append(list(texts))
    output = []
    for text in texts:
        polarity = sum(v for k, v in POLARITY.items() if k in text)
        output.append([polarity, [2.0 if polarity > 0 else 0, 0, 0, 0, 0, 0, 1.5 if polarity < 0 else 0, 0]])
    return output


class LocalModelTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.store = LightweightStore(Path(self.tmp.name) / 'test.sqlite3')
        fake_infer.calls = []
        self.patch = patch('backend.app.local_models.infer', side_effect=fake_infer); self.patch.start()
    def tearDown(self): self.patch.stop(); self.store.conn.close(); self.tmp.cleanup()

    def create(self):
        rows = [comment('a', '佐久間さん好き。永野は嫌い', 5), comment('b', '佐久間さん好き', 1), comment('c', '次のゲストはノブ？'), comment('d', '普通の感想')]
        run = self.store.create(URL, {'max_comments': 5000, 'reply_fetch_mode': 'full'}, seed(rows))
        state = self.store.get(run)
        dictionary = clean_dictionary([{'name': '佐久間', 'aliases': ['佐久間さん']}, {'name': '永野', 'aliases': []}])
        state.update(status='completed', stage='completed', summary_status='completed', people_status='completed', people_dictionary=dictionary, person_statistics=compute_statistics(state['comments'], dictionary))
        self.store.save(state)
        return run, {p['name']: p['id'] for p in dictionary['people']}

    def test_full_population_labels_person_sentences_and_cache(self):
        run, ids = self.create()
        self.store.queue(run, 'local'); self.store.process(run, None, None)
        report = self.store.report(run)
        self.assertEqual(report['status'], 'completed')
        local = report['local']
        self.assertEqual(local['status'], 'completed'); self.assertFalse(local['stale'])
        # 'a' mixes both people (net 0) and the weak question stays neutral rather than negative.
        self.assertEqual(local['sentiments'], {'positive': 1, 'neutral': 3, 'negative': 0})
        self.assertEqual(local['emotions']['joy'], 1)
        # Sentence-level: each person gets the sentiment of the sentence that names them.
        self.assertEqual(local['people'][ids['佐久間']]['positive'], 2)
        self.assertEqual(local['people'][ids['永野']]['negative'], 1)
        page = self.store.comments_page(run, None, None, 0, 30, person_id=ids['永野'], model_stance='negative')
        self.assertEqual([r['comment_id'] for r in page['comments']], ['a'])
        self.assertEqual(self.store.comments_page(run, None, None, 0, 30, sentiment='positive')['comments'][0]['local']['emotion'], 'joy')
        self.assertIn('sentiment', report['insights']['visible'])
        self.store.queue(run, 'local'); self.store.process(run, None, None)
        self.assertEqual(fake_infer.calls[-1], [])  # everything cached

    def test_dictionary_edit_marks_stale(self):
        run, _ = self.create()
        self.store.queue(run, 'local'); self.store.process(run, None, None)
        report = self.store.update_people(run, [{'name': '佐久間', 'aliases': []}])
        self.assertTrue(report['local']['stale'])

    def test_disabled_and_failure_keep_run_status(self):
        run, _ = self.create()
        with patch.dict('os.environ', {'LOCAL_MODELS': 'off'}):
            with self.assertRaises(ValueError): self.store.queue(run, 'local')
        with patch('backend.app.local_models.infer', side_effect=RuntimeError('boom')):
            self.store.queue(run, 'local'); self.store.process(run, None, None)
        state = self.store.get(run)
        self.assertEqual(state['local']['status'], 'failed'); self.assertEqual(state['status'], 'completed')


class XPulseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.store = LightweightStore(Path(self.tmp.name) / 'test.sqlite3')
        self.bin = patch('backend.app.x_pulse.executable', return_value='/bin/grok'); self.bin.start()
        run = self.store.create(URL, {'max_comments': 5000, 'reply_fetch_mode': 'full'}, seed([comment('a', '面白い')]))
        state = self.store.get(run); state.update(status='completed', stage='completed'); self.store.save(state)
        self.run = run
    def tearDown(self): self.bin.stop(); self.store.conn.close(); self.tmp.cleanup()

    def test_parses_final_json_and_drops_unverifiable_posts(self):
        answer = {'summary': '話題です', 'tone': '好意的', 'comparison': 'Xでは切り抜きの話が多い', 'topics': [
            {'title': '神回', 'summary': '反応', 'posts': [{'url': 'https://x.com/user/status/1234567', 'author': 'A @user', 'postedAt': '2026-09-20', 'gist': '最高'}, {'url': 'https://example.com/x', 'author': 'B', 'postedAt': '', 'gist': '偽'}]},
            {'title': 'URLなし', 'summary': '', 'posts': [{'url': 'not a url', 'author': 'C', 'postedAt': '', 'gist': 'x'}]}]}
        stdout = json.dumps({'text': '{"summary":"途中"}' + json.dumps(answer, ensure_ascii=False)}, ensure_ascii=False)
        commands = []
        def runner(command, cwd, stopped): commands.append(command); return stdout
        self.store.queue(self.run, 'x'); x_pulse.process(self.store, self.run, runner=runner)
        result = self.store.report(self.run)['x_pulse']
        self.assertEqual(result['status'], 'completed'); self.assertEqual(result['comparison'], 'Xでは切り抜きの話が多い')
        self.assertEqual([t['title'] for t in result['topics']], ['神回']); self.assertEqual(len(result['topics'][0]['posts']), 1)
        self.assertIn('x_search,web_search', commands[0]); self.assertIn('評価用動画', commands[0][2])
        self.assertEqual(self.store.get(self.run)['status'], 'completed')

    def test_error_envelope_fails_without_touching_run(self):
        self.store.queue(self.run, 'x')
        x_pulse.process(self.store, self.run, runner=lambda *a: json.dumps({'type': 'error', 'message': '未ログインです'}))
        state = self.store.get(self.run)
        self.assertEqual(state['x_pulse']['status'], 'failed'); self.assertEqual(state['x_pulse']['error'], '未ログインです'); self.assertEqual(state['status'], 'completed')

import tempfile
import unittest
from pathlib import Path
from backend.app import insights
from backend.app.lightweight import LightweightStore
from backend.app.youtube import parse_duration
from backend.tests.test_opinions import comment, seed, URL


def row(cid, text, likes=0, parent=None, replies=0, posted='2026-01-01T02:00:00Z'):
    return {**comment(cid, text, likes, parent), 'reply_count': replies, 'published_at': posted}


class InsightsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.store = LightweightStore(Path(self.tmp.name) / 'test.sqlite3')
    def tearDown(self): self.store.conn.close(); self.tmp.cleanup()

    def test_timestamps_ignore_implausible_values(self):
        self.assertEqual(insights.timestamps('12:20 ここ\n15:12 と 1:02:03 / 99:99 / 2026:10 / 12:20'), [740, 912, 3723])
        self.assertEqual(insights.timestamps('3:00 と 1:00', limit=120), [60])
        self.assertEqual(insights.timestamps('3時間でこの量'), [])
        self.assertEqual((parse_duration('PT1H2M3S'), parse_duration('PT45M'), parse_duration(None)), (3723, 2700, None))

    def test_report_insights_and_moment_filter(self):
        rows = [row('top', '1:05 最高', 100, replies=3), row('low', '0:10 と 1:10 ここ好き', 0), row('idx', '0:00 開始 1:00 本題 1:20 終盤 1:25 締め', 1), row('r1', '返信で支持', 9, parent='top', posted='2026-01-01T03:00:00Z')]
        rows += [row(f'p{i}', f'感想{i}', 50) for i in range(25)]
        data = seed(rows)
        data['video'].update(published_at='2026-01-01T00:00:00Z', duration_seconds=90)
        data['fetch']['fetched_at'] = '2026-01-02T02:00:00Z'
        run = self.store.create(URL, {'max_comments': 5000, 'reply_fetch_mode': 'full'}, data)
        result = self.store.report(run)['insights']
        self.assertEqual(result['visible']['top_n'], 20)
        self.assertAlmostEqual(result['visible']['top_like_share'], (100 + 19 * 50) / (100 + 10 + 1250))
        self.assertEqual(result['moments']['comment_count'], 2); self.assertEqual(result['moments']['index_comments'], 1)
        counts = {b['start']: b['comment_count'] for b in result['moments']['bins']}
        self.assertEqual(counts[60], 2)  # 1:05 and 1:10 in the same bin count one comment each
        self.assertEqual(result['moments']['bins'][0]['comment_count'], 1)
        self.assertEqual([b['comment_count'] for b in result['timeline']['bins']][:2], [0, 29])
        groups = {g['id']: g for g in result['notable']}
        self.assertEqual(groups['discussion']['items'][0]['comment_id'], 'top')
        self.assertEqual(groups['replies']['items'][0]['parent_text'], '1:05 最高')
        self.assertNotIn('top', [i['comment_id'] for i in groups.get('rising', {'items': []})['items']])
        self.assertNotIn('critical', groups)
        page = self.store.comments_page(run, None, None, 0, 30, sort='likes', moment=(60, 120))
        self.assertEqual([r['comment_id'] for r in page['comments']], ['top', 'low']); self.assertEqual(page['limit'], 30)

    def test_people_comparison_and_critical_from_jev(self):
        rows = [row('a', '佐久間さん最高', 10), row('b', '佐久間さん', 0), row('c', '別の話', 30)]
        state = {**seed(rows), 'people_status': 'completed', 'person_statistics': {'people': [{'id': 'p1', 'name': '佐久間'}], 'assignments': {'a': {'p1': {}}, 'b': {'p1': {}}}}, 'jev': {'version': 'sentiment-v2', 'rows': [{'comment_id': 'c', 'tone': 'negative'}, {'comment_id': 'a', 'tone': 'positive'}]}}
        result = insights.build(state)
        person = result['visible']['people'][0]
        self.assertAlmostEqual(person['all_rate'], 2 / 3); self.assertEqual(person['top_count'], 2); self.assertAlmostEqual(person['like_share'], 10 / 40)
        critical = next(g for g in result['notable'] if g['id'] == 'critical')
        self.assertEqual([i['comment_id'] for i in critical['items']], ['c'])

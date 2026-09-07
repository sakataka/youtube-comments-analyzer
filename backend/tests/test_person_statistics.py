import unittest
from backend.app.person_statistics import clean_dictionary, compute_statistics, validate_dictionary
from backend.tests.test_opinions import comment
from backend.tests import test_lightweight as fixtures
FakeSummary=fixtures.FakeSummary

class RulesTests(unittest.TestCase):
    def stats(self,texts,people=None):
        dictionary=clean_dictionary(people or [{'name':'佐久間宣行','aliases':['佐久間','佐久間P']},{'name':'森本晋太郎','aliases':['森本']}])
        return compute_statistics([comment(str(i),text) for i,text in enumerate(texts)],dictionary)
    def test_mentions_and_denominators(self):
        result=self.stats(['佐久間さん最高！佐久間P好き','森本さんが好き','あの子は最高','佐久間と森本'])
        counts={p['name']:p for p in result['people']}
        self.assertEqual(counts['佐久間宣行']['count'],2)
        self.assertEqual(counts['佐久間宣行']['rate'],.5)
        self.assertEqual(counts['佐久間宣行']['stances'],{'positive':1,'negative':0,'mixed':0,'unclear':1})
        self.assertEqual(result['unmatched_comments'],1)
        for p in result['people']:self.assertEqual(sum(p['stances'].values()),p['count'])
    def test_target_negation_quotes_and_mixed(self):
        result=self.stats(['佐久間は好きだけど企画は嫌い','佐久間は好きじゃない','佐久間は「最高」って言ってる','佐久間は最高？','佐久間さん最高。佐久間さんは苦手。','佐久間さんの企画はつまらない','森本は好き、佐久間は嫌い','佐久間さん嫌いじゃない'])
        pid=next(p['id'] for p in result['people'] if p['name']=='佐久間宣行')
        self.assertEqual([result['assignments'][str(i)][pid]['label'] for i in range(8)],['positive','unclear','unclear','unclear','mixed','unclear','unclear','unclear'])
    def test_conflicting_alias_and_latin_boundary(self):
        result=self.stats(['MarkとRemarkとM','共有が好き','森本晋太郎が好き'],[{'name':'Mark','aliases':['共有']},{'name':'森本晋太郎','aliases':['共有','森本']}])
        self.assertEqual(result['unmatched_comments'],1)
        self.assertTrue(result['warnings'])
        mark=next(p for p in result['people'] if p['name']=='Mark');self.assertEqual(mark['count'],1)
        self.assertEqual(self.stats(['Remark'],[{'name':'Mark','aliases':[]}])['matched_comments'],0)
    def test_alias_validation(self):
        with self.assertRaises(ValueError):validate_dictionary({'people':[{'name':'本名','aliases':[{'text':'愛称','evidence_id':'a','quote':'愛称'}]}]},{'a':'愛称'})
        with self.assertRaises(ValueError):validate_dictionary({'people':[{'name':'森本','aliases':[{'text':'森本','evidence_id':'a','quote':'森本さん'}]}]},{'a':'森本'})
    def test_name_is_not_sentiment(self):
        result=self.stats(['優しい太郎さん'],[{'name':'優しい太郎','aliases':[]}])
        self.assertEqual(result['people'][0]['stances']['unclear'],1)

class PeopleIntegrationTests(unittest.TestCase):
    setUp=fixtures.LightweightTests.setUp
    tearDown=fixtures.LightweightTests.tearDown
    create=fixtures.LightweightTests.create
    run_job=fixtures.LightweightTests.run_job
    def test_manual_edit_recounts_without_ai_or_summary_changes(self):
        id=self.create(4);self.run_job(id);before=self.store.get(id)
        report=self.store.update_people(id,[{'name':'感想','aliases':[]}])
        self.assertEqual(report['person_statistics']['people'][0]['count'],4)
        self.assertEqual(self.store.get(id)['topics'],before['topics'])
        self.assertEqual(self.store.get(id)['usage']['calls'],before['usage']['calls'])
        pid=report['person_statistics']['people'][0]['id']
        self.assertEqual(self.store.comments_page(id,None,None,0,30,person_id=pid,stance='unclear')['total'],4)
        client=FakeSummary();self.run_job(id,client);self.assertEqual(client.calls,0)
    def test_people_failure_keeps_summary(self):
        class FailedPeople(FakeSummary):
            def ask(self,prompt):
                if 'sample_comments' not in prompt:self.calls+=1;raise ValueError('invalid dictionary')
                return super().ask(prompt)
        client=FailedPeople();id=self.create();r=self.run_job(id,client)
        self.assertEqual(client.calls,3)
        self.assertEqual(r['summary_status'],'completed')
        self.assertEqual(r['person_statistics']['status'],'failed')
        self.assertTrue(r['topics'])
    def test_people_only_keeps_summary_and_is_bounded(self):
        id=self.create();self.run_job(id);before=self.store.get(id)
        self.store.queue(id,'people');client=FakeSummary();self.store.process(id,None,lambda *_:None,client=client)
        self.assertEqual(client.calls,0)
        self.assertEqual(self.store.get(id)['topics'],before['topics'])
    def test_people_only_stop_does_not_clear_summary(self):
        id=self.create();self.run_job(id);before=self.store.get(id)
        self.store.queue(id,'people');self.store.stop(id)
        self.store.process(id,None,lambda *_:None,client=FakeSummary())
        after=self.store.get(id)
        self.assertEqual(after['topics'],before['topics'])
        self.assertEqual(after['summary_status'],'completed')
        self.assertEqual(after['people_status'],'stopped')

class RegressionRulesTests(unittest.TestCase):
    stats=RulesTests.stats
    def test_intensity_is_not_positive_and_inflections_work(self):
        result=self.stats(['佐久間さんは上から目線がすごい','森本さんが面白かった','佐久間さんはかっこいいと思ってる','森本さんのチャンネルはつまらん'])
        self.assertEqual([next(iter(result['assignments'][str(i)].values()))['label'] for i in range(4)],['unclear','positive','positive','unclear'])

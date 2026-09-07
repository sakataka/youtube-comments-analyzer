import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch
from backend.app.lightweight import LightweightStore, make_prompt, select_comments
from backend.app.codex_client import wait_for_turn_text
from backend.tests.test_opinions import comment, seed, URL


class FakeSummary:
    def __init__(self, invalid=False): self.calls=0; self.invalid=invalid
    def ask(self,prompt):
        self.calls+=1
        row=json.loads(prompt.split('\ninput:\n')[1])['sample_comments'][0]
        return json.dumps({'topics':[{'title':'反応','description':'投稿の反応','reactions':'感想が述べられています。','evidence':[{'comment_id':row['comment_id'],'quote':'架空の引用' if self.invalid else row['text'][:100]}]}]},ensure_ascii=False)

class LightweightTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.store=LightweightStore(Path(self.tmp.name)/'test.sqlite3')
    def tearDown(self): self.store.conn.close(); self.tmp.cleanup()
    def create(self,n=300):
        return self.store.create(URL,{'max_comments':5000,'reply_fetch_mode':'full'},seed([comment(str(i),'感想です'+str(i)) for i in range(n)]))
    def run_job(self,id,client=None):
        self.store.queue(id,'resume');self.store.process(id,None,lambda *_:None,client=client or FakeSummary())
        return self.store.report(id)
    def test_bounded_summary_and_cache(self):
        id=self.create();client=FakeSummary();report=self.run_job(id,client)
        self.assertEqual(report['schema_version'],'report.v4');self.assertEqual(report['status'],'completed')
        self.assertEqual(report['sample']['sent_count'],250);self.assertEqual(client.calls,1)
        self.assertNotIn('analysis',report);self.assertEqual(report['coverage']['fetched'],300)
        self.run_job(id,client);self.assertEqual(client.calls,1)
        self.assertEqual(self.store.comments_page(id,None,None,0,30)['total'],300)
    def test_invalid_evidence_retries_once_raw_still_available(self):
        id=self.create();client=FakeSummary(True);r=self.run_job(id,client)
        self.assertEqual(client.calls,2);self.assertEqual(r['summary_status'],'failed');self.assertEqual(r['topics'],[])
        self.assertEqual(self.store.comments_page(id,None,None,0,30)['total'],300)
    def test_sample_reproducible_and_char_limit(self):
        id=self.create(1000);state=self.store.get(id)
        for row in state['comments']:row['text_original']='長文'*3000
        a=select_comments(state);b=select_comments(state)
        self.assertEqual(a,b);self.assertEqual(len({r['comment_id'] for r,_ in a[1]}),250)
        prompt=make_prompt(state)
        self.assertLess(len(prompt),60000);self.assertLess(state['sample']['sent_count'],250)
        self.assertGreater(state['sample']['truncated_count'],0)
    def test_expired_queue_makes_no_ai_calls(self):
        id=self.create();self.store.queue(id,'resume');s=self.store.get(id);s['queued_at']='2020-01-01T00:00:00+00:00';self.store.save(s)
        client=FakeSummary();self.store.process(id,None,lambda *_:None,client=client)
        self.assertEqual(client.calls,0);self.assertEqual(self.store.report(id)['summary_status'],'timed_out')
    def test_stop_before_ai(self):
        id=self.create();self.store.queue(id,'resume');self.store.stop(id);client=FakeSummary()
        self.store.process(id,None,lambda *_:None,client=client)
        self.assertEqual(client.calls,0);self.assertEqual(self.store.report(id)['summary_status'],'stopped')
    def test_legacy_cannot_resume(self):
        id=self.create();s=self.store.get(id);s.pop('schema_version');self.store.save(s)
        with self.assertRaises(ValueError):self.store.queue(id,'resume')
        self.assertEqual(self.store.report(id)['schema_version'],'report.v3')
    def test_final_response_not_commentary_or_delta(self):
        events=[{'method':'item/completed','params':{'item':{'type':'agentMessage','phase':'commentary','text':'処理します'}}},{'method':'item/agentMessage/delta','params':{'delta':'{'}},{'method':'item/completed','params':{'item':{'type':'agentMessage','phase':'final_answer','text':'{"topics":[]}'}}},{'method':'turn/completed','params':{'turn':{'status':'completed'}}}]
        with patch('backend.app.codex_client.read_json_line',side_effect=events):
            self.assertEqual(wait_for_turn_text(None,time.monotonic()+10,[]),'{"topics":[]}')
    def test_queue_prevents_unbounded_wait(self):
        first=self.create();second=self.create()
        self.store.queue(first,'resume')
        with self.assertRaises(ValueError):self.store.queue(second,'resume')
    def test_restart_marks_summary_stopped(self):
        id=self.create();self.store.queue(id,'resume')
        reopened=LightweightStore(Path(self.tmp.name)/'test.sqlite3')
        try:self.assertEqual(reopened.report(id)['summary_status'],'stopped')
        finally:reopened.conn.close()
    def test_stop_while_waiting_for_transport(self):
        import subprocess, sys, threading
        from backend.app.codex_client import read_json_line
        process=subprocess.Popen([sys.executable,'-c','import time;time.sleep(5)'],stdout=subprocess.PIPE,text=True)
        stopped=threading.Event();process._cancelled=stopped.is_set
        threading.Timer(.05,stopped.set).start()
        start=time.monotonic()
        try:
            with self.assertRaises(InterruptedError):read_json_line(process,start+3,[])
            self.assertLess(time.monotonic()-start,1)
        finally:process.kill();process.wait();process.stdout.close()
    def test_failed_turn_not_accepted(self):
        with patch('backend.app.codex_client.read_json_line',return_value={'method':'turn/completed','params':{'turn':{'status':'failed'}}}):
            with self.assertRaises(RuntimeError):wait_for_turn_text(None,time.monotonic()+1,[])
    def test_clone_reuses_summary_without_ai(self):
        id=self.create();self.run_job(id)
        original=self.store.get(id)
        new=self.store.create(URL,original['config'],original)
        client=FakeSummary();self.run_job(new,client)
        self.assertEqual(client.calls,0)
        self.assertEqual(self.store.get(id),original)
    def test_empty_transport_final_retried_once(self):
        class Empty:
            def __init__(self):self.calls=0
            def ask(self,prompt):self.calls+=1;raise ValueError('最終回答が空です')
        client=Empty();r=self.run_job(self.create(),client)
        self.assertEqual(client.calls,2);self.assertEqual(r['summary_status'],'failed')

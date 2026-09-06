"""Deterministic transport fake for contract/E2E tests, never a quality benchmark."""
import json


class FakeOpinionClient:
    def __init__(self):
        self.calls = 0
        self.prompts = []

    def ask(self, prompt):
        self.calls += 1
        self.prompts.append(prompt)
        payload = json.loads(prompt.split('\ninput:\n', 1)[1])
        if isinstance(payload, dict) and 'comments' in payload:
            comments = []
            for part in payload['comments']:
                text = part['text']
                stance = 'negative' if '苦手' in text or 'つまら' in text else 'positive'
                comments.append({'part_id': part['part_id'], 'outcome': 'analyzed', 'observations': [{'target': '動画', 'target_type': 'video', 'topic': '感想', 'opinion': '楽しめた' if stance == 'positive' else '楽しめなかった', 'reason': '', 'stance': stance, 'emotions': ['joy'] if stance == 'positive' else ['disappointment'], 'quote': text, 'subtitle_ids': []}]})
            return json.dumps({'comments': comments}, ensure_ascii=False)
        if isinstance(payload, dict) and 'targets' in payload:
            return json.dumps({'mappings': [{'source': item['source'], 'target': item['source'], 'evidence_comment_ids': []} for item in payload['targets']]})
        if isinstance(payload, dict) and 'group' in payload:
            return json.dumps({'supported': True, 'reason': 'test fixture'})
        if isinstance(payload, list) and payload and 'start' in payload[0]:
            return json.dumps({'notes': [{'text': '字幕の内容', 'segment_ids': [row['id'] for row in payload]}]})
        groups = {}
        for item in payload:
            key = (item['target'], item['topic'], item['stance'], item['label'])
            group = groups.setdefault(key, {k: item[k] for k in ('target', 'target_type', 'topic', 'stance', 'label', 'reason')})
            group.setdefault('member_ids', []).append(item['id'])
        return json.dumps({'groups': list(groups.values())}, ensure_ascii=False)

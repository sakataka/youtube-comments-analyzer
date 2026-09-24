"""Full-population sentiment and emotion with local Japanese BERT models (no AI tokens)."""
import hashlib
import os
import re
import threading
import time

from .opinion_service import restore_previous
from . import person_statistics as people_rules

VERSION = 'local-v2'
# WRIME-trained polarity regression (-2..2). A Twitter 3-class model read comedic praise as negative.
SENTIMENT_MODEL = ('neuralnaut/deberta-wrime-sentiment', '5ae7bd0fe7081c398c6f3fe07badc791b0a86186')
EMOTION_MODEL = ('patrickramos/bert-base-japanese-v2-wrime-fine-tune', '1f391822d6a11ccaacfff11f89935c387ffe7197')
EMOTIONS = ('joy', 'sadness', 'anticipation', 'surprise', 'anger', 'fear', 'disgust', 'trust')
POSITIVE, NEGATIVE = 0.15, -0.15  # polarity band between them is neutral
WEAK = 0.3  # questions such as guest guesses (「ノブ？」) score weakly negative
QUESTION = re.compile(r'[?？]|(?:か|かな|かも)[。！!…\s]*$')
EMOTION_MIN = 1.0  # WRIME intensity 0-3; 1 = weak but present
MAX_LENGTH, BATCH = 256, 32
SENTENCE = re.compile(r'[^。！!？?\n]+[。！!？?\n]?')
_models, _lock = {}, threading.Lock()


def enabled(): return os.getenv('LOCAL_MODELS', 'on') != 'off'


def key(text): return hashlib.sha256(f'{VERSION}\0{text}'.encode()).hexdigest()[:20]


def load():
    with _lock:
        if not _models:
            import torch
            from transformers import AutoModelForSequenceClassification, AutoTokenizer
            device = 'mps' if torch.backends.mps.is_available() else 'cpu'
            for name, (model_id, revision) in {'sentiment': SENTIMENT_MODEL, 'emotion': EMOTION_MODEL}.items():
                _models[name] = (AutoTokenizer.from_pretrained(model_id, revision=revision), AutoModelForSequenceClassification.from_pretrained(model_id, revision=revision).to(device).eval())
            _models['device'] = device
        return _models


def infer(texts, stopped=lambda: False):
    """Returns [polarity, 8 writer-emotion intensities] per text."""
    import torch
    models = load()
    output = []
    for start in range(0, len(texts), BATCH):
        if stopped(): raise InterruptedError('停止して保存しました。')
        batch = texts[start:start + BATCH]
        logits = {}
        for name in ('sentiment', 'emotion'):
            tokenizer, model = models[name]
            encoded = tokenizer(batch, padding=True, truncation=True, max_length=MAX_LENGTH, return_tensors='pt').to(models['device'])
            with torch.no_grad(): logits[name] = model(**encoded).logits.float().cpu().tolist()
        for s, e in zip(logits['sentiment'], logits['emotion']):
            output.append([round(s[0], 3), [round(v, 2) for v in e[:8]]])
    return output


def label(result, text=''):
    polarity = result[0]
    if abs(polarity) < WEAK and QUESTION.search(text.strip()): return 'neutral'
    return 'positive' if polarity >= POSITIVE else 'negative' if polarity <= NEGATIVE else 'neutral'


def emotion(result):
    values = result[1]
    best = max(range(8), key=lambda i: values[i])
    return EMOTIONS[best] if values[best] >= EMOTION_MIN else None


def person_label(results, texts):
    """Sentences about one person: opposite labels are mixed, never averaged to neutral."""
    labels = {label(r, t) for r, t in zip(results, texts)}
    if {'positive', 'negative'} <= labels: return 'mixed'
    for value in ('positive', 'negative', 'neutral'):
        if value in labels: return value
    return 'unclear'


def person_sentences(text, person_id, people):
    return [s.strip() for s in SENTENCE.findall(people_rules.normalize(text)) if s.strip() and person_id in {m[2] for m in people_rules.mentions(s, people)}]


def compute(state, stopped=lambda: False):
    cache = state.setdefault('local_cache', {})
    comments = state['comments']
    people = (state.get('people_dictionary') or {}).get('people', []) if state.get('people_status') == 'completed' else []
    assignments = state.get('person_statistics', {}).get('assignments', {}) if people else {}
    units = {}
    for row in comments:
        units[key(row['text_original'])] = row['text_original']
        for pid in assignments.get(row['comment_id'], {}):
            for sentence in person_sentences(row['text_original'], pid, people): units[key(sentence)] = sentence
    missing = [k for k in units if k not in cache]
    for k, result in zip(missing, infer([units[k] for k in missing], stopped)): cache[k] = result
    rows, person_rows = {}, {}
    person_counts = {p['id']: {v: 0 for v in ('positive', 'neutral', 'negative', 'mixed', 'unclear')} for p in people}
    for row in comments:
        result = cache[key(row['text_original'])]
        rows[row['comment_id']] = [label(result, row['text_original']), result[0], emotion(result)]
        for pid in assignments.get(row['comment_id'], {}):
            sentences = person_sentences(row['text_original'], pid, people)
            value = person_label([cache[key(s)] for s in sentences], sentences) if sentences else 'unclear'
            person_rows.setdefault(row['comment_id'], {})[pid] = value
            person_counts[pid][value] += 1
    # Keep only results that are still referenced by this run's text.
    state['local_cache'] = {k: cache[k] for k in units}
    return {'rows': rows, 'person_rows': person_rows, 'people': person_counts, 'inferred': len(missing), 'units': len(units)}


def process(store, run_id):
    state = store.get(run_id)
    previous = restore_previous(state)
    result = state.setdefault('local', {})
    result.update(status='running', error=None, version=VERSION, models={'sentiment': SENTIMENT_MODEL[0], 'emotion': EMOTION_MODEL[0]})
    state.update(status='running', stage='local')
    store.save(state)
    started = time.monotonic()
    try:
        if not enabled(): raise ValueError('LOCAL_MODELS=off のためローカル分析は無効です。')
        result.update(compute(state, lambda: store.stopped(run_id)), status='completed', dictionary=digest_people(state))
    except InterruptedError as exc:
        result.update(status='stopped', error=str(exc))
    except ImportError:
        result.update(status='failed', error='torch・transformersが未導入です。backend/requirements.txtをインストールしてください。')
    except Exception as exc:
        result.update(status='failed', error=f'ローカル分析に失敗しました：{str(exc)[:300]}')
    finally:
        result['elapsed_seconds'] = round(time.monotonic() - started, 1)
        state.update(status=previous[0], stage=previous[1], error_message=previous[2])
        store.save(state)


def digest_people(state):
    return hashlib.sha256(repr((state.get('people_dictionary') or {}).get('people', [])).encode()).hexdigest()[:16]


def report(state):
    result = state.get('local', {'status': 'not_started'})
    output = {k: v for k, v in result.items() if k not in ('rows', 'person_rows')}
    output['enabled'] = enabled()
    rows = result.get('rows', {})
    if result.get('status') == 'completed':
        output['sentiments'] = {v: 0 for v in ('positive', 'neutral', 'negative')}
        output['emotions'] = {v: 0 for v in (*EMOTIONS, 'none')}
        for sentiment, _, feeling in rows.values():
            output['sentiments'][sentiment] += 1; output['emotions'][feeling or 'none'] += 1
        output['denominator'] = len(rows)
        output['stale'] = len(rows) != len(state['comments']) or result.get('dictionary') != digest_people(state)
    return output

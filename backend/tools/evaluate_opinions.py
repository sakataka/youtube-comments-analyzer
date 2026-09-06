"""Prepare a human review packet; score only explicitly human-reviewed holdout data."""
from __future__ import annotations

import argparse
import json
import random
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.app.opinion_analysis import LABELS


def prepare(cache: Path, output: Path) -> dict:
    videos, records = [], []
    for index, metadata_path in enumerate(sorted(cache.glob('*/*.metadata.json'))[:6]):
        path = metadata_path.with_suffix('').with_suffix('.jsonl')
        rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
        video = json.loads(metadata_path.read_text())
        video_id = metadata_path.parent.name
        by_id = {row['comment_id']: row for row in rows}
        rng = random.Random('comments-quality-' + video_id)
        shuffled = rows.copy(); rng.shuffle(shuffled)
        candidates = sorted(rows, key=lambda row: -(row.get('like_count') or 0))[:10]
        candidates += [row for row in shuffled if row.get('is_reply')][:15]
        candidates += [row for row in shuffled if (row.get('like_count') or 0) <= 1][:15]
        candidates += shuffled
        chosen = list({row['comment_id']: row for row in candidates}.values())[:60]
        videos.append({'video_id': video_id, 'title': video.get('title'), 'split': 'calibration' if index % 2 == 0 else 'holdout', 'genre': None, 'reviewed_by': None, 'major_opinions': [], 'report_checks': {'unsupported_claims': None, 'minority_as_majority': None, 'opposite_stances_merged': None, 'subtitle_opinions_leaked': None}, 'notes': ''})
        for row in chosen:
            parent = by_id.get(row.get('parent_comment_id'))
            records.append({'video_id': video_id, 'comment_id': row['comment_id'], 'text': row['text_original'], 'parent_text': parent['text_original'] if parent else None, 'is_reply': bool(row.get('is_reply')), 'like_count': row.get('like_count'), 'reviewed_by': None, 'gold': None})
    packet = {'schema': 'opinion_evaluation', 'status': 'awaiting_human_review', 'instructions': 'genreとreviewed_byを人が記入。goldは[{target, stance}]。意見も対象もない場合は[]。AI出力を無確認でgoldにしない。major_opinionsは人手で主要意見と対応するpredicted_group_idsを記入。report_checksには各誤りの実数を記入。', 'videos': videos, 'records': records}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(packet, ensure_ascii=False, indent=2))
    return {'output': str(output), 'videos': len(videos), 'comments': len(records), 'status': packet['status']}


def combined(labels):
    values = set(labels)
    if len(values) == 1: return next(iter(values))
    if {'positive', 'negative'} <= values or 'mixed' in values: return 'mixed'
    if 'unclear' in values: return 'unclear'
    return next((label for label in ('positive', 'negative') if label in values), 'neutral')


def score(packet: dict, predictions: list[dict]) -> dict:
    videos = {video['video_id']: video for video in packet['videos']}
    blockers = []
    if len(videos) < 6: blockers.append('6動画未満')
    if len(videos) != len(packet['videos']): blockers.append('同一動画の重複')
    if len({v['genre'] for v in videos.values() if v.get('genre')}) < 3: blockers.append('評価ジャンルが3種類未満')
    if not all(v.get('reviewed_by') for v in videos.values()): blockers.append('動画単位の人手確認が未完了')
    if {v['split'] for v in videos.values()} != {'calibration', 'holdout'}: blockers.append('動画単位の調整用・未使用評価用分割が必要')
    if len({(r['video_id'], r['comment_id']) for r in packet['records']}) != len(packet['records']): blockers.append('正解データのコメントID重複')
    reviewed = [row for row in packet['records'] if row.get('reviewed_by') and isinstance(row.get('gold'), list)]
    if len(reviewed) < 300: blockers.append(f'人手確認済みコメントが{len(reviewed)}件（300件必要）')
    prediction_map = {(p['video_id'], p['comment_id']): p for p in predictions}
    if len(prediction_map) != len(predictions): blockers.append('予測ID重複')
    tp = fp = fn = held = matched = 0
    matrix = {gold: {pred: 0 for pred in LABELS} for gold in LABELS}
    for row in reviewed:
        if row['video_id'] not in videos: blockers.append('未登録動画の正解データ'); continue
        if videos[row['video_id']]['split'] != 'holdout': continue
        prediction = prediction_map.get((row['video_id'], row['comment_id']))
        if prediction is None: blockers.append('未使用評価用コメントの予測欠落'); continue
        gold_targets, pred_targets = {}, {}
        for obs in row['gold']:
            gold_targets.setdefault(obs['target'], []).append(obs['stance'])
        for obs in prediction['observations']:
            pred_targets.setdefault(obs['target'], []).append(obs['stance'])
        tp += len(gold_targets.keys() & pred_targets.keys()); fp += len(pred_targets.keys() - gold_targets.keys()); fn += len(gold_targets.keys() - pred_targets.keys())
        for target in gold_targets:
            gold = combined(gold_targets[target]); pred = combined(pred_targets.get(target, ['unclear']))
            matrix[gold][pred] += 1; held += pred == 'unclear'; matched += 1
    f1s = []
    for label in LABELS:
        correct = matrix[label][label]
        denominator = sum(matrix[label].values()) + sum(row[label] for row in matrix.values())
        f1s.append(2 * correct / denominator if denominator else 0)
        if not sum(matrix[label].values()): blockers.append(f'holdout正解に{label}がない')
    for video in videos.values():
        if not video.get('major_opinions') or any(not opinion.get('predicted_group_ids') for opinion in video.get('major_opinions', [])):
            blockers.append('主要意見の対応確認が未完了または取りこぼしあり')
        if any(value is None or value != 0 for value in video.get('report_checks', {}).values()) or len(video.get('report_checks', {})) != 4:
            blockers.append('レポートの根拠・少数意見・誤統合・字幕混入の確認が未完了または誤りあり')
    precision, recall, f1 = tp / max(1, tp + fp), tp / max(1, tp + fn), sum(f1s) / 5
    passed = not blockers and precision >= .9 and recall >= .85 and f1 >= .8
    return {'passed': passed, 'blockers': sorted(set(blockers)), 'target_precision': precision, 'target_recall': recall, 'sentiment_macro_f1': f1, 'held_rate': held / max(1, matched), 'confusion_matrix': matrix, 'human_reviewed_comments': len(reviewed)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest='command', required=True)
    prep = sub.add_parser('prepare'); prep.add_argument('--cache', type=Path, default=Path('data/youtube_cache')); prep.add_argument('--output', type=Path, default=Path('data/quality/review-packet.json'))
    evaluate = sub.add_parser('score'); evaluate.add_argument('packet', type=Path); evaluate.add_argument('predictions', type=Path)
    args = parser.parse_args()
    if args.command == 'prepare':
        print(json.dumps(prepare(args.cache, args.output), ensure_ascii=False))
    else:
        result = score(json.loads(args.packet.read_text()), [json.loads(line) for line in args.predictions.read_text().splitlines() if line.strip()])
        print(json.dumps(result, ensure_ascii=False, indent=2))
        raise SystemExit(0 if result['passed'] else 1)

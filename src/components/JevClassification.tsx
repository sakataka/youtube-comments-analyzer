import { useState } from 'react';
import type { JevReport } from '../types';
import { Button } from './ui/button';

const kinds: Record<string, string> = { question: '質問', request: '改善・要望', reaction: '感想・評価', information: '情報・補足', other: 'その他', held: '判定保留' };
const tones: Record<string, string> = { positive: '肯定的', negative: '否定的', mixed: '混在', unclear: '判定できず・中立' };
const statuses: Record<string, string> = { running: '分類中', completed: '完了', failed: '失敗', stopped: '停止済み', timed_out: '時間上限に到達', not_started: '未実行' };
export function JevClassification({ result, running, working, action }: { result?: JevReport; running: boolean; working: boolean; action: (path: string, body?: unknown) => Promise<boolean | undefined> }) {
  const [kind, setKind] = useState('');
  const [tone, setTone] = useState('');
  const rows = result?.rows ?? [];
  const filtered = rows.filter(row => (!kind || row.kind === kind) && (!tone || row.tone === tone));
  return <section className="opinion-section" aria-label="Jevコメント分類">
    <div className="opinion-section-heading"><span>JEV / CLASSIFICATION</span><h2>コメントを種類で読む</h2></div>
    <p>最大100件を固定抽出してJevで分類します。本文・返信先の文脈・動画タイトルをTypeSafeへ送信し、Jevの利用枠を消費します。投稿者名・IDは送信しません。</p>
    {!result?.configured ? <p>TYPESAFE_API_KEYが未設定です。アプリの.envに設定すると利用できます。</p> : null}
    <div className="opinion-actions"><Button disabled={working || running || !result?.configured} onClick={() => void action('actions', { action: 'jev' })}>Jevで分類する（最大100件）</Button></div>
    <p role="status">{statuses[result?.status ?? 'not_started']} · {rows.length} / {result?.total ?? 0}件</p>
    {result?.error ? <p role="alert">{result.error}</p> : null}
    {result?.usage ? <p>累計API呼び出し {result.usage.calls}回 · 入力 {result.usage.input_tokens} / 出力 {result.usage.output_tokens}トークン · 今回の再利用 {result.cache_hits ?? 0}件</p> : null}
    <p className="opinion-note">分類済みの範囲だけを表示します。コメント欄全体の賛否率や人物別評価ではありません。確信が低い判定は保留します。長文は本文2,000文字・返信先1,000文字までを使用します。</p>
    {rows.length > 0 ? <><div className="opinion-actions">
      <label>種類 <select aria-label="Jevの種類" value={kind} onChange={e => setKind(e.target.value)}><option value="">すべて</option>{Object.entries(kinds).map(([id, label]) => <option key={id} value={id}>{label}（{rows.filter(row => row.kind === id).length}）</option>)}</select></label>
      <label>論調 <select aria-label="Jevの論調" value={tone} onChange={e => setTone(e.target.value)}><option value="">すべて</option>{Object.entries(tones).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    </div><p>{filtered.length}件を表示</p><div className="opinion-evidence-list">{filtered.map(row => <article className="opinion-evidence-row" key={row.comment_id}><p>{kinds[row.kind]} · {tones[row.tone]}{row.truncated ? ' · 長文を省略して判定' : ''}</p><p className="opinion-original">{row.text}</p><a href={row.url} target="_blank" rel="noreferrer">分類した原文をYouTubeで開く ↗</a></article>)}</div></> : null}
  </section>;
}

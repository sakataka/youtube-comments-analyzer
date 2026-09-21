import { useState } from 'react';
import type { JevReport } from '../types';
import { Button } from './ui/button';

const kinds: Record<string, string> = { question: '質問', request: '改善・要望', reaction: '感想・評価', information: '情報・補足', other: 'その他', held: '判定保留' };
const tones: Record<string, string> = { very_positive: 'とてもポジティブ', positive: 'ややポジティブ', neutral: 'ニュートラル', negative: 'ややネガティブ', very_negative: 'とてもネガティブ', mixed: '賛否が混在', unclear: '判定困難' };
const statuses: Record<string, string> = { running: '分類中', completed: '完了', failed: '失敗', stopped: '停止済み', timed_out: '時間上限に到達', not_started: '未実行' };
export function JevClassification({ result, running, working, action }: { result?: JevReport; running: boolean; working: boolean; action: (path: string, body?: unknown) => Promise<boolean | undefined> }) {
  const [kind, setKind] = useState('');
  const [tone, setTone] = useState('');
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(20);
  const legacy = Boolean(result?.rows.length && result.version !== 'sentiment-v2');
  function selectTone(value: string) { setTone(value); setVisibleCount(20); }
  const rows = result?.rows ?? [];
  const filtered = rows.filter(row => (!kind || row.kind === kind) && (!tone || row.tone === tone) && row.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <section id="report-jev" className="opinion-section" aria-label="Jevコメント分類">
    <div className="opinion-section-heading"><span>JEV / CLASSIFICATION</span><h2 tabIndex={-1}>YouTubeコメント分類器</h2></div>
    <p>取得済みコメントのいいね上位500件を、最大10並列でJev分類します（最大5分）。本文・返信先の文脈・動画タイトルをTypeSafeへ送信し、Jevの利用枠を消費します。投稿者名・IDは送信しません。</p>
    {!result?.configured ? <p>TYPESAFE_API_KEYが未設定です。アプリの.envに設定すると利用できます。</p> : null}
    <div className="opinion-actions"><Button disabled={working || running || !result?.configured} onClick={() => void action('actions', { action: 'jev' })}>Jevで分類する（最大500件）</Button></div>
    {rows.length > 0 ? <p>{result?.selection === 'likes_desc' ? '対象：取得済みコメントのいいね上位500件まで' : '対象：以前の固定抽出コメント'}</p> : null}
    <p role="status">{statuses[result?.status ?? 'not_started']} · {rows.length} / {result?.total ?? 0}件</p>
    {result?.error ? <p role="alert">{result.error}</p> : null}
    {result?.usage ? <p>累計API呼び出し {result.usage.calls}回 · 入力 {result.usage.input_tokens} / 出力 {result.usage.output_tokens}トークン · 今回の再利用 {result.cache_hits ?? 0}件</p> : null}
    <p className="opinion-note">分類済みの範囲だけを表示します。コメント欄全体の賛否率や人物別評価ではありません。評価の確信が低いものは「暫定」と表示します。長文は本文2,000文字・返信先1,000文字までを使用します。</p>
    {legacy ? <p>以前の分類結果です。5段階で見るには「Jevで分類する」を実行してください。旧「肯定・否定」は強さ未判定、旧「判定できず・中立」は未分離です。</p> : null}
    {rows.length > 0 && !legacy ? <div className="jev-distribution" aria-label="コメントの評価分布">
      <p>分類した{rows.length}件の内訳（取得コメント全体の割合ではありません）</p>
      <div className="jev-bars">{Object.entries(tones).map(([id, label]) => {
        const count = rows.filter(row => row.tone === id).length;
        return <button type="button" key={id} className={`jev-bar jev-${id}`} aria-pressed={tone === id} onClick={() => selectTone(tone === id ? '' : id)}>
          <span>{label}</span><span className="jev-track"><span style={{ width: `${count / rows.length * 100}%` }} /></span><strong>{count}件 · {Math.round(count / rows.length * 100)}%</strong>
        </button>;
      })}</div>
    </div> : null}
    {rows.length > 0 ? <><div className="opinion-actions">
      <label>種類 <select aria-label="Jevの種類" value={kind} onChange={e => { setKind(e.target.value); setVisibleCount(20); }}><option value="">すべて</option>{Object.entries(kinds).map(([id, label]) => <option key={id} value={id}>{label}（{rows.filter(row => row.kind === id).length}）</option>)}</select></label>
      <label>論調 <select aria-label="Jevの論調" value={tone} onChange={e => selectTone(e.target.value)}><option value="">すべて</option>{Object.entries(tones).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <label>本文検索 <input aria-label="分類したコメントを検索" value={search} onChange={e => { setSearch(e.target.value); setVisibleCount(20); }} /></label>
      {tone || kind || search ? <Button variant="outline" onClick={() => { setTone(''); setKind(''); setSearch(''); setVisibleCount(20); }}>分類の絞り込みを解除</Button> : null}
    </div><p role="status">{filtered.length}件中 {Math.min(visibleCount, filtered.length)}件を表示</p><div className="opinion-evidence-list">{filtered.slice(0, visibleCount).map(row => <article className="opinion-evidence-row" key={row.comment_id}><p>{kinds[row.kind]} · {legacy ? ({positive: '肯定的（旧分類）', negative: '否定的（旧分類）', mixed: '賛否が混在', unclear: '中立・判定不明（旧分類）'}[row.tone] ?? row.tone) : tones[row.tone]}{!legacy && row.tone_confidence < 0.7 ? ' · 暫定' : ''}{row.truncated ? ' · 長文を省略して判定' : ''}</p><p className="opinion-original">{row.text}</p><details><summary>判定の確かさ</summary><p>評価分類の確信度：{Math.round(row.tone_confidence * 100)}%。正答率ではありません。70%未満は暫定候補です。評価の強さとは異なります。</p></details><a href={row.url} target="_blank" rel="noreferrer">分類した原文をYouTubeで開く ↗</a></article>)}</div>{filtered.length > visibleCount ? <Button variant="outline" onClick={() => setVisibleCount(value => value + 20)}>さらに20件表示</Button> : null}</> : null}
  </section>;
}

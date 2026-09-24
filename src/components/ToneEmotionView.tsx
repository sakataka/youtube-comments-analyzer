import { formatNumber } from '../api';
import type { LocalReport, XPulse } from '../types';
import { Button } from './ui/button';

export const sentimentLabels: Record<string, string> = { positive: '肯定的', neutral: '中立', negative: '否定的' };
export const modelStanceLabels: Record<string, string> = { positive: '肯定', neutral: '中立', negative: '否定', mixed: '両方', unclear: '判定できず' };
export const emotionLabels: Record<string, string> = { joy: '喜び', anticipation: '期待', surprise: '驚き', trust: '信頼', sadness: '悲しみ', anger: '怒り', fear: '恐れ', disgust: '嫌悪', none: '目立つ感情なし' };
const statuses: Record<string, string> = { not_started: '未実行', running: '判定中', completed: '完了', failed: '失敗', stopped: '停止済み' };
type Action = (path: string, body?: unknown) => Promise<boolean | undefined>;

function Bars({ counts, labels, total, selected, prefix, onSelect }: { counts: Record<string, number>; labels: Record<string, string>; total: number; selected: string; prefix: string; onSelect: (id: string) => void }) {
  return <div className="jev-bars">{Object.entries(labels).filter(([id]) => id in counts).map(([id, label]) => {
    const count = counts[id] ?? 0;
    return <button type="button" key={id} className={`jev-bar ${prefix}-${id}`} aria-pressed={selected === id} disabled={!count} onClick={() => onSelect(id)}>
      <span>{label}</span><span className="jev-track"><span style={{ width: `${total ? count / total * 100 : 0}%` }} /></span><strong>{formatNumber(count)}件 · {total ? Math.round(count / total * 100) : 0}%</strong>
    </button>;
  })}</div>;
}

export function ToneEmotionView({ local, running, working, action, sentiment, emotion, onFilter }: { local?: LocalReport; running: boolean; working: boolean; action: Action; sentiment: string; emotion: string; onFilter: (kind: 'sentiment' | 'emotion', id: string) => void }) {
  const done = local?.status === 'completed' && local.sentiments && local.emotions;
  const total = local?.denominator ?? 0;
  return <section id="report-tone" className="opinion-section" aria-label="全件の賛否と感情">
    <div className="opinion-section-heading"><span>TONE / EMOTION · LOCAL MODEL</span><h2 tabIndex={-1}>全件の賛否と感情</h2></div>
    <p>取得した全件を、このMacで動く日本語の分類モデルで判定します。AIのトークンは使いません。分析のあとに自動で実行します。</p>
    <p role="status">{local?.enabled === false ? 'ローカル分析は無効です（LOCAL_MODELS=off）。' : `${statuses[local?.status ?? 'not_started'] ?? local?.status}${local?.elapsed_seconds != null && local.status !== 'running' ? ` · ${local.elapsed_seconds}秒` : ''}`}</p>
    {local?.error ? <p role="alert">{local.error}</p> : null}
    {local?.stale ? <p className="opinion-note">取得件数か人物辞書が判定後に変わりました。再判定すると最新の状態に合わせます。</p> : null}
    {local?.enabled !== false && (!done || local?.stale || local?.status === 'failed') ? <Button disabled={working || running} onClick={() => void action('actions', { action: 'local' })}>{done ? '全件を再判定する' : '全件を判定する'}</Button> : null}
    {done ? <>
      <h3 className="insight-subheading">賛否（{formatNumber(total)}件すべて）</h3>
      <Bars counts={local.sentiments!} labels={sentimentLabels} total={total} selected={sentiment} prefix="tone" onSelect={id => onFilter('sentiment', id)} />
      <h3 className="insight-subheading">いちばん強い感情</h3>
      <Bars counts={local.emotions!} labels={emotionLabels} total={total} selected={emotion} prefix="emotion" onSelect={id => onFilter('emotion', id)} />
      <p className="opinion-note">棒を押すと該当する原文を表示します。どれも参考値です。お笑いのツッコミや皮肉、「メロい」のような新しい言い回しは誤判定することがあり、否定的に分類された投稿にも褒め言葉が混ざることがあります。賛否は{local.models?.sentiment}、感情は{local.models?.emotion}（いずれもWRIMEで学習、個人利用）で判定し、疑問文で判定の弱いもの（ゲストの予想など）は中立に入れています。「目立つ感情なし」は、どの感情も弱いと判定された投稿です。</p>
    </> : null}
  </section>;
}

export function XPulseView({ pulse, running, working, action }: { pulse?: XPulse; running: boolean; working: boolean; action: Action }) {
  const done = pulse?.status === 'completed';
  return <section id="report-x" className="opinion-section" aria-label="Xでの反応">
    <div className="opinion-section-heading"><span>X / GROK</span><h2 tabIndex={-1}>Xでの反応</h2></div>
    <p>ローカルのGrok CLIでX（旧Twitter）を検索し、この動画への反応を要約します。1つの分析につき自動で1回実行します。投稿の内容は事実として扱わず、件数や割合も推定しません。</p>
    <p role="status">{pulse?.status === 'running' ? 'Xを検索しています（数分かかります）…' : done ? `${pulse.observed_at ? new Date(pulse.observed_at).toLocaleString() : ''}に検索 · ${pulse.elapsed_seconds ?? 0}秒` : !pulse?.enabled ? 'X検索は使えません（Grok CLIが見つからないか、X_SEARCH=offです）。' : pulse.status === 'not_started' ? '未実行' : ''}</p>
    {pulse?.error ? <p role="alert">{pulse.error}</p> : null}
    {pulse?.enabled && pulse.status !== 'running' ? <Button variant={done ? 'outline' : 'default'} disabled={working || running} onClick={() => void action('actions', { action: 'x' })}>{done ? 'Xを検索し直す' : 'Xを検索する'}</Button> : null}
    {done ? <>
      {pulse.summary ? <p className="x-summary">{pulse.summary}</p> : <p className="opinion-empty">この動画に関するXの反応は見つかりませんでした。</p>}
      {pulse.tone ? <p><strong>温度感：</strong>{pulse.tone}</p> : null}
      {pulse.comparison ? <p><strong>YouTubeコメントとの違い：</strong>{pulse.comparison}</p> : null}
      <div className="opinion-grid">{pulse.topics?.map(topic => <article className="opinion-card" key={topic.title}>
        <h3>{topic.title}</h3><p>{topic.summary}</p>
        <ul className="x-posts">{topic.posts.map(post => <li key={post.url}><a href={post.url} target="_blank" rel="noreferrer">{post.author}{post.postedAt ? ` · ${post.postedAt}` : ''} ↗</a><p>{post.gist}</p></li>)}</ul>
      </article>)}</div>
    </> : null}
  </section>;
}

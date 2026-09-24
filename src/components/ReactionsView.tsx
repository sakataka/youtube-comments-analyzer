import { useState } from 'react';
import { formatNumber, formatPercent } from '../api';
import { emotionLabels, sentimentLabels } from '../labels';
import type { Action, Insights, LocalReport, NotableComment } from '../types';
import { Bars, StackBar } from './Charts';
import type { OpenComments } from './CommentBrowser';
import { Button } from './ui/button';

type LocalDone = LocalReport & { sentiments: Record<string, number>; emotions: Record<string, number>; denominator: number };
export function localDone(local?: LocalReport): LocalDone | null {
  return local?.status === 'completed' && local.sentiments && local.emotions ? local as LocalDone : null;
}

/** Status and (re)run control for the local sentiment/emotion models; renders nothing once results are current. */
export function LocalStatus({ local, busy, action }: { local?: LocalReport; busy: boolean; action: Action }) {
  const done = localDone(local);
  if (local?.enabled === false) return <p className="muted">ローカル判定は無効です（LOCAL_MODELS=off）。</p>;
  if (local?.status === 'running') return <p className="muted" role="status">全件の賛否と感情を判定しています…</p>;
  if (done && !local?.stale) return null;
  return <div className="inline-action">
    {local?.error ? <p role="alert">{local.error}</p> : <p className="muted">{done ? '判定後に取得件数か人物辞書が変わりました。' : '全件の賛否と感情はまだ判定していません。'}</p>}
    <Button size="sm" variant="outline" disabled={busy} onClick={() => void action('actions', { action: 'local' })}>{done ? '再判定する' : '全件を判定する'}</Button>
  </div>;
}

export function ReactionsView({ local, insights, busy, action, open }: { local?: LocalReport; insights?: Insights; busy: boolean; action: Action; open: OpenComments }) {
  const done = localDone(local);
  const visible = insights?.visible;
  return <>
    <section className="panel-section" aria-labelledby="tone-title">
      <div className="section-head"><h2 id="tone-title">賛否と感情</h2>{done ? <p>取得した{formatNumber(done.denominator)}件すべてを判定。棒を押すと該当する原文を開きます。</p> : null}</div>
      <LocalStatus local={local} busy={busy} action={action} />
      {done ? <div className="split">
        <div><h3>賛否</h3><Bars tone counts={done.sentiments} labels={sentimentLabels} total={done.denominator} onSelect={id => open({ label: `「${sentimentLabels[id]}」と判定された投稿`, sentiment: id, sort: 'likes' })} /></div>
        <div><h3>いちばん強い感情</h3><Bars counts={done.emotions} labels={emotionLabels} total={done.denominator} onSelect={id => open({ label: `感情が「${emotionLabels[id]}」の投稿`, emotion: id, sort: 'likes' })} /></div>
      </div> : null}
    </section>
    {visible ? <section className="panel-section" aria-labelledby="visible-title">
      <div className="section-head"><h2 id="visible-title">上に見えるコメントと全体のずれ</h2><p>YouTubeで目に入りやすい、いいね上位{visible.top_n}件の親コメントと取得全件の比較です。</p></div>
      <div className="facts">
        <p><b>{formatPercent(visible.top_like_share, 0)}</b><span>上位{visible.top_n}件が集めたいいねの割合</span></p>
        <p><b>{formatNumber(visible.zero_like_parents)}</b><span>いいね0の親コメント（全{formatNumber(visible.parents)}件中）</span></p>
      </div>
      {visible.sentiment ? <div className="stacks">
        <StackBar label="取得全件" shares={visible.sentiment.all} labels={sentimentLabels} />
        <StackBar label={`いいね上位${visible.top_n}件`} shares={visible.sentiment.top} labels={sentimentLabels} />
        <StackBar label="いいねで重み付け" shares={visible.sentiment.likes} labels={sentimentLabels} />
      </div> : null}
    </section> : null}
    {insights?.notable.length ? <NotableComments groups={insights.notable} /> : null}
    <details className="fine-print">
      <summary>判定の注意点</summary>
      <p>賛否は{local?.models?.sentiment ?? 'ローカルの分類モデル'}、感情は{local?.models?.emotion ?? 'ローカルの分類モデル'}による参考値です。ツッコミ・皮肉・新しい言い回しは誤判定しやすく、判定の弱い疑問文は中立に入れています。「いいねで重み付け」はいいねの多い投稿ほど大きく数えた割合です。YouTubeの人気順はいいね数だけで決まらないため、上位{visible?.top_n ?? 20}件は近似です。</p>
    </details>
  </>;
}

function NotableComments({ groups }: { groups: Insights['notable'] }) {
  const [id, setId] = useState(groups[0].id);
  const current = groups.find(g => g.id === id) ?? groups[0];
  return <section className="panel-section" aria-labelledby="notable-title">
    <div className="section-head"><h2 id="notable-title">目立つコメント</h2></div>
    <div className="segmented" role="group" aria-label="目立つコメントの種類">{groups.map(g => <Button key={g.id} size="sm" variant={g.id === current.id ? 'default' : 'outline'} aria-pressed={g.id === current.id} onClick={() => setId(g.id)}>{g.title}</Button>)}</div>
    <p className="muted">{current.description}</p>
    <div className="comment-list">{current.items.map(row => <NotableItem key={row.comment_id} row={row} />)}</div>
  </section>;
}

export function NotableItem({ row }: { row: NotableComment }) {
  return <article className="comment-item">
    <p className="comment-meta"><span>{row.is_reply ? '返信' : '親コメント'}</span><span>{row.metric ?? `いいね ${row.like_count}`}</span>{row.reply_count ? <span>返信 {row.reply_count}</span> : null}</p>
    {row.parent_text ? <details className="comment-context"><summary>返信先</summary><blockquote>{row.parent_text}</blockquote></details> : null}
    <p className="comment-text clamp">{row.text}</p>
    <a className="comment-link" href={row.url} target="_blank" rel="noreferrer">YouTubeで開く ↗</a>
  </article>;
}

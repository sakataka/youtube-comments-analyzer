import { useState } from 'react';
import { formatNumber, formatPercent } from '../api';
import type { Insights, NotableComment } from '../types';
import { Button } from './ui/button';
import { sentimentLabels } from './ToneEmotionView';

export function formatSeconds(value: number) {
  const h = Math.floor(value / 3600), m = Math.floor(value % 3600 / 60), s = value % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function CommentRow({ row }: { row: NotableComment }) {
  return <article className="opinion-evidence-row">
    <p className="opinion-note">{row.is_reply ? '返信' : '親コメント'} · {row.metric ?? `いいね ${row.like_count}`}{row.reply_count ? ` · 返信 ${row.reply_count}件` : ''}</p>
    {row.parent_text ? <details><summary>返信先の文脈</summary><blockquote>{row.parent_text}</blockquote></details> : null}
    <p className="opinion-original insight-clamp">{row.text}</p>
    <a href={row.url} target="_blank" rel="noreferrer">YouTubeのコメントを開く ↗</a>
  </article>;
}

export function VisibleVsAllView({ insights, onPerson }: { insights?: Insights; onPerson: (id: string) => void }) {
  const [group, setGroup] = useState('top');
  if (!insights) return null;
  const { visible, notable } = insights;
  const current = notable.find(g => g.id === group) ?? notable[0];
  const scale = Math.max(0.01, ...visible.people.flatMap(p => [p.all_rate, p.top_rate, p.like_share]));
  return <section id="report-visible" className="opinion-section" aria-label="上位に見えるコメントと全体">
    <div className="opinion-section-heading"><span>HIGHLIGHTS / VISIBLE VS ALL</span><h2 tabIndex={-1}>上に見えるコメントと、全体のずれ</h2></div>
    <p>YouTubeで最初に目に入りやすい「いいね上位{visible.top_n}件の親コメント」と、取得した全件を比べます。AIは使っていません。人気順の表示はいいね数だけで決まらないため、上位は近似です。</p>
    <div className="opinion-metrics"><span>上位{visible.top_n}件が全いいねの <b>{formatPercent(visible.top_like_share)}</b></span><span>いいね0の親コメント <b>{formatNumber(visible.zero_like_parents)}</b> / {formatNumber(visible.parents)}件</span></div>
    {visible.sentiment ? <>
      <h3 className="insight-subheading">賛否の見え方</h3>
      <div className="insight-stacks">{([['all', '取得全件'], ['top', `いいね上位${visible.top_n}件`], ['likes', 'いいねで重み付け']] as const).map(([id, label]) => <div key={id} className="insight-stack-row">
        <span>{label}</span>
        <span className="insight-stack" aria-label={`${label}：${Object.entries(sentimentLabels).map(([k, v]) => `${v} ${formatPercent(visible.sentiment![id][k] ?? 0, 0)}`).join('、')}`}>{Object.keys(sentimentLabels).map(k => <span key={k} className={`insight-stack-${k}`} style={{ width: `${(visible.sentiment![id][k] ?? 0) * 100}%` }} />)}</span>
        <small>{Object.entries(sentimentLabels).map(([k, v]) => `${v} ${formatPercent(visible.sentiment![id][k] ?? 0, 0)}`).join(' / ')}</small>
      </div>)}</div>
      <p className="opinion-note">ローカルモデルによる参考判定です。「いいねで重み付け」は、いいね数の多い投稿ほど大きく数えた割合です。</p>
    </> : null}
    {visible.people.length ? <>
      <h3 className="insight-subheading">人物ごとの見え方</h3>
      <p className="opinion-note">「全件」は取得全件のうちその人物に言及した割合、「上位」はいいね上位{visible.top_n}件に占める割合、「いいね」は全いいねのうち言及した投稿が集めた割合です。棒の長さは表示中の最大値を基準にしています。人物辞書の一致に基づきます。</p>
      <div className="insight-people">{visible.people.map(p => <button type="button" key={p.id} className="insight-person" onClick={() => onPerson(p.id)} aria-label={`${p.name}：全件 ${formatPercent(p.all_rate)}、上位${visible.top_n}件中 ${p.top_count}件、いいね ${formatPercent(p.like_share)}。原文を表示`}>
        <strong>{p.name}</strong>
        {([['全件', p.all_rate, 'all'], [`上位${visible.top_n}`, p.top_rate, 'top'], ['いいね', p.like_share, 'likes']] as const).map(([label, value, kind]) => <span key={kind} className="insight-meter"><small>{label}</small><span className="jev-track"><span className={`insight-fill-${kind}`} style={{ width: `${value / scale * 100}%` }} /></span><small>{kind === 'top' ? `${p.top_count}件` : formatPercent(value)}</small></span>)}
      </button>)}</div>
    </> : <p className="opinion-note">人物集計が完了すると、人物ごとの上位と全体の比較を表示します。</p>}
    <h3 className="insight-subheading">目立つコメント</h3>
    {notable.length ? <>
      <div className="insight-tabs" role="group" aria-label="目立つコメントの種類">{notable.map(g => <Button key={g.id} size="sm" variant={g.id === current.id ? 'default' : 'outline'} aria-pressed={g.id === current.id} onClick={() => setGroup(g.id)}>{g.title}</Button>)}</div>
      <p className="opinion-note">{current.description}</p>
      <div className="opinion-evidence-list">{current.items.map(row => <CommentRow key={row.comment_id} row={row} />)}</div>
    </> : <p className="opinion-empty">表示できるコメントはまだありません。</p>}
  </section>;
}

export function MomentsView({ insights, videoUrl, selected, onMoment }: { insights?: Insights; videoUrl: string; selected: string; onMoment: (start: number, end: number) => void }) {
  if (!insights) return null;
  const { moments, timeline } = insights;
  const maxCount = Math.max(1, ...moments.bins.map(b => b.comment_count));
  const peaks = [...moments.bins].filter(b => b.comment_count).sort((a, b) => b.comment_count - a.comment_count || a.start - b.start).slice(0, 3);
  const timelineTotal = timeline.bins.reduce((sum, b) => sum + b.comment_count, 0);
  const at = (seconds: number) => { const url = new URL(videoUrl); url.searchParams.set('t', `${seconds}s`); return url.toString(); };
  return <section id="report-moments" className="opinion-section" aria-label="動画の場面と投稿時間">
    <div className="opinion-section-heading"><span>MOMENTS / TIMELINE</span><h2 tabIndex={-1}>どの場面に反応し、いつ書かれたか</h2></div>
    <h3 className="insight-subheading">コメントで時刻が挙がった場面</h3>
    {moments.comment_count ? <>
      <p className="opinion-note">「12:34」のような時刻を含む {formatNumber(moments.comment_count)}件を{moments.bin_seconds! >= 60 ? `${moments.bin_seconds! / 60}分` : `${moments.bin_seconds}秒`}ごとに数えました。時刻を書かない反応は含みません。{moments.index_comments ? `時刻を4つ以上並べた目次のような投稿 ${moments.index_comments}件は除いています。` : ''}{moments.duration_seconds ? '動画の長さを超える時刻は除外しています。' : '動画の長さが未取得のため、時刻の表記ゆれや時計の時刻が混ざる場合があります。'}棒を押すと、その場面に触れた原文を表示します。</p>
      <div className="insight-histogram" role="group" aria-label="場面ごとのコメント数">{moments.bins.map(b => <button type="button" key={b.start} disabled={!b.comment_count} aria-pressed={selected === `${b.start}-${b.end}`} aria-label={`${formatSeconds(b.start)}〜${formatSeconds(b.end)}：${b.comment_count}件`} title={`${formatSeconds(b.start)}〜 ${b.comment_count}件`} onClick={() => onMoment(b.start, b.end)}><span style={{ height: `${b.comment_count / maxCount * 100}%` }} /></button>)}</div>
      <div className="insight-axis" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <span key={i}>{formatSeconds(Math.round((moments.bins.at(-1)?.end ?? 0) * i / 4))}</span>)}</div>
      <ol className="insight-peaks">{peaks.map(b => <li key={b.start}>
        <p><a href={at(b.start)} target="_blank" rel="noreferrer">{formatSeconds(b.start)}〜 を動画で見る ↗</a> · {b.comment_count}件 · いいね合計 {formatNumber(b.likes)}</p>
        {b.sample ? <blockquote className="insight-clamp">{b.sample.text}</blockquote> : null}
        <Button variant="outline" size="sm" onClick={() => onMoment(b.start, b.end)}>この場面の原文を読む</Button>
      </li>)}</ol>
    </> : <p className="opinion-empty">時刻を含むコメントは見つかりませんでした。</p>}
    <h3 className="insight-subheading">動画公開から投稿までの時間</h3>
    {timelineTotal ? <>
      <div className="jev-bars">{timeline.bins.map(b => <div key={b.label} className="jev-bar insight-static-bar"><span>{b.label}</span><span className="jev-track"><span style={{ width: `${b.comment_count / timelineTotal * 100}%` }} /></span><strong>{formatNumber(b.comment_count)}件 · {Math.round(b.comment_count / timelineTotal * 100)}%</strong></div>)}</div>
      <p className="opinion-note">返信を含む取得全件です。いいねは取得時点の累計で、早く投稿されたものほど多くなりやすい点に注意してください。{timeline.undated ? `投稿日時不明 ${timeline.undated}件を除いています。` : ''}</p>
    </> : <p className="opinion-empty">動画の公開日時または投稿日時がないため表示できません。</p>}
  </section>;
}

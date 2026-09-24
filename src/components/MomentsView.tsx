import { formatNumber } from '../api';
import { formatSeconds } from '../labels';
import type { Insights } from '../types';
import { Bars } from './Charts';
import type { OpenComments } from './CommentBrowser';
import { Button } from './ui/button';

export function MomentsView({ insights, videoUrl, open }: { insights: Insights; videoUrl: string; open: OpenComments }) {
  const { moments, timeline } = insights;
  const maxCount = Math.max(1, ...moments.bins.map(b => b.comment_count));
  const peaks = moments.bins.filter(b => b.comment_count).sort((a, b) => b.comment_count - a.comment_count || a.start - b.start).slice(0, 3);
  const timelineTotal = timeline.bins.reduce((sum, b) => sum + b.comment_count, 0);
  const at = (seconds: number) => { const url = new URL(videoUrl); url.searchParams.set('t', `${seconds}s`); return url.toString(); };
  const openMoment = (start: number, end: number) => open({ label: `動画の${formatSeconds(start)}〜${formatSeconds(end)}に触れた投稿`, moment: [start, end], sort: 'likes' });
  const size = moments.bin_seconds ?? 0;
  return <>
    <section className="panel-section" aria-labelledby="moments-title">
      <div className="section-head">
        <h2 id="moments-title">コメントで時刻が挙がった場面</h2>
        {moments.comment_count ? <p>「12:34」のような時刻を含む{formatNumber(moments.comment_count)}件を{size >= 60 ? `${size / 60}分` : `${size}秒`}ごとに数えました。棒を押すと原文を開きます。</p> : null}
      </div>
      {moments.comment_count ? <>
        <div className="histogram" role="group" aria-label="場面ごとのコメント数">{moments.bins.map(b => <button type="button" key={b.start} disabled={!b.comment_count} aria-label={`${formatSeconds(b.start)}〜${formatSeconds(b.end)}：${b.comment_count}件`} title={`${formatSeconds(b.start)}〜 ${b.comment_count}件`} onClick={() => openMoment(b.start, b.end)}><span style={{ height: `${b.comment_count / maxCount * 100}%` }} /></button>)}</div>
        <div className="histogram-axis" aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <span key={i}>{formatSeconds(Math.round((moments.bins.at(-1)?.end ?? 0) * i / 4))}</span>)}</div>
        <h3>特に多かった場面</h3>
        <ol className="peaks">{peaks.map(b => <li key={b.start}>
          <div className="peak-head"><a href={at(b.start)} target="_blank" rel="noreferrer">{formatSeconds(b.start)}〜 ↗</a><span className="muted">{b.comment_count}件 · いいね {formatNumber(b.likes)}</span><Button variant="outline" size="sm" onClick={() => openMoment(b.start, b.end)}>原文を開く</Button></div>
          {b.sample ? <blockquote className="clamp">{b.sample.text}</blockquote> : null}
        </li>)}</ol>
        <p className="muted small">時刻を書かない反応は含みません。{moments.index_comments ? `時刻を4つ以上並べた目次のような投稿${moments.index_comments}件は除外。` : ''}{moments.duration_seconds ? '' : '動画の長さが未取得のため、時計の時刻などが混ざる場合があります。'}</p>
      </> : <p className="muted">時刻を含むコメントは見つかりませんでした。</p>}
    </section>
    <section className="panel-section" aria-labelledby="timeline-title">
      <div className="section-head"><h2 id="timeline-title">動画公開から投稿までの時間</h2></div>
      {timelineTotal ? <>
        <Bars counts={Object.fromEntries(timeline.bins.map(b => [b.label, b.comment_count]))} labels={Object.fromEntries(timeline.bins.map(b => [b.label, b.label]))} total={timelineTotal} />
        <p className="muted small">返信を含む取得全件。いいねは取得時点の累計なので、早い投稿ほど多くなりやすい点に注意してください。{timeline.undated ? `投稿日時不明の${timeline.undated}件は除外。` : ''}</p>
      </> : <p className="muted">動画の公開日時または投稿日時がないため表示できません。</p>}
    </section>
  </>;
}

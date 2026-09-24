import type { Action, XPulse } from '../types';
import { Button } from './ui/button';

export function xAvailable(pulse?: XPulse) { return Boolean(pulse?.enabled || pulse?.status === 'completed'); }

export function XPulseView({ pulse, busy, action }: { pulse?: XPulse; busy: boolean; action: Action }) {
  const done = pulse?.status === 'completed';
  return <section className="panel-section" aria-labelledby="x-title">
    <div className="section-head">
      <h2 id="x-title">Xでの反応</h2>
      <p>Grok CLIでXを検索した要約です。投稿内容は事実として扱わず、件数や割合は推定しません。</p>
    </div>
    <div className="inline-action">
      <p className="muted" role="status">{pulse?.status === 'running' ? 'Xを検索しています（数分かかります）…' : done ? `${pulse.observed_at ? new Date(pulse.observed_at).toLocaleString('ja-JP') : ''}に検索` : !pulse?.enabled ? 'X検索は使えません（Grok CLIが見つからないか、X_SEARCH=offです）。' : '未実行'}</p>
      {pulse?.enabled && pulse.status !== 'running' ? <Button size="sm" variant="outline" disabled={busy} onClick={() => void action('actions', { action: 'x' })}>{done ? '検索し直す' : 'Xを検索する'}</Button> : null}
    </div>
    {pulse?.error ? <p role="alert">{pulse.error}</p> : null}
    {done ? <>
      {pulse.summary ? <p className="lead">{pulse.summary}</p> : <p className="muted">この動画に関するXの反応は見つかりませんでした。</p>}
      {pulse.tone || pulse.comparison ? <dl className="x-facts">
        {pulse.tone ? <><dt>温度感</dt><dd>{pulse.tone}</dd></> : null}
        {pulse.comparison ? <><dt>YouTubeとの違い</dt><dd>{pulse.comparison}</dd></> : null}
      </dl> : null}
      <div className="card-grid">{pulse.topics?.map(topic => <article className="card" key={topic.title}>
        <h3>{topic.title}</h3><p>{topic.summary}</p>
        <ul className="x-posts">{topic.posts.map(post => <li key={post.url}><a href={post.url} target="_blank" rel="noreferrer">{post.author}{post.postedAt ? ` · ${post.postedAt}` : ''} ↗</a><p>{post.gist}</p></li>)}</ul>
      </article>)}</div>
    </> : null}
  </section>;
}

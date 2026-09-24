import { formatNumber } from '../api';
import { emotionLabels, formatDate, sentimentLabels } from '../labels';
import type { Action, LightReport } from '../types';
import { StackBar } from './Charts';
import type { OpenComments } from './CommentBrowser';
import { LocalStatus, localDone } from './ReactionsView';
import { Button } from './ui/button';

export type Tab = 'overview' | 'reactions' | 'people' | 'moments' | 'x' | 'comments';

export function ReportOverview({ report, running, busy, action, open, goTo, onReanalyze }: { report: LightReport; running: boolean; busy: boolean; action: Action; open: OpenComments; goTo: (tab: Tab) => void; onReanalyze: () => void }) {
  const { coverage, statistics, insights, x_pulse: pulse } = report;
  const local = localDone(report.local);
  const shares = insights?.visible.sentiment;
  const emotions = local ? Object.entries(local.emotions).filter(([k, n]) => k !== 'none' && n).sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
  const stats = report.person_statistics;
  const people = stats?.status === 'completed' ? (stats.people ?? []).slice(0, 5) : [];
  const maxPerson = Math.max(1, ...people.map(p => p.count));
  return <>
    <div className="stats">
      <div className="stat"><b>{formatNumber(coverage.fetched)}<small>件</small></b><span>取得コメント</span><small>親 {formatNumber(coverage.parents)} ／ 返信 {formatNumber(coverage.replies)}</small></div>
      <div className="stat"><b>{formatNumber(statistics.likes)}</b><span>いいね合計</span><small>賛成票や人数ではありません</small></div>
      <div className="stat"><b>{formatNumber(report.concentration.unique_authors)}<small>人</small></b><span>投稿者</span>{statistics.duplicate_comments ? <small>完全同文の重複 {statistics.duplicate_comments}件</small> : null}</div>
      <div className="stat"><b className="stat-date">{formatDate(coverage.published_from)}〜</b><span>投稿期間</span><small>{formatDate(coverage.published_to)}まで</small></div>
    </div>
    <p className="muted small">{coverage.source === 'fixture' ? 'テスト用データです。実際の動画の反応ではありません。' : coverage.api_exhausted ? 'APIで取得できる範囲をすべて取得しました（削除・非公開のコメントは含みません）。' : '部分取得です。この範囲がコメント欄全体を代表するとは限りません。'}</p>

    <div className="overview-grid">
      <section className="card" aria-labelledby="overview-tone">
        <h2 id="overview-tone">全体の反応</h2>
        {local ? <>
          <div className="stacks">
            <StackBar label="取得全件" shares={shares?.all ?? Object.fromEntries(Object.entries(local.sentiments).map(([k, n]) => [k, n / Math.max(1, local.denominator)]))} labels={sentimentLabels} />
            {shares ? <StackBar label={`いいね上位${insights!.visible.top_n}件`} shares={shares.top} labels={sentimentLabels} /> : null}
          </div>
          {emotions.length ? <div className="chips"><span className="muted small">多い感情</span>{emotions.map(([k, n]) => <button type="button" key={k} className="chip" onClick={() => open({ label: `感情が「${emotionLabels[k]}」の投稿`, emotion: k, sort: 'likes' })}>{emotionLabels[k]} {formatNumber(n)}</button>)}</div> : null}
          <Button className="more" variant="link" size="sm" onClick={() => goTo('reactions')}>賛否と感情を詳しく見る →</Button>
        </> : <LocalStatus local={report.local} busy={busy} action={action} />}
      </section>
      <section className="card" aria-labelledby="overview-people">
        <h2 id="overview-people">よく話題にされた人物</h2>
        {people.length ? <>
          <ol className="rank">{people.map(p => <li key={p.id}><button type="button" onClick={() => open({ label: `${p.name}に言及した投稿`, person_id: p.id, sort: 'likes' })} aria-label={`${p.name} ${p.count}件の原文を開く`}>
            <span className="rank-name">{p.name}</span><span className="bar-track"><span style={{ width: `${p.count / maxPerson * 100}%` }} /></span><span className="rank-value">{formatNumber(p.count)}件</span>
          </button></li>)}</ol>
          <Button className="more" variant="link" size="sm" onClick={() => goTo('people')}>人物ごとの評価を見る →</Button>
        </> : <p className="muted">{stats?.status === 'running' || running ? '人物を集計しています…' : stats?.status === 'completed' ? '辞書に一致した人物はいません。' : '人物集計はまだありません。'}</p>}
      </section>
    </div>

    <section className="panel-section" aria-labelledby="topics-title">
      <div className="section-head">
        <h2 id="topics-title">このコメント欄で語られていること</h2>
        <p>抽出した{report.sample.sent_count ?? 0}件をAIが要約した話題です。全体の賛否率や少数意見の網羅は示しません。</p>
      </div>
      {report.topics.length ? <div className="card-grid">{report.topics.map(topic => <article className="card topic" key={topic.id}>
        <h3>{topic.title}</h3>
        <p>{topic.description}</p>
        <p className="muted">{topic.reactions}</p>
        {topic.evidence.map((e, i) => <blockquote key={`${e.comment_id}-${i}`}>{e.quote}</blockquote>)}
        <Button variant="outline" size="sm" onClick={() => open({ label: `根拠の原文：${topic.title}`, group_id: topic.id })}>根拠の原文を読む</Button>
      </article>)}</div> : <p className="muted">{running ? '要約を作成しています。完了を待つ間も集計と原文は読めます。' : '表示できる要約はありません。原文タブで取得済みのコメントを読めます。'}</p>}
    </section>

    {pulse?.status === 'completed' && pulse.summary ? <section className="card" aria-labelledby="overview-x">
      <h2 id="overview-x">Xでの反応</h2>
      <p>{pulse.summary}</p>
      <Button className="more" variant="link" size="sm" onClick={() => goTo('x')}>Xの話題と投稿を見る →</Button>
    </section> : null}

    <details className="fine-print">
      <summary>この分析について</summary>
      <p>集計・検索・賛否と感情の判定はAIのトークンを使いません。要約だけが抽出コメントを読みます（候補{report.sample.candidate_count ?? 0}件から{report.sample.sent_count ?? 0}件。親・返信と投稿時期で分けた無作為抽出に、高評価・返信の多い投稿を補足。長文などの省略{report.sample.truncated_count ?? 0}件）。</p>
      <p>{report.method.model} / {report.method.effort} · AI {report.usage.calls}回 · 累計{Math.round(report.usage.elapsed_seconds)}秒 · 入力{formatNumber(report.usage.input_characters)}文字 · 出力{formatNumber(report.usage.output_characters)}文字</p>
      <Button variant="outline" size="sm" disabled={busy} onClick={onReanalyze}>保存した原文から新しく分析し直す</Button>
    </details>
  </>;
}

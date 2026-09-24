import { useRef, useState } from 'react';
import { Tabs } from 'radix-ui';
import { formatNumber } from '../api';
import type { Action, LightReport } from '../types';
import { AppHeader } from './AppHeader';
import { CommentBrowser, CommentSheet, useCommentSheet } from './CommentBrowser';
import { MomentsView } from './MomentsView';
import { PeopleView } from './PeopleView';
import { ReactionsView } from './ReactionsView';
import { ReportOverview, type Tab } from './ReportOverview';
import { XPulseView, xAvailable } from './XPulseView';
import { Button } from './ui/button';

const summaryStates: Record<string, string> = { not_started: '集計を準備しています', running: '抽出コメントを要約しています', completed: '抽出コメントの要約完了', failed: '要約を作成できませんでした', stopped: '停止して保存しました', timed_out: '時間枠に達したため保存しました' };
const runningStages: Record<string, string> = { queued: '順番待ち', fetching: 'コメントを取得しています', people: '人物を集計しています', local: '全件の賛否と感情を判定しています', x: 'Xの反応を検索しています（数分かかります）' };

export function LightReportView({ report, error, working, action, onNewAnalysis, onOpenSettings, onReanalyze }: {
  report: LightReport; error: string; working: boolean; action: Action;
  onNewAnalysis: () => void; onOpenSettings: () => void; onReanalyze: () => void;
}) {
  const running = report.status === 'running' || report.status === 'queued';
  const busy = running || working;
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(window.location.search).get('tab') as Tab | null) ?? 'overview');
  const sheet = useCommentSheet();
  const tabsRef = useRef<HTMLDivElement>(null);
  const version = `${report.coverage.fetched}:${report.coverage.updated_at}`;
  const people = report.person_statistics?.people?.length ?? 0;
  const state = running ? runningStages[report.stage] ?? summaryStates[report.summary_status] : summaryStates[report.summary_status] ?? report.summary_status;
  const tabs: Array<[Tab, string, number?]> = [['overview', '概要'], ['reactions', '反応'], ['people', '人物', people || undefined], ['moments', '場面'], ...(xAvailable(report.x_pulse) ? [['x', 'X'] as [Tab, string]] : []), ['comments', '原文', report.coverage.fetched]];

  function select(next: string) {
    setTab(next as Tab);
    const url = new URL(window.location.href);
    if (next === 'overview') url.searchParams.delete('tab'); else url.searchParams.set('tab', next);
    window.history.replaceState(null, '', url);
    const top = tabsRef.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) tabsRef.current?.scrollIntoView({ block: 'start' });
  }

  return <main className="report-shell">
    <AppHeader report onHome={onNewAnalysis} onNewAnalysis={onNewAnalysis} onOpenSettings={onOpenSettings} />
    <header className="report-head">
      <h1>{report.video.title || 'コメントを取得しています'}</h1>
      <p className="muted">{report.video.channel_title} · <a href={report.video.url} target="_blank" rel="noreferrer">YouTubeで動画を見る ↗</a></p>
    </header>
    {error ? <p role="alert">{error}</p> : null}
    <section className={`status-bar${running ? ' is-running' : report.summary_status === 'completed' ? '' : ' is-attention'}`} aria-label="取得と要約の状況">
      <p><i className="status-dot" aria-hidden="true" /><strong aria-live="polite">{state}</strong><span className="muted">{formatNumber(report.coverage.fetched)}件取得 · {report.sample.sent_count ?? 0}件を要約 · AI {report.usage.calls}回</span></p>
      <div className="status-actions">{running
        ? <Button size="sm" variant="outline" disabled={working} onClick={() => void action('actions', { action: 'stop' })}>停止して保存</Button>
        : <>
          {report.summary_status !== 'completed' ? <Button size="sm" disabled={working} onClick={() => void action('actions', { action: 'resume' })}>保存データから要約を再試行</Button> : null}
          {report.can_continue ? <Button size="sm" variant="outline" disabled={working} onClick={() => void action('actions', { action: 'continue' })}>続きのコメントを取得・要約</Button> : null}
        </>}</div>
      {report.error_message ? <p className="status-error" role="alert">{report.error_message} 取得済みの集計と原文は利用できます。</p> : null}
    </section>

    <Tabs.Root value={tabs.some(([id]) => id === tab) ? tab : 'overview'} onValueChange={select}>
      <div className="tabs-bar" ref={tabsRef}>
        <Tabs.List className="tabs" aria-label="分析結果">{tabs.map(([id, label, count]) => <Tabs.Trigger key={id} value={id} className="tab">{label}{count ? <span className="tab-count">{formatNumber(count)}</span> : null}</Tabs.Trigger>)}</Tabs.List>
      </div>
      <Tabs.Content value="overview" className="tab-panel"><ReportOverview report={report} running={running} busy={busy} action={action} open={sheet.open} goTo={select} onReanalyze={onReanalyze} /></Tabs.Content>
      <Tabs.Content value="reactions" className="tab-panel"><ReactionsView local={report.local} insights={report.insights} busy={busy} action={action} open={sheet.open} /></Tabs.Content>
      <Tabs.Content value="people" className="tab-panel"><PeopleView statistics={report.person_statistics} local={report.local} visible={report.insights?.visible} running={running} busy={busy} action={action} open={sheet.open} /></Tabs.Content>
      <Tabs.Content value="moments" className="tab-panel">{report.insights ? <MomentsView insights={report.insights} videoUrl={report.video.url} open={sheet.open} /> : null}</Tabs.Content>
      {xAvailable(report.x_pulse) ? <Tabs.Content value="x" className="tab-panel"><XPulseView pulse={report.x_pulse} busy={busy} action={action} /></Tabs.Content> : null}
      {/* Kept mounted so search and paging survive switching tabs. */}
      <Tabs.Content value="comments" className="tab-panel" forceMount>
        <section className="panel-section" aria-labelledby="comments-title">
          <div className="section-head"><h2 id="comments-title">取得したすべての原文</h2></div>
          <CommentBrowser runId={report.run_id} version={version} />
        </section>
      </Tabs.Content>
    </Tabs.Root>
    <CommentSheet runId={report.run_id} version={version} sheet={sheet} />
  </main>;
}

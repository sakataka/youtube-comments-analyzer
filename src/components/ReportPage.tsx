import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from '../api';
import type { AnyReport, LightReport } from '../types';
import { AppHeader } from './AppHeader';
import { LightReportView } from './LightReportView';
import { Button } from './ui/button';

/** Loads and polls one saved run. Only report.v4 has a full view; older results can be re-run from their saved comments. */
export function ReportPage({ runId, onNewAnalysis, onOpenSettings, onOpenRun }: { runId: string; onNewAnalysis: () => void; onOpenSettings: () => void; onOpenRun: (id: string) => void }) {
  const [report, setReport] = useState<AnyReport | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    async function refresh() {
      try {
        const next = await api<AnyReport>(`/api/runs/${runId}/report`);
        if (active) { setReport(next); setError(''); }
      } catch (caught) { if (active) setError(message(caught)); }
      if (active) timer = window.setTimeout(refresh, 1800);
    }
    setReport(null);
    void refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [runId]);
  async function action(path: string, body?: unknown) {
    setWorking(true);
    try {
      await api(`/api/runs/${runId}/${path}`, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      setReport(await api<AnyReport>(`/api/runs/${runId}/report`));
      if (path === 'actions' && (body as { action: string }).action === 'stop') toast.info('停止を要求しました。現在の処理を終了して保存します。');
    } catch (caught) { toast.error(message(caught)); return false; }
    finally { setWorking(false); }
    return true;
  }
  async function reanalyze() {
    try { onOpenRun((await api<{ run_id: string }>(`/api/runs/${runId}/reanalyze`, { method: 'POST' })).run_id); }
    catch (caught) { toast.error(message(caught)); }
  }
  if (report?.schema_version === 'report.v4') return <LightReportView key={runId} report={report as LightReport} error={error} working={working} action={action} onNewAnalysis={onNewAnalysis} onOpenSettings={onOpenSettings} onReanalyze={() => void reanalyze()} />;
  return <main className="report-shell">
    <AppHeader report onHome={onNewAnalysis} onNewAnalysis={onNewAnalysis} onOpenSettings={onOpenSettings} />
    {error ? <p role="alert">{error}</p> : null}
    {!report ? <p className="muted" role="status">保存済みの分析を読み込んでいます…</p> : <header className="report-head">
      <h1>{report.video.title}</h1>
      <p className="muted">旧方式の保存結果です。この画面では表示しません。保存した原文から現在の方式で分析し直せます。</p>
      <Button onClick={() => void reanalyze()}>新しい分析としてやり直す</Button>
    </header>}
  </main>;
}

function message(caught: unknown) { return caught instanceof Error ? caught.message : String(caught); }

import { FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { api } from './api';
import { OpinionReportView } from './components/OpinionReportView';
import { SettingsPanel } from './components/SettingsPanel';
import { StartScreen } from './components/StartScreen';
import { Toaster } from './components/ui/sonner';
import type { DataSummary, ReplyMode, RunState, SettingsInfo } from './types';

export default function App() {
  const [url, setUrl] = useState('');
  const [maxComments, setMaxComments] = useState(5000);
  const [replyMode, setReplyMode] = useState<ReplyMode>('full');
  const [forceRefresh, setForceRefresh] = useState(false);
  const [settings, setSettings] = useState<SettingsInfo | null>(null);
  const [data, setData] = useState<DataSummary | null>(null);
  const [history, setHistory] = useState<RunState[]>([]);
  const [runId, setRunId] = useState<string | null>(() => new URLSearchParams(window.location.search).get('run'));
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncTheme = () => document.documentElement.classList.toggle('dark', media.matches);
    syncTheme(); media.addEventListener('change', syncTheme);
    void refresh().catch(showError);
    return () => media.removeEventListener('change', syncTheme);
  }, []);

  async function refresh() {
    const [nextSettings, nextData, nextRuns] = await Promise.all([api<SettingsInfo>('/api/settings'), api<DataSummary>('/api/data/summary'), api<{ runs: RunState[] }>('/api/runs')]);
    setSettings(nextSettings); setData(nextData); setHistory(nextRuns.runs);
  }
  function openRun(id: string) {
    setRunId(id);
    window.history.replaceState(null, '', `?run=${encodeURIComponent(id)}`);
    window.scrollTo(0, 0);
  }
  function home() {
    setRunId(null); setUrl('');
    window.history.replaceState(null, '', window.location.pathname);
    void refresh().catch(showError);
    window.scrollTo(0, 0);
  }
  async function startRun(event: FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const created = await api<{ run_id: string }>('/api/runs', { method: 'POST', body: JSON.stringify({ url, max_comments: maxComments, reply_fetch_mode: replyMode, force_refresh: forceRefresh }) });
      openRun(created.run_id);
    } catch (caught) { showError(caught); }
    finally { setBusy(false); }
  }
  async function dataAction(action: string, id?: string) {
    setBusy(true);
    try {
      await api('/api/data/actions', { method: 'POST', body: JSON.stringify({ action, run_id: id }) });
      await refresh(); toast.success('保存データを更新しました。');
    } catch (caught) { showError(caught); }
    finally { setBusy(false); }
  }
  return <>
    {runId ? <OpinionReportView runId={runId} onNewAnalysis={home} onOpenSettings={() => { setSettingsOpen(true); void refresh().catch(showError); }} onOpenRun={openRun} /> : <StartScreen url={url} setUrl={setUrl} maxComments={maxComments} setMaxComments={setMaxComments} replyMode={replyMode} setReplyMode={setReplyMode} forceRefresh={forceRefresh} setForceRefresh={setForceRefresh} settings={settings} history={history} historyCount={data?.run_count ?? 0} busy={busy} onSubmit={startRun} onOpenRun={openRun} onDeleteRun={id => void dataAction(id ? 'delete_run' : 'delete_all_runs', id)} onOpenSettings={() => setSettingsOpen(true)} />}
    <SettingsPanel settings={settings} data={data} busy={busy} open={settingsOpen} onClose={() => { setSettingsOpen(false); window.requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-dialog-trigger="settings"]')?.focus()); }} onDataAction={action => void dataAction(action)} />
    <Toaster closeButton richColors position="bottom-right" />
  </>;
}
function showError(caught: unknown) { toast.error(caught instanceof Error ? caught.message : String(caught)); }

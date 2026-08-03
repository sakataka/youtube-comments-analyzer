import { FormEvent, useEffect, useState } from "react";
import { api } from "./api";
import { ReportView } from "./components/ReportView";
import { ReviewCenter } from "./components/ReviewCenter";
import { SettingsPanel } from "./components/SettingsPanel";
import { StartScreen } from "./components/StartScreen";
import { Toaster } from "./components/ui/sonner";
import { toast } from "sonner";
import {
  AiInsight,
  AppView,
  CandidatesResponse,
  CommentsPage,
  DataSummary,
  ReplyMode,
  Report,
  RunJob,
  RunState,
  SentimentLabel,
  SentimentReviewItem,
  SettingsInfo
} from "./types";

export default function App() {
  useSystemTheme();
  const [url, setUrl] = useState("");
  const [maxComments, setMaxComments] = useState(5000);
  const [replyMode, setReplyMode] = useState<ReplyMode>("full");
  const [forceRefresh, setForceRefresh] = useState(false);
  const [settings, setSettings] = useState<SettingsInfo | null>(null);
  const [dataSummary, setDataSummary] = useState<DataSummary | null>(null);
  const [history, setHistory] = useState<RunState[]>([]);
  const [run, setRun] = useState<RunState | null>(null);
  const [job, setJob] = useState<RunJob | null>(null);
  const [sentimentJob, setSentimentJob] = useState<RunJob | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [candidates, setCandidates] = useState<CandidatesResponse | null>(null);
  const [view, setView] = useState<AppView>("overview");
  const [selectedPersonId, setSelectedPersonId] = useState<string | null>(null);
  const [aiInsight, setAiInsight] = useState<AiInsight | null>(null);
  const [commentsPage, setCommentsPage] = useState<CommentsPage | null>(null);
  const [commentSearch, setCommentSearch] = useState("");
  const [commentPersonFilter, setCommentPersonFilter] = useState("all");
  const [commentSentimentFilter, setCommentSentimentFilter] = useState("all");
  const [commentSort, setCommentSort] = useState("likes");
  const [commentPage, setCommentPage] = useState(0);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void loadInitialData();
  }, []);

  useEffect(() => {
    if (!error) return;
    toast.error(error);
    setError(null);
  }, [error]);

  useEffect(() => {
    if (!notice) return;
    toast.success(notice);
    setNotice(null);
  }, [notice]);

  useEffect(() => {
    if (!run || view !== "comments") return;
    const timer = window.setTimeout(() => {
      void loadComments(run.run_id, commentPage, commentSearch, commentPersonFilter, commentSentimentFilter, commentSort);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [commentPage, commentPersonFilter, commentSearch, commentSentimentFilter, commentSort, run, view]);

  async function loadInitialData() {
    const [nextSettings, nextData, runList] = await Promise.all([
      api<SettingsInfo>("/api/settings"),
      api<DataSummary>("/api/data/summary"),
      api<{ runs: RunState[] }>("/api/runs")
    ]);
    setSettings(nextSettings);
    setDataSummary(nextData);
    setHistory(runList.runs);
    setMaxComments(nextSettings.max_comments.default);
    const initialRunId = new URLSearchParams(window.location.search).get("run");
    if (initialRunId) await openRun(initialRunId);
  }

  async function startRun(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await api<{ job_id: string; status: string }>("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          url,
          max_comments: maxComments,
          reply_fetch_mode: replyMode,
          fetch_order: "relevance",
          force_refresh: forceRefresh
        })
      });
      const completed = await waitForJob(created.job_id);
      if (!completed.run_id) throw new Error("分析結果のIDを取得できませんでした。");
      await openRun(completed.run_id);
      if (import.meta.env.VITE_AUTO_AI_ASSIST !== "0") void reanalyzeSentiment(completed.run_id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function waitForJob(jobId: string): Promise<RunJob> {
    while (true) {
      const nextJob = await api<RunJob>(`/api/jobs/${jobId}`);
      setJob(nextJob);
      if (nextJob.status === "completed") return nextJob;
      if (nextJob.status === "failed") throw new Error(nextJob.error_message || "分析に失敗しました。");
      await new Promise((resolve) => window.setTimeout(resolve, 600));
    }
  }

  async function openRun(runId: string) {
    setBusy(true);
    setError(null);
    try {
      const insightPromise = api<AiInsight>(`/api/runs/${runId}/ai-insight`).catch(() => null);
      const [nextRun, nextCandidates, nextReport, nextInsight] = await Promise.all([
        api<RunState>(`/api/runs/${runId}`),
        api<CandidatesResponse>(`/api/runs/${runId}/candidates`),
        api<Report>(`/api/runs/${runId}/report`),
        insightPromise
      ]);
      setRun(nextRun);
      setCandidates(nextCandidates);
      setReport(nextReport);
      setAiInsight(nextInsight);
      setSelectedPersonId(nextReport.rankings.mention_ranking[0]?.person_id ?? null);
      setCommentSearch("");
      setCommentPersonFilter("all");
      setCommentSentimentFilter("all");
      setCommentSort("likes");
      setCommentPage(0);
      setView("overview");
      setJob(null);
      setSentimentJob(null);
      setReviewOpen(false);
      setUrl(nextRun.video?.url ?? "");
      setMaxComments(nextRun.fetch_summary?.max_comments_requested ?? maxComments);
      setReplyMode((nextRun.fetch_summary?.reply_fetch_mode as ReplyMode) ?? "full");
      window.history.replaceState(null, "", `?run=${encodeURIComponent(runId)}`);
      await refreshHistory();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function reanalyzeSentiment(runId: string) {
    try {
      const created = await api<RunJob>(`/api/runs/${runId}/sentiment/reanalyze`, {
        method: "POST",
        body: JSON.stringify({ include_ai: true })
      });
      const completed = await waitForSentimentJob(created);
      if (completed.status !== "completed") return;
      const nextReport = await api<Report>(`/api/runs/${runId}/report`);
      setReport((current) => (current?.run_id === runId ? nextReport : current));
      if (run?.run_id === runId && view === "comments") {
        await loadComments(runId, commentPage, commentSearch, commentPersonFilter, commentSentimentFilter, commentSort);
      }
      setNotice(nextReport.sentiment.local_model?.status === "failed" ? "ローカルモデルを利用できなかったため、ルール結果へ縮退しました。" : nextReport.sentiment.ai_status === "failed" ? "AI補助に失敗した項目は判断保留としてレビューへ残しました。" : "三段階の感情判定を反映しました。");
    } catch (caught) {
      setNotice(`感情の再判定を完了できませんでした。現在の結果は保持されています。${errorMessage(caught)}`);
    }
  }

  async function waitForSentimentJob(initial: RunJob): Promise<RunJob> {
    let nextJob = initial;
    while (true) {
      setSentimentJob(nextJob);
      if (nextJob.status === "completed") return nextJob;
      if (nextJob.status === "failed") throw new Error(nextJob.error_message || "感情の再判定に失敗しました。");
      await new Promise((resolve) => window.setTimeout(resolve, 600));
      nextJob = await api<RunJob>(`/api/jobs/${nextJob.job_id}`);
    }
  }

  async function runAiInsight() {
    if (!run) return;
    setAiBusy(true);
    setError(null);
    try {
      const insight = await api<AiInsight>(`/api/runs/${run.run_id}/ai-insight`, { method: "POST" });
      setAiInsight(insight);
      if (insight.status === "failed") setNotice("AIインサイトを利用できませんでした。通常の分析結果は有効です。");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setAiBusy(false);
    }
  }

  async function candidateAction(action: Record<string, string>) {
    if (!run) return;
    setBusy(true);
    try {
      await api(`/api/runs/${run.run_id}/candidate-actions`, { method: "POST", body: JSON.stringify({ actions: [action] }) });
      await api(`/api/runs/${run.run_id}/continue`, { method: "POST" });
      const [nextCandidates, nextReport] = await Promise.all([
        api<CandidatesResponse>(`/api/runs/${run.run_id}/candidates`),
        api<Report>(`/api/runs/${run.run_id}/report`)
      ]);
      setCandidates(nextCandidates);
      setReport(nextReport);
      setNotice("人物候補を反映してレポートを再集計しました。");
      void reanalyzeSentiment(run.run_id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function sentimentAction(item: SentimentReviewItem, label: SentimentLabel) {
    if (!run) return;
    setBusy(true);
    try {
      const nextReport = await api<Report>(`/api/runs/${run.run_id}/sentiment-actions`, {
        method: "POST",
        body: JSON.stringify({ actions: [{ comment_id: item.comment_id, target_type: item.target_type, target_id: item.target_id, label }] })
      });
      setReport(nextReport);
      if (view === "comments") await loadComments(run.run_id, commentPage, commentSearch, commentPersonFilter, commentSentimentFilter, commentSort);
      setNotice("感情判定を修正しました。");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function verifyReview() {
    if (!run) return;
    setBusy(true);
    try {
      const nextRun = await api<RunState>(`/api/runs/${run.run_id}/review/complete`, { method: "POST" });
      const nextReport = await api<Report>(`/api/runs/${run.run_id}/report`);
      setRun(nextRun);
      setReport(nextReport);
      closeDialog(setReviewOpen, "review");
      setNotice("レポートを確認済みにしました。");
      await refreshHistory();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function loadComments(runId: string, page: number, search: string, personFilter: string, sentimentFilter: string, sort: string) {
    setCommentsLoading(true);
    try {
      const params = new URLSearchParams({ limit: "100", offset: String(page * 100) });
      if (search.trim()) params.set("search", search.trim());
      if (personFilter !== "all") params.set("person_id", personFilter);
      if (sentimentFilter !== "all") params.set("sentiment", sentimentFilter);
      params.set("sort", sort);
      setCommentsPage(await api<CommentsPage>(`/api/runs/${runId}/comments?${params}`));
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCommentsLoading(false);
    }
  }

  async function refreshHistory() {
    const [runList, nextData] = await Promise.all([
      api<{ runs: RunState[] }>("/api/runs"),
      api<DataSummary>("/api/data/summary")
    ]);
    setHistory(runList.runs);
    setDataSummary(nextData);
  }

  async function deleteRuns(runId?: string) {
    setBusy(true);
    try {
      const action = runId ? "delete_run" : "delete_all_runs";
      const result = await api<{ deleted_count?: number }>("/api/data/actions", {
        method: "POST",
        body: JSON.stringify({ action, run_id: runId })
      });
      await refreshHistory();
      setNotice(runId ? "分析結果を削除しました。" : `${result.deleted_count ?? 0}件の分析結果を削除しました。`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  async function dataAction(action: "archive_youtube_cache" | "delete_youtube_cache") {
    const verb = action === "delete_youtube_cache" ? "削除" : "退避";
    setBusy(true);
    try {
      await api("/api/data/actions", { method: "POST", body: JSON.stringify({ action }) });
      setDataSummary(await api<DataSummary>("/api/data/summary"));
      setNotice(`YouTubeキャッシュを${verb}しました。`);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function newAnalysis() {
    setRun(null);
    setReport(null);
    setCandidates(null);
    setCommentsPage(null);
    setAiInsight(null);
    setSentimentJob(null);
    setCommentSearch("");
    setCommentPersonFilter("all");
    setCommentSentimentFilter("all");
    setCommentSort("likes");
    setCommentPage(0);
    setReplyMode("full");
    setNotice(null);
    setError(null);
    setView("overview");
    window.history.replaceState(null, "", window.location.pathname);
    window.scrollTo({
      top: 0,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
    });
  }

  return (
    <>
      {run && report ? (
        <ReportView
          run={run}
          report={report}
          candidates={candidates}
          view={view}
          setView={(next) => { setView(next); if (next === "comments") setCommentPage(0); }}
          selectedPersonId={selectedPersonId}
          setSelectedPersonId={setSelectedPersonId}
          aiInsight={aiInsight}
          aiBusy={aiBusy}
          sentimentJob={sentimentJob}
          commentsPage={commentsPage}
          commentsLoading={commentsLoading}
          commentSearch={commentSearch}
          commentPersonFilter={commentPersonFilter}
          commentSentimentFilter={commentSentimentFilter}
          commentSort={commentSort}
          commentPage={commentPage}
          setCommentSearch={(value) => { setCommentSearch(value); setCommentPage(0); }}
          setCommentPersonFilter={(value) => { setCommentPersonFilter(value); setCommentPage(0); }}
          setCommentSentimentFilter={(value) => { setCommentSentimentFilter(value); setCommentPage(0); }}
          setCommentSort={(value) => { setCommentSort(value); setCommentPage(0); }}
          setCommentPage={setCommentPage}
          onNewAnalysis={newAnalysis}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenReview={() => setReviewOpen(true)}
          onRunAi={runAiInsight}
        />
      ) : (
        <StartScreen
          url={url}
          setUrl={setUrl}
          maxComments={maxComments}
          setMaxComments={setMaxComments}
          replyMode={replyMode}
          setReplyMode={setReplyMode}
          forceRefresh={forceRefresh}
          setForceRefresh={setForceRefresh}
          settings={settings}
          history={history}
          historyCount={dataSummary?.run_count ?? history.length}
          busy={busy}
          job={job}
          onSubmit={startRun}
          onOpenRun={openRun}
          onDeleteRun={deleteRuns}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {report ? (
        <ReviewCenter
          report={report}
          candidates={candidates}
          busy={busy || aiBusy || sentimentJob?.status === "queued" || sentimentJob?.status === "running"}
          open={reviewOpen}
          onClose={() => closeDialog(setReviewOpen, "review")}
          onCandidateAction={candidateAction}
          onSentimentAction={sentimentAction}
          onVerify={verifyReview}
          onRunAiAssist={() => run && void reanalyzeSentiment(run.run_id)}
        />
      ) : null}
      <SettingsPanel settings={settings} data={dataSummary} busy={busy} open={settingsOpen} onClose={() => closeDialog(setSettingsOpen, "settings")} onDataAction={dataAction} />
      <Toaster closeButton richColors position="bottom-right" />
    </>
  );
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function useSystemTheme() {
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => document.documentElement.classList.toggle("dark", media.matches);
    syncTheme();
    media.addEventListener("change", syncTheme);
    return () => media.removeEventListener("change", syncTheme);
  }, []);
}

function closeDialog(setOpen: (open: boolean) => void, trigger: "settings" | "review") {
  setOpen(false);
  window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-dialog-trigger="${trigger}"]:not([hidden])`)?.focus());
}

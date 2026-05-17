import { Dispatch, FormEvent, Fragment, ReactNode, SetStateAction, useEffect, useMemo, useState } from "react";

type RunState = {
  run_id: string;
  status: string;
  stage: string;
  progress: number;
  error_message?: string | null;
  created_at?: string;
  video?: VideoSummary;
  fetch_summary?: {
    source: string;
    max_comments_requested: number;
    max_comments_fetched: number;
    fetched_top_level_count: number;
    fetched_reply_count: number;
    fetch_order: string;
    reply_fetch_mode: string;
    fetched_at: string;
    coverage: FetchCoverage;
  };
};

type RunJob = {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  progress: number;
  run_id?: string | null;
  error_message?: string | null;
  queue_position?: number;
};

type RunCreateResponse = { run_id: string; status: string } | { job_id: string; status: string };

type SettingsInfo = {
  youtube_api_key_configured: boolean;
  youtube_api_key_env_name: string;
  data_dir: string;
  database_path: string;
  max_comments: { default: number; min: number; max: number };
  cluster_count: { default: number; min: number; max: number };
  reply_fetch_modes: Array<{ value: string; label: string; uses_extra_quota: boolean }>;
  fetch_orders: string[];
  llm_provider: string;
  embeddings_enabled: boolean;
};

type DataSummary = {
  data_dir: string;
  database_bytes: number;
  youtube_cache: { path: string; bytes: number; file_count: number };
  runs: { path: string; bytes: number; file_count: number };
  llm_cache: { path: string; bytes: number; file_count: number };
  archive: { path: string; bytes: number; file_count: number };
  total_bytes: number;
  run_count: number;
};

type VideoSummary = {
  youtube_video_id: string;
  url: string;
  title: string;
  channel_title: string;
  published_at?: string | null;
  youtube_comment_count?: number | null;
  comment_count_available: boolean;
  youtube_view_count?: number | null;
  youtube_like_count?: number | null;
};

type FetchCoverage = {
  status: string;
  message: string;
  youtube_comment_count?: number | null;
  comment_count_available: boolean;
  fetched_comment_count: number;
  max_comments_requested: number;
};

type LikeDistributionBucket = {
  label: string;
  count: number;
};

type Alias = {
  alias_id: string;
  alias_text: string;
  normalized_alias: string;
  hit_count: number;
  mention_comment_count: number;
  confidence: number;
  source: string;
  status: string;
  representative_comment_ids: string[];
  representative_comments: Array<{
    comment_id: string;
    text_original: string;
    like_count: number;
  }>;
};

type Person = {
  person_id: string;
  display_name: string;
  entity_type: string;
  status: string;
  confidence: number;
  reason: string;
  accepted_alias_hit_total: number;
  all_alias_hit_total: number;
  accepted_mention_comment_count: number;
  aliases: Alias[];
};

type CandidatesResponse = {
  run_id: string;
  persons: Person[];
};

type RankingRow = {
  person_id: string;
  display_name: string;
  mention_comment_count: number;
  mention_rate: number;
  top_comment_mention_count: number;
  single_mention_count: number;
  multi_mention_count: number;
  raw_like_sum: number;
  like_weighted_score: number;
  representative_comments: Array<{
    comment_id: string;
    text_original: string;
    like_count: number;
  }>;
};

type AliasSuggestion = {
  token: string;
  normalized_alias: string;
  hit_count: number;
  suggested_person_id?: string | null;
  suggested_person_name?: string | null;
  reason: string;
  representative_comments: Array<{
    comment_id: string;
    text_original: string;
    like_count: number;
    is_reply: boolean;
  }>;
};

type LlmAssist = {
  schema_version: string;
  prompt_version: string;
  provider: string;
  source: string;
  input_hash: string;
  status?: string;
  error_message?: string;
  candidate_recommendations: Array<{
    display_name: string;
    recommendation: string;
    reason: string;
    target_display_name?: string | null;
  }>;
  alias_recommendations: Array<{
    alias: string;
    target_display_name: string;
    confidence: string;
    reason: string;
  }>;
  ambiguous_comments: Array<{
    comment_id: string;
    suggested_display_name?: string | null;
    confidence: string;
    reason: string;
  }>;
  notes: string[];
};

type AppealPersonSummary = {
  person_id: string;
  display_name: string;
  comment_count: number;
  category_counts: Array<{
    category: string;
    label: string;
    count: number;
    representative_comment_ids: string[];
  }>;
  tone_counts: Record<"positive" | "neutral" | "mixed" | "negative" | "unclear", number>;
  dominant_tone: string;
  summary: string;
  feature_words: Array<{
    term: string;
    count: number;
    document_count: number;
    score: number;
  }>;
  evaluation_summary: {
    target_display_name: string;
    counts: { positive: number; negative: number };
    dominant: string;
    evidence_comments: Array<{
      comment_id: string;
      text_original: string;
      like_count: number;
      terms: Array<{ term: string; polarity: string }>;
    }>;
  };
  evidence_comments: Array<{
    comment_id: string;
    text_original: string;
    like_count: number;
  }>;
  negative_note?: string | null;
};

type CooccurrencePair = {
  person_a_id: string;
  person_a_name: string;
  person_b_id: string;
  person_b_name: string;
  cooccurrence_comment_count: number;
  like_weighted_score: number;
  relationship_category: string;
  representative_comments: Array<{
    comment_id: string;
    text_original: string;
    like_count: number;
  }>;
};

type CommentCluster = {
  cluster_id: string;
  label: string;
  comment_count: number;
  top_persons: Array<{ display_name: string; count: number }>;
  top_keywords: Array<{ term: string; count: number }>;
  summary: string;
  representative_comments: Array<{
    comment_id: string;
    text_original: string;
    like_count: number;
  }>;
};

type ReviewMention = {
  person_id: string;
  display_name: string;
  confidence: number;
  match_method: string;
};

type QualityReviewComment = {
  comment_id: string;
  text_original: string;
  like_count: number;
  is_reply: boolean;
  reason: string;
  mentioned_persons: ReviewMention[];
  suggested_display_name?: string | null;
  llm_confidence?: string | null;
};

type ReportComment = {
  comment_id: string;
  text_original: string;
  like_count: number;
  is_reply: boolean;
  parent_comment_id?: string | null;
  mentioned_persons: ReviewMention[];
};

type CommentsPage = {
  run_id: string;
  total: number;
  limit: number;
  offset: number;
  comments: ReportComment[];
};

type Report = {
  schema_version: string;
  run_id: string;
  video: {
    youtube_video_id: string;
    url: string;
    title: string;
    channel_title: string;
  } & VideoSummary;
  fetch_summary: {
    source: string;
    fetched_at: string;
    fetched_top_level_count: number;
    fetched_reply_count: number;
    max_comments_fetched: number;
    total_like_count: number;
    like_count_distribution: LikeDistributionBucket[];
    max_comments_requested: number;
    fetch_order: string;
    reply_fetch_mode: string;
    coverage: FetchCoverage;
  };
  analysis_config: {
    top_comment_definition?: string;
    top_comment_count?: number;
    like_weight_formula?: string;
  };
  rankings: {
    mention_ranking: RankingRow[];
  };
  persons: Person[];
  alias_suggestions: AliasSuggestion[];
  llm_assist?: LlmAssist | null;
  appeal_summary: {
    people: AppealPersonSummary[];
  };
  cooccurrence: {
    pairs: CooccurrencePair[];
    matrix: Array<{
      source: string;
      targets: Array<{ target: string; count: number }>;
    }>;
  };
  clusters: {
    method: string;
    requested_cluster_count: number;
    clusters: CommentCluster[];
  };
  quality_review: {
    low_confidence_comments: QualityReviewComment[];
    llm_ambiguous_comments: QualityReviewComment[];
    ai_dictionary_conflicts: QualityReviewComment[];
    human_review_items: QualityReviewComment[];
  };
  sections: Record<string, { status: string; reason?: string }>;
  comments: ReportComment[];
};

type ResultTab =
  | "candidates"
  | "dashboard"
  | "llm"
  | "quality"
  | "aliases"
  | "details"
  | "personComments"
  | "cooccurrence"
  | "clusters"
  | "comments";
type AliasReviewState = "alias_candidate" | "needs_review" | "common_word";
type CandidateEntityFilter = "needs_review" | "primary" | "non_primary" | "all";

const API_BASE = import.meta.env.DEV ? "" : (import.meta.env.VITE_API_BASE_URL ?? "");

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export default function App() {
  const [url, setUrl] = useState("");
  const [maxComments, setMaxComments] = useState(5000);
  const [clusterCount, setClusterCount] = useState(8);
  const [replyFetchMode, setReplyFetchMode] = useState<"none" | "inline_subset" | "full">("none");
  const [forceRefresh, setForceRefresh] = useState(false);
  const [activeTab, setActiveTab] = useState<ResultTab>("candidates");
  const [run, setRun] = useState<RunState | null>(null);
  const [runJob, setRunJob] = useState<RunJob | null>(null);
  const [runHistory, setRunHistory] = useState<RunState[]>([]);
  const [settingsInfo, setSettingsInfo] = useState<SettingsInfo | null>(null);
  const [dataSummary, setDataSummary] = useState<DataSummary | null>(null);
  const [candidates, setCandidates] = useState<CandidatesResponse | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [llmBusy, setLlmBusy] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [displayNameDrafts, setDisplayNameDrafts] = useState<Record<string, string>>({});
  const [aliasSuggestionDrafts, setAliasSuggestionDrafts] = useState<Record<string, string>>({});
  const [ignoredAliasSuggestions, setIgnoredAliasSuggestions] = useState<Record<string, boolean>>({});
  const [aliasSuggestionReview, setAliasSuggestionReview] = useState<Record<string, AliasReviewState>>({});
  const [mergeDrafts, setMergeDrafts] = useState<Record<string, string>>({});
  const [candidateEntityFilter, setCandidateEntityFilter] = useState<CandidateEntityFilter>("primary");
  const [candidateReviewIndex, setCandidateReviewIndex] = useState(0);
  const [commentSearch, setCommentSearch] = useState("");
  const [commentPersonFilter, setCommentPersonFilter] = useState("all");
  const [commentPage, setCommentPage] = useState(0);
  const [commentPageSize, setCommentPageSize] = useState(100);
  const [commentsPageData, setCommentsPageData] = useState<CommentsPage | null>(null);
  const [personCommentPage, setPersonCommentPage] = useState(0);
  const [personCommentPageSize, setPersonCommentPageSize] = useState(100);
  const [personCommentsPageData, setPersonCommentsPageData] = useState<CommentsPage | null>(null);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsRefreshKey, setCommentsRefreshKey] = useState(0);
  const [commentPersonDrafts, setCommentPersonDrafts] = useState<Record<string, string>>({});
  const [selectedDetailPersonId, setSelectedDetailPersonId] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const candidateSummary = useMemo(() => {
    const persons = candidates?.persons ?? [];
    const primaryPersons = persons.filter((person) => isPrimaryEntityType(person.entity_type));
    return {
      accepted: persons.filter((person) => person.status === "accepted").length,
      rejected: persons.filter((person) => person.status === "rejected").length,
      pending: persons.filter((person) => person.status !== "accepted" && person.status !== "rejected").length,
      pendingPrimary: primaryPersons.filter(isPendingCandidate).length,
      pendingNonPrimary: persons.filter((person) => !isPrimaryEntityType(person.entity_type) && isPendingCandidate(person)).length,
      total: persons.length,
      nonPrimary: persons.filter((person) => !isPrimaryEntityType(person.entity_type)).length
    };
  }, [candidates]);

  const visibleCandidatePersons = useMemo(() => {
    return filterCandidatePersons(candidates?.persons ?? [], candidateEntityFilter);
  }, [candidateEntityFilter, candidates]);

  const decidedPrimaryCandidatePersons = useMemo(() => {
    return (candidates?.persons ?? [])
      .filter((person) => ["accepted", "rejected"].includes(person.status) && isPrimaryEntityType(person.entity_type))
      .sort((a, b) => {
        if (a.status !== b.status) return a.status === "accepted" ? -1 : 1;
        return b.accepted_mention_comment_count - a.accepted_mention_comment_count;
      });
  }, [candidates]);

  const pendingPrimaryCandidatePersons = useMemo(() => {
    return (candidates?.persons ?? [])
      .filter((person) => isPrimaryEntityType(person.entity_type) && isPendingCandidate(person))
      .sort((a, b) => b.accepted_mention_comment_count - a.accepted_mention_comment_count);
  }, [candidates]);

  const currentCandidatePerson = visibleCandidatePersons[candidateReviewIndex] ?? null;
  const pendingQueueIndex = currentCandidatePerson
    ? pendingPrimaryCandidatePersons.findIndex((person) => person.person_id === currentCandidatePerson.person_id)
    : -1;

  const commentPersonOptions = useMemo(() => {
    return report?.rankings.mention_ranking.map((row) => ({ person_id: row.person_id, display_name: row.display_name })) ?? [];
  }, [report]);

  const assignablePersons = useMemo(() => {
    return report?.persons.filter((person) => person.status === "accepted") ?? [];
  }, [report]);

  const visibleAliasSuggestions = useMemo(() => {
    return (report?.alias_suggestions ?? []).filter((suggestion) => !ignoredAliasSuggestions[suggestion.normalized_alias]);
  }, [ignoredAliasSuggestions, report]);

  const frequentReviewGroups = useMemo(() => {
    const suggestions = visibleAliasSuggestions.map((suggestion) => ({
      suggestion,
      reviewState: aliasSuggestionReview[suggestion.normalized_alias] ?? defaultAliasReviewState(suggestion)
    }));
    return {
      personCandidates: report?.persons.filter((person) => person.status !== "rejected") ?? [],
      aliasCandidates: suggestions.filter((item) => item.reviewState === "alias_candidate"),
      needsReview: suggestions.filter((item) => item.reviewState === "needs_review"),
      commonWords: suggestions.filter((item) => item.reviewState === "common_word")
    };
  }, [aliasSuggestionReview, report, visibleAliasSuggestions]);

  useEffect(() => {
    setCandidateReviewIndex(0);
  }, [candidateEntityFilter, candidates?.run_id]);

  const selectedDetailPerson = useMemo(() => {
    if (!report?.rankings.mention_ranking.length) return null;
    return (
      report.rankings.mention_ranking.find((row) => row.person_id === selectedDetailPersonId) ??
      report.rankings.mention_ranking[0]
    );
  }, [report, selectedDetailPersonId]);

  const selectedPersonDetails = useMemo(() => {
    if (!report || !selectedDetailPerson) return null;
    const person = report.persons.find((item) => item.person_id === selectedDetailPerson.person_id);
    const appeal = report.appeal_summary.people.find((item) => item.person_id === selectedDetailPerson.person_id);
    const comments = report.comments
      .filter((comment) => comment.mentioned_persons.some((mentioned) => mentioned.person_id === selectedDetailPerson.person_id))
      .sort((a, b) => b.like_count - a.like_count);
    const aliases = person?.aliases.filter((alias) => alias.status === "accepted") ?? [];
    return {
      person,
      appeal,
      comments,
      aliases,
      featureWords: appeal?.feature_words ?? []
    };
  }, [report, selectedDetailPerson]);

  const dashboardStats = useMemo(() => {
    if (!report) return null;
    const totalComments = report.fetch_summary.max_comments_fetched;
    const replyCount = report.fetch_summary.fetched_reply_count;
    const mentionedComments = report.comments.filter((comment) => comment.mentioned_persons.length > 0).length;
    const unassignedComments = Math.max(report.comments.length - mentionedComments, 0);
    const topPerson = report.rankings.mention_ranking[0] ?? null;
    const maxMentionCount = Math.max(...report.rankings.mention_ranking.map((row) => row.mention_comment_count), 1);
    return {
      totalComments,
      replyCount,
      mentionedComments,
      unassignedComments,
      topPerson,
      maxMentionCount,
      acceptedPersons: report.persons.filter((person) => person.status === "accepted").length
    };
  }, [report]);

  useEffect(() => {
    void refreshRunHistory();
    void refreshOpsInfo();
  }, []);

  useEffect(() => {
    setCandidateReviewIndex(0);
  }, [candidateEntityFilter, candidates?.run_id]);

  useEffect(() => {
    if (candidateReviewIndex >= visibleCandidatePersons.length) {
      setCandidateReviewIndex(Math.max(visibleCandidatePersons.length - 1, 0));
    }
  }, [candidateReviewIndex, visibleCandidatePersons.length]);

  useEffect(() => {
    setCommentPage(0);
  }, [commentPersonFilter, commentSearch, commentPageSize, report?.run_id]);

  useEffect(() => {
    setPersonCommentPage(0);
  }, [personCommentPageSize, report?.run_id, selectedDetailPersonId]);

  useEffect(() => {
    if (!run || !report || activeTab !== "comments") return;
    let active = true;
    setCommentsLoading(true);
    const params = new URLSearchParams({
      limit: String(commentPageSize),
      offset: String(commentPage * commentPageSize)
    });
    if (commentSearch.trim()) params.set("search", commentSearch.trim());
    if (commentPersonFilter !== "all") params.set("person_id", commentPersonFilter);
    api<CommentsPage>(`/api/runs/${run.run_id}/comments?${params.toString()}`)
      .then((page) => {
        if (active) setCommentsPageData(page);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setCommentsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, commentPage, commentPageSize, commentPersonFilter, commentSearch, commentsRefreshKey, report, run]);

  useEffect(() => {
    if (!run || !report || activeTab !== "personComments" || !selectedDetailPersonId) return;
    let active = true;
    setCommentsLoading(true);
    const params = new URLSearchParams({
      limit: String(personCommentPageSize),
      offset: String(personCommentPage * personCommentPageSize),
      person_id: selectedDetailPersonId
    });
    api<CommentsPage>(`/api/runs/${run.run_id}/comments?${params.toString()}`)
      .then((page) => {
        if (active) setPersonCommentsPageData(page);
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setCommentsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeTab, commentsRefreshKey, personCommentPage, personCommentPageSize, report, run, selectedDetailPersonId]);

  async function refreshRunHistory() {
    try {
      const response = await api<{ runs: RunState[] }>("/api/runs");
      setRunHistory(response.runs);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function refreshOpsInfo() {
    try {
      const [settings, data] = await Promise.all([api<SettingsInfo>("/api/settings"), api<DataSummary>("/api/data/summary")]);
      setSettingsInfo(settings);
      setDataSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function openRunExport() {
    if (!run) return;
    window.open(`${API_BASE}/api/runs/${run.run_id}/export`, "_blank", "noopener,noreferrer");
  }

  async function runDataAction(action: "archive_run" | "delete_run" | "archive_youtube_cache" | "delete_youtube_cache", runId?: string) {
    const message =
      action === "delete_run"
        ? "この run を削除します。元に戻せません。"
        : action === "archive_run"
          ? "この run の artifact を退避し、一覧から外します。"
          : action === "delete_youtube_cache"
            ? "YouTube cache を削除します。次回同条件でも API 再取得が必要になります。"
            : "YouTube cache を archive に退避します。";
    if (!window.confirm(message)) return;
    setBusy(true);
    setError(null);
    setLastAction(null);
    try {
      await api("/api/data/actions", {
        method: "POST",
        body: JSON.stringify({ action, run_id: runId })
      });
      if (runId && run?.run_id === runId) {
        setRun(null);
        setCandidates(null);
        setReport(null);
      }
      await refreshRunHistory();
      await refreshOpsInfo();
      setLastAction("データ管理操作を実行しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function openRun(runId: string) {
    setBusy(true);
    setLastAction(null);
    setError(null);
    setReport(null);
    setRunJob(null);
    try {
      const state = await api<RunState>(`/api/runs/${runId}`);
      const nextCandidates = await api<CandidatesResponse>(`/api/runs/${runId}/candidates`);
      let nextReport: Report | null = null;
      try {
        nextReport = await api<Report>(`/api/runs/${runId}/report`);
      } catch {
        nextReport = null;
      }
      setRun(state);
      setCandidates(nextCandidates);
      setActiveTab(nextReport ? "dashboard" : "candidates");
      setReport(nextReport);
      setUrl(state.video?.url ?? url);
      setMaxComments(state.fetch_summary?.max_comments_requested ?? maxComments);
      setReplyFetchMode((state.fetch_summary?.reply_fetch_mode as "none" | "inline_subset" | "full") ?? replyFetchMode);
      setLastAction("過去分析を読み込みました");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function startRun(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setLastAction(null);
    setError(null);
    setReport(null);
    try {
      const created = await api<RunCreateResponse>("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          url,
          max_comments: maxComments,
          cluster_count: clusterCount,
          reply_fetch_mode: replyFetchMode,
          fetch_order: "relevance",
          force_refresh: forceRefresh,
          use_llm: false,
          use_embeddings: false
        })
      });
      if ("job_id" in created) {
        const completed = await waitForRunJob(created.job_id);
        if (!completed.run_id) throw new Error(completed.error_message || "job completed without run_id");
        const state = await api<RunState>(`/api/runs/${completed.run_id}`);
        const nextCandidates = await api<CandidatesResponse>(`/api/runs/${completed.run_id}/candidates`);
        setRun(state);
        setCandidates(nextCandidates);
      } else {
        const state = await api<RunState>(`/api/runs/${created.run_id}`);
        const nextCandidates = await api<CandidatesResponse>(`/api/runs/${created.run_id}/candidates`);
        setRun(state);
        setCandidates(nextCandidates);
      }
      setActiveTab("candidates");
      await refreshRunHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function waitForRunJob(jobId: string): Promise<RunJob> {
    while (true) {
      const job = await api<RunJob>(`/api/jobs/${jobId}`);
      setRunJob(job);
      if (job.status === "completed") return job;
      if (job.status === "failed") throw new Error(job.error_message || "分析 job が失敗しました");
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
  }

  async function updateCandidate(
    action: {
      type: string;
      person_id?: string;
      alias_id?: string;
      alias_text?: string;
      display_name?: string;
      source_person_id?: string;
      target_person_id?: string;
    },
    label: string
  ) {
    if (!run) return;
    setBusy(true);
    setUpdatingId(action.person_id ?? action.alias_id ?? null);
    setLastAction(null);
    setError(null);
    try {
      await api(`/api/runs/${run.run_id}/candidate-actions`, {
        method: "POST",
        body: JSON.stringify({ actions: [action] })
      });
      const nextCandidates = await api<CandidatesResponse>(`/api/runs/${run.run_id}/candidates`);
      setCandidates(nextCandidates);
      if (shouldAdvanceCandidateCard(action.type)) {
        setCandidateReviewIndex((index) => {
          if (candidateEntityFilter === "needs_review") return index;
          return Math.min(index + 1, Math.max(visibleCandidatePersons.length - 1, 0));
        });
      }
      setLastAction(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setUpdatingId(null);
    }
  }

  function jumpToCandidate(personId: string, filter: CandidateEntityFilter = "primary") {
    const persons = candidates?.persons ?? [];
    const nextVisiblePersons = filterCandidatePersons(persons, filter);
    const nextIndex = nextVisiblePersons.findIndex((person) => person.person_id === personId);
    setCandidateEntityFilter(filter);
    setCandidateReviewIndex(Math.max(nextIndex, 0));
  }

  function jumpPendingCandidate(direction: "previous" | "next") {
    if (!pendingPrimaryCandidatePersons.length) return;
    const fallbackIndex = direction === "previous" ? pendingPrimaryCandidatePersons.length - 1 : 0;
    const currentIndex = pendingQueueIndex >= 0 ? pendingQueueIndex : fallbackIndex;
    const nextIndex =
      direction === "previous"
        ? (currentIndex - 1 + pendingPrimaryCandidatePersons.length) % pendingPrimaryCandidatePersons.length
        : (currentIndex + 1) % pendingPrimaryCandidatePersons.length;
    jumpToCandidate(pendingPrimaryCandidatePersons[nextIndex].person_id, "primary");
  }

  function openPersonComments(personId: string) {
    setSelectedDetailPersonId(personId);
    setPersonCommentPage(0);
    setActiveTab("personComments");
  }

  async function updateDisplayName(person: Person) {
    const displayName = (displayNameDrafts[person.person_id] ?? person.display_name).trim();
    if (!displayName || displayName === person.display_name) return;
    await updateCandidate(
      { type: "update_display_name", person_id: person.person_id, display_name: displayName },
      `${person.display_name} の表示名を ${displayName} に更新しました`
    );
  }

  async function mergePerson(person: Person) {
    const targetPersonId = mergeDrafts[person.person_id];
    if (!targetPersonId) return;
    const target = candidates?.persons.find((candidate) => candidate.person_id === targetPersonId);
    await updateCandidate(
      { type: "merge_person", source_person_id: person.person_id, target_person_id: targetPersonId },
      `${person.display_name} を ${target?.display_name ?? "選択した人物"} に統合しました`
    );
    setMergeDrafts((drafts) => ({ ...drafts, [person.person_id]: "" }));
  }

  async function splitMergedPerson(person: Person) {
    await updateCandidate(
      { type: "split_merged_person", person_id: person.person_id },
      `${person.display_name} の統合を解除しました`
    );
  }

  async function continueRun() {
    if (!run) return;
    setBusy(true);
    setLastAction(null);
    setError(null);
    try {
      const state = await api<RunState>(`/api/runs/${run.run_id}/continue`, { method: "POST" });
      const nextReport = await api<Report>(`/api/runs/${run.run_id}/report`);
      setRun(state);
      setReport(nextReport);
      setActiveTab("dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function updateCommentMention(action: { type: "add_mention" | "remove_mention"; comment_id: string; person_id: string }) {
    if (!run) return;
    setBusy(true);
    setLastAction(null);
    setError(null);
    try {
      const nextReport = await api<Report>(`/api/runs/${run.run_id}/comment-actions`, {
        method: "POST",
        body: JSON.stringify({ actions: [action] })
      });
      setReport(nextReport);
      setCommentsRefreshKey((key) => key + 1);
      setLastAction(action.type === "add_mention" ? "コメントに人物を追加しました" : "コメントから人物を外しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function acceptAliasSuggestion(suggestion: AliasSuggestion, selectedPersonId?: string) {
    if (!run) return;
    const personId = selectedPersonId || aliasSuggestionDrafts[suggestion.normalized_alias] || suggestion.suggested_person_id || "";
    if (!personId) return;
    setBusy(true);
    setLastAction(null);
    setError(null);
    try {
      await api(`/api/runs/${run.run_id}/candidate-actions`, {
        method: "POST",
        body: JSON.stringify({
          actions: [
            {
              type: "add_alias",
              person_id: personId,
              alias_text: suggestion.token
            }
          ]
        })
      });
      const state = await api<RunState>(`/api/runs/${run.run_id}/continue`, { method: "POST" });
      const nextCandidates = await api<CandidatesResponse>(`/api/runs/${run.run_id}/candidates`);
      const nextReport = await api<Report>(`/api/runs/${run.run_id}/report`);
      setRun(state);
      setCandidates(nextCandidates);
      setReport(nextReport);
      setIgnoredAliasSuggestions((ignored) => ({ ...ignored, [suggestion.normalized_alias]: true }));
      setAliasSuggestionReview((reviews) => {
        const { [suggestion.normalized_alias]: _removed, ...rest } = reviews;
        return rest;
      });
      setLastAction(`表記「${suggestion.token}」を alias に追加しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function runLlmAssist() {
    if (!run) return;
    setLlmBusy(true);
    setLastAction(null);
    setError(null);
    try {
      const result = await api<LlmAssist>(`/api/runs/${run.run_id}/llm-assist`, { method: "POST" });
      const nextReport = await api<Report>(`/api/runs/${run.run_id}/report`);
      setReport(nextReport);
      setLastAction(result.status === "failed" ? "LLM 補助だけ失敗しました。通常レポートは有効です。" : "LLM 補助分析を更新しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLlmBusy(false);
    }
  }

  async function applyLlmAssist() {
    if (!run || !report?.llm_assist || report.llm_assist.status === "failed") return;
    const candidateActions: Array<Record<string, string>> = [];
    const commentActions: Array<Record<string, string>> = [];
    const personsByName = new Map((candidates?.persons ?? report.persons).map((person) => [person.display_name, person]));

    for (const item of report.llm_assist.candidate_recommendations) {
      const person = personsByName.get(item.display_name);
      if (!person) continue;
      if (item.recommendation === "accept") {
        candidateActions.push({ type: "accept_person", person_id: person.person_id });
      } else if (item.recommendation === "reject") {
        candidateActions.push({ type: "reject_person", person_id: person.person_id });
      } else if (item.recommendation === "merge" && item.target_display_name) {
        const target = personsByName.get(item.target_display_name);
        if (target && target.person_id !== person.person_id) {
          candidateActions.push({ type: "merge_person", source_person_id: person.person_id, target_person_id: target.person_id });
        }
      }
    }

    for (const item of report.llm_assist.alias_recommendations) {
      if (item.confidence === "low") continue;
      const target = personsByName.get(item.target_display_name);
      if (target) {
        candidateActions.push({ type: "add_alias", person_id: target.person_id, alias_text: item.alias });
      }
    }

    for (const item of report.llm_assist.ambiguous_comments) {
      if (!item.suggested_display_name || item.confidence === "low") continue;
      const target = personsByName.get(item.suggested_display_name);
      if (target) {
        commentActions.push({ type: "add_mention", comment_id: item.comment_id, person_id: target.person_id });
      }
    }

    if (!candidateActions.length && !commentActions.length) {
      setLastAction("反映できる LLM 提案はありません");
      return;
    }

    setBusy(true);
    setLastAction(null);
    setError(null);
    try {
      if (candidateActions.length) {
        await api(`/api/runs/${run.run_id}/candidate-actions`, {
          method: "POST",
          body: JSON.stringify({ actions: candidateActions })
        });
      }
      let nextReport: Report;
      if (commentActions.length) {
        nextReport = await api<Report>(`/api/runs/${run.run_id}/comment-actions`, {
          method: "POST",
          body: JSON.stringify({ actions: commentActions })
        });
      } else {
        const nextRun = await api<RunState>(`/api/runs/${run.run_id}/continue`, { method: "POST" });
        setRun(nextRun);
        nextReport = await api<Report>(`/api/runs/${run.run_id}/report`);
      }
      const nextCandidates = await api<CandidatesResponse>(`/api/runs/${run.run_id}/candidates`);
      setCandidates(nextCandidates);
      setReport(nextReport);
      setLastAction(`LLM 提案を反映しました（候補 ${candidateActions.length} 件 / コメント ${commentActions.length} 件）`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function setAliasReviewState(suggestion: AliasSuggestion, reviewState: AliasReviewState) {
    setAliasSuggestionReview((reviews) => ({
      ...reviews,
      [suggestion.normalized_alias]: reviewState
    }));
    setLastAction(`「${suggestion.token}」を ${aliasReviewStateLabel(reviewState)} に分類しました`);
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero__intro">
          <h1>
            <span>YouTube コメント</span>
            <span>人物言及分析</span>
          </h1>
          <p>
            コメントを保存してから候補抽出、alias 確認、人物別ランキングまでをローカルで実行します。
            API キーなしでも fixture で検証できます。
          </p>
        </div>
        <form className="start-form" onSubmit={startRun}>
          <label className="start-form__url-field">
            YouTube URL
            <input value={url} onChange={(event) => setUrl(event.target.value)} />
          </label>
          <div className="start-form__settings">
            <span className="start-form__settings-title">詳細設定</span>
            <div className="start-form__number-fields">
              <label>
                最大コメント数
                <input
                  type="number"
                  min="1"
                  max="5000"
                  value={maxComments}
                  onChange={(event) => setMaxComments(Number(event.target.value))}
                />
              </label>
              <label>
                クラスタ数
                <input
                  type="number"
                  min="5"
                  max="12"
                  value={clusterCount}
                  onChange={(event) => setClusterCount(Number(event.target.value))}
                />
                <small className="field-note">コメントクラスタリングの目安です。5 から 12 の範囲で指定します。</small>
              </label>
            </div>
            <label className="start-form__wide-field">
              返信コメント
              <select value={replyFetchMode} onChange={(event) => setReplyFetchMode(event.target.value as "none" | "inline_subset" | "full")}>
                <option value="none">トップレベルのみ</option>
                <option value="inline_subset">同梱返信だけ含める</option>
                <option value="full">返信を追加取得して含める</option>
              </select>
              <small className="field-note">{replyFetchModeDescription(replyFetchMode)}</small>
            </label>
            <label className="checkbox-label">
              <input type="checkbox" checked={forceRefresh} onChange={(event) => setForceRefresh(event.target.checked)} />
              差分更新する
              <small>同条件 cache があっても YouTube API を再取得し、重複を除いて cache を更新します。</small>
            </label>
          </div>
          <button type="submit" disabled={busy}>
            {busy ? "処理中" : "分析を開始"}
          </button>
        </form>
      </section>

      {error ? <div className="error-box">{error}</div> : null}

      {runJob && runJob.status !== "completed" ? (
        <section className="panel status-panel">
          <div className="status-panel__wide">
            <span className="label">Job</span>
            <strong>{runJob.status === "queued" ? "待機中" : runJob.status === "running" ? "実行中" : "失敗"}</strong>
            <small>
              {runJob.stage}
              {runJob.queue_position ? ` / queue ${runJob.queue_position}` : ""}
            </small>
          </div>
          <progress value={runJob.progress} max={1} />
          {runJob.error_message ? <div className="status-warning">{runJob.error_message}</div> : null}
        </section>
      ) : null}

      <section className="utility-panels">
        <details className="panel history-panel">
          <summary>
            <div>
              <h2>過去分析</h2>
              <p>保存済み run を読み込みます。同じ取得条件のコメントは cache から再利用されます。</p>
            </div>
            <strong>{runHistory.length} 件</strong>
          </summary>
          <div className="history-panel__body">
          <div className="section-heading">
            <div>
              <h3>保存済み run</h3>
              <p>必要な run だけ開いて候補・レポートを復元します。</p>
            </div>
            <button type="button" onClick={refreshRunHistory} disabled={busy}>
              更新
            </button>
          </div>
          {runHistory.length ? (
            <div className="history-list">
              {runHistory.map((historyRun) => (
                <article className={historyRun.run_id === run?.run_id ? "history-card history-card--active" : "history-card"} key={historyRun.run_id}>
                  <div>
                    <h3>{historyRun.video?.title || historyRun.video?.youtube_video_id || historyRun.run_id}</h3>
                    <p>
                      {historyRun.video?.channel_title || "チャンネル未取得"} / {formatDateTime(historyRun.created_at)}
                    </p>
                    <small>
                      {sourceLabel(historyRun.fetch_summary?.source ?? "")} / {historyRun.fetch_summary?.max_comments_fetched ?? 0} 件 /{" "}
                      {replyFetchModeLabel(historyRun.fetch_summary?.reply_fetch_mode ?? "none")}
                    </small>
                  </div>
                  <button type="button" onClick={() => openRun(historyRun.run_id)} disabled={busy}>
                    開く
                  </button>
                  <button type="button" onClick={() => runDataAction("archive_run", historyRun.run_id)} disabled={busy}>
                    退避
                  </button>
                  <button type="button" onClick={() => runDataAction("delete_run", historyRun.run_id)} disabled={busy}>
                    削除
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <p className="list-note">保存済み run はまだありません。</p>
          )}
          </div>
        </details>

        <details className="panel ops-panel">
          <summary>
            <div>
              <h2>運用・設定・データ管理</h2>
              <p>API key の読み込み状態、取得設定、保存データ容量、export 導線を確認します。</p>
            </div>
            <strong>{dataSummary ? formatBytes(dataSummary.total_bytes) : "未取得"}</strong>
          </summary>
          <div className="history-panel__body">
          <div className="section-heading">
            <div>
              <h3>設定状態</h3>
              <p>秘密値は表示せず、読み込み状態だけを出します。</p>
            </div>
            <button type="button" onClick={refreshOpsInfo} disabled={busy}>
              更新
            </button>
          </div>
          <div className="ops-grid">
            <div>
              <span className="label">{settingsInfo?.youtube_api_key_env_name ?? "YOUTUBE_API_KEY"}</span>
              <strong>{settingsInfo?.youtube_api_key_configured ? "設定済み" : "未設定"}</strong>
              <small>値そのものは表示しません。</small>
            </div>
            <div>
              <span className="label">LLM</span>
              <strong>{settingsInfo?.llm_provider ?? "codex_app_server"}</strong>
              <small>追加 API key なしで Codex app server を使います。</small>
            </div>
            <div>
              <span className="label">Embeddings</span>
              <strong>{settingsInfo?.embeddings_enabled ? "有効" : "無効"}</strong>
              <small>現在のクラスタリングは特徴語ベースです。</small>
            </div>
            <div>
              <span className="label">Max Comments</span>
              <strong>{settingsInfo?.max_comments.max ?? 5000}</strong>
              <small>画面から 1〜5000 の範囲で指定します。</small>
            </div>
            <div>
              <span className="label">Cluster Count</span>
              <strong>
                {settingsInfo?.cluster_count.min ?? 5}〜{settingsInfo?.cluster_count.max ?? 12}
              </strong>
              <small>新規分析時のクラスタ数です。</small>
            </div>
            <div>
              <span className="label">Data Dir</span>
              <strong>{dataSummary?.run_count ?? 0} runs</strong>
              <small>{settingsInfo?.data_dir ?? dataSummary?.data_dir}</small>
            </div>
          </div>
          {dataSummary ? (
            <div className="data-summary-grid">
              <div>
                <strong>Database</strong>
                <span>{formatBytes(dataSummary.database_bytes)}</span>
              </div>
              <div>
                <strong>YouTube cache</strong>
                <span>
                  {formatBytes(dataSummary.youtube_cache.bytes)} / {dataSummary.youtube_cache.file_count} files
                </span>
              </div>
              <div>
                <strong>Runs</strong>
                <span>
                  {formatBytes(dataSummary.runs.bytes)} / {dataSummary.runs.file_count} files
                </span>
              </div>
              <div>
                <strong>LLM cache</strong>
                <span>
                  {formatBytes(dataSummary.llm_cache.bytes)} / {dataSummary.llm_cache.file_count} files
                </span>
              </div>
              <div>
                <strong>Archive</strong>
                <span>
                  {formatBytes(dataSummary.archive.bytes)} / {dataSummary.archive.file_count} files
                </span>
              </div>
            </div>
          ) : null}
          <div className="ops-actions">
            <button type="button" onClick={openRunExport} disabled={!run}>
              現在の run を JSON export
            </button>
            <button type="button" onClick={() => runDataAction("archive_run", run?.run_id)} disabled={!run || busy}>
              現在の run を退避
            </button>
            <button type="button" onClick={() => runDataAction("delete_run", run?.run_id)} disabled={!run || busy}>
              現在の run を削除
            </button>
            <button type="button" onClick={() => runDataAction("archive_youtube_cache")} disabled={busy || !dataSummary?.youtube_cache.file_count}>
              YouTube cache を退避
            </button>
            <button type="button" onClick={() => runDataAction("delete_youtube_cache")} disabled={busy || !dataSummary?.youtube_cache.file_count}>
              YouTube cache を削除
            </button>
            <small>export は明示操作だけで実行します。通常 test は fixture を使い、live API test とは分けて扱います。</small>
          </div>
          </div>
        </details>
      </section>

      {run ? (
        <section className="panel status-panel status-panel--run">
          <div className="run-overview">
            {run.video ? (
              <div className="run-video">
                <span className="label">Video</span>
                <strong>{run.video.title || run.video.youtube_video_id}</strong>
                <small>
                  {run.video.channel_title || "チャンネル未取得"} / YouTube表示 {formatNullableNumber(run.video.youtube_comment_count)}
                </small>
              </div>
            ) : null}
            <div className="run-badges" aria-label="run 状態">
              <span title={run.run_id}>#{shortRunId(run.run_id)}</span>
              <span>{runStatusLabel(run.status)}</span>
              <span>{runStageLabel(run.stage)}</span>
            </div>
          </div>
          {run.fetch_summary ? (
            <div className="run-metrics">
              <div className="run-metric" title={sourceNote(run.fetch_summary.source)}>
                <span aria-hidden="true">◉</span>
                <div>
                  <small>Source</small>
                  <strong>{sourceLabel(run.fetch_summary.source)}</strong>
                </div>
              </div>
              <div className="run-metric">
                <span aria-hidden="true">#</span>
                <div>
                  <small>Comments</small>
                  <strong>
                    {run.fetch_summary.max_comments_fetched} / {run.fetch_summary.max_comments_requested}
                  </strong>
                  <em>{run.fetch_summary.fetch_order}</em>
                </div>
              </div>
              <div className="run-metric">
                <span aria-hidden="true">↩</span>
                <div>
                  <small>Replies</small>
                  <strong>{run.fetch_summary.fetched_reply_count} 件</strong>
                  <em>{replyFetchModeLabel(run.fetch_summary.reply_fetch_mode)}</em>
                </div>
              </div>
              <div className="run-metric run-metric--coverage" title={run.fetch_summary.coverage.message}>
                <span aria-hidden="true">▣</span>
                <div>
                  <small>Coverage</small>
                  <strong>{coverageLabel(run.fetch_summary.coverage.status)}</strong>
                  <em>{run.fetch_summary.coverage.message}</em>
                </div>
              </div>
            </div>
          ) : null}
          <progress className="run-progress" value={run.progress} max={1} />
          {run.fetch_summary && run.fetch_summary.coverage.status !== "complete_or_near_complete" ? (
            <div className="status-warning">
              要求 {run.fetch_summary.max_comments_requested} 件 / 取得 {run.fetch_summary.max_comments_fetched} 件
              {run.fetch_summary.coverage.comment_count_available
                ? ` / YouTube表示 ${formatNullableNumber(run.fetch_summary.coverage.youtube_comment_count)} 件`
                : " / YouTube表示コメント数は未取得"}
              。{run.fetch_summary.coverage.message}
            </div>
          ) : null}
        </section>
      ) : null}

      {candidates || report ? (
        <nav className="result-tabs" aria-label="分析結果の表示切り替え">
          <button
            type="button"
            className={activeTab === "candidates" ? "result-tabs__item result-tabs__item--active" : "result-tabs__item"}
            onClick={() => setActiveTab("candidates")}
            disabled={!candidates}
          >
            候補確認
          </button>
          <button
            type="button"
            className={activeTab === "dashboard" ? "result-tabs__item result-tabs__item--active" : "result-tabs__item"}
            onClick={() => setActiveTab("dashboard")}
            disabled={!report}
          >
            概要
          </button>
          <button
            type="button"
            className={activeTab === "llm" ? "result-tabs__item result-tabs__item--active" : "result-tabs__item"}
            onClick={() => setActiveTab("llm")}
            disabled={!report}
          >
            LLM補助
          </button>
          <button
            type="button"
            className={activeTab === "quality" ? "result-tabs__item result-tabs__item--active" : "result-tabs__item"}
            onClick={() => setActiveTab("quality")}
            disabled={!report}
          >
            要確認
          </button>
          <button
            type="button"
            className={activeTab === "aliases" ? "result-tabs__item result-tabs__item--active" : "result-tabs__item"}
            onClick={() => setActiveTab("aliases")}
            disabled={!report}
          >
            頻出語レビュー
          </button>
          <button
            type="button"
            className={activeTab === "details" ? "result-tabs__item result-tabs__item--active" : "result-tabs__item"}
            onClick={() => setActiveTab("details")}
            disabled={!report}
          >
            人物詳細
          </button>
          <button
            type="button"
            className={activeTab === "personComments" ? "result-tabs__item result-tabs__item--active" : "result-tabs__item"}
            onClick={() => setActiveTab("personComments")}
            disabled={!report}
          >
            人物コメント
          </button>
          <button
            type="button"
            className={activeTab === "cooccurrence" ? "result-tabs__item result-tabs__item--active" : "result-tabs__item"}
            onClick={() => setActiveTab("cooccurrence")}
            disabled={!report}
          >
            関係性
          </button>
          <button
            type="button"
            className={activeTab === "clusters" ? "result-tabs__item result-tabs__item--active" : "result-tabs__item"}
            onClick={() => setActiveTab("clusters")}
            disabled={!report}
          >
            クラスタ
          </button>
          <button
            type="button"
            className={activeTab === "comments" ? "result-tabs__item result-tabs__item--active" : "result-tabs__item"}
            onClick={() => setActiveTab("comments")}
            disabled={!report}
          >
            コメント
          </button>
        </nav>
      ) : null}

      {candidates && activeTab === "candidates" ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>人物候補と alias</h2>
              <p>人物ごとに、その人物として数える表記をまとめています。採用済み表記だけで集計します。</p>
              <AnalysisHelp>
                最初に確認する画面です。タイトルやコメントから人物・グループ候補を作り、同じ人物を指す短い呼び名を alias としてまとめます。
                ここで採用した人物と表記だけが、以降のランキングやコメント紐づけに使われます。
              </AnalysisHelp>
            </div>
            <button disabled={busy || candidateSummary.accepted === 0} onClick={continueRun}>
              候補を確定して集計
            </button>
          </div>
          <div className="filter-bar">
            <label>
              候補の表示範囲
              <select value={candidateEntityFilter} onChange={(event) => setCandidateEntityFilter(event.target.value as CandidateEntityFilter)}>
                <option value="needs_review">要確認のみ</option>
                <option value="primary">人物・グループ・コンビのみ</option>
                <option value="non_primary">人物外候補のみ</option>
                <option value="all">すべて表示</option>
              </select>
            </label>
            <small>概要欄やタイトルで強く判定した人物は自動採用し、上の主要キーワードに常時表示します。</small>
          </div>
          <div className="candidate-deck">
            <div>
              <span className="label">Review Queue</span>
              <strong>
                {visibleCandidatePersons.length ? `${candidateReviewIndex + 1} / ${visibleCandidatePersons.length}` : "0 / 0"}
              </strong>
              <small>
                {candidateEntityFilter === "needs_review"
                  ? "保留中の人物候補だけを移動します。"
                  : "採用または除外すると、この表示範囲の次のカードに進みます。"}
              </small>
            </div>
            <div className="candidate-deck__actions">
              <button
                type="button"
                className="choice-button"
                disabled={!pendingPrimaryCandidatePersons.length}
                onClick={() => jumpPendingCandidate("previous")}
              >
                前の保留
              </button>
              <button
                type="button"
                className="choice-button choice-button--pending"
                disabled={!pendingPrimaryCandidatePersons.length}
                onClick={() => {
                  if (pendingQueueIndex >= 0) {
                    jumpPendingCandidate("next");
                    return;
                  }
                  jumpToCandidate(pendingPrimaryCandidatePersons[0].person_id, "primary");
                }}
              >
                次の保留
              </button>
              <button
                type="button"
                className="choice-button"
                disabled={candidateReviewIndex <= 0}
                onClick={() => setCandidateReviewIndex((index) => Math.max(index - 1, 0))}
              >
                前へ
              </button>
              <button
                type="button"
                className="choice-button"
                disabled={candidateReviewIndex >= visibleCandidatePersons.length - 1}
                onClick={() => setCandidateReviewIndex((index) => Math.min(index + 1, visibleCandidatePersons.length - 1))}
              >
                次へ
              </button>
            </div>
          </div>
          <div className="candidate-grid">
            {(currentCandidatePerson ? [currentCandidatePerson] : []).map((person) => (
              <article className={`candidate-card candidate-card--${person.status}`} key={person.person_id}>
                <div className="candidate-card__header">
                  <div>
                    <h3>{person.display_name}</h3>
                    <p>{person.reason}</p>
                    <p className="candidate-total">
                      集計対象表記 {person.aliases.filter((alias) => alias.status === "accepted").length} 件 / 重複除外後{" "}
                      {person.accepted_mention_comment_count} 件
                    </p>
                    <p className="confidence-line">
                      <span>{entityTypeLabel(person.entity_type)}</span>
                      <span>{confidenceLabel("candidate", person.confidence)}</span>
                    </p>
                  </div>
                  <span className={`status status-${person.status}`}>{statusLabel(person.status)}</span>
                </div>
                <div className="candidate-actions">
                  <button
                    className={person.status === "accepted" ? "choice-button choice-button--selected" : "choice-button"}
                    disabled={busy || person.status === "accepted"}
                    onClick={() =>
                      updateCandidate(
                        { type: "accept_person", person_id: person.person_id },
                        `${person.display_name} を採用しました`
                      )
                    }
                  >
                    {updatingId === person.person_id ? "処理中" : person.status === "accepted" ? "採用済み" : "採用"}
                  </button>
                  <button
                    className={person.status === "rejected" ? "choice-button choice-button--rejected" : "choice-button"}
                    disabled={busy || person.status === "rejected"}
                    onClick={() =>
                      updateCandidate(
                        { type: "reject_person", person_id: person.person_id },
                        `${person.display_name} を除外しました`
                      )
                    }
                  >
                    {updatingId === person.person_id ? "処理中" : person.status === "rejected" ? "除外済み" : "除外"}
                  </button>
                  {person.reason === "別の人物候補に統合済み" ? (
                    <button type="button" disabled={busy} onClick={() => splitMergedPerson(person)}>
                      統合解除
                    </button>
                  ) : null}
                </div>
                <div className="alias-preview" aria-label={`${person.display_name} の集計表記プレビュー`}>
                  {person.aliases
                    .filter((alias) => alias.status === "accepted")
                    .slice(0, 5)
                    .map((alias) => (
                      <span key={alias.alias_id}>{alias.alias_text}</span>
                    ))}
                  {person.aliases.filter((alias) => alias.status === "accepted").length > 5 ? (
                    <span>+{person.aliases.filter((alias) => alias.status === "accepted").length - 5}</span>
                  ) : null}
                </div>
                <details className="candidate-details" open={person.status !== "accepted"}>
                  <summary>表記・統合を編集</summary>
                  <div className="alias-editor" aria-label={`${person.display_name} の表示名と表記編集`}>
                    <label>
                      集計先の人物名
                      <div className="inline-edit">
                        <input
                          value={displayNameDrafts[person.person_id] ?? person.display_name}
                          onChange={(event) =>
                            setDisplayNameDrafts((drafts) => ({ ...drafts, [person.person_id]: event.target.value }))
                          }
                        />
                        <button
                          type="button"
                          disabled={
                            busy ||
                            !(displayNameDrafts[person.person_id] ?? person.display_name).trim() ||
                            (displayNameDrafts[person.person_id] ?? person.display_name).trim() === person.display_name
                          }
                          onClick={() => updateDisplayName(person)}
                        >
                          更新
                        </button>
                      </div>
                    </label>
                    <label>
                      この候補を別人物へ統合
                      <div className="inline-edit">
                        <select
                          value={mergeDrafts[person.person_id] ?? ""}
                          onChange={(event) =>
                            setMergeDrafts((drafts) => ({ ...drafts, [person.person_id]: event.target.value }))
                          }
                        >
                          <option value="">統合先を選択</option>
                          {(candidates?.persons ?? [])
                            .filter((candidate) => candidate.person_id !== person.person_id && candidate.status !== "rejected")
                            .map((candidate) => (
                              <option key={candidate.person_id} value={candidate.person_id}>
                                {candidate.display_name}
                              </option>
                            ))}
                        </select>
                        <button type="button" disabled={busy || !(mergeDrafts[person.person_id] ?? "")} onClick={() => mergePerson(person)}>
                          統合
                        </button>
                      </div>
                    </label>
                  </div>
                  <div className="alias-list-heading">この人物として数える表記</div>
                  <ul className="alias-list">
                    {person.aliases.map((alias) => (
                      <li key={alias.alias_id}>
                        <span>
                          {alias.alias_text}
                          <small>{aliasSourceLabel(alias.source)}</small>
                        </span>
                        <span>表記別 {alias.mention_comment_count}件</span>
                        <span>{confidenceLabel("alias", alias.confidence)}</span>
                        <span className={`status status-${alias.status}`}>{statusLabel(alias.status)}</span>
                        <button
                          className={alias.status === "accepted" ? "choice-button choice-button--selected" : "choice-button"}
                          disabled={busy || alias.status === "accepted"}
                          onClick={() =>
                            updateCandidate(
                              { type: "accept_alias", alias_id: alias.alias_id },
                              `表記「${alias.alias_text}」を集計対象にしました`
                            )
                          }
                        >
                          {updatingId === alias.alias_id ? "処理中" : alias.status === "accepted" ? "集計中" : "集計に入れる"}
                        </button>
                        <button
                          className={alias.status === "rejected" ? "choice-button choice-button--rejected" : "choice-button"}
                          disabled={busy || alias.status === "rejected"}
                          onClick={() =>
                            updateCandidate(
                              { type: "reject_alias", alias_id: alias.alias_id },
                              `表記「${alias.alias_text}」を集計から外しました`
                            )
                          }
                        >
                          {updatingId === alias.alias_id ? "処理中" : alias.status === "rejected" ? "外し済み" : "集計から外す"}
                        </button>
                        <button
                          className="choice-button choice-button--danger"
                          disabled={busy}
                          onClick={() =>
                            updateCandidate(
                              { type: "delete_alias", alias_id: alias.alias_id },
                              `表記「${alias.alias_text}」を削除しました`
                            )
                          }
                        >
                          削除
                        </button>
                        {alias.representative_comments.length ? (
                          <details className="alias-evidence">
                            <summary>代表コメント</summary>
                            {alias.representative_comments.map((comment) => (
                              <blockquote key={comment.comment_id}>
                                {comment.text_original}
                                <LikeCount count={comment.like_count} />
                              </blockquote>
                            ))}
                          </details>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              </article>
            ))}
            {!visibleCandidatePersons.length ? <p className="empty-note">この表示範囲に該当する候補はありません。</p> : null}
          </div>
          <div className="review-summary review-summary--below" aria-live="polite">
            <span>候補 {candidateSummary.total} 件</span>
            <strong>採用 {candidateSummary.accepted} 件</strong>
            <button type="button" className="review-summary__pending" onClick={() => setCandidateEntityFilter("needs_review")}>
              保留 {candidateSummary.pending} 件
              {candidateSummary.pendingNonPrimary ? <small>人物外 {candidateSummary.pendingNonPrimary}</small> : null}
            </button>
            <span>除外 {candidateSummary.rejected} 件</span>
            <span>人物外候補 {candidateSummary.nonPrimary} 件</span>
            {lastAction ? <em>{lastAction}</em> : null}
          </div>
          {pendingPrimaryCandidatePersons.length ? (
            <div className="pending-candidates" aria-label="保留中の人物候補">
              <div>
                <span className="label">保留中</span>
                <strong>{candidateSummary.pendingPrimary} 件</strong>
              </div>
              <div className="pending-candidates__list">
                {pendingPrimaryCandidatePersons.slice(0, 18).map((person) => (
                  <button
                    key={person.person_id}
                    type="button"
                    className="keyword-chip keyword-chip--pending"
                    onClick={() => jumpToCandidate(person.person_id, "primary")}
                  >
                    <span>{person.display_name}</span>
                    <small>{person.accepted_mention_comment_count}件</small>
                  </button>
                ))}
                {pendingPrimaryCandidatePersons.length > 18 ? (
                  <span className="keyword-chip keyword-chip--more">+{pendingPrimaryCandidatePersons.length - 18}</span>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="accepted-keywords" aria-label="決定済み候補">
            <div>
              <span className="label">決定済み</span>
              <strong>採用 {candidateSummary.accepted} / 除外 {candidateSummary.rejected}</strong>
            </div>
            <div className="accepted-keywords__list">
              {decidedPrimaryCandidatePersons.slice(0, 14).map((person) => (
                <button
                  key={person.person_id}
                  type="button"
                  className={`keyword-chip keyword-chip--${person.status}`}
                  onClick={() => jumpToCandidate(person.person_id, "primary")}
                >
                  <span>{person.display_name}</span>
                  <small>{person.status === "accepted" ? `${person.accepted_mention_comment_count}件` : "除外"}</small>
                </button>
              ))}
              {decidedPrimaryCandidatePersons.length > 14 ? <span className="keyword-chip keyword-chip--more">+{decidedPrimaryCandidatePersons.length - 14}</span> : null}
            </div>
          </div>
        </section>
      ) : null}

      {report && activeTab === "dashboard" ? (
        <section className="panel dashboard-panel">
          <div className="section-heading">
            <div>
              <h2>概要ダッシュボード</h2>
              <p>
                データソース: {sourceLabel(report.fetch_summary.source)} / 取得コメント:
                {report.fetch_summary.fetched_top_level_count + report.fetch_summary.fetched_reply_count} / YouTube表示:
                {formatNullableNumber(report.video.youtube_comment_count)}
              </p>
              <AnalysisHelp>
                分析全体の入口です。取得できたコメント範囲、人物に紐づいたコメント数、上位人物、いいね分布をまとめて、
                この run の信頼できる範囲と大まかな注目先を判断します。
              </AnalysisHelp>
            </div>
          </div>
          <div className="dashboard-grid">
            <div>
              <span className="label">動画</span>
              <strong>{report.video.title || report.video.youtube_video_id}</strong>
              <small>{report.video.channel_title || "チャンネル未取得"}</small>
            </div>
            <div>
              <span className="label">採用人物</span>
              <strong>{dashboardStats?.acceptedPersons ?? 0} 件</strong>
              <small>ランキング対象</small>
            </div>
            <div>
              <span className="label">取得範囲</span>
              <strong>{coverageLabel(report.fetch_summary.coverage.status)}</strong>
              <small>{report.fetch_summary.coverage.message}</small>
            </div>
            <div>
              <span className="label">コメント数</span>
              <strong>
                {report.fetch_summary.max_comments_fetched} / {report.fetch_summary.max_comments_requested}
              </strong>
              <small>YouTube表示 {formatNullableNumber(report.video.youtube_comment_count)}</small>
            </div>
            <div>
              <span className="label">返信</span>
              <strong>{report.fetch_summary.fetched_reply_count} 件</strong>
              <small>{replyFetchModeLabel(report.fetch_summary.reply_fetch_mode)}</small>
            </div>
            <div>
              <span className="label">紐づけ済み</span>
              <strong>{dashboardStats?.mentionedComments ?? 0} 件</strong>
              <small>未紐づけ {dashboardStats?.unassignedComments ?? 0} 件</small>
            </div>
            <div>
              <span className="label">トップ人物</span>
              <strong>{dashboardStats?.topPerson?.display_name ?? "なし"}</strong>
              <small>{dashboardStats?.topPerson ? `${dashboardStats.topPerson.mention_comment_count} 件` : "言及なし"}</small>
            </div>
          </div>
          <div className="dashboard-charts">
            <div className="mention-chart" aria-label="人物別言及数グラフ">
              <div className="chart-header">
                <strong>人物別言及数</strong>
                <small>上位 {Math.min(report.rankings.mention_ranking.length, 10)} 件</small>
              </div>
              {report.rankings.mention_ranking.slice(0, 10).map((row) => (
                <div className="mention-bar" key={row.person_id}>
                  <button type="button" className="mention-bar__name" onClick={() => openPersonComments(row.person_id)}>
                    {row.display_name}
                  </button>
                  <div>
                    <i style={{ width: `${Math.max((row.mention_comment_count / (dashboardStats?.maxMentionCount ?? 1)) * 100, 4)}%` }} />
                  </div>
                  <strong>{row.mention_comment_count}</strong>
                </div>
              ))}
            </div>
            <div className="comment-composition" aria-label="コメント分類比率">
              <div className="chart-header">
                <strong>コメント分類</strong>
                <small>取得済みコメント内</small>
              </div>
              <div className="composition-meter">
                <span
                  style={{
                    width: `${((dashboardStats?.mentionedComments ?? 0) / Math.max(dashboardStats?.totalComments ?? 1, 1)) * 100}%`
                  }}
                />
                <em
                  style={{
                    width: `${((dashboardStats?.replyCount ?? 0) / Math.max(dashboardStats?.totalComments ?? 1, 1)) * 100}%`
                  }}
                />
              </div>
              <div className="composition-legend">
                <span>人物紐づけ {dashboardStats?.mentionedComments ?? 0}</span>
                <span>返信 {dashboardStats?.replyCount ?? 0}</span>
                <span>未紐づけ {dashboardStats?.unassignedComments ?? 0}</span>
              </div>
            </div>
          </div>
          <div className="like-distribution" aria-label="いいね数分布">
            <div className="like-distribution__header">
              <strong>いいね数分布</strong>
              <small>取得済みコメント内</small>
            </div>
            <div className="like-distribution__bars">
              {report.fetch_summary.like_count_distribution.map((bucket) => (
                <div key={bucket.label}>
                  <span>{bucket.label}</span>
                  <meter
                    min={0}
                    max={Math.max(...report.fetch_summary.like_count_distribution.map((item) => item.count), 1)}
                    value={bucket.count}
                  />
                  <strong>{bucket.count}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="section-heading section-heading--compact">
            <div>
              <h2>言及ランキング</h2>
              <p>
                上位コメントの定義: {topCommentDefinitionLabel(report.analysis_config.top_comment_definition)} / 上位{" "}
                {report.analysis_config.top_comment_count ?? 50} 件。weighted score は{" "}
                {report.analysis_config.like_weight_formula ?? "1 + log1p(like_count)"} です。
              </p>
            </div>
          </div>
          <div className="report-layout">
            <div className="ranking-list">
              {report.rankings.mention_ranking.map((row, index) => (
                <article className="ranking-row" key={row.person_id}>
                  <span className="rank-number">{index + 1}</span>
                  <div>
                    <h3>
                      <button type="button" className="link-button" onClick={() => openPersonComments(row.person_id)}>
                        {row.display_name}
                      </button>
                    </h3>
                    <p>
                      全体 {row.mention_comment_count}件 / 上位コメント内 {row.top_comment_mention_count}件 / 単独{" "}
                      {row.single_mention_count}件 / 同時言及 {row.multi_mention_count}件
                    </p>
                    <p>
                      raw likes {row.raw_like_sum.toLocaleString("ja-JP")} / weighted {row.like_weighted_score.toFixed(2)} /{" "}
                      {(row.mention_rate * 100).toFixed(1)}%
                    </p>
                    {row.representative_comments.map((comment) => (
                      <blockquote key={comment.comment_id}>
                        {comment.text_original}
                        <LikeCount count={comment.like_count} />
                      </blockquote>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <details className="sections-box">
              <summary>セクション状態</summary>
              {Object.entries(report.sections).map(([key, section]) => (
                <div key={key}>
                  <span>{key}</span>
                  <strong>{section.status}</strong>
                  {section.reason ? <small>{section.reason}</small> : null}
                </div>
              ))}
            </details>
          </div>
        </section>
      ) : null}

      {report && activeTab === "llm" ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>LLM 補助分析</h2>
              <p>Codex app server 経由で、候補整理、alias 補完案、曖昧コメントだけをレビュー補助します。</p>
              <AnalysisHelp>
                ルールベース集計だけでは迷いやすい候補統合、別表記、曖昧なコメントを AI が補助的に提案します。
                件数集計そのものは deterministic な通常レポート側を正として扱います。
              </AnalysisHelp>
            </div>
            <div className="button-row">
              <button type="button" disabled={llmBusy || busy} onClick={runLlmAssist}>
                {llmBusy ? "分析中" : report.llm_assist ? "LLM 補助を再実行" : "LLM 補助を実行"}
              </button>
              <button type="button" disabled={busy || !report.llm_assist || report.llm_assist.status === "failed"} onClick={applyLlmAssist}>
                分析に反映
              </button>
            </div>
          </div>
          {report.llm_assist ? (
            report.llm_assist.status === "failed" ? (
              <div className="degraded-box">
                <strong>LLM 補助分析だけ失敗しました</strong>
                <p>候補抽出、alias、ランキング、コメント紐づけの通常レポートは有効です。</p>
                <small>{report.llm_assist.error_message || report.sections.llm_assist?.reason || "原因未取得"}</small>
              </div>
            ) : (
              <div className="llm-assist-grid">
              <div>
                <h3>候補整理</h3>
                {report.llm_assist.candidate_recommendations.length ? (
                  report.llm_assist.candidate_recommendations.map((item, index) => (
                    <article key={`${item.display_name}-${index}`}>
                      <strong>
                        {item.display_name} / {llmRecommendationLabel(item.recommendation)}
                      </strong>
                      {item.target_display_name ? <small>統合候補: {item.target_display_name}</small> : null}
                      <p>{item.reason}</p>
                    </article>
                  ))
                ) : (
                  <p>提案はありません。</p>
                )}
              </div>
              <div>
                <h3>alias 補完案</h3>
                {report.llm_assist.alias_recommendations.length ? (
                  report.llm_assist.alias_recommendations.map((item, index) => (
                    <article key={`${item.alias}-${index}`}>
                      <strong>
                        {item.alias} → {item.target_display_name}
                      </strong>
                      <small>confidence: {item.confidence}</small>
                      <p>{item.reason}</p>
                    </article>
                  ))
                ) : (
                  <p>提案はありません。</p>
                )}
              </div>
              <div>
                <h3>曖昧コメント</h3>
                {report.llm_assist.ambiguous_comments.length ? (
                  report.llm_assist.ambiguous_comments.map((item) => (
                    <article key={item.comment_id}>
                      <strong>{item.suggested_display_name || "紐づけなし"}</strong>
                      <small>
                        {item.comment_id} / {item.confidence}
                      </small>
                      <p>{item.reason}</p>
                    </article>
                  ))
                ) : (
                  <p>提案はありません。</p>
                )}
              </div>
            </div>
            )
          ) : (
            <p className="list-note">まだ LLM 補助分析は実行していません。</p>
          )}
        </section>
      ) : null}

      {report && activeTab === "quality" ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>要確認コメント</h2>
              <p>低 confidence、AI と辞書判定の差分、LLM が曖昧としたコメントをまとめます。</p>
              <AnalysisHelp>
                集計ミスになりやすいコメントだけを後から点検する画面です。低信頼、AI 提案との差分、人物なし判定の可能性をまとめ、
                全コメントを読み直さずに品質確認できます。
              </AnalysisHelp>
            </div>
            <button type="button" disabled={llmBusy || busy} onClick={runLlmAssist}>
              {llmBusy ? "分析中" : report.llm_assist ? "LLM 補助を再実行" : "LLM 補助を実行"}
            </button>
          </div>
          <div className="review-summary">
            <span>人間確認 {report.quality_review.human_review_items.length} 件</span>
            <span>低 confidence {report.quality_review.low_confidence_comments.length} 件</span>
            <span>AI/辞書差分 {report.quality_review.ai_dictionary_conflicts.length} 件</span>
            <span>LLM曖昧 {report.quality_review.llm_ambiguous_comments.length} 件</span>
          </div>
          <QualityReviewList title="人間確認を推奨" items={report.quality_review.human_review_items} />
          <QualityReviewList title="低 confidence comments" items={report.quality_review.low_confidence_comments} />
          <QualityReviewList title="AI 判定と辞書判定の差分" items={report.quality_review.ai_dictionary_conflicts} />
          <QualityReviewList title="LLM ambiguous classification" items={report.quality_review.llm_ambiguous_comments} />
        </section>
      ) : null}

      {report && activeTab === "aliases" ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>頻出語レビュー</h2>
              <p>人物候補と、既存 alias に入っていない頻出表記を分類します。alias に採用すると再集計します。</p>
              <AnalysisHelp>
                コメント内でよく出る表記のうち、まだ人物 alias として採用されていない語を見ます。
                人名の短縮形なら alias に追加し、一般語なら除外に寄せることで次の集計を安定させます。
              </AnalysisHelp>
            </div>
            <strong>{visibleAliasSuggestions.length + frequentReviewGroups.personCandidates.length} 件</strong>
          </div>
          <div className="frequent-review-summary">
            <button type="button" onClick={() => setActiveTab("candidates")}>
              人物候補 {frequentReviewGroups.personCandidates.length}
            </button>
            <span>alias 候補 {frequentReviewGroups.aliasCandidates.length}</span>
            <span>要確認 {frequentReviewGroups.needsReview.length}</span>
            <span>一般語 {frequentReviewGroups.commonWords.length}</span>
          </div>
          <div className="frequent-review-board">
            <div className="frequent-review-column">
              <h3>人物候補</h3>
              <p>人物そのものの採用・除外は候補確認で行います。</p>
              {frequentReviewGroups.personCandidates.slice(0, 8).map((person) => (
                <article className="frequent-word-card frequent-word-card--person" key={person.person_id}>
                  <strong>{person.display_name}</strong>
                  <small>
                    {person.entity_type} / {statusLabel(person.status)} / {person.accepted_mention_comment_count} 件
                  </small>
                </article>
              ))}
              {frequentReviewGroups.personCandidates.length > 8 ? (
                <p className="list-note">ほか {frequentReviewGroups.personCandidates.length - 8} 件</p>
              ) : null}
            </div>
            <FrequentAliasColumn
              title="alias 候補"
              items={frequentReviewGroups.aliasCandidates}
              busy={busy}
              assignablePersons={assignablePersons}
              aliasSuggestionDrafts={aliasSuggestionDrafts}
              setAliasSuggestionDrafts={setAliasSuggestionDrafts}
              acceptAliasSuggestion={acceptAliasSuggestion}
              setAliasReviewState={setAliasReviewState}
            />
            <FrequentAliasColumn
              title="要確認"
              items={frequentReviewGroups.needsReview}
              busy={busy}
              assignablePersons={assignablePersons}
              aliasSuggestionDrafts={aliasSuggestionDrafts}
              setAliasSuggestionDrafts={setAliasSuggestionDrafts}
              acceptAliasSuggestion={acceptAliasSuggestion}
              setAliasReviewState={setAliasReviewState}
            />
            <div className="frequent-review-column">
              <h3>一般語</h3>
              <p>集計対象にしない語です。必要なら要確認へ戻せます。</p>
              {frequentReviewGroups.commonWords.length ? (
                frequentReviewGroups.commonWords.map(({ suggestion }) => (
                  <article className="frequent-word-card" key={suggestion.normalized_alias}>
                    <strong>{suggestion.token}</strong>
                    <small>{suggestion.hit_count} 件 / 集計から除外中</small>
                    <button type="button" className="choice-button" onClick={() => setAliasReviewState(suggestion, "needs_review")}>
                      要確認に戻す
                    </button>
                  </article>
                ))
              ) : (
                <p className="list-note">分類済みの一般語はありません。</p>
              )}
            </div>
          </div>
        </section>
      ) : null}

      {report && selectedDetailPerson && selectedPersonDetails && activeTab === "details" ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>人物別詳細</h2>
              <p>人物ごとの集計表記、特徴語、根拠コメントを確認します。</p>
              <AnalysisHelp>
                1 人ずつ、どの表記で拾われ、どんな言葉と一緒に語られ、どのコメントが根拠になっているかを確認します。
                ランキングの理由を掘り下げるための画面です。
              </AnalysisHelp>
            </div>
          </div>
          <div className="detail-layout">
            <aside className="person-selector">
              {report.rankings.mention_ranking.map((row) => (
                <button
                  className={row.person_id === selectedDetailPerson.person_id ? "person-selector__item person-selector__item--active" : "person-selector__item"}
                  key={row.person_id}
                  type="button"
                  onClick={() => setSelectedDetailPersonId(row.person_id)}
                >
                  <span>{row.display_name}</span>
                  <strong>{row.mention_comment_count}件</strong>
                </button>
              ))}
            </aside>
            <div className="person-detail">
              <div className="person-detail__summary">
                <div>
                  <h3>{selectedDetailPerson.display_name}</h3>
                  <p>
                    {selectedDetailPerson.mention_comment_count}件 / {(selectedDetailPerson.mention_rate * 100).toFixed(1)}% / weighted{" "}
                    {selectedDetailPerson.like_weighted_score.toFixed(2)}
                  </p>
                </div>
                <strong>{selectedPersonDetails.comments.length} コメント</strong>
              </div>
              <div className="detail-block">
                <h4>集計表記</h4>
                <div className="mention-pills detail-pills">
                  {selectedPersonDetails.aliases.map((alias) => (
                    <span key={alias.alias_id}>{alias.alias_text}</span>
                  ))}
                </div>
              </div>
              {selectedPersonDetails.appeal ? (
                <div className="detail-block appeal-block">
                  <h4>魅力分析</h4>
                  <p>{selectedPersonDetails.appeal.summary}</p>
                  <div className="appeal-grid">
                    <div>
                      <strong>カテゴリ</strong>
                      {selectedPersonDetails.appeal.category_counts.slice(0, 6).map((category) => (
                        <div className="appeal-meter" key={category.category}>
                          <span>{category.label}</span>
                          <meter min={0} max={Math.max(selectedPersonDetails.appeal?.comment_count ?? 1, 1)} value={category.count} />
                          <em>{category.count}</em>
                        </div>
                      ))}
                    </div>
                    <div>
                      <strong>tone</strong>
                      <div className="tone-grid">
                        {Object.entries(selectedPersonDetails.appeal.tone_counts).map(([tone, count]) => (
                          <span key={tone}>
                            {toneLabel(tone)} <b>{count}</b>
                          </span>
                        ))}
                      </div>
                      {selectedPersonDetails.appeal.negative_note ? <small>{selectedPersonDetails.appeal.negative_note}</small> : null}
                    </div>
                    <div>
                      <strong>評価語文脈</strong>
                      <div className="tone-grid">
                        <span>
                          positive <b>{selectedPersonDetails.appeal.evaluation_summary.counts.positive}</b>
                        </span>
                        <span>
                          negative <b>{selectedPersonDetails.appeal.evaluation_summary.counts.negative}</b>
                        </span>
                        <span>
                          dominant <b>{selectedPersonDetails.appeal.evaluation_summary.dominant}</b>
                        </span>
                      </div>
                    </div>
                  </div>
                  {selectedPersonDetails.appeal.evaluation_summary.evidence_comments.length ? (
                    <div className="feature-list">
                      {selectedPersonDetails.appeal.evaluation_summary.evidence_comments.flatMap((comment) =>
                        comment.terms.map((term) => <span key={`${comment.comment_id}-${term.term}`}>{term.term}</span>)
                      )}
                    </div>
                  ) : null}
                  <div className="comment-list">
                    {selectedPersonDetails.appeal.evidence_comments.slice(0, 3).map((comment) => (
                      <article className="comment-row" key={comment.comment_id}>
                        <div className="comment-row__meta">
                          <LikeCount count={comment.like_count} strong />
                        </div>
                        <p>{comment.text_original}</p>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="detail-block">
                <h4>特徴語</h4>
                <div className="feature-list">
                  {selectedPersonDetails.featureWords.map((word) => (
                    <span key={word.term}>{word.term}</span>
                  ))}
                </div>
              </div>
              <div className="detail-block">
                <h4>代表コメント</h4>
                <div className="comment-list">
                  {selectedPersonDetails.comments.slice(0, 8).map((comment) => (
                    <article className="comment-row" key={comment.comment_id}>
                      <div className="comment-row__meta">
                        <LikeCount count={comment.like_count} strong />
                      </div>
                      <p>{comment.text_original}</p>
                    </article>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {report && activeTab === "cooccurrence" ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>共起・関係性分析</h2>
              <p>同じコメント内で複数人物が言及された組み合わせを集計します。</p>
              <AnalysisHelp>
                同じコメントで一緒に語られる人物の組み合わせを見ます。比較、セット扱い、掛け合い、関係性への反応など、
                単独ランキングでは見えないコメント欄の連想を確認できます。
              </AnalysisHelp>
            </div>
            <strong>{report.cooccurrence.pairs.length} 組</strong>
          </div>
          <div className="cooccurrence-layout">
            <div className="cooccurrence-list">
              {report.cooccurrence.pairs.slice(0, 20).map((pair) => (
                <article className="cooccurrence-card" key={`${pair.person_a_id}-${pair.person_b_id}`}>
                  <div>
                    <h3>
                      {pair.person_a_name} × {pair.person_b_name}
                    </h3>
                    <p>
                      {pair.cooccurrence_comment_count} 件 / weighted {pair.like_weighted_score.toFixed(2)}
                    </p>
                  </div>
                  <span className="status status-available">{pair.relationship_category}</span>
                  {pair.representative_comments.map((comment) => (
                    <blockquote key={comment.comment_id}>
                      {comment.text_original}
                      <LikeCount count={comment.like_count} />
                    </blockquote>
                  ))}
                </article>
              ))}
              {report.cooccurrence.pairs.length === 0 ? <p className="list-note">共起はまだありません。</p> : null}
            </div>
            <aside className="cooccurrence-matrix">
              <h3>ヒートマップ</h3>
              <p>左の人物と上の人物が、同じコメント内で一緒に出た件数です。</p>
              <div className="matrix-table" style={{ "--matrix-size": Math.min(report.cooccurrence.matrix.length, 8) } as React.CSSProperties}>
                <span className="matrix-corner">人物</span>
                {report.cooccurrence.matrix.slice(0, 8).map((row) => (
                  <strong className="matrix-column-label" key={`column-${row.source}`} title={row.source}>
                    {row.source}
                  </strong>
                ))}
                {report.cooccurrence.matrix.slice(0, 8).map((row) => (
                  <Fragment key={row.source}>
                    <strong className="matrix-row-label" title={row.source}>
                      {row.source}
                    </strong>
                    {row.targets.slice(0, 8).map((target) => {
                      const isSelf = row.source === target.target;
                      return (
                        <span
                          className={isSelf ? "matrix-cell matrix-cell--self" : "matrix-cell"}
                          key={`${row.source}-${target.target}`}
                          title={`${row.source} × ${target.target}: ${target.count} 件`}
                          style={{ opacity: isSelf ? 1 : target.count ? Math.min(1, 0.28 + target.count / 20) : 0.2 }}
                        >
                          {isSelf ? "ー" : target.count}
                        </span>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </aside>
          </div>
        </section>
      ) : null}

      {report && activeTab === "clusters" ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>コメントクラスタ</h2>
              <p>
                {report.clusters.method} / 設定 {report.clusters.requested_cluster_count} 件。本文特徴語で近いコメント群をまとめます。
              </p>
              <AnalysisHelp>
                似た内容のコメントを話題ごとにまとめます。誰が多いかだけでなく、コメント欄が何について盛り上がっているかを
                ざっくり把握するための画面です。
              </AnalysisHelp>
            </div>
            <strong>{report.clusters.clusters.length} 件</strong>
          </div>
          <div className="cluster-grid">
            {sortedCommentClusters(report.clusters.clusters).map((cluster) => (
              <article className="cluster-card" key={cluster.cluster_id}>
                <div className="cluster-card__header">
                  <div>
                    <h3>{cluster.label}</h3>
                    <p>{cluster.summary}</p>
                  </div>
                  <strong>{cluster.comment_count}</strong>
                </div>
                <div className="cluster-pills">
                  {cluster.top_persons.map((person) => (
                    <span key={person.display_name}>
                      {person.display_name} {person.count}
                    </span>
                  ))}
                </div>
                <div className="cluster-keywords">
                  {cluster.top_keywords.map((keyword) => (
                    <span key={keyword.term}>{keyword.term}</span>
                  ))}
                </div>
                {cluster.representative_comments.slice(0, 3).map((comment) => (
                  <blockquote key={comment.comment_id}>
                    {comment.text_original}
                    <LikeCount count={comment.like_count} />
                  </blockquote>
                ))}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {report && selectedDetailPerson && activeTab === "personComments" ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>人物コメント</h2>
              <p>人物別言及数から選んだ人物のコメントだけをページングして確認します。</p>
              <AnalysisHelp>
                ランキングで気になった人物について、該当コメントだけを読みます。100 件または 200 件ずつ DB から取得するので、
                大きな run でも画面を軽く保てます。
              </AnalysisHelp>
            </div>
            <strong>{selectedDetailPerson.display_name}</strong>
          </div>
          <div className="person-comment-toolbar">
            <label>
              人物
              <select
                value={selectedDetailPerson.person_id}
                onChange={(event) => {
                  setSelectedDetailPersonId(event.target.value);
                  setPersonCommentPage(0);
                }}
              >
                {commentPersonOptions.map((person) => (
                  <option key={person.person_id} value={person.person_id}>
                    {person.display_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <PaginatedCommentList
            pageData={personCommentsPageData}
            page={personCommentPage}
            pageSize={personCommentPageSize}
            loading={commentsLoading}
            busy={busy}
            assignablePersons={assignablePersons}
            commentPersonDrafts={commentPersonDrafts}
            setCommentPersonDrafts={setCommentPersonDrafts}
            updateCommentMention={updateCommentMention}
            onPageChange={setPersonCommentPage}
            onPageSizeChange={setPersonCommentPageSize}
          />
        </section>
      ) : null}

      {report && activeTab === "comments" ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>コメント一覧</h2>
              <p>コメント本文と紐づいた人物を確認します。検索と人物フィルタで根拠を絞り込めます。</p>
              <AnalysisHelp>
                集計結果の元になった個別コメントを確認します。検索、人物別、未紐づけで絞り込み、
                必要に応じてコメント単位で人物紐づけを追加・解除できます。
              </AnalysisHelp>
            </div>
            <strong>{commentsPageData?.total ?? report.comments.length} / {report.comments.length} 件</strong>
          </div>
          <div className="comment-toolbar">
            <label>
              検索
              <input
                placeholder="コメント本文で検索"
                value={commentSearch}
                onChange={(event) => setCommentSearch(event.target.value)}
              />
            </label>
            <label>
              人物
              <select value={commentPersonFilter} onChange={(event) => setCommentPersonFilter(event.target.value)}>
                <option value="all">すべて</option>
                <option value="unassigned">未紐づけ</option>
                {commentPersonOptions.map((person) => (
                  <option key={person.person_id} value={person.person_id}>
                    {person.display_name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <PaginatedCommentList
            pageData={commentsPageData}
            page={commentPage}
            pageSize={commentPageSize}
            loading={commentsLoading}
            busy={busy}
            assignablePersons={assignablePersons}
            commentPersonDrafts={commentPersonDrafts}
            setCommentPersonDrafts={setCommentPersonDrafts}
            updateCommentMention={updateCommentMention}
            onPageChange={setCommentPage}
            onPageSizeChange={setCommentPageSize}
          />
        </section>
      ) : null}
    </main>
  );
}

function PaginatedCommentList({
  pageData,
  page,
  pageSize,
  loading,
  busy,
  assignablePersons,
  commentPersonDrafts,
  setCommentPersonDrafts,
  updateCommentMention,
  onPageChange,
  onPageSizeChange
}: {
  pageData: CommentsPage | null;
  page: number;
  pageSize: number;
  loading: boolean;
  busy: boolean;
  assignablePersons: Person[];
  commentPersonDrafts: Record<string, string>;
  setCommentPersonDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  updateCommentMention: (action: { type: "add_mention" | "remove_mention"; comment_id: string; person_id: string }) => void;
  onPageChange: Dispatch<SetStateAction<number>>;
  onPageSizeChange: Dispatch<SetStateAction<number>>;
}) {
  const total = pageData?.total ?? 0;
  const pageCount = Math.max(Math.ceil(total / pageSize), 1);
  const start = total ? page * pageSize + 1 : 0;
  const end = Math.min((page + 1) * pageSize, total);
  return (
    <>
      <div className="comment-pagination" aria-label="コメントページング">
        <div>
          <strong>
            {start}-{end}
          </strong>
          <span>/ {total} 件</span>
        </div>
        <label>
          表示件数
          <select value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
            <option value={100}>100件</option>
            <option value={200}>200件</option>
          </select>
        </label>
        <div className="comment-pagination__actions">
          <button type="button" className="choice-button" disabled={loading || page <= 0} onClick={() => onPageChange((value) => Math.max(value - 1, 0))}>
            前へ
          </button>
          <span>
            {Math.min(page + 1, pageCount)} / {pageCount}
          </span>
          <button
            type="button"
            className="choice-button"
            disabled={loading || page >= pageCount - 1}
            onClick={() => onPageChange((value) => Math.min(value + 1, pageCount - 1))}
          >
            次へ
          </button>
        </div>
      </div>
      {loading ? <p className="list-note">コメントを取得しています。</p> : null}
      <div className="comment-list">
        {(pageData?.comments ?? []).map((comment) => (
          <article className="comment-row" key={comment.comment_id}>
            <div className="comment-row__meta">
              <LikeCount count={comment.like_count} strong />
              {comment.is_reply ? <span className="reply-badge">返信</span> : null}
              <div className="mention-pills">
                {comment.mentioned_persons.length ? (
                  comment.mentioned_persons.map((person) => (
                    <span key={person.person_id}>
                      {person.display_name}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          updateCommentMention({
                            type: "remove_mention",
                            comment_id: comment.comment_id,
                            person_id: person.person_id
                          })
                        }
                      >
                        外す
                      </button>
                    </span>
                  ))
                ) : (
                  <span className="mention-pills__empty">未紐づけ</span>
                )}
              </div>
            </div>
            <p>{comment.text_original}</p>
            <div className="comment-assign">
              <select
                value={commentPersonDrafts[comment.comment_id] ?? ""}
                onChange={(event) =>
                  setCommentPersonDrafts((drafts) => ({ ...drafts, [comment.comment_id]: event.target.value }))
                }
              >
                <option value="">人物を選択</option>
                {assignablePersons.map((person) => (
                  <option key={person.person_id} value={person.person_id}>
                    {person.display_name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={busy || !(commentPersonDrafts[comment.comment_id] ?? "")}
                onClick={() =>
                  updateCommentMention({
                    type: "add_mention",
                    comment_id: comment.comment_id,
                    person_id: commentPersonDrafts[comment.comment_id]
                  })
                }
              >
                この人物に紐づけ
              </button>
            </div>
          </article>
        ))}
      </div>
      {!loading && pageData && !pageData.comments.length ? <p className="list-note">該当するコメントはありません。</p> : null}
    </>
  );
}

function FrequentAliasColumn({
  title,
  items,
  busy,
  assignablePersons,
  aliasSuggestionDrafts,
  setAliasSuggestionDrafts,
  acceptAliasSuggestion,
  setAliasReviewState
}: {
  title: string;
  items: Array<{ suggestion: AliasSuggestion; reviewState: AliasReviewState }>;
  busy: boolean;
  assignablePersons: Person[];
  aliasSuggestionDrafts: Record<string, string>;
  setAliasSuggestionDrafts: Dispatch<SetStateAction<Record<string, string>>>;
  acceptAliasSuggestion: (suggestion: AliasSuggestion, selectedPersonId?: string) => void;
  setAliasReviewState: (suggestion: AliasSuggestion, reviewState: AliasReviewState) => void;
}) {
  return (
    <div className="frequent-review-column">
      <h3>{title}</h3>
      <p>{title === "alias 候補" ? "人物への紐づけ候補です。" : "人物名か一般語かを確認します。"}</p>
      {items.length ? (
        items.map(({ suggestion, reviewState }) => {
          const optionPersons = sortedAliasPersonOptions(suggestion, assignablePersons);
          const selectedPersonId = aliasSuggestionDrafts[suggestion.normalized_alias] ?? bestAliasPersonId(suggestion, optionPersons) ?? "";
          return (
            <article className="alias-suggestion-card" key={suggestion.normalized_alias}>
              <div>
                <h4>{suggestion.token}</h4>
                <p>{suggestion.reason}</p>
                <strong>{suggestion.hit_count} 件</strong>
                <span className={`status status-${reviewState}`}>{aliasReviewStateLabel(reviewState)}</span>
              </div>
              <label>
                紐づけ先
                <select
                  value={selectedPersonId}
                  onChange={(event) =>
                    setAliasSuggestionDrafts((drafts) => ({
                      ...drafts,
                      [suggestion.normalized_alias]: event.target.value
                    }))
                  }
                >
                  <option value="">人物を選択</option>
                  {optionPersons.map((person) => (
                    <option key={person.person_id} value={person.person_id}>
                      {person.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="candidate-actions">
                <button type="button" disabled={busy || !selectedPersonId} onClick={() => acceptAliasSuggestion(suggestion, selectedPersonId)}>
                  alias に追加
                </button>
                <button type="button" disabled={busy} onClick={() => setAliasReviewState(suggestion, "needs_review")}>
                  保留
                </button>
                <button type="button" disabled={busy} onClick={() => setAliasReviewState(suggestion, "common_word")}>
                  一般語として除外
                </button>
              </div>
              <details className="alias-evidence">
                <summary>代表コメント</summary>
                {suggestion.representative_comments.map((comment) => (
                  <blockquote key={comment.comment_id}>
                    {comment.text_original}
                    <span className="alias-evidence-meta">
                      <LikeCount count={comment.like_count} />
                      {comment.is_reply ? " / 返信" : ""}
                    </span>
                  </blockquote>
                ))}
              </details>
            </article>
          );
        })
      ) : (
        <p className="list-note">該当する表記はありません。</p>
      )}
    </div>
  );
}

function QualityReviewList({ title, items }: { title: string; items: QualityReviewComment[] }) {
  return (
    <details className="quality-review-section" open={title === "人間確認を推奨"}>
      <summary>
        <strong>{title}</strong>
        <span>{items.length} 件</span>
      </summary>
      {items.length ? (
        <div className="quality-review-list">
          {items.map((item) => (
            <article key={`${title}-${item.comment_id}`}>
              <div>
                <strong>{item.suggested_display_name ? `LLM候補: ${item.suggested_display_name}` : item.reason}</strong>
                <LikeCount count={item.like_count} />
              </div>
              <p>{item.text_original}</p>
              <div className="mention-pills">
                {item.mentioned_persons.length ? (
                  item.mentioned_persons.map((person) => (
                    <span key={`${item.comment_id}-${person.person_id}`}>
                      {person.display_name} / {confidenceLabel("classification", person.confidence)}
                    </span>
                  ))
                ) : (
                  <span className="mention-pills__empty">現在の辞書判定なし</span>
                )}
                {item.llm_confidence ? <span>LLM {item.llm_confidence}</span> : null}
                {item.is_reply ? <span>返信</span> : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="list-note">該当するコメントはありません。</p>
      )}
    </details>
  );
}

function AnalysisHelp({ children }: { children: ReactNode }) {
  return (
    <details className="analysis-help">
      <summary aria-label="この分析の目的を開く">?</summary>
      <p>{children}</p>
    </details>
  );
}

function LikeCount({ count, strong = false }: { count: number; strong?: boolean }) {
  const content = (
    <>
      <span aria-hidden="true">👍</span>
      <span>{count.toLocaleString("ja-JP")}</span>
    </>
  );
  return strong ? <strong className="like-count">{content}</strong> : <small className="like-count">{content}</small>;
}

function statusLabel(status: string): string {
  if (status === "accepted") return "採用";
  if (status === "rejected") return "除外";
  if (status === "pending") return "保留";
  if (status === "candidate") return "候補";
  return status;
}

function isPrimaryEntityType(entityType: string): boolean {
  return ["person", "group", "duo"].includes(entityType);
}

function isPendingCandidate(person: Person): boolean {
  return person.status !== "accepted" && person.status !== "rejected";
}

function filterCandidatePersons(persons: Person[], filter: CandidateEntityFilter): Person[] {
  if (filter === "all") return persons;
  if (filter === "non_primary") return persons.filter((person) => !isPrimaryEntityType(person.entity_type) && needsCandidateReview(person));
  if (filter === "needs_review") {
    return persons.filter((person) => isPrimaryEntityType(person.entity_type) && isPendingCandidate(person));
  }
  return persons.filter((person) => isPrimaryEntityType(person.entity_type));
}

function sortedCommentClusters(clusters: CommentCluster[]): CommentCluster[] {
  return [...clusters].sort((a, b) => {
    if (a.cluster_id === "other" && b.cluster_id !== "other") return 1;
    if (a.cluster_id !== "other" && b.cluster_id === "other") return -1;
    return b.comment_count - a.comment_count;
  });
}

function needsCandidateReview(person: Person): boolean {
  if (person.status === "rejected") return false;
  return person.status !== "accepted" || person.aliases.some((alias) => alias.status !== "accepted");
}

function sortedAliasPersonOptions(suggestion: AliasSuggestion, persons: Person[]): Person[] {
  return [...persons].sort((a, b) => {
    const scoreDelta = aliasPersonScore(suggestion, b) - aliasPersonScore(suggestion, a);
    if (scoreDelta !== 0) return scoreDelta;
    return b.accepted_mention_comment_count - a.accepted_mention_comment_count;
  });
}

function bestAliasPersonId(suggestion: AliasSuggestion, persons: Person[]): string | null {
  if (suggestion.suggested_person_id && persons.some((person) => person.person_id === suggestion.suggested_person_id)) {
    return suggestion.suggested_person_id;
  }
  const best = persons[0];
  return best && aliasPersonScore(suggestion, best) >= 3 ? best.person_id : null;
}

function aliasPersonScore(suggestion: AliasSuggestion, person: Person): number {
  const token = normalizeSearch(suggestion.normalized_alias || suggestion.token);
  const name = normalizeSearch(person.display_name);
  if (!token || !name) return 0;
  if (suggestion.suggested_person_id === person.person_id) return 100;
  if (token === name) return 80;
  if (name.includes(token) || token.includes(name)) return 50;
  const aliasHit = person.aliases.some((alias) => {
    const aliasText = normalizeSearch(alias.normalized_alias || alias.alias_text);
    return aliasText === token || aliasText.includes(token) || token.includes(aliasText);
  });
  if (aliasHit) return 40;
  return commonPrefixLength(token, name);
}

function commonPrefixLength(a: string, b: string): number {
  let length = 0;
  while (length < a.length && length < b.length && a[length] === b[length]) {
    length += 1;
  }
  return length;
}

function shouldAdvanceCandidateCard(actionType: string): boolean {
  return new Set([
    "accept_person",
    "reject_person",
    "accept_alias",
    "reject_alias",
    "delete_alias",
    "merge_person",
    "split_merged_person"
  ]).has(actionType);
}

function entityTypeLabel(entityType: string): string {
  if (entityType === "person") return "人物候補";
  if (entityType === "group") return "グループ候補";
  if (entityType === "duo") return "コンビ候補";
  if (entityType === "channel") return "チャンネル候補";
  return `${entityType} 候補`;
}

function confidenceLabel(kind: "candidate" | "alias" | "classification", value: number): string {
  const label = kind === "candidate" ? "候補信頼度" : kind === "alias" ? "alias信頼度" : "分類信頼度";
  return `${label} ${Math.round(value * 100)}%`;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function sourceLabel(source: string): string {
  if (source === "cache") return "Cache";
  if (source === "youtube_api") return "YouTube API";
  if (source === "youtube_api_diff") return "YouTube API 差分更新";
  if (source === "fixture") return "Fixture";
  return source;
}

function sourceNote(source: string): string {
  if (source === "cache") return "保存済みデータを使用。API再消費なし。";
  if (source === "youtube_api") return "今回YouTube APIから取得。次回同条件はcache使用。";
  if (source === "youtube_api_diff") return "YouTube APIから再取得し、既存cacheと重複排除して更新。";
  if (source === "fixture") return "API keyなしの検証データ。";
  return "";
}

function shortRunId(runId: string): string {
  return runId.replace(/^run_/, "").slice(0, 8);
}

function runStatusLabel(status: string): string {
  if (status === "waiting_for_review") return "レビュー待ち";
  if (status === "completed") return "完了";
  if (status === "running") return "実行中";
  if (status === "failed_recoverable") return "復旧待ち";
  return status;
}

function runStageLabel(stage: string): string {
  if (stage === "extracting_candidates") return "候補抽出";
  if (stage === "completed") return "集計完了";
  if (stage === "fetching_comments") return "取得中";
  if (stage === "creating_run") return "保存中";
  return stage.replaceAll("_", " ");
}

function replyFetchModeLabel(mode: string): string {
  if (mode === "none") return "トップレベルのみ";
  if (mode === "inline_subset") return "同梱返信のみ";
  if (mode === "full") return "返信を追加取得";
  return mode;
}

function replyFetchModeDescription(mode: string): string {
  if (mode === "none") return "動画直下のトップレベルコメントだけを取得します。";
  if (mode === "inline_subset") {
    return "commentThreads.list のレスポンスに最初から同梱される一部返信だけを含めます。追加 API 呼び出しはありません。";
  }
  if (mode === "full") return "各トップレベルコメントの返信を comments.list で追加ページング取得します。返信数に応じて API quota を使います。";
  return "";
}

function llmRecommendationLabel(value: string): string {
  if (value === "accept") return "採用推奨";
  if (value === "reject") return "除外推奨";
  if (value === "merge") return "統合推奨";
  if (value === "review") return "要確認";
  return value;
}

function formatNullableNumber(value?: number | null): string {
  return typeof value === "number" ? value.toLocaleString("ja-JP") : "未取得";
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

function formatDateTime(value?: string): string {
  if (!value) return "日時未取得";
  return new Date(value).toLocaleString("ja-JP");
}

function coverageLabel(status: string): string {
  if (status === "complete_or_near_complete") return "概ね取得済み";
  if (status === "limited_by_request") return "要求上限まで取得";
  if (status === "limited_by_api_or_availability") return "取得不足の可能性";
  if (status === "unknown") return "不明";
  return status;
}

function topCommentDefinitionLabel(value?: string): string {
  if (value === "like_count_desc") return "取得済みコメントをいいね数の多い順に並べた上位";
  return value || "未設定";
}

function toneLabel(tone: string): string {
  if (tone === "positive") return "positive";
  if (tone === "neutral") return "neutral";
  if (tone === "mixed") return "mixed";
  if (tone === "negative") return "negative";
  if (tone === "unclear") return "unclear";
  return tone;
}

function aliasSourceLabel(source: string): string {
  if (source === "name_part") return "フルネームから自動追加";
  if (source.includes("metadata_title") && source.includes("comment")) return "タイトルとコメントから検出";
  if (source.includes("metadata_title")) return "タイトルから検出";
  if (source.includes("metadata_description")) return "概要欄から検出";
  if (source.includes("comment")) return "コメント頻度から検出";
  if (source === "user") return "手動追加";
  return source;
}

function aliasReviewStateLabel(state: AliasReviewState): string {
  if (state === "alias_candidate") return "alias 候補";
  if (state === "needs_review") return "要確認";
  if (state === "common_word") return "一般語";
  return state;
}

function defaultAliasReviewState(suggestion: AliasSuggestion): AliasReviewState {
  const normalized = normalizeSearch(suggestion.normalized_alias || suggestion.token);
  const commonTerms = new Set([
    "すぎる",
    "すぎて",
    "めっちゃ",
    "ってる",
    "してる",
    "だった",
    "ったら",
    "なの",
    "として",
    "からの",
    "でした",
    "がいい",
    "みたいな",
    "らしい",
    "デビュー",
    "グループ",
    "ゲーム",
    "コロナ",
    "ティッシュ",
    "ドローミー"
  ]);
  if (commonTerms.has(normalized)) return "common_word";
  if (suggestion.suggested_person_name && normalized.includes(normalizeSearch(suggestion.suggested_person_name))) {
    return "common_word";
  }
  if (/^[ぁ-んー]+$/.test(normalized) && normalized.length <= 2) return "common_word";
  if (/^[ぁ-んー]+$/.test(normalized) && normalized.length >= 5) return "common_word";
  if (/^[ぁ-んー]+$/.test(normalized)) return "needs_review";
  return suggestion.suggested_person_id ? "alias_candidate" : "needs_review";
}

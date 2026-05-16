import { FormEvent, useMemo, useState } from "react";

type RunState = {
  run_id: string;
  status: string;
  stage: string;
  progress: number;
  error_message?: string | null;
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
  rankings: {
    mention_ranking: RankingRow[];
  };
  persons: Person[];
  alias_suggestions: AliasSuggestion[];
  llm_assist?: LlmAssist | null;
  sections: Record<string, { status: string; reason?: string }>;
  comments: Array<{
    comment_id: string;
    text_original: string;
    like_count: number;
    is_reply: boolean;
    parent_comment_id?: string | null;
    mentioned_persons: Array<{
      person_id: string;
      display_name: string;
    }>;
  }>;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

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
  const [url, setUrl] = useState("https://www.youtube.com/watch?v=vlpLbiqNhLo");
  const [maxComments, setMaxComments] = useState(5000);
  const [replyFetchMode, setReplyFetchMode] = useState<"none" | "inline_subset">("none");
  const [run, setRun] = useState<RunState | null>(null);
  const [candidates, setCandidates] = useState<CandidatesResponse | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [llmBusy, setLlmBusy] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [displayNameDrafts, setDisplayNameDrafts] = useState<Record<string, string>>({});
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({});
  const [aliasSuggestionDrafts, setAliasSuggestionDrafts] = useState<Record<string, string>>({});
  const [ignoredAliasSuggestions, setIgnoredAliasSuggestions] = useState<Record<string, boolean>>({});
  const [mergeDrafts, setMergeDrafts] = useState<Record<string, string>>({});
  const [commentSearch, setCommentSearch] = useState("");
  const [commentPersonFilter, setCommentPersonFilter] = useState("all");
  const [commentPersonDrafts, setCommentPersonDrafts] = useState<Record<string, string>>({});
  const [selectedDetailPersonId, setSelectedDetailPersonId] = useState<string | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const candidateSummary = useMemo(() => {
    const persons = candidates?.persons ?? [];
    return {
      accepted: persons.filter((person) => person.status === "accepted").length,
      rejected: persons.filter((person) => person.status === "rejected").length,
      pending: persons.filter((person) => person.status !== "accepted" && person.status !== "rejected").length,
      total: persons.length
    };
  }, [candidates]);

  const commentPersonOptions = useMemo(() => {
    return report?.rankings.mention_ranking.map((row) => ({ person_id: row.person_id, display_name: row.display_name })) ?? [];
  }, [report]);

  const assignablePersons = useMemo(() => {
    return report?.persons.filter((person) => person.status === "accepted") ?? [];
  }, [report]);

  const visibleAliasSuggestions = useMemo(() => {
    return (report?.alias_suggestions ?? []).filter((suggestion) => !ignoredAliasSuggestions[suggestion.normalized_alias]);
  }, [ignoredAliasSuggestions, report]);

  const filteredComments = useMemo(() => {
    const query = normalizeSearch(commentSearch);
    const comments = report?.comments ?? [];
    return comments.filter((comment) => {
      const matchesText = !query || normalizeSearch(comment.text_original).includes(query);
      const matchesPerson =
        commentPersonFilter === "all" ||
        (commentPersonFilter === "unassigned" && comment.mentioned_persons.length === 0) ||
        comment.mentioned_persons.some((person) => person.person_id === commentPersonFilter);
      return matchesText && matchesPerson;
    });
  }, [commentPersonFilter, commentSearch, report]);

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
    const comments = report.comments
      .filter((comment) => comment.mentioned_persons.some((mentioned) => mentioned.person_id === selectedDetailPerson.person_id))
      .sort((a, b) => b.like_count - a.like_count);
    const aliases = person?.aliases.filter((alias) => alias.status === "accepted") ?? [];
    return {
      person,
      comments,
      aliases,
      featureWords: extractFeatureWords(
        comments.map((comment) => comment.text_original),
        [selectedDetailPerson.display_name, ...aliases.map((alias) => alias.alias_text)]
      )
    };
  }, [report, selectedDetailPerson]);

  async function startRun(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setLastAction(null);
    setError(null);
    setReport(null);
    try {
      const created = await api<{ run_id: string; status: string }>("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          url,
          max_comments: maxComments,
          reply_fetch_mode: replyFetchMode,
          fetch_order: "relevance",
          use_llm: false,
          use_embeddings: false
        })
      });
      const state = await api<RunState>(`/api/runs/${created.run_id}`);
      const nextCandidates = await api<CandidatesResponse>(`/api/runs/${created.run_id}/candidates`);
      setRun(state);
      setCandidates(nextCandidates);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
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
      setLastAction(label);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setUpdatingId(null);
    }
  }

  async function updateDisplayName(person: Person) {
    const displayName = (displayNameDrafts[person.person_id] ?? person.display_name).trim();
    if (!displayName || displayName === person.display_name) return;
    await updateCandidate(
      { type: "update_display_name", person_id: person.person_id, display_name: displayName },
      `${person.display_name} の表示名を ${displayName} に更新しました`
    );
  }

  async function addAlias(person: Person) {
    const aliasText = (aliasDrafts[person.person_id] ?? "").trim();
    if (!aliasText) return;
    await updateCandidate(
      { type: "add_alias", person_id: person.person_id, alias_text: aliasText },
      `${person.display_name} に表記「${aliasText}」を追加しました`
    );
    setAliasDrafts((drafts) => ({ ...drafts, [person.person_id]: "" }));
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
      setLastAction(action.type === "add_mention" ? "コメントに人物を追加しました" : "コメントから人物を外しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function acceptAliasSuggestion(suggestion: AliasSuggestion) {
    if (!run) return;
    const personId = aliasSuggestionDrafts[suggestion.normalized_alias] || suggestion.suggested_person_id || "";
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
      await api<LlmAssist>(`/api/runs/${run.run_id}/llm-assist`, { method: "POST" });
      const nextReport = await api<Report>(`/api/runs/${run.run_id}/report`);
      setReport(nextReport);
      setLastAction("LLM 補助分析を更新しました");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLlmBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <h1>YouTube コメント人物言及分析</h1>
          <p>
            コメントを保存してから候補抽出、alias 確認、人物別ランキングまでをローカルで実行します。
            API キーなしでも fixture で検証できます。
          </p>
        </div>
        <form className="start-form" onSubmit={startRun}>
          <label>
            YouTube URL
            <input value={url} onChange={(event) => setUrl(event.target.value)} />
          </label>
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
            返信コメント
            <select value={replyFetchMode} onChange={(event) => setReplyFetchMode(event.target.value as "none" | "inline_subset")}>
              <option value="none">トップレベルのみ</option>
              <option value="inline_subset">API同梱分を含める</option>
            </select>
          </label>
          <button type="submit" disabled={busy}>
            {busy ? "処理中" : "分析を開始"}
          </button>
        </form>
      </section>

      {error ? <div className="error-box">{error}</div> : null}

      {run ? (
        <section className="panel status-panel">
          {run.video ? (
            <div className="status-panel__wide">
              <span className="label">Video</span>
              <strong>{run.video.title || run.video.youtube_video_id}</strong>
              <small>
                {run.video.channel_title || "チャンネル未取得"} / YouTube表示コメント数:{" "}
                {formatNullableNumber(run.video.youtube_comment_count)}
              </small>
            </div>
          ) : null}
          <div>
            <span className="label">Run</span>
            <strong>{run.run_id}</strong>
          </div>
          <div>
            <span className="label">Status</span>
            <strong>{run.status}</strong>
          </div>
          <div>
            <span className="label">Stage</span>
            <strong>{run.stage}</strong>
          </div>
          {run.fetch_summary ? (
            <div>
              <span className="label">Data Source</span>
              <strong>{sourceLabel(run.fetch_summary.source)}</strong>
              <small>{sourceNote(run.fetch_summary.source)}</small>
            </div>
          ) : null}
          {run.fetch_summary ? (
            <div>
              <span className="label">Comments</span>
              <strong>
                {run.fetch_summary.max_comments_fetched} / {run.fetch_summary.max_comments_requested}
              </strong>
              <small>
                {run.fetch_summary.fetch_order} / {replyFetchModeLabel(run.fetch_summary.reply_fetch_mode)}
              </small>
            </div>
          ) : null}
          {run.fetch_summary ? (
            <div>
              <span className="label">Replies</span>
              <strong>{run.fetch_summary.fetched_reply_count} 件</strong>
              <small>{replyFetchModeLabel(run.fetch_summary.reply_fetch_mode)}</small>
            </div>
          ) : null}
          {run.fetch_summary ? (
            <div>
              <span className="label">Coverage</span>
              <strong>{coverageLabel(run.fetch_summary.coverage.status)}</strong>
              <small>{run.fetch_summary.coverage.message}</small>
            </div>
          ) : null}
          <progress value={run.progress} max={1} />
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

      {candidates ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>人物候補と alias</h2>
              <p>人物ごとに、その人物として数える表記をまとめています。採用済み表記だけで集計します。</p>
            </div>
            <button disabled={busy || candidateSummary.accepted === 0} onClick={continueRun}>
              候補を確定して集計
            </button>
          </div>
          <div className="review-summary" aria-live="polite">
            <span>候補 {candidateSummary.total} 件</span>
            <strong>採用 {candidateSummary.accepted} 件</strong>
            <span>保留 {candidateSummary.pending} 件</span>
            <span>除外 {candidateSummary.rejected} 件</span>
            {lastAction ? <em>{lastAction}</em> : null}
          </div>
          <div className="candidate-grid">
            {candidates.persons.map((person) => (
              <article className={`candidate-card candidate-card--${person.status}`} key={person.person_id}>
                <div className="candidate-card__header">
                  <div>
                    <h3>{person.display_name}</h3>
                    <p>{person.reason}</p>
                    <p className="candidate-total">
                      集計対象表記 {person.aliases.filter((alias) => alias.status === "accepted").length} 件 / 重複除外後{" "}
                      {person.accepted_mention_comment_count} 件
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
                </div>
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
                    この人物として数える表記を追加
                    <div className="inline-edit">
                      <input
                        placeholder="例: 立野 / 沙紀 / みりちゃん"
                        value={aliasDrafts[person.person_id] ?? ""}
                        onChange={(event) =>
                          setAliasDrafts((drafts) => ({ ...drafts, [person.person_id]: event.target.value }))
                        }
                      />
                      <button type="button" disabled={busy || !(aliasDrafts[person.person_id] ?? "").trim()} onClick={() => addAlias(person)}>
                        追加
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
                      {alias.representative_comments.length ? (
                        <details className="alias-evidence">
                          <summary>代表コメント</summary>
                          {alias.representative_comments.map((comment) => (
                            <blockquote key={comment.comment_id}>
                              {comment.text_original}
                              <small>{comment.like_count} likes</small>
                            </blockquote>
                          ))}
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {report ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>言及ランキング</h2>
              <p>
                データソース: {sourceLabel(report.fetch_summary.source)} / 取得コメント:
                {report.fetch_summary.fetched_top_level_count + report.fetch_summary.fetched_reply_count} / YouTube表示:
                {formatNullableNumber(report.video.youtube_comment_count)}
              </p>
            </div>
          </div>
          <div className="report-summary-grid">
            <div>
              <span className="label">動画</span>
              <strong>{report.video.title || report.video.youtube_video_id}</strong>
              <small>{report.video.channel_title || "チャンネル未取得"}</small>
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
          <div className="report-layout">
            <div className="ranking-list">
              {report.rankings.mention_ranking.map((row, index) => (
                <article className="ranking-row" key={row.person_id}>
                  <span className="rank-number">{index + 1}</span>
                  <div>
                    <h3>{row.display_name}</h3>
                    <p>
                      {row.mention_comment_count}件 / {(row.mention_rate * 100).toFixed(1)}% / weighted{" "}
                      {row.like_weighted_score.toFixed(2)}
                    </p>
                    {row.representative_comments.map((comment) => (
                      <blockquote key={comment.comment_id}>{comment.text_original}</blockquote>
                    ))}
                  </div>
                </article>
              ))}
            </div>
            <aside className="sections-box">
              <h3>セクション状態</h3>
              {Object.entries(report.sections).map(([key, section]) => (
                <div key={key}>
                  <span>{key}</span>
                  <strong>{section.status}</strong>
                  {section.reason ? <small>{section.reason}</small> : null}
                </div>
              ))}
            </aside>
          </div>
        </section>
      ) : null}

      {report ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>LLM 補助分析</h2>
              <p>Codex app server 経由で、候補整理、alias 補完案、曖昧コメントだけをレビュー補助します。</p>
            </div>
            <button type="button" disabled={llmBusy || busy} onClick={runLlmAssist}>
              {llmBusy ? "分析中" : report.llm_assist ? "LLM 補助を再実行" : "LLM 補助を実行"}
            </button>
          </div>
          {report.llm_assist ? (
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
          ) : (
            <p className="list-note">まだ LLM 補助分析は実行していません。</p>
          )}
        </section>
      ) : null}

      {report ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>未知 alias 候補</h2>
              <p>既存 alias に入っていない、ニックネームらしい頻出表記です。人物に紐づけると再集計します。</p>
            </div>
            <strong>{visibleAliasSuggestions.length} 件</strong>
          </div>
          {visibleAliasSuggestions.length ? (
            <div className="alias-suggestion-grid">
              {visibleAliasSuggestions.map((suggestion) => (
                <article className="alias-suggestion-card" key={suggestion.normalized_alias}>
                  <div>
                    <h3>{suggestion.token}</h3>
                    <p>{suggestion.reason}</p>
                    <strong>{suggestion.hit_count} 件</strong>
                  </div>
                  <label>
                    紐づけ先
                    <select
                      value={aliasSuggestionDrafts[suggestion.normalized_alias] ?? suggestion.suggested_person_id ?? ""}
                      onChange={(event) =>
                        setAliasSuggestionDrafts((drafts) => ({
                          ...drafts,
                          [suggestion.normalized_alias]: event.target.value
                        }))
                      }
                    >
                      <option value="">人物を選択</option>
                      {assignablePersons.map((person) => (
                        <option key={person.person_id} value={person.person_id}>
                          {person.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="candidate-actions">
                    <button
                      type="button"
                      disabled={busy || !(aliasSuggestionDrafts[suggestion.normalized_alias] || suggestion.suggested_person_id)}
                      onClick={() => acceptAliasSuggestion(suggestion)}
                    >
                      alias に追加
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        setIgnoredAliasSuggestions((ignored) => ({
                          ...ignored,
                          [suggestion.normalized_alias]: true
                        }))
                      }
                    >
                      今回は無視
                    </button>
                  </div>
                  <details className="alias-evidence">
                    <summary>代表コメント</summary>
                    {suggestion.representative_comments.map((comment) => (
                      <blockquote key={comment.comment_id}>
                        {comment.text_original}
                        <small>
                          {comment.like_count} likes{comment.is_reply ? " / 返信" : ""}
                        </small>
                      </blockquote>
                    ))}
                  </details>
                </article>
              ))}
            </div>
          ) : (
            <p className="list-note">追加候補はありません。</p>
          )}
        </section>
      ) : null}

      {report && selectedDetailPerson && selectedPersonDetails ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>人物別詳細</h2>
              <p>人物ごとの集計表記、特徴語、根拠コメントを確認します。</p>
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
                        <strong>{comment.like_count} likes</strong>
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

      {report ? (
        <section className="panel">
          <div className="section-heading">
            <div>
              <h2>コメント一覧</h2>
              <p>コメント本文と紐づいた人物を確認します。検索と人物フィルタで根拠を絞り込めます。</p>
            </div>
            <strong>{filteredComments.length} / {report.comments.length} 件</strong>
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
          <div className="comment-list">
            {filteredComments.slice(0, 200).map((comment) => (
              <article className="comment-row" key={comment.comment_id}>
                <div className="comment-row__meta">
                  <strong>{comment.like_count} likes</strong>
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
          {filteredComments.length > 200 ? <p className="list-note">先頭 200 件を表示しています。検索条件を追加してください。</p> : null}
        </section>
      ) : null}
    </main>
  );
}

function statusLabel(status: string): string {
  if (status === "accepted") return "採用";
  if (status === "rejected") return "除外";
  if (status === "pending") return "保留";
  if (status === "candidate") return "候補";
  return status;
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function sourceLabel(source: string): string {
  if (source === "cache") return "Cache";
  if (source === "youtube_api") return "YouTube API";
  if (source === "fixture") return "Fixture";
  return source;
}

function sourceNote(source: string): string {
  if (source === "cache") return "保存済みデータを使用。API再消費なし。";
  if (source === "youtube_api") return "今回YouTube APIから取得。次回同条件はcache使用。";
  if (source === "fixture") return "API keyなしの検証データ。";
  return "";
}

function replyFetchModeLabel(mode: string): string {
  if (mode === "none") return "トップレベルのみ";
  if (mode === "inline_subset") return "API同梱返信を含む";
  if (mode === "full") return "返信を全件取得";
  return mode;
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

function coverageLabel(status: string): string {
  if (status === "complete_or_near_complete") return "概ね取得済み";
  if (status === "limited_by_request") return "要求上限まで取得";
  if (status === "limited_by_api_or_availability") return "取得不足の可能性";
  if (status === "unknown") return "不明";
  return status;
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

function extractFeatureWords(texts: string[], excludedTerms: string[]): Array<{ term: string; count: number }> {
  const excluded = new Set(excludedTerms.map((term) => normalizeSearch(term)).filter(Boolean));
  const stopwords = new Set(["さん", "ちゃん", "くん", "これ", "それ", "動画", "コメント", "ところ", "感じ", "今回"]);
  const counts = new Map<string, number>();
  for (const text of texts) {
    const tokens = text.match(/[一-龥々ぁ-んァ-ヶーA-Za-z0-9]{2,16}/g) ?? [];
    for (const token of tokens) {
      const normalized = normalizeSearch(token);
      if (excluded.has(normalized) || stopwords.has(normalized) || normalized.length < 2 || /\d/.test(normalized)) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([term, count]) => ({ term, count }));
}

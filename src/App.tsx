import { FormEvent, useMemo, useState } from "react";

type RunState = {
  run_id: string;
  status: string;
  stage: string;
  progress: number;
  error_message?: string | null;
};

type Alias = {
  alias_id: string;
  alias_text: string;
  hit_count: number;
  confidence: number;
  status: string;
  representative_comment_ids: string[];
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

type Report = {
  schema_version: string;
  run_id: string;
  video: {
    youtube_video_id: string;
    url: string;
    title: string;
    channel_title: string;
  };
  fetch_summary: {
    source: string;
    fetched_at: string;
    fetched_top_level_count: number;
    fetched_reply_count: number;
    total_like_count: number;
    max_comments_requested: number;
    fetch_order: string;
    reply_fetch_mode: string;
  };
  rankings: {
    mention_ranking: RankingRow[];
  };
  sections: Record<string, { status: string; reason?: string }>;
  comments: Array<{
    comment_id: string;
    text_original: string;
    like_count: number;
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
  const [run, setRun] = useState<RunState | null>(null);
  const [candidates, setCandidates] = useState<CandidatesResponse | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [displayNameDrafts, setDisplayNameDrafts] = useState<Record<string, string>>({});
  const [aliasDrafts, setAliasDrafts] = useState<Record<string, string>>({});
  const [commentSearch, setCommentSearch] = useState("");
  const [commentPersonFilter, setCommentPersonFilter] = useState("all");
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
          reply_fetch_mode: "none",
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
    action: { type: string; person_id?: string; alias_id?: string; alias_text?: string; display_name?: string },
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
          <button type="submit" disabled={busy}>
            {busy ? "処理中" : "分析を開始"}
          </button>
        </form>
      </section>

      {error ? <div className="error-box">{error}</div> : null}

      {run ? (
        <section className="panel status-panel">
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
          <progress value={run.progress} max={1} />
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
                      集計対象表記 {person.aliases.filter((alias) => alias.status === "accepted").length} 件 / 集計コメント{" "}
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
                </div>
                <div className="alias-list-heading">この人物として数える表記</div>
                <ul className="alias-list">
                  {person.aliases.map((alias) => (
                    <li key={alias.alias_id}>
                      <span>{alias.alias_text}</span>
                      <span>{alias.hit_count}件</span>
                      <span className={`status status-${alias.status}`}>{statusLabel(alias.status)}</span>
                      <button
                        className={alias.status === "accepted" ? "choice-button choice-button--selected" : "choice-button"}
                        disabled={busy || alias.status === "accepted"}
                        onClick={() =>
                          updateCandidate(
                            { type: "accept_alias", alias_id: alias.alias_id },
                            `alias「${alias.alias_text}」を採用しました`
                          )
                        }
                      >
                        {updatingId === alias.alias_id ? "処理中" : alias.status === "accepted" ? "採用済み" : "採用"}
                      </button>
                      <button
                        className={alias.status === "rejected" ? "choice-button choice-button--rejected" : "choice-button"}
                        disabled={busy || alias.status === "rejected"}
                        onClick={() =>
                          updateCandidate(
                            { type: "reject_alias", alias_id: alias.alias_id },
                            `alias「${alias.alias_text}」を除外しました`
                          )
                        }
                      >
                        {updatingId === alias.alias_id ? "処理中" : alias.status === "rejected" ? "除外済み" : "除外"}
                      </button>
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
                データソース: {report.fetch_summary.source} / 取得コメント:
                {report.fetch_summary.fetched_top_level_count}
              </p>
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
                  <div className="mention-pills">
                    {comment.mentioned_persons.length ? (
                      comment.mentioned_persons.map((person) => <span key={person.person_id}>{person.display_name}</span>)
                    ) : (
                      <span className="mention-pills__empty">未紐づけ</span>
                    )}
                  </div>
                </div>
                <p>{comment.text_original}</p>
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

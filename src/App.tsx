import { FormEvent, useMemo, useState } from "react";

type RunState = {
  run_id: string;
  status: string;
  stage: string;
  progress: number;
  error_message?: string | null;
  fetch_summary?: {
    source: string;
    max_comments_requested: number;
    max_comments_fetched: number;
    fetch_order: string;
    reply_fetch_mode: string;
    fetched_at: string;
  };
};

type Alias = {
  alias_id: string;
  alias_text: string;
  hit_count: number;
  confidence: number;
  source: string;
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
  persons: Person[];
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
                {run.fetch_summary.fetch_order} / {run.fetch_summary.reply_fetch_mode}
              </small>
            </div>
          ) : null}
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
                      <span>
                        {alias.alias_text}
                        <small>{aliasSourceLabel(alias.source)}</small>
                      </span>
                      <span>{alias.hit_count}件</span>
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
                    <span key={word.term}>
                      {word.term}
                      <strong>{word.count}</strong>
                    </span>
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
      if (excluded.has(normalized) || stopwords.has(normalized) || normalized.length < 2) continue;
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([term, count]) => ({ term, count }));
}

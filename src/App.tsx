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
  const [error, setError] = useState<string | null>(null);

  const acceptedCount = useMemo(
    () => candidates?.persons.filter((person) => person.status === "accepted").length ?? 0,
    [candidates]
  );

  async function startRun(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
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

  async function updateCandidate(action: { type: string; person_id?: string; alias_id?: string }) {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/api/runs/${run.run_id}/candidate-actions`, {
        method: "POST",
        body: JSON.stringify({ actions: [action] })
      });
      const nextCandidates = await api<CandidatesResponse>(`/api/runs/${run.run_id}/candidates`);
      setCandidates(nextCandidates);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function continueRun() {
    if (!run) return;
    setBusy(true);
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
              <p>短い alias や低頻度候補は保留にしています。採用済み alias だけで集計します。</p>
            </div>
            <button disabled={busy || acceptedCount === 0} onClick={continueRun}>
              候補を確定して集計
            </button>
          </div>
          <div className="candidate-grid">
            {candidates.persons.map((person) => (
              <article className="candidate-card" key={person.person_id}>
                <div className="candidate-card__header">
                  <div>
                    <h3>{person.display_name}</h3>
                    <p>{person.reason}</p>
                  </div>
                  <span className={`status status-${person.status}`}>{person.status}</span>
                </div>
                <div className="candidate-actions">
                  <button onClick={() => updateCandidate({ type: "accept_person", person_id: person.person_id })}>
                    採用
                  </button>
                  <button onClick={() => updateCandidate({ type: "reject_person", person_id: person.person_id })}>
                    除外
                  </button>
                </div>
                <ul className="alias-list">
                  {person.aliases.map((alias) => (
                    <li key={alias.alias_id}>
                      <span>{alias.alias_text}</span>
                      <span>{alias.hit_count}件</span>
                      <span className={`status status-${alias.status}`}>{alias.status}</span>
                      <button onClick={() => updateCandidate({ type: "accept_alias", alias_id: alias.alias_id })}>
                        採用
                      </button>
                      <button onClick={() => updateCandidate({ type: "reject_alias", alias_id: alias.alias_id })}>
                        除外
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
    </main>
  );
}

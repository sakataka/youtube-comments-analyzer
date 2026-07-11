import { FormEvent } from "react";
import { formatNumber } from "../api";
import { ReplyMode, RunJob, RunState, SettingsInfo } from "../types";

type Props = {
  url: string;
  setUrl: (value: string) => void;
  maxComments: number;
  setMaxComments: (value: number) => void;
  replyMode: ReplyMode;
  setReplyMode: (value: ReplyMode) => void;
  forceRefresh: boolean;
  setForceRefresh: (value: boolean) => void;
  settings: SettingsInfo | null;
  history: RunState[];
  busy: boolean;
  job: RunJob | null;
  onSubmit: (event: FormEvent) => void;
  onOpenRun: (runId: string) => void;
  onOpenSettings: () => void;
};

export function StartScreen({
  url,
  setUrl,
  maxComments,
  setMaxComments,
  replyMode,
  setReplyMode,
  forceRefresh,
  setForceRefresh,
  settings,
  history,
  busy,
  job,
  onSubmit,
  onOpenRun,
  onOpenSettings
}: Props) {
  return (
    <main className="start-shell">
      <header className="product-header">
        <a className="product-name" href="/" aria-label="コメントインサイト ホーム">
          コメントインサイト
        </a>
        <button className="text-button" type="button" onClick={onOpenSettings}>
          設定
        </button>
      </header>

      <section className="start-hero" aria-labelledby="start-title">
        <div className="start-copy">
          <h1 id="start-title">YouTubeコメントから、受け取られ方を読み解く。</h1>
          <p>誰が、どんな感情で、何について語られたのか。件数と根拠コメントを一つのレポートにまとめます。</p>
        </div>
        <form className="analysis-form" onSubmit={onSubmit}>
          <label htmlFor="youtube-url">YouTube動画のURL</label>
          <div className="analysis-form__primary">
            <input
              id="youtube-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
            />
            <button type="submit" disabled={busy}>
              {busy ? "分析しています" : "分析する"}
            </button>
          </div>
          <details className="advanced-settings">
            <summary>詳細設定</summary>
            <div className="advanced-settings__body">
              <label htmlFor="max-comments">
                最大コメント数
                <input
                  id="max-comments"
                  type="number"
                  min={settings?.max_comments.min ?? 1}
                  max={settings?.max_comments.max ?? 5000}
                  value={maxComments}
                  onChange={(event) => setMaxComments(Number(event.target.value))}
                />
              </label>
              <fieldset>
                <legend>返信コメント</legend>
                {(settings?.reply_fetch_modes ?? defaultReplyModes).map((mode) => (
                  <label className="radio-row" key={mode.value}>
                    <input
                      type="radio"
                      name="reply-mode"
                      value={mode.value}
                      checked={replyMode === mode.value}
                      onChange={() => setReplyMode(mode.value)}
                    />
                    <span>{mode.label}</span>
                    {mode.uses_extra_quota ? <small>追加quotaを使用</small> : null}
                  </label>
                ))}
              </fieldset>
              <label className="check-row">
                <input type="checkbox" checked={forceRefresh} onChange={(event) => setForceRefresh(event.target.checked)} />
                <span>保存済みコメントとの差分を更新する</span>
              </label>
            </div>
          </details>
          {job && job.status !== "completed" ? (
            <div className="job-progress" aria-live="polite">
              <div>
                <strong>{job.status === "queued" ? "分析待ち" : "コメントを分析中"}</strong>
                <span>{jobStageLabel(job.stage)}</span>
              </div>
              <progress max={1} value={job.progress} />
            </div>
          ) : null}
        </form>
      </section>

      <section className="recent-runs" aria-labelledby="recent-title">
        <div className="section-title-row">
          <div>
            <h2 id="recent-title">最近の分析</h2>
            <p>保存済みのレポートを、そのまま続きから開けます。</p>
          </div>
          <span>{history.length}件</span>
        </div>
        {history.length ? (
          <div className="recent-list">
            {history.slice(0, 6).map((item) => (
              <button className="recent-row" type="button" key={item.run_id} onClick={() => onOpenRun(item.run_id)}>
                <span className="recent-row__title">{item.video?.title || item.video?.youtube_video_id || item.run_id}</span>
                <span>{item.video?.channel_title || "チャンネル未取得"}</span>
                <span>
                  {formatNumber(item.fetch_summary?.max_comments_fetched)}件・
                  {item.review_status === "verified" ? "確認済み" : "暫定"}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <p className="empty-state">まだ分析結果はありません。</p>
        )}
      </section>
    </main>
  );
}

const defaultReplyModes: SettingsInfo["reply_fetch_modes"] = [
  { value: "none", label: "トップレベルのみ", uses_extra_quota: false },
  { value: "inline_subset", label: "同梱返信を含める", uses_extra_quota: false },
  { value: "full", label: "返信を追加取得する", uses_extra_quota: true }
];

function jobStageLabel(stage: string): string {
  if (stage === "fetching_comments") return "YouTubeコメントを取得しています";
  if (stage === "building_provisional_report") return "人物・感情・話題を集計しています";
  if (stage === "queued") return "前の分析が終わるまで待機しています";
  return stage;
}

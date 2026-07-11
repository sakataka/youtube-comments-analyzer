import { FormEvent } from "react";
import { formatNumber } from "../api";
import { ReplyMode, RunJob, RunState, SettingsInfo } from "../types";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Field, FieldContent, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "./ui/field";
import { Input } from "./ui/input";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { AppHeader } from "./AppHeader";
import { SectionHeading } from "./SectionHeading";

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
      <AppHeader onOpenSettings={onOpenSettings} />

      <section className="start-hero" aria-labelledby="start-title">
        <h1 id="start-title">YouTubeコメントを分析</h1>
        <form className="analysis-form" onSubmit={onSubmit}>
          <FieldLabel htmlFor="youtube-url">YouTube動画のURL</FieldLabel>
          <div className="analysis-form__primary">
            <Input
              id="youtube-url"
              type="url"
              inputMode="url"
              autoComplete="url"
              placeholder="https://www.youtube.com/watch?v=..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              required
            />
            <Button size="lg" type="submit" disabled={busy}>
              {busy ? "分析しています" : "分析する"}
            </Button>
          </div>
          <details className="advanced-settings">
            <summary>詳細設定</summary>
            <FieldGroup className="advanced-settings__body">
              <Field className="max-comments-field" orientation="responsive">
                <FieldLabel htmlFor="max-comments">最大コメント数</FieldLabel>
                <Input
                  id="max-comments"
                  type="number"
                  min={settings?.max_comments.min ?? 1}
                  max={settings?.max_comments.max ?? 5000}
                  value={maxComments}
                  onChange={(event) => setMaxComments(Number(event.target.value))}
                />
              </Field>
              <FieldSet>
                <FieldLegend>返信コメント</FieldLegend>
                <RadioGroup value={replyMode} onValueChange={(value) => setReplyMode(value as ReplyMode)}>
                {(settings?.reply_fetch_modes ?? defaultReplyModes).map((mode) => (
                  <FieldLabel className="radio-row" htmlFor={`reply-mode-${mode.value}`} key={mode.value}>
                    <RadioGroupItem id={`reply-mode-${mode.value}`} value={mode.value} />
                    <FieldContent><span>{mode.label}</span></FieldContent>
                    {mode.uses_extra_quota ? <small>追加quotaを使用</small> : null}
                  </FieldLabel>
                ))}
                </RadioGroup>
              </FieldSet>
              <Field orientation="horizontal">
                <Checkbox id="force-refresh" checked={forceRefresh} onCheckedChange={(checked) => setForceRefresh(checked === true)} />
                <FieldLabel className="check-row" htmlFor="force-refresh">保存済みコメントとの差分を更新する</FieldLabel>
              </Field>
            </FieldGroup>
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
        <SectionHeading compact id="recent-title" title="最近の分析" description="保存済みのレポートを、そのまま続きから開けます。" aside={<span>{history.length}件</span>} />
        {history.length ? (
          <div className="recent-list">
            {history.slice(0, 6).map((item) => (
              <Button className="recent-row" variant="ghost" type="button" key={item.run_id} onClick={() => onOpenRun(item.run_id)}>
                <span className="recent-row__title">{item.video?.title || item.video?.youtube_video_id || item.run_id}</span>
                <span>{item.video?.channel_title || "チャンネル未取得"}</span>
                <span>
                  {formatNumber(item.fetch_summary?.max_comments_fetched)}件・
                  {item.review_status === "verified" ? "確認済み" : "暫定"}
                </span>
              </Button>
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

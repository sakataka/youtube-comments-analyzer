import { FormEvent, useRef, useState } from "react";
import { formatNumber } from "../api";
import { ReplyMode, RunJob, RunState, SettingsInfo } from "../types";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Field, FieldContent, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "./ui/field";
import { Input } from "./ui/input";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { AppHeader } from "./AppHeader";
import { SectionHeading } from "./SectionHeading";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";
import { Trash2Icon } from "lucide-react";

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
  historyCount: number;
  busy: boolean;
  job: RunJob | null;
  onSubmit: (event: FormEvent) => void;
  onOpenRun: (runId: string) => void;
  onDeleteRun: (runId?: string) => void;
  onOpenSettings: () => void;
};

type PendingDelete = { type: "one"; run: RunState } | { type: "all" };

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
  historyCount,
  busy,
  job,
  onSubmit,
  onOpenRun,
  onDeleteRun,
  onOpenSettings
}: Props) {
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const deleteTriggerRef = useRef<HTMLButtonElement | null>(null);
  const pendingTitle = pendingDelete?.type === "one" ? runTitle(pendingDelete.run) : null;

  function openDeleteDialog(trigger: HTMLButtonElement, pending: PendingDelete) {
    deleteTriggerRef.current = trigger;
    setPendingDelete(pending);
  }

  function closeDeleteDialog() {
    setPendingDelete(null);
    window.requestAnimationFrame(() => deleteTriggerRef.current?.focus());
  }

  return (
    <>
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
        <SectionHeading
          compact
          id="recent-title"
          title="最近の分析"
          description="保存済みのレポートを、そのまま続きから開けます。"
          aside={history.length ? (
            <div className="recent-actions">
              <span>{historyCount}件</span>
              <Button variant="destructive" size="sm" type="button" disabled={busy} onClick={(event) => openDeleteDialog(event.currentTarget, { type: "all" })}>すべて削除</Button>
            </div>
          ) : <span>0件</span>}
        />
        {history.length ? (
          <div className="recent-list">
            {history.slice(0, 6).map((item) => (
              <div className="recent-row" key={item.run_id}>
                <Button className="recent-row__open" variant="ghost" type="button" disabled={busy} onClick={() => onOpenRun(item.run_id)}>
                  <span className="recent-row__title">{runTitle(item)}</span>
                  <span>{item.video?.channel_title || "チャンネル未取得"}</span>
                  <span>
                    {formatNumber(item.fetch_summary?.max_comments_fetched)}件・
                    {item.review_status === "verified" ? "確認済み" : "暫定"}
                  </span>
                </Button>
                <Button className="recent-row__delete" variant="ghost" size="icon" type="button" disabled={busy} aria-label={`「${runTitle(item)}」を削除`} onClick={(event) => openDeleteDialog(event.currentTarget, { type: "one", run: item })}>
                  <Trash2Icon />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state">まだ分析結果はありません。</p>
        )}
      </section>
    </main>
    <AlertDialog open={pendingDelete != null} onOpenChange={(open) => { if (!open) closeDeleteDialog(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{pendingDelete?.type === "all" ? `${historyCount}件の分析結果をすべて削除しますか？` : "この分析結果を削除しますか？"}</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDelete?.type === "all"
              ? "最近の分析にある保存済みレポートをすべて削除します。YouTubeコメントのキャッシュは削除しません。この操作は元に戻せません。"
              : `「${pendingTitle ?? "分析結果"}」を削除します。YouTubeコメントのキャッシュは削除しません。この操作は元に戻せません。`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>キャンセル</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={() => onDeleteRun(pendingDelete?.type === "one" ? pendingDelete.run.run_id : undefined)}>
            {pendingDelete?.type === "all" ? "すべて削除" : "削除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function runTitle(run: RunState): string {
  return run.video?.title || run.video?.youtube_video_id || run.run_id;
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

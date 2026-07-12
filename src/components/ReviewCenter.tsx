import { formatNumber } from "../api";
import { CandidatesResponse, Report, SentimentLabel, SentimentReviewItem } from "../types";
import { sentimentLabel, sentimentMethodLabel, sentimentReasonLabel } from "../lib/sentiment";
import { XIcon } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";

type Props = {
  report: Report;
  candidates: CandidatesResponse | null;
  busy: boolean;
  open: boolean;
  onClose: () => void;
  onCandidateAction: (action: Record<string, string>) => void;
  onSentimentAction: (item: SentimentReviewItem, label: SentimentLabel) => void;
  onVerify: () => void;
  onRunAiAssist: () => void;
};

const sentimentOptions: Array<{ value: SentimentLabel; label: string }> = [
  { value: "positive", label: "ポジティブ" },
  { value: "neutral", label: "ニュートラル" },
  { value: "negative", label: "ネガティブ" },
  { value: "mixed", label: "混合" },
  { value: "unclear", label: "判断保留" }
];

export function ReviewCenter({ report, candidates, busy, open, onClose, onCandidateAction, onSentimentAction, onVerify, onRunAiAssist }: Props) {
  const pendingCandidates = (candidates?.persons ?? []).filter((person) => !["accepted", "rejected"].includes(person.status));
  const sentimentItems = report.sentiment.review_items.slice(0, 30);
  const qualityItems = report.quality_review.human_review_items.slice(0, 10);
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent className="modal review-modal" showCloseButton={false}>
        <DialogHeader className="modal-header">
          <div><DialogTitle>レビューセンター</DialogTitle><DialogDescription>結果に影響しやすい候補と、感情が曖昧なコメントだけを確認します。</DialogDescription></div>
          <DialogClose asChild><Button variant="secondary" size="icon" type="button" aria-label="閉じる"><XIcon /></Button></DialogClose>
        </DialogHeader>
        <div className="review-summary">
          <div><span>人物候補</span><strong>{pendingCandidates.length}件</strong></div>
          <div><span>要確認（上位を表示）</span><strong>{report.review.pending_item_count}件</strong></div>
          <div><span>AI補助</span><strong>{report.sentiment.ai_status === "available" ? "利用済み" : report.sentiment.ai_status === "partial" ? "一部未完了" : "未完了"}</strong></div>
          <div><span>ローカルモデル</span><strong>{report.sentiment.local_model?.status === "available" ? "利用済み" : "未完了"}</strong></div>
          <Button type="button" disabled={busy} onClick={onRunAiAssist}>感情を再判定</Button>
        </div>

        <div className="review-columns">
          <section aria-labelledby="candidate-review-title">
            <h3 id="candidate-review-title">人物候補</h3>
            {pendingCandidates.length ? pendingCandidates.slice(0, 20).map((person) => (
              <article className="review-item" key={person.person_id}>
                <div><strong>{person.display_name}</strong><span>{formatNumber(person.accepted_mention_comment_count)}件・確度 {Math.round(person.confidence * 100)}%</span></div>
                <p>{person.reason}</p>
                <div className="review-actions">
                  <Button size="sm" type="button" disabled={busy} onClick={() => onCandidateAction({ type: "accept_person", person_id: person.person_id })}>採用</Button>
                  <Button size="sm" variant="secondary" type="button" disabled={busy} onClick={() => onCandidateAction({ type: "reject_person", person_id: person.person_id })}>除外</Button>
                </div>
              </article>
            )) : <p className="empty-state">保留中の人物候補はありません。</p>}
          </section>

          <section aria-labelledby="sentiment-review-title">
            <h3 id="sentiment-review-title">感情の要確認</h3>
            {qualityItems.length ? (
              <div className="quality-review-list">
                <h4>人物紐づけの要確認</h4>
                {qualityItems.map((item) => (
                  <article className="review-item" key={`quality-${item.comment_id}`}>
                    <div><strong>{item.mentioned_persons.map((person) => person.display_name).join("・") || "人物未確定"}</strong><span>{item.reason}</span></div>
                    <p>{item.text_original}</p>
                  </article>
                ))}
              </div>
            ) : null}
            {sentimentItems.length ? sentimentItems.map((item) => (
              <article className="review-item" key={`${item.comment_id}-${item.target_type}-${item.target_id ?? "video"}`}>
                <div><strong>{item.target_display_name || "動画全体"}</strong><span>現在: {sentimentLabel(item.label)}・{item.method === "human" ? "人が確定" : `確度 ${Math.round(item.confidence * 100)}%`}・{sentimentMethodLabel(item.method)}</span></div>
                {item.review_reasons?.length ? <div className="review-reasons">{item.review_reasons.map((reason) => <span key={reason}>{sentimentReasonLabel(reason)}</span>)}</div> : null}
                <p>{item.text_original}</p>
                <SentimentEvidenceDetails item={item} />
                <div className="sentiment-choices" aria-label="感情を修正">
                  {sentimentOptions.map((option) => (
                    <Button size="sm" variant={item.label === option.value ? "default" : "secondary"} type="button" disabled={busy} onClick={() => onSentimentAction(item, option.value)} key={option.value}>{option.label}</Button>
                  ))}
                </div>
              </article>
            )) : <p className="empty-state">感情の要確認項目はありません。</p>}
          </section>
        </div>
        <DialogFooter className="modal-footer">
          <p>確認済みにしても、後から修正して再集計できます。</p>
          <Button type="button" disabled={busy} onClick={onVerify}>このレポートを確認済みにする</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SentimentEvidenceDetails({ item }: { item: SentimentReviewItem }) {
  const rule = item.evidence.rule;
  const local = item.evidence.local_model;
  const probabilities = local?.probabilities;
  return (
    <details className="review-evidence">
      <summary>判定根拠</summary>
      <dl>
        <div><dt>ルール</dt><dd>{rule?.matched_terms?.map((term) => term.term).join("・") || "一致語なし"}</dd></div>
        {rule?.ambiguity_flags?.length ? <div><dt>曖昧性</dt><dd>{rule.ambiguity_flags.join("・")}</dd></div> : null}
        {probabilities ? <div><dt>モデル確率</dt><dd>ポジティブ {Math.round((probabilities.positive ?? 0) * 100)}% / ニュートラル {Math.round((probabilities.neutral ?? 0) * 100)}% / ネガティブ {Math.round((probabilities.negative ?? 0) * 100)}%</dd></div> : null}
        {item.evidence.ai?.reason ? <div><dt>AI</dt><dd>{item.evidence.ai.reason}</dd></div> : null}
      </dl>
    </details>
  );
}

import { formatNumber } from "../api";
import { CandidatesResponse, Report, SentimentLabel, SentimentReviewItem } from "../types";

type Props = {
  report: Report;
  candidates: CandidatesResponse | null;
  busy: boolean;
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

export function ReviewCenter({ report, candidates, busy, onClose, onCandidateAction, onSentimentAction, onVerify, onRunAiAssist }: Props) {
  const pendingCandidates = (candidates?.persons ?? []).filter((person) => !["accepted", "rejected"].includes(person.status));
  const sentimentItems = report.sentiment.review_items.slice(0, 30);
  const qualityItems = report.quality_review.human_review_items.slice(0, 10);
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal review-modal" role="dialog" aria-modal="true" aria-labelledby="review-title">
        <header className="modal-header">
          <div><h2 id="review-title">レビューセンター</h2><p>結果に影響しやすい候補と、感情が曖昧なコメントだけを確認します。</p></div>
          <button className="icon-button" type="button" aria-label="閉じる" onClick={onClose}>×</button>
        </header>
        <div className="review-summary">
          <div><span>人物候補</span><strong>{pendingCandidates.length}件</strong></div>
          <div><span>要確認（上位を表示）</span><strong>{report.review.pending_item_count}件</strong></div>
          <div><span>AI補助</span><strong>{report.sentiment.ai_status === "available" ? "利用済み" : "未完了"}</strong></div>
          <button type="button" disabled={busy} onClick={onRunAiAssist}>AIで曖昧項目を補助</button>
        </div>

        <div className="review-columns">
          <section aria-labelledby="candidate-review-title">
            <h3 id="candidate-review-title">人物候補</h3>
            {pendingCandidates.length ? pendingCandidates.slice(0, 20).map((person) => (
              <article className="review-item" key={person.person_id}>
                <div><strong>{person.display_name}</strong><span>{formatNumber(person.accepted_mention_comment_count)}件・確度 {Math.round(person.confidence * 100)}%</span></div>
                <p>{person.reason}</p>
                <div className="review-actions">
                  <button type="button" disabled={busy} onClick={() => onCandidateAction({ type: "accept_person", person_id: person.person_id })}>採用</button>
                  <button className="secondary-button" type="button" disabled={busy} onClick={() => onCandidateAction({ type: "reject_person", person_id: person.person_id })}>除外</button>
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
                <div><strong>{item.target_display_name || "動画全体"}</strong><span>現在: {labelText(item.label)}・確度 {Math.round(item.confidence * 100)}%</span></div>
                <p>{item.text_original}</p>
                <div className="sentiment-choices" aria-label="感情を修正">
                  {sentimentOptions.map((option) => (
                    <button className={item.label === option.value ? "choice-active" : "secondary-button"} type="button" disabled={busy} onClick={() => onSentimentAction(item, option.value)} key={option.value}>{option.label}</button>
                  ))}
                </div>
              </article>
            )) : <p className="empty-state">感情の要確認項目はありません。</p>}
          </section>
        </div>
        <footer className="modal-footer">
          <p>確認済みにしても、後から修正して再集計できます。</p>
          <button type="button" disabled={busy} onClick={onVerify}>このレポートを確認済みにする</button>
        </footer>
      </section>
    </div>
  );
}

function labelText(label: SentimentLabel): string {
  return sentimentOptions.find((item) => item.value === label)?.label ?? label;
}

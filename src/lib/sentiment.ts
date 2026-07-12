import { SentimentLabel, SentimentMethod, SentimentReviewReason } from "../types";

export const sentimentLabels: SentimentLabel[] = ["positive", "neutral", "negative", "mixed", "unclear"];

export function sentimentLabel(label: SentimentLabel): string {
  return { positive: "ポジティブ", neutral: "ニュートラル", negative: "ネガティブ", mixed: "混合", unclear: "判断保留" }[label];
}

export function sentimentMethodLabel(method: SentimentMethod): string {
  return { rule: "ルール", local_model: "ローカルモデル", hybrid: "ルール＋モデル", ai: "AI補助", human: "人が修正" }[method];
}

export function sentimentReasonLabel(reason: SentimentReviewReason | string): string {
  return {
    ai_failed: "AI補助に失敗",
    ai_unresolved: "AIでも未確定",
    ai_capacity_deferred: "AI補助の上限外",
    rule_model_conflict: "ルールとモデルが不一致",
    local_model_failed: "ローカルモデルを利用不可",
    low_model_confidence: "モデル確度が低い",
    mixed_candidate: "肯定・否定が混在",
    input_truncated: "長文を一部省略",
    ambiguous_expression: "文脈に曖昧さあり",
  }[reason] ?? reason;
}

export function integrationReasonLabel(reason?: string | null): string {
  if (!reason) return "判定理由なし";
  return {
    rule_provisional: "ローカル判定前のルール結果",
    local_model_clear: "ルールに明確な極性がなく、モデルが高確度で判定",
    rule_model_agreement: "ルールとローカルモデルが一致",
    local_model_unavailable_rule_confirmed: "モデルを利用できず、明確なルール結果を採用",
    local_model_unavailable_ambiguous: "モデルを利用できず、曖昧なため判断保留",
  }[reason] ?? sentimentReasonLabel(reason);
}

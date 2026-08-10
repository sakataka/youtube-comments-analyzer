export type SentimentLabel = "positive" | "neutral" | "negative" | "mixed" | "unclear";
export type SentimentMethod = "rule" | "local_model" | "hybrid" | "ai" | "human";
export type SentimentReviewReason = "ai_failed" | "ai_unresolved" | "ai_capacity_deferred" | "rule_model_conflict" | "local_model_failed" | "low_model_confidence" | "mixed_candidate" | "input_truncated" | "ambiguous_expression";

export type SentimentDistribution = {
  total: number;
  counts: Record<SentimentLabel, number>;
  rates: Record<SentimentLabel, number>;
};

export type SettingsInfo = {
  youtube_api_key_configured: boolean;
  youtube_api_key_env_name: string;
  data_dir: string;
  max_comments: { default: number; min: number; max: number };
  reply_fetch_modes: Array<{ value: ReplyMode; label: string; uses_extra_quota: boolean }>;
  llm_provider: string;
  local_sentiment: {
    status: "not_loaded" | "available" | "failed" | "disabled";
    model_id: string;
    revision: string;
    license: string;
    confidence_threshold: number;
    device: string;
    failure_reason?: string | null;
  };
};

export type DataSummary = {
  total_bytes: number;
  run_count: number;
  youtube_cache: { bytes: number; file_count: number };
  runs: { bytes: number; file_count: number };
};

export type ReplyMode = "none" | "inline_subset" | "full";

export type RunState = {
  run_id: string;
  status: string;
  stage: string;
  progress: number;
  error_message?: string | null;
  review_status?: "provisional" | "verified";
  reviewed_at?: string | null;
  created_at?: string;
  video?: VideoSummary;
  fetch_summary?: FetchSummary;
};

export type RunJob = {
  job_id: string;
  status: "queued" | "running" | "completed" | "failed";
  stage: string;
  progress: number;
  run_id?: string | null;
  error_message?: string | null;
  queue_position?: number;
};

type VideoSummary = {
  youtube_video_id: string;
  url: string;
  title: string;
  channel_title: string;
  youtube_comment_count?: number | null;
  comment_count_available: boolean;
};

type FetchSummary = {
  source: string;
  fetched_at?: string;
  max_comments_requested: number;
  max_comments_fetched: number;
  fetched_top_level_count: number;
  fetched_reply_count: number;
  reply_fetch_mode: string;
  fetch_order: string;
  coverage: {
    status: string;
    message: string;
    youtube_comment_count?: number | null;
    comment_count_available: boolean;
    fetched_comment_count: number;
    max_comments_requested: number;
  };
  like_count_distribution?: Array<{ label: string; count: number }>;
};

type Alias = {
  alias_id: string;
  alias_text: string;
  status: string;
  hit_count: number;
  confidence: number;
};

type Person = {
  person_id: string;
  display_name: string;
  entity_type: string;
  status: string;
  confidence: number;
  reason: string;
  accepted_mention_comment_count: number;
  aliases: Alias[];
};

export type CandidatesResponse = { run_id: string; persons: Person[] };

export type RankingRow = {
  person_id: string;
  display_name: string;
  mention_comment_count: number;
  mention_rate: number;
  top_comment_mention_count: number;
  single_mention_count: number;
  multi_mention_count: number;
  raw_like_sum: number;
  like_weighted_score: number;
  sentiment: SentimentDistribution;
  representative_comments: EvidenceComment[];
};

type EvidenceComment = {
  comment_id: string;
  text_original: string;
  like_count: number;
};

type Topic = {
  cluster_id: string;
  label: string;
  comment_count: number;
  top_persons: Array<{ display_name: string; count: number }>;
  top_keywords: Array<{ term: string; count: number }>;
  summary: string;
  representative_comments: EvidenceComment[];
};

type CooccurrencePair = {
  person_a_id: string;
  person_a_name: string;
  person_b_id: string;
  person_b_name: string;
  cooccurrence_comment_count: number;
  like_weighted_score: number;
  relationship_category: string;
  representative_comments: EvidenceComment[];
};

type AppealPerson = {
  person_id: string;
  display_name: string;
  comment_count: number;
  summary: string;
  category_counts: Array<{ category: string; label: string; count: number }>;
  feature_words: Array<{ term: string; count: number; score: number }>;
  evidence_comments: EvidenceComment[];
};

export type SentimentReviewItem = {
  comment_id: string;
  text_original: string;
  like_count: number;
  target_type: "video" | "person";
  target_id?: string | null;
  target_display_name?: string | null;
  label: SentimentLabel;
  confidence: number;
  method: SentimentMethod;
  review_reasons: SentimentReviewReason[];
  evidence: SentimentEvidence;
};

type SentimentEvidence = {
  schema_version?: string;
  rule?: {
    label?: SentimentLabel;
    confidence?: number;
    matched_terms?: Array<{ term: string; effective_polarity?: string; negated?: boolean; ignored_reason?: string | null }>;
    negations?: string[];
    scope_text?: string;
    scope_type?: string;
    ambiguity_flags?: string[];
  };
  local_model?: {
    status?: string;
    model_id?: string;
    revision?: string;
    confidence?: number;
    probabilities?: Partial<Record<"positive" | "neutral" | "negative", number>>;
    device?: string;
    error?: string;
  };
  integration?: { label?: SentimentLabel; reason?: string; review_reasons?: SentimentReviewReason[] };
  ai?: { status?: string; reason?: string; confidence?: string };
  human_override?: { label: SentimentLabel; created_at: string };
};

export type Report = {
  schema_version: "report.v2";
  run_id: string;
  review: { status: "provisional" | "verified"; is_verified: boolean; pending_item_count: number };
  video: VideoSummary;
  fetch_summary: FetchSummary;
  rankings: { mention_ranking: RankingRow[] };
  sentiment: {
    method: "hybrid";
    rule_status: string;
    pipeline_version?: string;
    generation_id?: string | null;
    ai_status: "not_run" | "available" | "partial" | "failed";
    local_model?: {
      status: "available" | "failed" | "not_run" | "disabled";
      model_id?: string | null;
      revision?: string | null;
      confidence_threshold?: number | null;
      device?: string | null;
      failure_reason?: string | null;
    };
    ai_summary?: {
      assisted_comment_count: number;
      applied_label_count: number;
      failed_label_count: number;
      eligible_label_count: number;
    };
    method_counts?: Record<SentimentMethod, number>;
    review_item_count?: number;
    overall: SentimentDistribution;
    timeline?: Array<{
      label: string;
      comment_count: number;
      like_count: number;
      distribution: SentimentDistribution;
    }>;
    per_person: Array<{
      person_id: string;
      display_name: string;
      distribution: SentimentDistribution;
      average_confidence: number;
    }>;
    review_items: SentimentReviewItem[];
  };
  topics: { method: string; note: string; items: Topic[] };
  clusters: { method: string; clusters: Topic[] };
  cooccurrence: { pairs: CooccurrencePair[] };
  appeal_summary: { people: AppealPerson[] };
  persons: Person[];
  alias_suggestions: Array<{
    token: string;
    normalized_alias: string;
    hit_count: number;
    suggested_person_id?: string | null;
    suggested_person_name?: string | null;
    reason: string;
  }>;
  quality_review: {
    human_review_items: Array<{
      comment_id: string;
      text_original: string;
      like_count: number;
      reason: string;
      mentioned_persons: Array<{ person_id: string; display_name: string }>;
    }>;
  };
  evidence: { comments_endpoint: string; comment_count: number };
};

type ReportComment = {
  comment_id: string;
  text_original: string;
  like_count: number;
  is_reply: boolean;
  sentiment_label: SentimentLabel;
  sentiment_method: SentimentMethod;
  sentiment_confidence: number;
  sentiment_model_id?: string | null;
  sentiment_model_revision?: string | null;
  sentiment_reason?: string | null;
  sentiment_is_human_override: boolean;
  mentioned_persons: Array<{ person_id: string; display_name: string; confidence: number; match_method: string }>;
};

export type CommentsPage = {
  run_id: string;
  total: number;
  limit: number;
  offset: number;
  comments: ReportComment[];
};

export type AiInsight = {
  schema_version?: "ai_insight.v1" | "ai_insight.v2" | "ai_insight.v3";
  status?: string;
  headline: string;
  summary: string;
  dominant_reception?: string;
  reaction_concentration?: string;
  timeline_interpretation?: string;
  surprising_pattern?: string;
  insights: Array<{
    conclusion?: string;
    interpretation?: string;
    metrics?: string[];
    evidence_comments?: string[];
    title?: string;
    detail?: string;
    evidence?: string[];
  }>;
  watch_points: string[];
};

export type AppView = "overview" | "people" | "topics" | "comments";

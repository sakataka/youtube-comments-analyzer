export type SentimentLabel = "positive" | "neutral" | "negative" | "mixed" | "unclear";

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
};

export type DataSummary = {
  total_bytes: number;
  run_count: number;
  youtube_cache: { bytes: number; file_count: number };
  runs: { bytes: number; file_count: number };
  llm_cache: { bytes: number; file_count: number };
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

export type VideoSummary = {
  youtube_video_id: string;
  url: string;
  title: string;
  channel_title: string;
  youtube_comment_count?: number | null;
  comment_count_available: boolean;
};

export type FetchSummary = {
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

export type Alias = {
  alias_id: string;
  alias_text: string;
  status: string;
  hit_count: number;
  confidence: number;
};

export type Person = {
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

export type EvidenceComment = {
  comment_id: string;
  text_original: string;
  like_count: number;
};

export type Topic = {
  cluster_id: string;
  label: string;
  comment_count: number;
  top_persons: Array<{ display_name: string; count: number }>;
  top_keywords: Array<{ term: string; count: number }>;
  summary: string;
  representative_comments: EvidenceComment[];
};

export type CooccurrencePair = {
  person_a_id: string;
  person_a_name: string;
  person_b_id: string;
  person_b_name: string;
  cooccurrence_comment_count: number;
  like_weighted_score: number;
  relationship_category: string;
  representative_comments: EvidenceComment[];
};

export type AppealPerson = {
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
  method: string;
  evidence: { terms?: string[]; scope_text?: string; ai_reason?: string };
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
    ai_status: "not_run" | "available" | "failed";
    overall: SentimentDistribution;
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

export type ReportComment = {
  comment_id: string;
  text_original: string;
  like_count: number;
  is_reply: boolean;
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
  status?: string;
  headline: string;
  summary: string;
  insights: Array<{ title: string; detail: string; evidence: string[] }>;
  watch_points: string[];
};

export type AppView = "overview" | "people" | "topics" | "comments";

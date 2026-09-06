export type SentimentLabel = 'positive' | 'negative' | 'neutral' | 'mixed' | 'unclear';

export type Observation = {
  id?: string; comment_id?: string; target: string; target_type: 'person' | 'group' | 'product' | 'video' | 'other' | 'unknown';
  topic: string; opinion: string; reason: string; stance: SentimentLabel;
  emotions: string[]; quote: string; subtitle_ids: string[];
};
export type OpinionGroup = {
  id: string; target: string; target_type: string; topic: string; label: string; reason: string; stance: SentimentLabel;
  comment_count: number; denominator: number; rate: number; parent_count: number; parent_denominator: number;
  reply_count: number; reply_denominator: number; top_count: number; top_denominator: number; top_rate: number;
  parent_rate: number; difference_pp: number; unique_authors: number; author_known_count: number;
  emotions: Record<string, number>; counter_group_ids: string[];
  evidence: Array<{ comment_id: string; quote: string; subtitle_ids: string[] }>;
};
export type OpinionReport = {
  schema_version: 'report.v3'; run_id: string; video: { title: string; channel_title: string; youtube_video_id: string; url: string };
  status: string; stage: string; error_message?: string; review: { human_reviewed: boolean };
  coverage: { source: string; fetch_order: string; fetched_at: string; updated_at: string; parents_done: boolean; replies_done: boolean; api_exhausted: boolean; reply_mode: string; stop_reason: string; fetched: number; parents: number; replies: number; pending_replies: number; published_from: string | null; published_to: string | null; youtube_comment_count: number | null };
  analysis: { processed: number; unprocessed: number; held: number; no_opinion: number; grouped: boolean; context_incomplete: number };
  transcript: { status: string; source?: string; automatic?: boolean; language?: string; reason?: string; segment_count: number };
  groups: OpinionGroup[]; targets: Array<{ name: string; type: string; comment_count: number; group_ids: string[]; stances: Record<string, number> }>;
  summary: Array<{ group_id: string; text: string; evidence: OpinionGroup['evidence'] }>;
  concentration: { unique_authors: number; known_author_comments: number; max_comments_per_author: number; duplicate_text_comments: number };
  usage: { calls: number; input_characters: number; output_characters: number; elapsed_seconds: number; tokens: number | null };
  can_continue: boolean; method: { model: string; effort: string; version: string; top_definition: string };
};
export type EvidenceComment = { comment_id: string; text_original: string; like_count: number; published_at: string; is_reply: boolean; parent_text: string | null; review_reason: string | null; analysis_status: string; observations: Observation[]; subtitles: Array<{ id: string; start: number; end: number; text: string }>; url: string };
export type EvidencePage = { comments: EvidenceComment[]; total: number; offset: number; limit: number };

export type ReplyMode = 'none' | 'full';
export type SettingsInfo = { youtube_api_key_configured: boolean; youtube_api_key_env_name: string; max_comments: { default: number; min: number; max: number }; reply_fetch_modes: Array<{ value: ReplyMode; label: string; uses_extra_quota: boolean }>; llm_provider: string; model: string; effort: string };
export type DataSummary = { run_count: number; total_bytes: number; runs: { bytes: number }; youtube_cache: { bytes: number; file_count: number } };
export type RunState = { run_id: string; status: string; created_at: string; review_status: string; video: { title: string; channel_title: string; youtube_video_id: string }; fetch_summary: { max_comments_fetched: number } };

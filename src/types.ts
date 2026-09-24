export type CommentRow = {
  comment_id: string; text_original: string; like_count: number; reply_count?: number; published_at: string; is_reply: boolean; parent_text: string | null; url: string;
  local?: { sentiment: string; polarity: number; emotion: string | null; people: Record<string, string> } | null;
  person_judgements?: Record<string, PersonJudgement>;
};
export type CommentPage = { comments: CommentRow[]; total: number; offset: number; limit: number };

export type ReplyMode = 'none' | 'full';
export type SettingsInfo = { youtube_api_key_configured: boolean; youtube_api_key_env_name: string; max_comments: { default: number; min: number; max: number }; reply_fetch_modes: Array<{ value: ReplyMode; label: string; uses_extra_quota: boolean }>; llm_provider: string; model: string; effort: string };
export type DataSummary = { run_count: number; total_bytes: number; runs: { bytes: number }; youtube_cache: { bytes: number; file_count: number } };
export type RunState = { run_id: string; status: string; created_at: string; review_status: string; video: { title: string; channel_title: string; youtube_video_id: string }; fetch_summary: { max_comments_fetched: number } };

export type Topic = { id: string; title: string; description: string; reactions: string; evidence: Array<{ comment_id: string; quote: string }> };
export type LightReport = {
  schema_version: 'report.v4'; run_id: string; status: string; stage: string; error_message?: string; summary_status: string; can_continue: boolean;
  video: { title: string; channel_title: string; youtube_video_id: string; url: string };
  coverage: { source: string; updated_at: string; api_exhausted: boolean; fetched: number; parents: number; replies: number; published_from: string | null; published_to: string | null };
  concentration: { unique_authors: number };
  usage: { calls: number; input_characters: number; output_characters: number; elapsed_seconds: number };
  topics: Topic[];
  sample: { candidate_count?: number; sent_count?: number; truncated_count?: number };
  statistics: { likes: number; duplicate_comments: number };
  method: { model: string; effort: string };
  person_statistics?: PersonStatistics; insights?: Insights; local?: LocalReport; x_pulse?: XPulse;
};
/** Anything other than v4 is shown only as a legacy notice. */
export type AnyReport = LightReport | { schema_version: string; run_id: string; video: LightReport['video'] };

export type PersonJudgement = { label: 'positive' | 'negative' | 'mixed' | 'unclear'; aliases: string[]; signals: Array<{ stance: string; term: string; clause: string }>; reasons: string[] };
export type PersonStatistics = {
  status: string; source?: string; error?: string; denominator?: number; matched_comments?: number; unmatched_comments?: number;
  warnings?: string[]; people?: Array<{ id: string; name: string; aliases: string[]; count: number; rate: number; parents: number; replies: number; stances: Record<string, number>; stance_rates: Record<string, number> }>;
};

export type NotableComment = { comment_id: string; text: string; like_count: number; reply_count: number; is_reply: boolean; published_at: string | null; parent_text: string | null; metric: string | null; url: string };
export type Insights = {
  visible: { top_n: number; parents: number; top_like_share: number; zero_like_parents: number; sentiment?: Record<'all' | 'top' | 'likes', Record<string, number>>; people: Array<{ id: string; name: string; all_rate: number; top_count: number; top_rate: number; like_share: number }> };
  moments: { comment_count: number; index_comments: number; bin_seconds: number | null; duration_seconds: number | null; bins: Array<{ start: number; end: number; comment_count: number; likes: number; sample: NotableComment | null }> };
  timeline: { undated: number; bins: Array<{ label: string; comment_count: number; replies: number; likes: number }> };
  notable: Array<{ id: string; title: string; description: string; items: NotableComment[] }>;
};

export type LocalReport = {
  status: string; enabled: boolean; error?: string | null; stale?: boolean; denominator?: number; elapsed_seconds?: number;
  models?: { sentiment: string; emotion: string }; sentiments?: Record<string, number>; emotions?: Record<string, number>;
  people?: Record<string, Record<string, number>>;
};
export type XPulse = {
  status: string; enabled: boolean; error?: string | null; observed_at?: string; elapsed_seconds?: number;
  summary?: string; tone?: string; comparison?: string;
  topics?: Array<{ title: string; summary: string; posts: Array<{ url: string; author: string; postedAt: string; gist: string }> }>;
};

export type Action = (path: string, body?: unknown) => Promise<boolean | undefined>;

import { formatNumber } from "../api";
import { CommentsPage, Report, SentimentLabel } from "../types";
import { Button } from "./ui/button";
import { Field, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { SectionHeading } from "./SectionHeading";

type Props = {
  report: Report;
  pageData: CommentsPage | null;
  loading: boolean;
  search: string;
  personFilter: string;
  sentimentFilter: string;
  sort: string;
  page: number;
  onSearchChange: (value: string) => void;
  onPersonFilterChange: (value: string) => void;
  onSentimentFilterChange: (value: string) => void;
  onSortChange: (value: string) => void;
  onPageChange: (value: number) => void;
};

export function CommentsView({ report, pageData, loading, search, personFilter, sentimentFilter, sort, page, onSearchChange, onPersonFilterChange, onSentimentFilterChange, onSortChange, onPageChange }: Props) {
  const pageCount = Math.max(Math.ceil((pageData?.total ?? 0) / (pageData?.limit ?? 100)), 1);
  return (
    <section className="report-section report-section--full comments-section" aria-labelledby="comments-title">
      <SectionHeading id="comments-title" title="根拠コメント" description="コメントを検索し、人物・感情で絞り込み、高評価順でも確認できます。" aside={<span>{formatNumber(pageData?.total ?? report.evidence.comment_count)}件</span>} />
      <div className="comment-filters">
        <Field><FieldLabel htmlFor="comment-search">検索</FieldLabel><Input id="comment-search" type="search" value={search} placeholder="コメント本文を検索" onChange={(event) => onSearchChange(event.target.value)} /></Field>
        <Field><FieldLabel htmlFor="person-filter">人物</FieldLabel><Select value={personFilter} onValueChange={onPersonFilterChange}>
          <SelectTrigger id="person-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="all">すべて</SelectItem>
            <SelectItem value="unassigned">人物未紐づけ</SelectItem>
            {report.rankings.mention_ranking.map((person) => <SelectItem value={person.person_id} key={person.person_id}>{person.display_name}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select></Field>
        <Field><FieldLabel htmlFor="sentiment-filter">感情</FieldLabel><Select value={sentimentFilter} onValueChange={onSentimentFilterChange}>
          <SelectTrigger id="sentiment-filter"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="all">すべて</SelectItem>
            {sentimentLabels.map((label) => <SelectItem value={label} key={label}>{sentimentLabel(label)}</SelectItem>)}
          </SelectGroup></SelectContent>
        </Select></Field>
        <Field><FieldLabel htmlFor="comment-sort">並び順</FieldLabel><Select value={sort} onValueChange={onSortChange}>
          <SelectTrigger id="comment-sort"><SelectValue /></SelectTrigger>
          <SelectContent><SelectGroup>
            <SelectItem value="source">取得順</SelectItem>
            <SelectItem value="likes">高評価順</SelectItem>
          </SelectGroup></SelectContent>
        </Select></Field>
      </div>
      {loading ? <p className="loading-note" aria-live="polite">コメントを読み込んでいます。</p> : null}
      <div className="comment-list">
        {pageData?.comments.map((comment) => (
          <article className="comment-row" key={comment.comment_id}>
            <p>{comment.text_original}</p>
            <div><strong className="comment-like">高評価 {formatNumber(comment.like_count)}</strong><span className={`sentiment-tag sentiment-tag--${comment.sentiment_label}`}>{sentimentLabel(comment.sentiment_label)}</span>{comment.is_reply ? <span>返信</span> : null}{comment.mentioned_persons.map((person) => <span key={person.person_id}>{person.display_name}</span>)}</div>
          </article>
        ))}
      </div>
      <div className="pagination">
        <Button variant="secondary" type="button" disabled={page === 0} onClick={() => onPageChange(page - 1)}>前へ</Button>
        <span>{page + 1} / {pageCount}</span>
        <Button variant="secondary" type="button" disabled={page + 1 >= pageCount} onClick={() => onPageChange(page + 1)}>次へ</Button>
      </div>
    </section>
  );
}

const sentimentLabels: SentimentLabel[] = ["positive", "neutral", "negative", "mixed", "unclear"];

function sentimentLabel(label: SentimentLabel): string {
  return { positive: "ポジティブ", neutral: "ニュートラル", negative: "ネガティブ", mixed: "混合", unclear: "判断保留" }[label];
}

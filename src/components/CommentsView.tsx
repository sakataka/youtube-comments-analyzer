import { formatNumber } from "../api";
import { CommentsPage, Report } from "../types";
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
  page: number;
  onSearchChange: (value: string) => void;
  onPersonFilterChange: (value: string) => void;
  onPageChange: (value: number) => void;
};

export function CommentsView({ report, pageData, loading, search, personFilter, page, onSearchChange, onPersonFilterChange, onPageChange }: Props) {
  const pageCount = Math.max(Math.ceil((pageData?.total ?? 0) / (pageData?.limit ?? 100)), 1);
  return (
    <section className="report-section report-section--full comments-section" aria-labelledby="comments-title">
      <SectionHeading id="comments-title" title="根拠コメント" description="分析に使われたコメントを検索し、人物別に絞り込めます。" aside={<span>{formatNumber(pageData?.total ?? report.evidence.comment_count)}件</span>} />
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
      </div>
      {loading ? <p className="loading-note" aria-live="polite">コメントを読み込んでいます。</p> : null}
      <div className="comment-list">
        {pageData?.comments.map((comment) => (
          <article className="comment-row" key={comment.comment_id}>
            <p>{comment.text_original}</p>
            <div><span>高評価 {formatNumber(comment.like_count)}</span>{comment.is_reply ? <span>返信</span> : null}{comment.mentioned_persons.map((person) => <span key={person.person_id}>{person.display_name}</span>)}</div>
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

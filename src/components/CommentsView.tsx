import { formatNumber } from "../api";
import { CommentsPage, Report } from "../types";

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
      <div className="section-heading">
        <div><h2 id="comments-title">根拠コメント</h2><p>分析に使われたコメントを検索し、人物別に絞り込めます。</p></div>
        <span>{formatNumber(pageData?.total ?? report.evidence.comment_count)}件</span>
      </div>
      <div className="comment-filters">
        <label>検索<input type="search" value={search} placeholder="コメント本文を検索" onChange={(event) => onSearchChange(event.target.value)} /></label>
        <label>人物<select value={personFilter} onChange={(event) => onPersonFilterChange(event.target.value)}>
          <option value="all">すべて</option><option value="unassigned">人物未紐づけ</option>
          {report.rankings.mention_ranking.map((person) => <option value={person.person_id} key={person.person_id}>{person.display_name}</option>)}
        </select></label>
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
        <button type="button" disabled={page === 0} onClick={() => onPageChange(page - 1)}>前へ</button>
        <span>{page + 1} / {pageCount}</span>
        <button type="button" disabled={page + 1 >= pageCount} onClick={() => onPageChange(page + 1)}>次へ</button>
      </div>
    </section>
  );
}

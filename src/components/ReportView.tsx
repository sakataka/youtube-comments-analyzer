import { formatNumber, formatPercent } from "../api";
import {
  AiInsight,
  AppView,
  CandidatesResponse,
  CommentsPage,
  RankingRow,
  Report,
  RunState,
  SentimentDistribution,
  SentimentLabel
} from "../types";
import { CommentsView } from "./CommentsView";

type Props = {
  run: RunState;
  report: Report;
  candidates: CandidatesResponse | null;
  view: AppView;
  setView: (view: AppView) => void;
  selectedPersonId: string | null;
  setSelectedPersonId: (personId: string) => void;
  aiInsight: AiInsight | null;
  aiBusy: boolean;
  commentsPage: CommentsPage | null;
  commentsLoading: boolean;
  commentSearch: string;
  commentPersonFilter: string;
  commentPage: number;
  setCommentSearch: (value: string) => void;
  setCommentPersonFilter: (value: string) => void;
  setCommentPage: (value: number) => void;
  onNewAnalysis: () => void;
  onOpenSettings: () => void;
  onOpenReview: () => void;
  onRunAi: () => void;
};

const navItems: Array<{ value: AppView; label: string }> = [
  { value: "overview", label: "概要" },
  { value: "people", label: "人物" },
  { value: "topics", label: "話題・共起" },
  { value: "comments", label: "コメント" }
];

export function ReportView(props: Props) {
  const { run, report, view, setView } = props;
  const coverage = report.fetch_summary.coverage;
  const coverageRate = coverage.youtube_comment_count
    ? coverage.fetched_comment_count / coverage.youtube_comment_count
    : null;

  return (
    <main className="report-shell">
      <header className="product-header product-header--report">
        <button className="product-name product-name--button" type="button" onClick={props.onNewAnalysis}>
          コメントインサイト
        </button>
        <div className="header-actions">
          <button className="text-button" type="button" onClick={props.onOpenSettings}>
            設定
          </button>
          <button type="button" onClick={props.onNewAnalysis}>新しい動画を分析</button>
        </div>
      </header>

      <section className="report-header" aria-labelledby="report-title">
        <div className="report-header__main">
          <h1 id="report-title">{report.video.title}</h1>
          <p>{report.video.channel_title}</p>
          <div className="report-meta">
            <span>
              取得 {formatNumber(coverage.fetched_comment_count)} / {formatNumber(coverage.youtube_comment_count)}件
              {coverageRate != null ? `（${formatPercent(coverageRate)}）` : ""}
            </span>
            <span className={report.review.is_verified ? "report-status report-status--verified" : "report-status"}>
              {report.review.is_verified ? "確認済みレポート" : "暫定レポート"}
            </span>
          </div>
        </div>
      </section>

      <nav className="report-nav" aria-label="レポート表示">
        {navItems.map((item) => (
          <button
            className={view === item.value ? "report-nav__item report-nav__item--active" : "report-nav__item"}
            type="button"
            aria-current={view === item.value ? "page" : undefined}
            onClick={() => setView(item.value)}
            key={item.value}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {view === "overview" ? <Overview {...props} /> : null}
      {view === "people" ? <PeopleView {...props} /> : null}
      {view === "topics" ? <TopicsView report={report} /> : null}
      {view === "comments" ? (
        <CommentsView
          report={report}
          pageData={props.commentsPage}
          loading={props.commentsLoading}
          search={props.commentSearch}
          personFilter={props.commentPersonFilter}
          page={props.commentPage}
          onSearchChange={props.setCommentSearch}
          onPersonFilterChange={props.setCommentPersonFilter}
          onPageChange={props.setCommentPage}
        />
      ) : null}
    </main>
  );
}

function Overview(props: Props) {
  const { report } = props;
  const ranking = report.rankings.mention_ranking.slice(0, 5);
  const topics = report.topics.items.slice(0, 4);
  return (
    <div className="report-grid">
      <div className="report-main">
        <section className="report-section sentiment-overview" aria-labelledby="reception-title">
          <div className="section-heading">
            <div>
              <h2 id="reception-title">この動画はどう受け取られた？</h2>
              <p>明示的な評価語はルールで、文脈が曖昧なコメントはAIで補助判定します。</p>
            </div>
            <span>{formatNumber(report.sentiment.overall.total)}件を分析</span>
          </div>
          <SentimentBar distribution={report.sentiment.overall} large />
        </section>

        <section className="report-section" aria-labelledby="people-title">
          <div className="section-heading">
            <div>
              <h2 id="people-title">よく語られた人物</h2>
              <p>言及量と、その人物について語られた感情を並べています。</p>
            </div>
            <button className="inline-link" type="button" onClick={() => props.setView("people")}>すべての人物</button>
          </div>
          <PersonTable rows={ranking} onSelect={(id) => { props.setSelectedPersonId(id); props.setView("people"); }} />
        </section>

        <section className="report-section" aria-labelledby="topic-title">
          <div className="section-heading">
            <div>
              <h2 id="topic-title">主な話題</h2>
              <p>{report.topics.note}</p>
            </div>
            <button className="inline-link" type="button" onClick={() => props.setView("topics")}>すべての話題</button>
          </div>
          <div className="topic-list topic-list--compact">
            {topics.map((topic) => (
              <article className="topic-row" key={topic.cluster_id}>
                <div>
                  <h3>{topic.label}</h3>
                  <span>{formatNumber(topic.comment_count)}件</span>
                </div>
                <p>{topic.representative_comments[0]?.text_original || topic.summary}</p>
              </article>
            ))}
          </div>
        </section>
      </div>

      <aside className="insight-rail" aria-label="分析の補足">
        <section>
          <h2>分析上の注意</h2>
          <dl>
            <div><dt>取得範囲</dt><dd>{formatNumber(report.fetch_summary.max_comments_fetched)}件</dd></div>
            <div><dt>YouTube表示</dt><dd>{formatNumber(report.video.youtube_comment_count)}件</dd></div>
            <div><dt>AI感情補助</dt><dd>{aiStatusLabel(report.sentiment.ai_status)}</dd></div>
          </dl>
          <p>{report.fetch_summary.coverage.message}</p>
        </section>
        <section>
          <h2>レビューセンター</h2>
          <strong className="rail-count">{report.review.pending_item_count}件</strong>
          <p>人物候補や感情の判断が曖昧な項目だけを確認できます。</p>
          <button className="inline-link" type="button" onClick={props.onOpenReview}>レビューを開く</button>
        </section>
        <section>
          <h2>AIサマリー</h2>
          {props.aiInsight?.summary ? (
            <>
              <strong>{props.aiInsight.headline}</strong>
              <p>{props.aiInsight.summary}</p>
            </>
          ) : (
            <p>集計結果から、注目点と注意点を短く整理します。</p>
          )}
          <button className="inline-link" type="button" disabled={props.aiBusy} onClick={props.onRunAi}>
            {props.aiBusy ? "抽出しています" : props.aiInsight ? "サマリーを更新" : "AIサマリーを抽出"}
          </button>
        </section>
      </aside>
    </div>
  );
}

function PeopleView(props: Props) {
  const rows = props.report.rankings.mention_ranking;
  const selected = rows.find((row) => row.person_id === props.selectedPersonId) ?? rows[0];
  const appeal = props.report.appeal_summary.people.find((item) => item.person_id === selected?.person_id);
  return (
    <section className="report-section report-section--full people-section" aria-labelledby="all-people-title">
      <div className="section-heading">
        <div>
          <h2 id="all-people-title">人物別の受け取られ方</h2>
          <p>人物を選ぶと、言及された文脈と根拠コメントを確認できます。</p>
        </div>
      </div>
      <div className="people-layout">
        <div className="people-list">
          <PersonTable rows={rows} onSelect={props.setSelectedPersonId} selectedId={selected?.person_id} />
        </div>
        {selected ? (
          <article className="person-detail">
            <div className="person-detail__header">
              <div><h3>{selected.display_name}</h3><p>{formatNumber(selected.mention_comment_count)}件・{formatPercent(selected.mention_rate)}</p></div>
              <span>平均確度 {Math.round((props.report.sentiment.per_person.find((item) => item.person_id === selected.person_id)?.average_confidence ?? 0) * 100)}%</span>
            </div>
            <SentimentBar distribution={selected.sentiment} large />
            {appeal ? (
              <>
                <div className="detail-block"><h4>コメント上の特徴</h4><p>{appeal.summary}</p></div>
                <div className="keyword-list">{appeal.feature_words.slice(0, 10).map((word) => <span key={word.term}>{word.term}</span>)}</div>
              </>
            ) : null}
            <div className="detail-block">
              <h4>根拠コメント</h4>
              <div className="evidence-list">
                {selected.representative_comments.map((comment) => <EvidenceRow key={comment.comment_id} comment={comment} />)}
              </div>
            </div>
          </article>
        ) : null}
      </div>
    </section>
  );
}

function TopicsView({ report }: { report: Report }) {
  return (
    <div className="topics-layout">
      <section className="report-section" aria-labelledby="all-topics-title">
        <div className="section-heading"><div><h2 id="all-topics-title">話題カテゴリ</h2><p>{report.topics.note}</p></div></div>
        <div className="topic-list">
          {report.topics.items.map((topic) => (
            <article className="topic-row topic-row--expanded" key={topic.cluster_id}>
              <div><h3>{topic.label}</h3><span>{formatNumber(topic.comment_count)}件</span></div>
              <p>{topic.summary}</p>
              <div className="keyword-list">{topic.top_keywords.slice(0, 6).map((word) => <span key={word.term}>{word.term}</span>)}</div>
              {topic.representative_comments[0] ? <EvidenceRow comment={topic.representative_comments[0]} /> : null}
            </article>
          ))}
        </div>
      </section>
      <section className="report-section" aria-labelledby="co-title">
        <div className="section-heading"><div><h2 id="co-title">一緒に語られた人物</h2><p>同じコメント内で言及された回数です。関係性そのものを断定する指標ではありません。</p></div></div>
        <div className="co-list">
          {report.cooccurrence.pairs.slice(0, 20).map((pair) => (
            <article key={`${pair.person_a_id}-${pair.person_b_id}`}>
              <div><h3>{pair.person_a_name} × {pair.person_b_name}</h3><strong>{formatNumber(pair.cooccurrence_comment_count)}件</strong></div>
              {pair.representative_comments[0] ? <p>{pair.representative_comments[0].text_original}</p> : null}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function PersonTable({ rows, onSelect, selectedId }: { rows: RankingRow[]; onSelect: (id: string) => void; selectedId?: string }) {
  return (
    <div className="person-table" role="table" aria-label="人物別言及数と感情">
      <div className="person-table__head" role="row">
        <span role="columnheader">人物</span><span role="columnheader">言及数</span><span role="columnheader">言及シェア</span><span role="columnheader">感情の内訳</span>
      </div>
      {rows.map((row) => (
        <button className={selectedId === row.person_id ? "person-row person-row--active" : "person-row"} type="button" onClick={() => onSelect(row.person_id)} role="row" key={row.person_id}>
          <strong role="cell">{row.display_name}</strong>
          <span role="cell">{formatNumber(row.mention_comment_count)}件</span>
          <span role="cell">{formatPercent(row.mention_rate)}</span>
          <span role="cell"><SentimentBar distribution={row.sentiment} compact /></span>
        </button>
      ))}
    </div>
  );
}

export function SentimentBar({ distribution, large = false, compact = false }: { distribution: SentimentDistribution; large?: boolean; compact?: boolean }) {
  return (
    <div className={large ? "sentiment sentiment--large" : compact ? "sentiment sentiment--compact" : "sentiment"}>
      <div className="sentiment-bar" role="img" aria-label={sentimentAriaLabel(distribution)}>
        {(["positive", "neutral", "negative", "mixed", "unclear"] as SentimentLabel[]).map((label) => (
          <span className={`sentiment-bar__${label}`} style={{ width: `${distribution.rates[label] * 100}%` }} key={label} />
        ))}
      </div>
      {compact ? null : (
        <div className="sentiment-legend">
          {(["positive", "neutral", "negative", "mixed", "unclear"] as SentimentLabel[]).map((label) => (
            <span key={label}><i className={`legend-dot legend-dot--${label}`} />{sentimentLabel(label)} {formatPercent(distribution.rates[label], 0)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function EvidenceRow({ comment }: { comment: { text_original: string; like_count: number } }) {
  return <blockquote className="evidence-row"><p>{comment.text_original}</p><span>高評価 {formatNumber(comment.like_count)}</span></blockquote>;
}

function sentimentAriaLabel(value: SentimentDistribution): string {
  return (["positive", "neutral", "negative", "mixed", "unclear"] as SentimentLabel[])
    .map((label) => `${sentimentLabel(label)} ${formatPercent(value.rates[label], 0)}`)
    .join("、");
}

function sentimentLabel(label: SentimentLabel): string {
  return { positive: "ポジティブ", neutral: "ニュートラル", negative: "ネガティブ", mixed: "混合", unclear: "判断保留" }[label];
}

function aiStatusLabel(status: Report["sentiment"]["ai_status"]): string {
  if (status === "available") return "利用済み";
  if (status === "failed") return "失敗・ルール結果を表示";
  return "未実行・ルール結果を表示";
}

import { formatNumber, formatPercent } from "../api";
import {
  AiInsight,
  AppView,
  CandidatesResponse,
  CommentsPage,
  RankingRow,
  Report,
  RunJob,
  RunState,
  SentimentDistribution,
  SentimentLabel
} from "../types";
import { sentimentLabel, sentimentLabels, sentimentMethodLabel } from "../lib/sentiment";
import { CommentsView } from "./CommentsView";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { AppHeader } from "./AppHeader";
import { SectionHeading } from "./SectionHeading";

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
  sentimentJob: RunJob | null;
  commentsPage: CommentsPage | null;
  commentsLoading: boolean;
  commentSearch: string;
  commentPersonFilter: string;
  commentSentimentFilter: string;
  commentSort: string;
  commentPage: number;
  setCommentSearch: (value: string) => void;
  setCommentPersonFilter: (value: string) => void;
  setCommentSentimentFilter: (value: string) => void;
  setCommentSort: (value: string) => void;
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
      <AppHeader report onHome={props.onNewAnalysis} onOpenSettings={props.onOpenSettings} onNewAnalysis={props.onNewAnalysis} />

      <section className="report-header" aria-labelledby="report-title">
        <div className="report-header__main">
          <h1 id="report-title">{report.video.title}</h1>
          <p>{report.video.channel_title}</p>
          <div className="report-meta">
            <span>
              取得 {formatNumber(coverage.fetched_comment_count)} / {formatNumber(coverage.youtube_comment_count)}件
              {coverageRate != null ? `（${formatPercent(coverageRate)}）` : ""}
            </span>
            <Badge variant="outline" className={report.review.is_verified ? "report-status report-status--verified" : "report-status"}>
              {report.review.is_verified ? "確認済みレポート" : "暫定レポート"}
            </Badge>
            {props.sentimentJob?.status === "queued" || props.sentimentJob?.status === "running" ? <Badge variant="outline" className="sentiment-job-status">{sentimentStageLabel(props.sentimentJob.stage)} {Math.round(props.sentimentJob.progress * 100)}%</Badge> : null}
          </div>
        </div>
      </section>

      <Tabs value={view} onValueChange={(value) => setView(value as AppView)} className="report-tabs">
        <TabsList className="report-nav" variant="line" aria-label="レポート表示">
          {navItems.map((item) => <TabsTrigger className="report-nav__item" value={item.value} key={item.value}>{item.label}</TabsTrigger>)}
        </TabsList>
        <TabsContent value="overview"><Overview {...props} /></TabsContent>
        <TabsContent value="people"><PeopleView {...props} /></TabsContent>
        <TabsContent value="topics"><TopicsView report={report} /></TabsContent>
        <TabsContent value="comments">
          <CommentsView
            report={report}
            pageData={props.commentsPage}
            loading={props.commentsLoading}
            search={props.commentSearch}
            personFilter={props.commentPersonFilter}
            sentimentFilter={props.commentSentimentFilter}
            sort={props.commentSort}
            page={props.commentPage}
            onSearchChange={props.setCommentSearch}
            onPersonFilterChange={props.setCommentPersonFilter}
            onSentimentFilterChange={props.setCommentSentimentFilter}
            onSortChange={props.setCommentSort}
            onPageChange={props.setCommentPage}
          />
        </TabsContent>
      </Tabs>
    </main>
  );
}

function Overview(props: Props) {
  const { report } = props;
  const ranking = report.rankings.mention_ranking.slice(0, 5);
  const topics = report.topics.items.slice(0, 4);
  const openSentimentComments = (label: SentimentLabel) => {
    props.setCommentSentimentFilter(label);
    props.setCommentPage(0);
    props.setView("comments");
  };
  return (
    <div className="report-grid">
      <div className="report-main">
        <section className="report-section sentiment-overview" aria-labelledby="reception-title">
          <SectionHeading id="reception-title" title="この動画はどう受け取られた？" description="ルールとローカルモデルで判定し、反語や不一致などの難しいコメントだけをAIで補助します。" aside={<span>{formatNumber(report.sentiment.overall.total)}件を分析</span>} />
          <SentimentBar distribution={report.sentiment.overall} large onSelect={openSentimentComments} />
          <SentimentMethodSummary report={report} />
        </section>

        <section className="report-section" aria-labelledby="people-title">
          <SectionHeading id="people-title" title="よく語られた人物" description="言及量と、その人物について語られた感情を並べています。" aside={<Button className="inline-link" variant="link" type="button" onClick={() => props.setView("people")}>すべての人物</Button>} />
          <PersonTable rows={ranking} onSelect={(id) => { props.setSelectedPersonId(id); props.setView("people"); }} />
        </section>

        <section className="report-section" aria-labelledby="topic-title">
          <SectionHeading id="topic-title" title="主な話題" description={report.topics.note} aside={<Button className="inline-link" variant="link" type="button" onClick={() => props.setView("topics")}>すべての話題</Button>} />
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

        <InsightSection insight={props.aiInsight} busy={props.aiBusy} onRun={props.onRunAi} />
      </div>

      <aside className="insight-rail" aria-label="分析の補足">
        <section>
          <h2>分析上の注意</h2>
          <dl>
            <div><dt>取得範囲</dt><dd>{formatNumber(report.fetch_summary.max_comments_fetched)}件</dd></div>
            <div><dt>YouTube表示</dt><dd>{formatNumber(report.video.youtube_comment_count)}件</dd></div>
            <div><dt>AI感情補助</dt><dd>{aiStatusLabel(report.sentiment.ai_status)}</dd></div>
            <div><dt>ローカルモデル</dt><dd>{localModelStatusLabel(report.sentiment.local_model?.status)}</dd></div>
            <div><dt>AI送信</dt><dd>{formatNumber(report.sentiment.ai_summary?.assisted_comment_count ?? 0)}コメント</dd></div>
          </dl>
          {report.sentiment.local_model?.model_id ? <p className="model-identity">{report.sentiment.local_model.model_id}<br /><code>{report.sentiment.local_model.revision}</code></p> : null}
          <p>{report.fetch_summary.coverage.message}</p>
        </section>
        <section>
          <h2>レビューセンター</h2>
          <strong className="rail-count">{report.review.pending_item_count}件</strong>
          <p>人物候補や感情の判断が曖昧な項目だけを確認できます。</p>
          <Button className="inline-link" variant="link" type="button" data-dialog-trigger="review" onClick={props.onOpenReview}>レビューを開く</Button>
        </section>
        <section>
          <h2>AIインサイト</h2>
          <p>{props.aiInsight?.summary ? "生成済みです。本文の分析セクションで根拠とともに確認できます。" : "集計と代表コメントから、動画が受けた理由を掘り下げます。"}</p>
          <Button className="inline-link" variant="link" type="button" disabled={props.aiBusy} onClick={props.onRunAi}>
            {props.aiBusy ? "分析しています" : props.aiInsight ? "インサイトを更新" : "インサイトを生成"}
          </Button>
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
      <SectionHeading id="all-people-title" title="人物別の受け取られ方" description="人物を選ぶと、言及された文脈と根拠コメントを確認できます。" />
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
        <Button className={selectedId === row.person_id ? "person-row person-row--active" : "person-row"} variant="ghost" type="button" onClick={() => onSelect(row.person_id)} role="row" key={row.person_id}>
          <strong role="cell">{row.display_name}</strong>
          <span role="cell">{formatNumber(row.mention_comment_count)}件</span>
          <span role="cell">{formatPercent(row.mention_rate)}</span>
          <span role="cell"><SentimentBar distribution={row.sentiment} compact /></span>
        </Button>
      ))}
    </div>
  );
}

function SentimentBar({ distribution, large = false, compact = false, onSelect }: { distribution: SentimentDistribution; large?: boolean; compact?: boolean; onSelect?: (label: SentimentLabel) => void }) {
  return (
    <div className={large ? "sentiment sentiment--large" : compact ? "sentiment sentiment--compact" : "sentiment"}>
      <div className="sentiment-bar" role={onSelect ? "group" : "img"} aria-label={sentimentAriaLabel(distribution)}>
        {sentimentLabels.map((label) => (
          onSelect ? <button type="button" className={`sentiment-bar__${label}`} style={{ width: `${distribution.rates[label] * 100}%` }} aria-label={`${sentimentLabel(label)}のコメントを表示`} title={`${sentimentLabel(label)} ${formatPercent(distribution.rates[label], 0)}`} onClick={() => onSelect(label)} key={label} />
            : <span className={`sentiment-bar__${label}`} style={{ width: `${distribution.rates[label] * 100}%` }} key={label} />
        ))}
      </div>
      {compact ? null : (
        <div className="sentiment-legend">
          {sentimentLabels.map((label) => (
            onSelect ? <button type="button" onClick={() => onSelect(label)} key={label}><i className={`legend-dot legend-dot--${label}`} />{sentimentLabel(label)} {formatPercent(distribution.rates[label], 0)}</button>
              : <span key={label}><i className={`legend-dot legend-dot--${label}`} />{sentimentLabel(label)} {formatPercent(distribution.rates[label], 0)}</span>
          ))}
        </div>
      )}
    </div>
  );
}

function InsightSection({ insight, busy, onRun }: { insight: AiInsight | null; busy: boolean; onRun: () => void }) {
  return (
    <section className="report-section insight-section" aria-labelledby="insight-title">
      <SectionHeading id="insight-title" title="コメントから見える動画の勝ち筋" description="集計値と実際の反応を結びつけ、受けた理由と再現できそうな要素を読み解きます。" aside={<Button className="inline-link" variant="link" type="button" disabled={busy} onClick={onRun}>{busy ? "分析しています" : insight ? "更新" : "AIで分析"}</Button>} />
      {insight?.summary ? (
        <div className="insight-content">
          <div className="insight-lead"><h3>{insight.headline}</h3><p>{insight.summary}</p></div>
          <div className="insight-list">
            {insight.insights.map((item, index) => {
              const conclusion = item.conclusion || item.title || `注目点 ${index + 1}`;
              const interpretation = item.interpretation || item.detail || "";
              const metrics = item.metrics || item.evidence || [];
              return <article key={`${conclusion}-${index}`}><h4>{conclusion}</h4><p>{interpretation}</p>{metrics.length ? <ul className="insight-metrics">{metrics.map((value) => <li key={value}>{value}</li>)}</ul> : null}{item.evidence_comments?.length ? <div className="insight-evidence">{item.evidence_comments.map((comment) => <blockquote key={comment}>{comment}</blockquote>)}</div> : null}</article>;
            })}
          </div>
          {insight.watch_points.length ? <div className="insight-watch"><h4>読み取り上の注意</h4><ul>{insight.watch_points.map((point) => <li key={point}>{point}</li>)}</ul></div> : null}
        </div>
      ) : (
        <div className="insight-empty"><p>{busy ? "人物・話題・高評価コメントを横断して分析しています。" : "人物の言及量だけでなく、高評価コメントや話題ごとの代表反応まで使って、動画が支持された理由を整理します。"}</p>{busy ? <progress aria-label="AIインサイトを生成中" /> : null}</div>
      )}
    </section>
  );
}

function EvidenceRow({ comment }: { comment: { text_original: string; like_count: number } }) {
  return <blockquote className="evidence-row"><p>{comment.text_original}</p><span>高評価 {formatNumber(comment.like_count)}</span></blockquote>;
}

function sentimentAriaLabel(value: SentimentDistribution): string {
  return sentimentLabels
    .map((label) => `${sentimentLabel(label)} ${formatPercent(value.rates[label], 0)}`)
    .join("、");
}

function aiStatusLabel(status: Report["sentiment"]["ai_status"]): string {
  if (status === "available") return "利用済み";
  if (status === "partial") return "一部利用・未確定あり";
  if (status === "failed") return "失敗・未確定はレビューへ";
  return "未実行";
}

function localModelStatusLabel(status?: NonNullable<Report["sentiment"]["local_model"]>["status"]): string {
  if (status === "available") return "利用済み";
  if (status === "failed") return "利用失敗・縮退";
  if (status === "disabled") return "無効";
  return "未実行";
}

function SentimentMethodSummary({ report }: { report: Report }) {
  const counts = report.sentiment.method_counts;
  if (!counts) return <p className="sentiment-method-note">旧run・ローカルモデル未再判定</p>;
  return (
    <dl className="sentiment-method-summary" aria-label="判定方法別件数">
      {(["rule", "local_model", "hybrid", "ai", "human"] as const).map((method) => (
        <div key={method}><dt>{sentimentMethodLabel(method)}</dt><dd>{formatNumber(counts[method] ?? 0)}件</dd></div>
      ))}
    </dl>
  );
}

function sentimentStageLabel(stage: string): string {
  if (stage === "sentiment_local_model") return "ローカル判定中";
  if (stage === "sentiment_ai_assist") return "AI補助中";
  if (stage.startsWith("sentiment_persisting")) return "結果を保存中";
  return stage === "sentiment_queued" ? "再判定待機中" : "感情を再判定中";
}

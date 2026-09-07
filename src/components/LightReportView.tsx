import { useEffect, useState } from 'react';
import { api, formatNumber } from '../api';
import type { EvidencePage, LightReport } from '../types';
import { AppHeader } from './AppHeader';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { toast } from 'sonner';

const statuses: Record<string, string> = { not_started: '集計を準備しています', running: '抽出コメントを要約しています', completed: '抽出コメントの要約完了', failed: '要約を作成できませんでした', stopped: '停止して保存しました', timed_out: '時間枠に達したため保存しました' };

export function LightReportView({ report, error, working, action, onNewAnalysis, onOpenSettings, onOpenRun }: {
  report: LightReport; error: string; working: boolean; action: (path: string, body?: unknown) => Promise<boolean | undefined>;
  onNewAnalysis: () => void; onOpenSettings: () => void; onOpenRun: (id: string) => void;
}) {
  const running = report.status === 'running' || report.status === 'queued';
  const [group, setGroup] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('newest');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<EvidencePage | null>(null);
  const [pageError, setPageError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setPage(null); setPageError('');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ search, sort, offset: String(offset), limit: '30' });
      if (group) params.set('group_id', group);
      void api<EvidencePage>(`/api/runs/${report.run_id}/comments?${params}`, { signal: controller.signal }).then(setPage).catch(e => { if (!controller.signal.aborted) setPageError(String(e)); });
    }, 150);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [report.run_id, report.coverage.fetched, group, search, sort, offset]);
  function filter(id: string) {
    setGroup(id); setOffset(0); setSearch('');
    document.getElementById('raw-comments')?.scrollIntoView({ behavior: 'smooth' });
  }
  return <main className="opinion-shell">
    <AppHeader report onHome={onNewAnalysis} onNewAnalysis={onNewAnalysis} onOpenSettings={onOpenSettings} />
    <header className="opinion-intro"><p className="opinion-eyebrow">COMMENT INSIGHTS · ASTRA LIGHT</p><h1>{report.video.title || 'コメントを取得しています'}</h1><p>{report.video.channel_title} · <a href={report.video.url} target="_blank" rel="noreferrer">YouTubeで動画を見る ↗</a></p></header>
    {error ? <p role="alert">{error}</p> : null}
    <section className="opinion-progress" aria-label="取得と要約の状況">
      <strong aria-live="polite">{report.stage === 'queued' ? '順番待ち' : report.stage === 'fetching' && running ? 'コメントを取得しています' : statuses[report.summary_status] || report.summary_status}</strong>
      <div className="opinion-metrics"><span><b>{formatNumber(report.coverage.fetched)}</b>件取得</span><span><b>{report.sample.sent_count ?? 0}</b>件を要約に使用</span><span><b>{report.usage.calls}</b>回のAI呼び出し</span></div>
      <p>全件の集計はAIを使わず、要約は抽出したコメントだけを読みます。通常1回、修復時はもう1回。全体10分を目標に時間制限を設けています。</p>
      {report.error_message ? <p role="alert">{report.error_message} 取得済みの集計と原文は利用できます。</p> : null}
      <div className="opinion-actions">{running ? <Button disabled={working} onClick={() => void action('actions', { action: 'stop' })}>停止して保存</Button> : <>
        {report.summary_status !== 'completed' ? <Button disabled={working} onClick={() => { setGroup(''); void action('actions', { action: 'resume' }); }}>保存データから要約を再試行</Button> : null}
        {report.can_continue ? <Button disabled={working} variant="outline" onClick={() => { setGroup(''); void action('actions', { action: 'continue' }); }}>続きのコメントを取得・要約</Button> : null}
        <Button disabled={working} variant="outline" onClick={async () => { try { const result = await api<{run_id:string}>(`/api/runs/${report.run_id}/reanalyze`, {method:'POST'}); onOpenRun(result.run_id); } catch (e) { toast.error(String(e)); } }}>新しい分析としてやり直す</Button>
      </>}</div>
    </section>
    <section className="opinion-section"><div className="opinion-section-heading"><span>01 / COUNTS</span><h2>取得した全件の集計</h2></div>
      <div className="opinion-metrics"><span>親コメント <b>{report.coverage.parents}</b>件</span><span>返信 <b>{report.coverage.replies}</b>件</span><span>いいね合計 <b>{formatNumber(report.statistics.likes)}</b></span><span>完全同文の重複 <b>{report.statistics.duplicate_comments}</b>件</span></div>
      <p>{report.coverage.source === 'fixture' ? 'テスト用データです。実際の動画の反応ではありません。' : report.coverage.api_exhausted ? 'APIで取得可能な範囲を取得しました。削除・非公開コメントは含みません。' : '部分取得です。この範囲がコメント欄全体を代表するとは限りません。'}</p>
      <p className="opinion-note">投稿期間：{report.coverage.published_from ? new Date(report.coverage.published_from).toLocaleDateString() : '不明'} 〜 {report.coverage.published_to ? new Date(report.coverage.published_to).toLocaleDateString() : '不明'} ／ 投稿者ID確認済み {report.concentration.unique_authors}人。いいねは賛成票や人数ではありません。</p>
    </section>
    <section className="opinion-section"><div className="opinion-section-heading"><span>02 / SAMPLED VOICES</span><h2>このコメント欄で語られていること</h2></div>
      <p>抽出範囲で確認した話題です。全体の賛否率や、少数意見の網羅を示すものではありません。</p>
      <div className="opinion-grid">{report.topics.map(topic => <article className="opinion-card" key={topic.id}><h3>{topic.title}</h3><p>{topic.description}</p><p>{topic.reactions}</p>{topic.evidence.map((e,i) => <blockquote key={`${e.comment_id}-${i}`}>{e.quote}</blockquote>)}<Button variant="outline" onClick={() => filter(topic.id)}>根拠の原文を読む</Button></article>)}</div>
      {!report.topics.length ? <p className="opinion-empty">{running ? '要約を待つ間も、下の原文を読めます。' : '表示できる要約はありません。取得済みの原文をご確認ください。'}</p> : null}
      {report.summary_status === 'completed' ? <Button variant="ghost" disabled={working || report.review.human_reviewed} onClick={() => void action('review/complete')}>{report.review.human_reviewed ? '抽出要約を確認済み' : '抽出要約を確認済みにする'}</Button> : null}
      <details><summary>抽出方法と処理時間</summary><p>候補 {report.sample.candidate_count ?? 0}件 ／ 送信 {report.sample.sent_count ?? 0}件 ／ 長文・親文脈の省略 {report.sample.truncated_count ?? 0}件。親・返信と投稿時期で分けた無作為抽出を中心に、高評価・返信の多い投稿を補足します。入力文字数上限による省略があります。</p><p>字幕は使用していません。{report.method.model} / {report.method.effort} · 累計 {Math.round(report.usage.elapsed_seconds)}秒 · 入力 {formatNumber(report.usage.input_characters)}文字 · 出力 {formatNumber(report.usage.output_characters)}文字</p></details>
    </section>
    <section id="raw-comments" className="opinion-section"><div className="opinion-section-heading"><span>03 / ORIGINAL COMMENTS</span><h2>原文を読む</h2></div>
      <div className="opinion-actions"><Input aria-label="原文を検索" placeholder="原文を検索" value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} /><label>並べ替え <select aria-label="原文の並べ替え" value={sort} onChange={e => { setSort(e.target.value); setOffset(0); }}><option value="newest">新しい順</option><option value="likes">いいね順</option><option value="replies">返信の多い順</option></select></label>{group ? <Button variant="outline" onClick={() => filter('')}>すべての原文を表示</Button> : null}</div>
      {pageError ? <p role="alert">{pageError}</p> : !page ? <p>原文を読み込み中…</p> : <><p>{page.total}件中 {page.total ? offset+1 : 0}〜{Math.min(offset+30,page.total)}件</p><div className="opinion-evidence-list">{page.comments.map(row => <article className="opinion-evidence-row" key={row.comment_id}><p className="opinion-note">{row.is_reply ? '返信' : '親コメント'} · いいね {row.like_count}</p>{row.parent_text ? <details><summary>返信先の文脈</summary><blockquote>{row.parent_text}</blockquote></details> : null}<p className="opinion-original">{row.text_original}</p><a href={row.url} target="_blank" rel="noreferrer">YouTubeのコメントを開く ↗</a></article>)}</div><div className="opinion-actions"><Button disabled={offset===0} variant="outline" onClick={() => setOffset(Math.max(0,offset-30))}>前へ</Button><Button disabled={offset+30>=page.total} variant="outline" onClick={() => setOffset(offset+30)}>次へ</Button></div></>}
    </section>
  </main>;
}

import { useEffect, useRef, useState } from 'react';
import { api, formatNumber, formatPercent } from '../api';
import type { EvidenceComment, EvidencePage, Observation, OpinionGroup, OpinionReport } from '../types';
import { AppHeader } from './AppHeader';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { toast } from 'sonner';

const labels: Record<string, string> = { positive: '肯定', negative: '否定', neutral: '中立・言及', mixed: '肯否が混在', unclear: '判断保留' };
const emotions: Record<string, string> = { joy: '喜び', admiration: '称賛', surprise: '驚き', anger: '怒り', disappointment: '落胆', sadness: '悲しみ', anxiety: '不安', other: 'その他', unclear: '不明' };
const stages: Record<string, string> = { created: '開始準備', queued: '順番待ち', fetching: 'コメント取得', subtitles: '字幕取得', background: '動画の背景を整理', reading: 'コメントを文脈に沿って分析', grouping: '意見の統合・根拠の検証', completed: '取得範囲の分析完了', paused: '停止中', interrupted: '再開できます', correction_saved: '修正を保存', transcript_changed: '字幕を変更' };

export function OpinionReportView({ runId, onNewAnalysis, onOpenSettings, onOpenRun }: { runId: string; onNewAnalysis: () => void; onOpenSettings: () => void; onOpenRun: (id: string) => void }) {
  const [report, setReport] = useState<OpinionReport | null>(null);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const [evidenceGroup, updateEvidenceGroup] = useState<string | null | undefined>(undefined);
  const evidenceTrigger = useRef<HTMLElement | null>(null);
  function setEvidenceGroup(value: string | null | undefined) {
    if (value !== undefined && evidenceGroup === undefined) evidenceTrigger.current = document.activeElement as HTMLElement;
    updateEvidenceGroup(value);
    if (value === undefined) window.requestAnimationFrame(() => evidenceTrigger.current?.focus());
  }
  const [target, setTarget] = useState('');
  const [rename, setRename] = useState('');
  useEffect(() => {
    let active = true;
    let timer: number | undefined;
    async function refresh() {
      try {
        const next = await api<OpinionReport>(`/api/runs/${runId}/report`);
        if (active) { setReport(next); setError(''); }
      } catch (caught) { if (active) setError(message(caught)); }
      if (active) timer = window.setTimeout(refresh, 1800);
    }
    setReport(null); setTarget(''); setEvidenceGroup(undefined);
    void refresh();
    return () => { active = false; window.clearTimeout(timer); };
  }, [runId]);
  async function action(path: string, body?: unknown) {
    setWorking(true);
    try {
      await api(`/api/runs/${runId}/${path}`, { method: 'POST', ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      setReport(await api<OpinionReport>(`/api/runs/${runId}/report`));
      if (path === 'actions' && (body as { action: string }).action === 'stop') toast.info('現在の処理を保存して停止します。AIの応答待ちは最大10分かかる場合があります。');
    } catch (caught) { toast.error(message(caught)); return false; }
    finally { setWorking(false); }
    return true;
  }
  const running = report?.status === 'running' || report?.status === 'queued';
  const groups = report?.groups.filter(group => !target || group.target === target) ?? [];
  const selectedGroup = report?.groups.find(group => group.id === evidenceGroup);
  return <main className="opinion-shell">
    <AppHeader report onHome={onNewAnalysis} onNewAnalysis={onNewAnalysis} onOpenSettings={onOpenSettings} />
    {error ? <p role="alert" className="opinion-error">{error}</p> : null}
    {!report ? <p role="status">保存済みの分析を読み込んでいます…</p> : <>
      <header className="opinion-intro">
        <p className="opinion-eyebrow">COMMENT INSIGHTS <span>取得範囲の反応を読む</span></p>
        <h1>{report.video.title || 'コメント欄を読み解いています'}</h1>
        <p>{report.video.channel_title} · <a href={report.video.url} target="_blank" rel="noreferrer">YouTubeで動画を見る ↗</a></p>
      </header>
      <section className="opinion-progress" aria-label="取得と分析の状況">
        <div><strong aria-live="polite">{report.status === 'failed' ? '途中結果を保存して停止しました' : stages[report.stage] || report.stage}</strong><span>{report.review.human_reviewed ? '人が確認済み' : '人による全体確認は未実施'}</span></div>
        <div className="opinion-metrics"><span><b>{formatNumber(report.coverage.fetched)}</b>件取得</span><span><b>{formatNumber(report.analysis.processed)}</b>件分析済み</span><span><b>{report.analysis.unprocessed}</b>件未分析</span><span><b>{report.analysis.held}</b>件判断保留</span></div>
        <progress aria-label="取得コメントの分析進捗" max={Math.max(1, report.coverage.fetched)} value={report.analysis.processed} />
        <p>{report.coverage.source === 'fixture' ? 'テスト用データです。実際の動画の反応ではありません。' : report.coverage.api_exhausted ? 'APIで取得可能な範囲を最後まで確認しました。削除・非公開コメントは含みません。' : 'コメント欄全体の取得は未完了です。この範囲が全期間を代表するとは限りません。'}</p>
        <p>親コメント {report.coverage.parents}件 ／ 返信 {report.coverage.replies}件 ／ 取得した親に対する未取得返信の目安 {report.coverage.pending_replies}件</p>
        {report.error_message ? <p role="alert" className="opinion-error">{report.error_message}</p> : null}
        <div className="opinion-actions">
          {report.analysis.held ? <Button variant="outline" onClick={() => setEvidenceGroup("__held")}>判断保留の根拠を確認</Button> : null}
          {running ? <Button variant="outline" disabled={working} onClick={() => void action('actions', { action: 'stop' })}>停止して保存</Button> : <>
            {report.status !== 'completed' ? <Button disabled={working} onClick={() => void action('actions', { action: 'resume' })}>保存した続きから再開</Button> : null}
            {report.can_continue ? <Button disabled={working} onClick={() => void action('actions', { action: 'continue' })}>続きのコメントを取得・分析</Button> : null}
            <Button variant="outline" disabled={working} onClick={async () => { setWorking(true); try { const result = await api<{ run_id: string }>(`/api/runs/${runId}/reanalyze`, { method: 'POST' }); onOpenRun(result.run_id); } catch (caught) { toast.error(message(caught)); } finally { setWorking(false); } }}>新しい分析としてやり直す</Button>
          </>}
        </div>
        <details><summary>取得範囲・字幕・処理時間</summary><div className="opinion-details">
          <p>取得順：新しい順 ／ 投稿日時：{date(report.coverage.published_from)}〜{date(report.coverage.published_to)}</p>
          <p>取得開始：{date(report.coverage.fetched_at)} ／ 保存更新：{date(report.coverage.updated_at)} ／ YouTube表示コメント数：{formatNumber(report.coverage.youtube_comment_count)}</p>
          <p>字幕：{report.transcript.status === 'available' ? `${report.transcript.segment_count}区間・${report.transcript.language}${report.transcript.automatic ? '（自動字幕には誤認識の可能性があります）' : ''}` : report.transcript.reason || '取得待ち'}</p>
          <p>処理時間 {Math.round(report.usage.elapsed_seconds / 60)}分 ／ AI呼び出し {report.usage.calls}回 ／ 入力 {formatNumber(report.usage.input_characters)}文字。トークン利用量は取得できていません。</p>
          <label className="opinion-upload">字幕を取り込んで再分析（VTT・SRT・JSON3）<Input type="file" accept=".vtt,.srt,.json3,.json" disabled={running || working} onChange={async event => { const file = event.target.files?.[0]; if (file) { if (file.size > 5_000_000) toast.error('字幕は5MB以下にしてください。'); else await action('transcript', { content: await file.text() }); } event.target.value = ''; }} /></label>
          <p>字幕は解釈の背景です。字幕の発言をコメント投稿者の意見として数えません。</p>
        </div></details>
      </section>
      <section className="opinion-section" aria-labelledby="opinion-summary">
        <div className="opinion-section-heading"><span>01 / OVERVIEW</span><h2 id="opinion-summary">このコメント欄で語られていること</h2></div>
        {report.summary.length ? <ol className="opinion-summary-list">{report.summary.map(item => <li key={item.group_id}><button onClick={() => setEvidenceGroup(item.group_id)}>{item.text}<span>根拠を読む →</span></button></li>)}</ol> : <p className="opinion-empty">{running ? 'コメントの文脈と根拠を確認しています。確認できた意見をここにまとめます。' : 'まだ根拠の検証を完了した意見はありません。判断保留・未分析の件数や停止理由を確認してください。'}</p>}
        <p className="opinion-note">取得した投稿の傾向です。視聴者全員の本音や、動画内の事実を確定するものではありません。</p>
      </section>
      <section className="opinion-section" aria-labelledby="opinion-groups">
        <div className="opinion-section-heading"><span>02 / OPINIONS</span><h2 id="opinion-groups">主な意見と、その理由</h2></div>
        <label className="opinion-target-filter">人物・対象で絞る<select value={target} onChange={event => setTarget(event.target.value)}><option value="">すべての対象</option>{report.targets.map(item => <option key={`${item.type}:${item.name}`} value={item.name}>{item.name} · {item.comment_count}件</option>)}</select></label>
        <p className="opinion-note">割合の分母は取得コメント {report.coverage.fetched}件（未分析を含む）。複数の意見を含む投稿があるため合計は100%を超える場合があります。</p>
        <div className="opinion-grid">{groups.map(group => <article className="opinion-card" key={group.id}>
          <div className="opinion-card-meta"><span>{group.target} · {group.topic}</span><span className={`opinion-stance opinion-stance--${group.stance}`}>{labels[group.stance]}</span></div>
          <h3>{group.label}</h3><p>{group.reason || '理由が明示されていない反応です。'}</p>
          <div className="opinion-count"><b>{group.comment_count}<small>件</small></b><span>{formatPercent(group.rate)} / {group.denominator}件</span></div>
          <div className="opinion-bar" aria-hidden="true"><i style={{ width: `${group.rate * 100}%` }} /></div>
          <p className="opinion-note">親 {group.parent_count}/{group.parent_denominator}件 · 返信 {group.reply_count}/{group.reply_denominator}件<br />投稿者 {group.unique_authors}人（ID取得済み {group.author_known_count}件の範囲）</p>
          {Object.keys(group.emotions).length ? <p className="opinion-note">表現された感情：{Object.keys(group.emotions).map(value => emotions[value] || value).join('・')}</p> : null}
          {group.evidence[0] ? <blockquote>{group.evidence[0].quote}</blockquote> : null}
          <Button variant="outline" onClick={() => setEvidenceGroup(group.id)}>根拠コメント {group.comment_count}件を読む</Button>
          {group.counter_group_ids.length ? <div className="opinion-counter">{group.counter_group_ids.map(id => <button key={id} onClick={() => setEvidenceGroup(id)}>異なる評価の根拠を読む →</button>)}</div> : null}
        </article>)}</div>
        {target ? <details className="opinion-rename"><summary>この対象の名前・別名を修正する</summary><form onSubmit={event => { event.preventDefault(); void action('opinion-corrections', { rename_from: target, rename_to: rename }); setTarget(''); }}><Input aria-label="統一する対象名" placeholder="統一する名前" maxLength={160} value={rename} onChange={event => setRename(event.target.value)} required /><Button disabled={running || working}>保存して再集計</Button></form></details> : null}
      </section>
      <section className="opinion-section" aria-labelledby="opinion-targets">
        <div className="opinion-section-heading"><span>03 / PEOPLE &amp; SUBJECTS</span><h2 id="opinion-targets">誰・何が語られているか</h2></div>
        <div className="opinion-target-list">{report.targets.map(item => <button key={`${item.type}:${item.name}`} onClick={() => { setTarget(item.name); document.getElementById('opinion-groups')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); }}><strong>{item.name}</strong><span>{item.comment_count}件のコメント</span><small>{Object.entries(item.stances).map(([stance, count]) => `${labels[stance]} ${count}件`).join(' ／ ')}</small></button>)}</div>
        <p className="opinion-note">根拠を確認できた意見・言及から集計。同じ投稿が異なる評価を含むことがあります。</p>
      </section>
      <section className="opinion-section" aria-labelledby="opinion-differences">
        <div className="opinion-section-heading"><span>04 / PERSPECTIVES</span><h2 id="opinion-differences">目立つ反応と、全体の違い</h2></div>
        <p className="opinion-note">{report.method.top_definition}と、取得した親コメント全体を比較。いいねは賛成票や人数ではありません。</p>
        <div className="opinion-comparisons">{[...report.groups].sort((a, b) => Math.abs(b.difference_pp) - Math.abs(a.difference_pp)).slice(0, 5).map(group => <button className="opinion-comparison" key={group.id} onClick={() => setEvidenceGroup(group.id)}><span>{group.target}：{group.label}</span><span>全体 {formatPercent(group.parent_rate)}<br />高評価上位 {formatPercent(group.top_rate)}</span><b>{group.difference_pp > 0 ? '+' : ''}{group.difference_pp.toFixed(1)}<small>pt</small></b></button>)}</div>
        <details><summary>件数の少ない意見も読む</summary><div className="opinion-minority">{[...report.groups].sort((a, b) => a.comment_count - b.comment_count).slice(0, 5).map(group => <button key={group.id} onClick={() => setEvidenceGroup(group.id)}>{group.target}：{group.label}（{group.comment_count}件） →</button>)}</div></details>
        <p className="opinion-note">投稿者IDを取得できた {report.concentration.known_author_comments}件は {report.concentration.unique_authors}人からの投稿。最多投稿者は {report.concentration.max_comments_per_author}件。同文の繰り返しは {report.concentration.duplicate_text_comments}件あり、自動除外していません。</p>
      </section>
      <footer className="opinion-footer"><Button variant="outline" onClick={() => setEvidenceGroup(null)}>すべての原文を検索する</Button><Button variant="ghost" disabled={running || working || report.status !== 'completed' || report.review.human_reviewed} onClick={() => void action('review/complete')}>人が全体を確認済みにする</Button><p>判断保留 {report.analysis.held}件 · 意見・対象言及なし {report.analysis.no_opinion}件 · 文脈に不足のある投稿 {report.analysis.context_incomplete}件</p></footer>
      <EvidenceDialog key={runId} runId={runId} group={selectedGroup} groupId={evidenceGroup} running={running || working} videoId={report.video.youtube_video_id} onClose={() => setEvidenceGroup(undefined)} onCorrect={body => action('opinion-corrections', body)} />
    </>}
  </main>;
}

function EvidenceDialog({ runId, group, groupId, running, videoId, onClose, onCorrect }: { runId: string; group?: OpinionGroup; groupId: string | null | undefined; running: boolean; videoId: string; onClose: () => void; onCorrect: (body: unknown) => Promise<boolean> }) {
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<EvidencePage | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { setOffset(0); setSearch(''); }, [groupId]);
  useEffect(() => {
    if (groupId === undefined) return;
    const controller = new AbortController();
    setPage(null); setError('');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ limit: '30', offset: String(offset), search });
      if (groupId === '__held') params.set('analysis_status', 'held');
      else if (groupId) params.set('group_id', groupId);
      void api<EvidencePage>(`/api/runs/${runId}/comments?${params}`, { signal: controller.signal }).then(setPage).catch(caught => { if (!controller.signal.aborted) setError(message(caught)); });
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [groupId, offset, runId, search]);
  return <Dialog open={groupId !== undefined} onOpenChange={open => { if (!open) onClose(); }}><DialogContent className="opinion-evidence-dialog"><DialogHeader><DialogTitle>根拠コメント</DialogTitle><DialogDescription>{group ? `${group.target}：${group.label}` : groupId === '__held' ? '判断保留になったコメントと、その根拠を確認できます。' : '取得したコメントの原文を検索できます。'}</DialogDescription></DialogHeader>
    <Input type="search" aria-label="原文を検索" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} placeholder="原文を検索" />
    {error ? <p role="alert">{error}</p> : !page ? <p role="status">読み込み中…</p> : <><p>{page.total}件中 {page.total ? offset + 1 : 0}〜{Math.min(offset + 30, page.total)}件</p>
      <div className="opinion-evidence-list">{page.comments.map(comment => <article key={comment.comment_id} className="opinion-evidence-row"><p className="opinion-note">{comment.is_reply ? '返信' : '親コメント'} · {date(comment.published_at)} · いいね {comment.like_count}</p>{comment.parent_text ? <details><summary>返信先の文脈</summary><blockquote>{comment.parent_text}</blockquote></details> : null}<p className="opinion-original">{comment.text_original}</p>{comment.analysis_status === "held" ? <p className="opinion-note">判断保留：{comment.review_reason || "対象や評価を確定できていません。"}</p> : comment.analysis_status === "pending" ? <p className="opinion-note">このコメントは未分析です。</p> : null}<a href={comment.url} target="_blank" rel="noreferrer">YouTubeのコメントを開く ↗</a>
        {comment.subtitles.length ? <details><summary>解釈に使った字幕</summary>{comment.subtitles.map(segment => <p key={segment.id}><a href={`https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(segment.start)}`} target="_blank" rel="noreferrer">{Math.floor(segment.start / 60)}:{String(Math.floor(segment.start % 60)).padStart(2, '0')}</a> {segment.text}</p>)}</details> : null}
        <CorrectionEditor comment={comment} disabled={running} onSave={async observations => { if (await onCorrect({ comment_id: comment.comment_id, observations })) onClose(); }} />
      </article>)}</div><div className="opinion-actions"><Button variant="outline" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 30))}>前へ</Button><Button variant="outline" disabled={offset + 30 >= page.total} onClick={() => setOffset(value => value + 30)}>次へ</Button></div></>}
  </DialogContent></Dialog>;
}

function CorrectionEditor({ comment, disabled, onSave }: { comment: EvidenceComment; disabled: boolean; onSave: (items: Observation[]) => Promise<void> }) {
  const [items, setItems] = useState<Observation[]>(comment.observations.map(({ id: _id, comment_id: _commentId, ...item }) => item));
  function update(index: number, values: Partial<Observation>) { setItems(current => current.map((item, i) => i === index ? { ...item, ...values } : item)); }
  return <details className="opinion-correction"><summary>このコメントの分析を確認・修正</summary><form onSubmit={event => { event.preventDefault(); void onSave(items); }}>
    {items.map((item, index) => <fieldset key={index}><legend>意見 {index + 1}</legend><label>対象<Input value={item.target} required maxLength={160} onChange={event => update(index, { target: event.target.value })} /></label><label>対象の種類<select value={item.target_type} onChange={event => update(index, { target_type: event.target.value as Observation['target_type'] })}>{Object.entries({ person: '人物', group: 'グループ', product: '商品', video: '動画', other: 'その他', unknown: '不明' }).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>話題<Input value={item.topic} required maxLength={160} onChange={event => update(index, { topic: event.target.value })} /></label><label>意見<Input value={item.opinion} required maxLength={300} onChange={event => update(index, { opinion: event.target.value })} /></label><label>理由<Input value={item.reason} maxLength={500} onChange={event => update(index, { reason: event.target.value })} /></label><label>対象への評価<select value={item.stance} onChange={event => update(index, { stance: event.target.value as Observation['stance'] })}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>原文の根拠<Input value={item.quote} required onChange={event => update(index, { quote: event.target.value })} /></label><Button type="button" variant="ghost" disabled={disabled} onClick={() => setItems(current => current.filter((_, i) => i !== index))}>この意見を除く</Button></fieldset>)}
    <div className="opinion-actions"><Button type="button" variant="outline" disabled={disabled} onClick={() => setItems(current => [...current, { target: '動画', target_type: 'video', topic: '', opinion: '', reason: '', stance: 'unclear', emotions: [], quote: comment.text_original, subtitle_ids: [] }])}>意見を追加</Button><Button disabled={disabled}>修正して再集計</Button></div>
  </form></details>;
}
function date(value: string | null | undefined): string { return value ? new Date(value).toLocaleString('ja-JP') : '未取得'; }
function message(caught: unknown): string { return caught instanceof Error ? caught.message : String(caught); }

import { useEffect, useRef, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { XIcon } from 'lucide-react';
import { api, formatNumber } from '../api';
import { emotionLabels, formatDate, modelStanceLabels, ruleStanceLabels, sentimentLabels } from '../labels';
import type { CommentPage, CommentRow } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';

export type Sort = 'newest' | 'likes' | 'replies';
/** Query for GET /api/runs/{id}/comments plus the heading shown above the results. */
export type CommentFilter = {
  label: string; sort?: Sort; group_id?: string; person_id?: string; stance?: string; model_stance?: string;
  sentiment?: string; emotion?: string; moment?: [number, number];
};
export type OpenComments = (filter: CommentFilter) => void;

const PAGE = 30;

export function CommentBrowser({ runId, filter, version, searchLabel = '原文を検索' }: { runId: string; filter?: CommentFilter; version: string; searchLabel?: string }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<Sort>(filter?.sort ?? 'newest');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<CommentPage | null>(null);
  const [error, setError] = useState('');
  const top = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ search, sort, offset: String(offset), limit: String(PAGE) });
      for (const key of ['group_id', 'person_id', 'stance', 'model_stance', 'sentiment', 'emotion'] as const) if (filter?.[key]) params.set(key, filter[key]);
      if (filter?.moment) { params.set('moment_start', String(filter.moment[0])); params.set('moment_end', String(filter.moment[1])); }
      api<CommentPage>(`/api/runs/${runId}/comments?${params}`, { signal: controller.signal }).then(setPage).catch(e => { if (!controller.signal.aborted) setError(String(e)); });
    }, 150);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [runId, filter, search, sort, offset, version]);
  function turn(next: number) { setOffset(next); top.current?.scrollIntoView({ block: 'nearest' }); }
  return <div className="comment-browser" ref={top}>
    <div className="comment-controls">
      <Input aria-label={searchLabel} placeholder="本文を検索" type="search" value={search} onChange={e => { setSearch(e.target.value); setOffset(0); }} />
      <select aria-label="原文の並べ替え" value={sort} onChange={e => { setSort(e.target.value as Sort); setOffset(0); }}>
        <option value="newest">新しい順</option><option value="likes">いいね順</option><option value="replies">返信の多い順</option>
      </select>
    </div>
    <p className="comment-count" role="status">{page ? page.total ? `${formatNumber(page.total)}件中 ${offset + 1}〜${Math.min(offset + PAGE, page.total)}件` : '該当する原文はありません' : error ? '原文を読み込めませんでした' : '読み込み中…'}</p>
    {error ? <p role="alert">{error}</p> : null}
    {page ? <>
      <div className="comment-list">{page.comments.map(row => <CommentItem key={row.comment_id} row={row} personId={filter?.person_id} showRule={Boolean(filter?.stance)} />)}</div>
      {page.total > PAGE ? <div className="comment-pager">
        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => turn(Math.max(0, offset - PAGE))}>前へ</Button>
        <Button size="sm" variant="outline" disabled={offset + PAGE >= page.total} onClick={() => turn(offset + PAGE)}>次へ</Button>
      </div> : null}
    </> : null}
  </div>;
}

function CommentItem({ row, personId, showRule }: { row: CommentRow; personId?: string; showRule: boolean }) {
  const toward = personId ? row.local?.people?.[personId] : undefined;
  // Rule-based reasons matter when filtering by them, or when no model judgement exists.
  const judgement = personId && (showRule || !toward) ? row.person_judgements?.[personId] : undefined;
  return <article className="comment-item">
    <p className="comment-meta">
      <span>{row.is_reply ? '返信' : '親コメント'}</span>
      <span>いいね {formatNumber(row.like_count)}</span>
      {row.reply_count ? <span>返信 {row.reply_count}</span> : null}
      <span>{formatDate(row.published_at)}</span>
      {row.local ? <span className={`tag tag-${row.local.sentiment}`}>{sentimentLabels[row.local.sentiment]}</span> : null}
      {row.local?.emotion ? <span className="tag">{emotionLabels[row.local.emotion]}</span> : null}
      {toward ? <span className={`tag tag-${toward}`}>この人物へ：{modelStanceLabels[toward]}</span> : null}
    </p>
    {row.parent_text ? <details className="comment-context"><summary>返信先</summary><blockquote>{row.parent_text}</blockquote></details> : null}
    <p className="comment-text">{row.text_original}</p>
    {judgement ? <p className="comment-judgement">ルール判定：{ruleStanceLabels[judgement.label]} ／ 呼び名：{judgement.aliases.join('、')}{judgement.signals.length ? ` ／ 評価表現：${judgement.signals.map(s => s.term).join('、')}` : ''}{judgement.reasons.length ? ` ／ 保留理由：${judgement.reasons.join('、')}` : ''}</p> : null}
    <a className="comment-link" href={row.url} target="_blank" rel="noreferrer">YouTubeで開く ↗</a>
  </article>;
}

/** Side panel over the report, so reading the evidence never loses the reader's place. */
export function useCommentSheet() {
  const [filter, setFilter] = useState<CommentFilter | null>(null);
  // Opened without a Radix trigger, so remember what had focus and return there on close.
  const opener = useRef<HTMLElement | null>(null);
  const open: OpenComments = next => { opener.current = document.activeElement as HTMLElement | null; setFilter(next); };
  return { filter, open, close: () => setFilter(null), restoreFocus: () => opener.current?.focus() };
}

export function CommentSheet({ runId, version, sheet }: { runId: string; version: string; sheet: ReturnType<typeof useCommentSheet> }) {
  const { filter } = sheet;
  return <DialogPrimitive.Root open={filter != null} onOpenChange={open => { if (!open) sheet.close(); }}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="sheet-overlay" />
      <DialogPrimitive.Content className="sheet" aria-describedby={undefined} onCloseAutoFocus={event => { event.preventDefault(); sheet.restoreFocus(); }}>
        <header className="sheet-header">
          <DialogPrimitive.Title>{filter?.label}</DialogPrimitive.Title>
          <DialogPrimitive.Close asChild><Button variant="ghost" size="icon" aria-label="閉じる"><XIcon /></Button></DialogPrimitive.Close>
        </header>
        <div className="sheet-body">{filter ? <CommentBrowser key={JSON.stringify(filter)} runId={runId} filter={filter} version={version} searchLabel="絞り込んだ原文を検索" /> : null}</div>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

import { formatNumber, formatPercent } from '../api';

/** Horizontal bars; each bar opens the matching original comments. */
export function Bars({ counts, labels, total, tone, onSelect }: { counts: Record<string, number>; labels: Record<string, string>; total: number; tone?: boolean; onSelect?: (id: string) => void }) {
  return <div className="bars">{Object.entries(labels).filter(([id]) => id in counts).map(([id, label]) => {
    const count = counts[id] ?? 0;
    const body = <><span className="bar-label">{label}</span><span className="bar-track"><span className={tone ? `fill-${id}` : undefined} style={{ width: `${total ? count / total * 100 : 0}%` }} /></span><span className="bar-value">{formatNumber(count)}件 <small>{total ? Math.round(count / total * 100) : 0}%</small></span></>;
    return onSelect
      ? <button type="button" key={id} className="bar" disabled={!count} aria-label={`${label} ${count}件の原文を開く`} onClick={() => onSelect(id)}>{body}</button>
      : <div key={id} className="bar">{body}</div>;
  })}</div>;
}

/** One 100% stacked bar with a readable legend, so meaning never rests on color alone. */
export function StackBar({ shares, labels, label }: { shares: Record<string, number>; labels: Record<string, string>; label: string }) {
  const legend = Object.entries(labels).map(([k, v]) => `${v} ${formatPercent(shares[k] ?? 0, 0)}`);
  return <div className="stack-row">
    <span className="stack-label">{label}</span>
    <span className="stack" role="img" aria-label={`${label}：${legend.join('、')}`}>{Object.keys(labels).map(k => <span key={k} className={`fill-${k}`} style={{ width: `${(shares[k] ?? 0) * 100}%` }} />)}</span>
    <span className="stack-legend">{Object.entries(labels).map(([k, v]) => <span key={k}><i className={`dot fill-${k}`} />{v} {formatPercent(shares[k] ?? 0, 0)}</span>)}</span>
  </div>;
}

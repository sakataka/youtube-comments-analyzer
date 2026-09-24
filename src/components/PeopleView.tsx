import { useState } from 'react';
import { formatNumber, formatPercent } from '../api';
import { modelStanceLabels, ruleStanceLabels } from '../labels';
import type { Action, Insights, LocalReport, PersonStatistics } from '../types';
import type { OpenComments } from './CommentBrowser';
import { Button } from './ui/button';

type Person = NonNullable<PersonStatistics['people']>[number];

export function PeopleView({ statistics, local, visible, running, busy, action, open }: { statistics?: PersonStatistics; local?: LocalReport; visible?: Insights['visible']; running: boolean; busy: boolean; action: Action; open: OpenComments }) {
  const [editing, setEditing] = useState(false);
  const done = statistics?.status === 'completed';
  const model = local?.status === 'completed' ? local.people : undefined;
  const reach = new Map(visible?.people.map(p => [p.id, p]));
  return <section className="panel-section" aria-labelledby="people-title">
    <div className="section-head">
      <h2 id="people-title">誰について語られているか</h2>
      {done ? <p>取得{formatNumber(statistics.denominator)}件のうち、人物辞書に一致した{formatNumber(statistics.matched_comments)}件。1つの投稿で複数人に触れると各人に数えます。</p> : null}
    </div>
    {statistics?.status === 'running' ? <p className="muted" role="status">人物名・別名の辞書を作り、全件を集計しています…</p> : null}
    {statistics?.error ? <p role="alert">人物集計：{statistics.error}</p> : null}
    {!running && !done ? <div className="inline-action"><p className="muted">人物集計はまだ完了していません。</p><Button size="sm" disabled={busy} onClick={() => void action('actions', { action: 'people' })}>人物集計を追加・再試行</Button></div> : null}
    {done && !statistics.people?.length ? <p className="muted">登録された人物はありません。辞書に人物名・呼び名を追加できます。</p> : null}
    {done ? <div className="person-grid">{statistics.people?.map(person => <PersonCard key={person.id} person={person} counts={model?.[person.id]} reach={reach.get(person.id)} topN={visible?.top_n ?? 20} open={open} />)}</div> : null}
    <div className="section-actions">
      <Button variant="outline" size="sm" disabled={busy} aria-expanded={editing} onClick={() => setEditing(!editing)}>人物名・別名の辞書を編集</Button>
    </div>
    {editing ? <DictionaryEditor statistics={statistics} busy={busy} action={action} onDone={() => setEditing(false)} /> : null}
    <details className="fine-print">
      <summary>集計と評価の注意点</summary>
      <p>{model ? '肯定・中立・否定は、名前を含む文をローカルモデルで判定した参考値です。文ごとに肯定と否定に分かれた投稿は「両方」です。' : '肯定・否定はルールによる参考値です。「判定できず」は中立という意味ではありません。'}割合の分母はその人物に一致した投稿です。「あの子」や名前を省いた返信は推定しないため、辞書に一致しない投稿にも人物への言及は含まれえます。</p>
      {statistics?.warnings?.map((warning, i) => <p key={i}>{warning}</p>)}
    </details>
  </section>;
}

function PersonCard({ person, counts, reach, topN, open }: { person: Person; counts?: Record<string, number>; reach?: Insights['visible']['people'][number]; topN: number; open: OpenComments }) {
  const rule = <Stances name={person.name} labels={ruleStanceLabels} counts={person.stances} total={person.count} kind="ルール判定" onOpen={stance => open({ label: `${person.name}：ルール判定「${ruleStanceLabels[stance]}」`, person_id: person.id, stance })} />;
  return <article className="person-card">
    <div className="person-head">
      <h3>{person.name}</h3>
      <Button variant="link" size="sm" onClick={() => open({ label: `${person.name}に言及した投稿`, person_id: person.id, sort: 'likes' })}>{formatNumber(person.count)}件 · 全件の{formatPercent(person.rate)}</Button>
    </div>
    <p className="muted small">親 {person.parents} ／ 返信 {person.replies}{reach ? ` · いいね上位${topN}件中 ${reach.top_count}件 · 全いいねの${formatPercent(reach.like_share)}` : ''}</p>
    {counts ? <>
      <Stances name={person.name} labels={modelStanceLabels} counts={counts} total={person.count} kind="モデル判定" onOpen={stance => open({ label: `${person.name}への評価「${modelStanceLabels[stance]}」`, person_id: person.id, model_stance: stance, sort: 'likes' })} />
      <details className="rule-details"><summary>ルール判定を見る</summary>{rule}</details>
    </> : rule}
    <p className="muted small">呼び名：{person.aliases.join('、') || 'なし'}</p>
  </article>;
}

function Stances({ name, labels, counts, total, kind, onOpen }: { name: string; labels: Record<string, string>; counts: Record<string, number>; total: number; kind: string; onOpen: (stance: string) => void }) {
  const entries = Object.entries(labels).filter(([key]) => key !== 'unclear' || counts[key]);
  const rate = (key: string) => (counts[key] ?? 0) / Math.max(1, total);
  return <>
    <div className="stack" role="img" aria-label={`${name}への${kind}：${entries.map(([k, v]) => `${v} ${counts[k] ?? 0}件`).join('、')}`}>{entries.map(([key]) => <span key={key} className={`fill-${key}`} style={{ width: `${rate(key) * 100}%` }} />)}</div>
    <div className="chips">{entries.filter(([key]) => counts[key]).map(([key, label]) => <button type="button" key={key} className="chip" onClick={() => onOpen(key)}><i className={`dot fill-${key}`} />{label} {counts[key] ?? 0}<small>{formatPercent(rate(key), 0)}</small></button>)}</div>
  </>;
}

function DictionaryEditor({ statistics, busy, action, onDone }: { statistics?: PersonStatistics; busy: boolean; action: Action; onDone: () => void }) {
  const [draft, setDraft] = useState(() => (statistics?.people ?? []).map(p => `${p.name}: ${p.aliases.filter(a => a !== p.name).join(', ')}`).join('\n'));
  const [error, setError] = useState('');
  return <form className="dictionary" onSubmit={async e => {
    e.preventDefault(); setError('');
    const people = draft.split('\n').filter(line => line.trim()).map(line => { const [name, ...parts] = line.split(/[:：]/); return { name: name.trim(), aliases: parts.join(':').split(/[,、]/).map(a => a.trim()).filter(Boolean) }; });
    if (people.some(p => p.name.length < 2)) { setError('人物名は2文字以上で入力してください。'); return; }
    if (await action('people', { people })) onDone();
  }}>
    <label htmlFor="person-dictionary-input">1行に「人物名: 別名1, 別名2」</label>
    <textarea id="person-dictionary-input" value={draft} rows={8} onChange={e => setDraft(e.target.value)} placeholder="佐久間宣行: 佐久間, 佐久間P" />
    <p className="muted small">保存するとAIを使わずに再集計します（要約は変わりません）。削除した行の人物は集計から外れます。現在の辞書：{statistics?.source === 'manual' ? '手動' : 'AI作成'}</p>
    {error ? <p role="alert">{error}</p> : null}
    <div><Button size="sm" disabled={busy}>辞書を保存して再集計</Button></div>
  </form>;
}

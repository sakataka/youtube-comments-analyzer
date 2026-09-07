import { useState } from 'react';
import type { PersonStatistics } from '../types';
import { Button } from './ui/button';

export const stanceLabels: Record<string,string> = {positive:'肯定',negative:'否定',mixed:'両方',unclear:'判定できず'};
const percent = (value: number) => `${(value*100).toFixed(1)}%`;

export function PersonStatisticsView({ statistics, running, working, action, onFilter }: { statistics?: PersonStatistics; running:boolean; working:boolean; action:(path:string,body?:unknown)=>Promise<boolean|undefined>; onFilter:(id:string,stance:string)=>void }) {
  const [editing,setEditing]=useState(false);
  const [draft,setDraft]=useState('');
  const [error,setError]=useState('');
  const stats=statistics;
  return <section className="opinion-section" aria-label="人物別の言及と評価">
    <div className="opinion-section-heading"><span>02 / PEOPLE</span><h2>誰について語られているか</h2></div>
    <p>名前・別名の辞書に一致した投稿を、取得した全件から集計しています。同じ投稿で同じ人物が繰り返し登場しても1件です。</p>
    {stats?.status === 'running' ? <p role="status">人物名・別名の辞書を作成し、全件を集計しています…</p> : null}
    {stats?.error ? <p role="alert">人物集計：{stats.error} 要約と原文は引き続き利用できます。</p> : null}
    {stats?.status === 'completed' ? <>
      <p className="opinion-note">分母：取得 {stats.denominator}件 ／ 辞書に一致 {stats.matched_comments}件 ／ 辞書未一致 {stats.unmatched_comments}件。複数人物への言及があるため、人物別の割合の合計は100%を超える場合があります。</p>
      <p className="opinion-note">肯定・否定はルールによる参考値です。4区分の分母はその人物に一致した投稿全件。「判定できず」は中立という意味ではありません。</p>
      {!stats.people?.length ? <p>登録された人物はありません。辞書に人物名・呼び名を追加できます。</p> : null}
      <div className="person-statistics">{stats.people?.map(person => <article className="person-stat-card" key={person.id}>
        <div className="person-stat-heading"><h3>{person.name}</h3><Button variant="ghost" onClick={() => onFilter(person.id,'')}>{person.count}件 · 全件の{percent(person.rate)}</Button></div>
        <p className="opinion-note">親 {person.parents}件 ／ 返信 {person.replies}件 · 呼び名：{person.aliases.join('、') || '有効な呼び名なし'}</p>
        <div className="person-stance-bar" aria-label={`${person.name}の参考評価の内訳`}>{Object.keys(stanceLabels).map(key => <span key={key} className={`person-stance-${key}`} style={{width:percent(person.stance_rates[key])}} title={`${stanceLabels[key]} ${person.stances[key]}件`} />)}</div>
        <div className="person-stance-counts">{Object.entries(stanceLabels).map(([key,label]) => <Button key={key} variant="outline" disabled={!person.stances[key]} onClick={() => onFilter(person.id,key)}><i className={`person-stance-dot person-stance-${key}`} />{label} {person.stances[key]}件 <small>{percent(person.stance_rates[key])}</small></Button>)}</div>
      </article>)}</div>
    </> : !running ? <p>人物集計はまだ完了していません。保存済みの原文から追加できます。</p> : null}
    {stats?.warnings?.map((warning,i) => <p className="opinion-note" key={i}>{warning}</p>)}
    <p className="opinion-note">「あの子」「最後の人」や名前を省略した返信は推定しません。辞書未一致は、人物への言及がないという意味ではありません。引用・疑問・否定・複数人物が混ざった表現などは保留します。</p>
    {!running && stats?.status !== 'completed' ? <Button disabled={working} onClick={() => void action('actions',{action:'people'})}>人物集計を追加・再試行</Button> : null}
    <Button variant="ghost" disabled={running || working} onClick={() => {setDraft((stats?.people ?? []).map(p => `${p.name}: ${p.aliases.filter(a => a !== p.name).join(', ')}`).join('\n'));setEditing(!editing);setError('');}}>人物名・別名の辞書を編集</Button>
    {editing ? <form className="person-dictionary" onSubmit={async e => {
      e.preventDefault();setError('');
      const people=draft.split('\n').filter(line => line.trim()).map(line => {const [name,...parts]=line.split(/[:：]/);return {name:name.trim(),aliases:parts.join(':').split(/[,、]/).map(a => a.trim()).filter(Boolean)};});
      if(people.some(p => p.name.length<2)){setError('人物名は2文字以上で入力してください。');return;}
      if(await action('people',{people})) {setEditing(false);onFilter('','');}
    }}><label htmlFor="person-dictionary-input">1行に「人物名: 別名1, 別名2」。人物名そのものも集計に使います。</label><textarea id="person-dictionary-input" value={draft} rows={8} onChange={e => setDraft(e.target.value)} placeholder="佐久間宣行: 佐久間, 佐久間P" /><p className="opinion-note">削除した行の人物は集計対象から外れます。AIによる別名の統一は誤る場合があります。修正後はAIを呼ばずに再集計し、要約は変更しません。現在の辞書：{stats?.source === 'manual' ? '手動' : 'AI作成'}</p>{error ? <p role="alert">{error}</p> : null}<Button disabled={working || running}>辞書を保存して再集計</Button></form> : null}
  </section>;
}

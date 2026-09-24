export const sentimentLabels: Record<string, string> = { positive: '肯定的', neutral: '中立', negative: '否定的' };
export const modelStanceLabels: Record<string, string> = { positive: '肯定', neutral: '中立', negative: '否定', mixed: '両方', unclear: '判定できず' };
export const ruleStanceLabels: Record<string, string> = { positive: '肯定', negative: '否定', mixed: '両方', unclear: '判定できず' };
export const emotionLabels: Record<string, string> = { joy: '喜び', anticipation: '期待', surprise: '驚き', trust: '信頼', sadness: '悲しみ', anger: '怒り', fear: '恐れ', disgust: '嫌悪', none: '目立つ感情なし' };

export function formatSeconds(value: number) {
  const h = Math.floor(value / 3600), m = Math.floor(value % 3600 / 60), s = value % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString('ja-JP', { year: 'numeric', month: 'numeric', day: 'numeric' }) : '不明';
}

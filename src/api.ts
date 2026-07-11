export const API_BASE = import.meta.env.DEV ? "" : (import.meta.env.VITE_API_BASE_URL ?? "");

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init
  });
  if (!response.ok) {
    const text = await response.text();
    try {
      const payload = JSON.parse(text) as { detail?: string };
      throw new Error(payload.detail || `HTTP ${response.status}`);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(text || `HTTP ${response.status}`);
      throw error;
    }
  }
  return response.json() as Promise<T>;
}

export function formatNumber(value?: number | null): string {
  return value == null ? "—" : new Intl.NumberFormat("ja-JP").format(value);
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}

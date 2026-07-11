import { formatBytes } from "../api";
import { DataSummary, SettingsInfo } from "../types";

type Props = {
  settings: SettingsInfo | null;
  data: DataSummary | null;
  busy: boolean;
  onClose: () => void;
  onDataAction: (action: "archive_youtube_cache" | "delete_youtube_cache") => void;
};

export function SettingsPanel({ settings, data, busy, onClose, onDataAction }: Props) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
        <header className="modal-header"><div><h2 id="settings-title">設定とデータ</h2><p>秘密値は表示せず、利用状態と保存容量だけを確認します。</p></div><button className="icon-button" type="button" aria-label="閉じる" onClick={onClose}>×</button></header>
        <div className="settings-list">
          <div><span>{settings?.youtube_api_key_env_name ?? "YOUTUBE_API_KEY"}</span><strong>{settings?.youtube_api_key_configured ? "設定済み" : "未設定"}</strong></div>
          <div><span>AI補助</span><strong>{settings?.llm_provider ?? "codex_app_server"}</strong></div>
          <div><span>分析run</span><strong>{data?.run_count ?? 0}件・{formatBytes(data?.runs.bytes ?? 0)}</strong></div>
          <div><span>YouTubeキャッシュ</span><strong>{data?.youtube_cache.file_count ?? 0}ファイル・{formatBytes(data?.youtube_cache.bytes ?? 0)}</strong></div>
          <div><span>AIキャッシュ</span><strong>{data?.llm_cache.file_count ?? 0}ファイル・{formatBytes(data?.llm_cache.bytes ?? 0)}</strong></div>
          <div><span>保存データ合計</span><strong>{formatBytes(data?.total_bytes ?? 0)}</strong></div>
        </div>
        <div className="danger-zone">
          <h3>キャッシュ管理</h3><p>通常は削除する必要はありません。退避するとarchiveへ移動します。</p>
          <div><button className="secondary-button" type="button" disabled={busy || !data?.youtube_cache.file_count} onClick={() => onDataAction("archive_youtube_cache")}>キャッシュを退避</button><button className="danger-button" type="button" disabled={busy || !data?.youtube_cache.file_count} onClick={() => onDataAction("delete_youtube_cache")}>キャッシュを削除</button></div>
        </div>
      </section>
    </div>
  );
}

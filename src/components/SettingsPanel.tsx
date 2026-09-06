import { useState } from "react";
import { formatBytes } from "../api";
import { DataSummary, SettingsInfo } from "../types";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { XIcon } from "lucide-react";

type Props = {
  settings: SettingsInfo | null;
  data: DataSummary | null;
  busy: boolean;
  open: boolean;
  onClose: () => void;
  onDataAction: (action: "archive_youtube_cache" | "delete_youtube_cache") => void;
};

export function SettingsPanel({ settings, data, busy, open, onClose, onDataAction }: Props) {
  const [pendingAction, setPendingAction] = useState<"archive_youtube_cache" | "delete_youtube_cache" | null>(null);
  const verb = pendingAction === "delete_youtube_cache" ? "削除" : "退避";
  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
        <DialogContent className="modal settings-modal" showCloseButton={false}>
        <DialogHeader className="modal-header"><div><DialogTitle>設定とデータ</DialogTitle><DialogDescription>秘密値は表示せず、利用状態と保存容量だけを確認します。</DialogDescription></div><DialogClose asChild><Button variant="secondary" size="icon" type="button" aria-label="閉じる"><XIcon /></Button></DialogClose></DialogHeader>
        <div className="settings-list">
          <div><span>{settings?.youtube_api_key_env_name ?? "YOUTUBE_API_KEY"}</span><strong>{settings?.youtube_api_key_configured ? "設定済み" : "未設定"}</strong></div>
          <div><span>AI分析</span><strong>{settings?.llm_provider ?? "codex_app_server"}</strong></div>
          <div><span>分析モデル</span><strong>{settings?.model} / {settings?.effort}</strong></div>
          <div><span>分析run</span><strong>{data?.run_count ?? 0}件・{formatBytes(data?.runs.bytes ?? 0)}</strong></div>
          <div><span>YouTubeキャッシュ</span><strong>{data?.youtube_cache.file_count ?? 0}ファイル・{formatBytes(data?.youtube_cache.bytes ?? 0)}</strong></div>
          <div><span>保存データ合計</span><strong>{formatBytes(data?.total_bytes ?? 0)}</strong></div>
        </div>
        <div className="danger-zone">
          <h3>キャッシュ管理</h3><p>通常は削除する必要はありません。退避するとarchiveへ移動します。</p>
          <div><Button variant="secondary" type="button" disabled={busy || !data?.youtube_cache.file_count} onClick={() => setPendingAction("archive_youtube_cache")}>キャッシュを退避</Button><Button variant="destructive" type="button" disabled={busy || !data?.youtube_cache.file_count} onClick={() => setPendingAction("delete_youtube_cache")}>キャッシュを削除</Button></div>
        </div>
        </DialogContent>
      </Dialog>
      <AlertDialog open={pendingAction != null} onOpenChange={(nextOpen) => { if (!nextOpen) setPendingAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader><AlertDialogTitle>YouTubeキャッシュを{verb}しますか？</AlertDialogTitle><AlertDialogDescription>{pendingAction === "delete_youtube_cache" ? "削除したキャッシュは元に戻せません。" : "キャッシュをarchiveへ移動します。"}</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>キャンセル</AlertDialogCancel><AlertDialogAction variant={pendingAction === "delete_youtube_cache" ? "destructive" : "default"} onClick={() => { if (pendingAction) onDataAction(pendingAction); }}>キャッシュを{verb}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

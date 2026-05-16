# トラブルシューティング

## 開発画面で `Failed to fetch` が出る

フロントエンドの Vite dev server が、起動時に古い API URL を JavaScript に埋め込んだまま残っていると、バックエンドを再起動しても画面上では API が落ちているように見えることがあります。

現在の開発構成では、フロントエンドは相対パス `/api` を呼び、Vite proxy が `http://127.0.0.1:8000` へ転送します。開発時は `VITE_API_BASE_URL` を使わず、次の順で確認してください。

1. バックエンドを `127.0.0.1:8000` で起動する。
2. フロントエンドを `bun run dev` で起動する。
3. Vite が表示した URL で `/api/health` を開き、`{"status":"ok"}` が返ることを確認する。

```bash
curl http://127.0.0.1:8000/api/health
curl http://127.0.0.1:<vite-port>/api/health
```

`data/app.sqlite3` を削除または初期化した場合は、古いバックエンドプロセスも再起動してください。SQLite 接続が削除前のファイルを掴んだままになることがあります。

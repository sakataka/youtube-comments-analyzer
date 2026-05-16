# 実装ロードマップ

この文書は [requirements.md](requirements.md) を基準に、まだ実装・検証・改善が残っている項目だけを残した backlog です。

完了済みの実装詳細はここには載せません。現状の使い方と実装済み機能は [../README.md](../README.md) を参照してください。

## 運用・設定・データ管理

### データ管理

- 古い run と cache を削除または退避できるようにする。

### ジョブ実行

- 同時実行ジョブ数 1 の queued 状態を実装する。
- 実行中に新しい job が来た場合の待機表示を実装する。
- サーバー再起動後に `running` のまま残った job を `failed_recoverable` にする。
- 本格的な worker / queue 分離を検討する。

## API / データモデルの残り

- `POST /api/videos/inspect` で必要に応じて動画 metadata を確認できるようにする。
- `appeal_labels` 相当の保存を実装する。
- `clusters` 相当の保存を実装する。
- LLM cache の DB 管理を、現在の `llm_assists` / file cache から要件上の汎用 `llm_cache` に寄せるか判断する。
- `normalized_comments.jsonl`、`aliases.json`、`clusters.json` artifact の出力方針を決める。

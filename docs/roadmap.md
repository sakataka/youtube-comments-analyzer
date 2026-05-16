# 実装ロードマップ

この文書は [requirements.md](requirements.md) を基準に、まだ実装・検証・改善が残っている項目だけを残した backlog です。

完了済みの実装詳細はここには載せません。現状の使い方と実装済み機能は [../README.md](../README.md) を参照してください。

## 現在の前提

- MVP-0 の基本フローは動作済み。
- 今回設定した Step 1 から Step 7 は完了済み。
- MVP-2 の高度分析は一旦保留。
- Codex app server 連携は最小実呼び出しで受信成功を確認済み。
- P0 の頻出語レビュー UI と degraded report は実装済み。
- 人物別魅力分析は実装済み。
- 共起・関係性分析は実装済み。
- コメントクラスタリングは特徴語ベースで実装済み。
- 運用・設定・データ管理の基本整理は実装済み。

## MVP-1: 分析品質

### 人物候補と alias

- `person`, `group`, `duo` 以外の entity type を折りたたみ・フィルタ表示する。
- alias 削除を UI から行えるようにする。
- 誤って統合された候補を分割できるようにする。
- LLM なしの初期検証動画で alias 誤爆を確認し、抑制ルールを追加する。
- confidence 表示を「候補信頼度」「alias 信頼度」「分類信頼度」など文脈別に整理する。

### 低信頼・曖昧コメント

- low confidence comments を一覧表示する。
- AI 判定と辞書判定が食い違ったコメントを表示する。
- 人間確認を推奨する項目をまとめる。
- LLM ambiguous classification の batch、retry、schema validation を実装する。

### 言及ランキング

- 上位 N コメント内での言及数を表示する。
- 複数人物同時言及数を表示する。
- 単独言及数を表示する。
- `raw_like_sum` と `like_weighted_score` を分けて表示する。
- 上位コメントの定義を UI または設定で確認できるようにする。

## MVP-2: 高度分析

MVP-2 は現時点では保留。ただし要件としては残す。

### 日本語解析

- 日本語形態素解析を導入する。
- 固有表現抽出モデルを検討する。
- 助詞・係り受けを使った alias 文脈判定を検討する。
- 人物ごとの特徴語を単純頻度だけでなく TF-IDF 的に重み付けする。

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

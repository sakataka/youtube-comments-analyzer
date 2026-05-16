# 実装ロードマップ

この文書は [requirements.md](requirements.md) を基準に、現在の実装状況を「完了」「一部完了」「未実装」に分けたものです。

## 現在の到達点

現在は MVP-1 の一部まで動く状態です。

```text
URL 入力
  -> video_id 抽出
  -> fixture または YouTube API でコメント取得
  -> コメント保存
  -> 簡易人物候補抽出
  -> 候補確認 UI
  -> accepted alias で分類
  -> 人物別ランキング表示
  -> 必要に応じて Codex app server 経由の LLM 補助分析
```

## 完了

### Phase 1: 基盤

- repo 初期化
- Bun + Vite + React + TypeScript の frontend 構成
- Python 3.14 + FastAPI の backend 構成
- FastAPI の `/api/health`
- SQLite 初期 schema
- YouTube URL parsing
- dummy comments fixture
- backend unit / integration test
- frontend build

### Phase 2: コメント取得の一部

- YouTube Data API v3 連携
- `commentThreads.list` によるトップレベルコメント取得
- 最大コメント数 `5000`
- `reply_fetch_mode=none`
- `fetch_order=relevance | time`
- live API 取得結果の cache 保存
- 同条件 cache の再利用
- `comment_snapshots` 保存
- raw comments artifact 保存

未完了部分は後述します。

### Phase 3: 候補抽出の一部

- コメント正規化
- ルールベースの簡易候補抽出
- 敬称つき表現、カタカナ表現、ハッシュタグ、漢字 + カタカナ表現の抽出
- alias 候補保存
- 候補確認 UI
- action-based candidate API
- 候補・alias の採用/除外
- display name 編集 UI
- alias 追加 UI
- タイトル・概要欄・ハッシュタグの列挙からの候補抽出
- タイトル上のフルネーム候補への短い表記の自動紐づけ
- 一般語・番組/企画名寄り候補の自動除外
- 自動紐づけの候補理由表示
- 表記ごとの集計除外操作
- 表記ごとの代表コメント本文表示
- 候補 merge 操作

### Phase 4: 分類・集計の一部

- accepted alias による辞書マッチ分類
- 同一コメント内の同一人物重複を 1 件扱い
- 人物別言及ランキング
- like weighted score `1 + log1p(like_count)`
- 人物別代表コメント
- `report.v1` JSON 生成
- LLM / embedding dependent section の `skipped` 表示
- run artifact として `mentions.jsonl` / `report.json` 保存

### README / setup

- 必要環境
- backend setup
- frontend setup
- `.env.example`
- 起動方法
- 最小動作確認
- cache 保存方針
- デモ手順

### Step 1: MVP-1 前の軽量リファクタリング

- `pipeline.py` から候補抽出ロジックを `candidate_extraction.py` に分離
- alias マッチと confidence を `mention_classification.py` に分離
- report JSON 組み立てと取得範囲 summary を `report_builder.py` に分離
- `pipeline.py` は SQLite schema、run orchestration、永続化 API を中心に整理
- 既存テストの対象 import を新しい責務境界に合わせて更新

### Step 2: Phase 6 inline subset

- `reply_fetch_mode=inline_subset` を追加
- `commentThreads.list` に同梱される返信コメントを保存
- 返信コメントを候補抽出・分類・レポート対象に含める
- 返信件数と返信 badge を UI に表示

### Step 3: MVP-1 未知 alias / ニックネーム候補

- コメント内のニックネームらしい語を未知 alias 候補として抽出
- 既存人物の accepted alias と同一コメント内で共起する候補に紐づけ先を提案
- UI から既存人物へ alias として追加し、再集計できる

### Step 4: MVP-1 LLM 候補整理・曖昧分類

- Codex app server 経由の LLM 補助分析 endpoint
- 候補整理、alias 補完案、曖昧コメント分類の JSON schema
- prompt version と入力 hash による LLM cache
- `llm_assists` table と `data/runs/<run_id>/llm_assist.json` artifact 保存
- LLM 補助分析 UI
- author 情報を LLM 入力に含めない prompt / input builder

### Step 5: Phase 7 過去分析一覧

- `GET /api/runs` の run summary に作成日時を追加
- 保存済み run の一覧 UI
- 過去 run を開いて候補・既存 report を復元する UI
- 取得 source、取得件数、返信モードを一覧で確認する表示

### Step 6: Phase 7 概要ダッシュボード・グラフ

- 概要ダッシュボード UI
- 採用人物数、紐づけ済みコメント数、未紐づけコメント数、トップ人物の summary
- 人物別言及数の横棒グラフ
- コメント分類比率の簡易グラフ
- 既存のいいね数分布グラフとランキングを同じ report 面に配置

## 状況詳細

### 動画・取得概要

完了:

- video URL
- video ID
- fetched_at
- fetched comment count
- top-level / reply count
- total like count
- fetch order
- reply fetch mode
- source fixture / cache / youtube_api
- cache / YouTube API / fixture の UI 表示
- cache 使用時の API 再消費なし表示
- 取得不足の UI 表示
- 取得エラーの API response 整理
- live metadata の UI 表示強化
- YouTube 上の comment count availability
- いいね数分布
- API で全件取得できない場合の詳細表示強化

未完了:

- なし

### 人物候補と alias

完了:

- display name
- entity_type
- alias list
- alias hit count
- representative comment IDs
- confidence
- status
- reason
- 採用/除外操作
- コメント単位で「このコメントはこの人物に紐づける」を修正するレビュー UI
- alias ごとの代表コメント本文表示
- 表記ゆれ統合 UI
- merge 操作

後続改善:

- `person`, `group`, `duo` 以外の折りたたみ表示

### コメント取得

完了:

- `commentThreads.list`
- max comments `5000`
- `reply_fetch_mode=none`
- `reply_fetch_mode=inline_subset`
- `commentThreads.list` に同梱される返信コメントの保存
- 返信コメントを候補抽出・分類・レポート対象に含める
- 返信コメントの UI 表示
- cache
- 取得エラーの UI 表示
- 取得済みコメント一覧表示

後続フェーズへ移動:

- `reply_fetch_mode=full`
- `comments.list` による返信 full 取得
- 差分更新

### レポート UI

完了:

- 候補確認
- 言及ランキング
- 代表コメント
- section status
- 人物別詳細画面
- 人物別の集計表記表示
- 人物別の特徴語表示
- コメント一覧・検索画面
- 人物フィルタ
- 未紐づけコメント表示
- コメント単位の人物紐づけ追加・解除
- 手動紐づけ修正後のランキング再生成
- 未知 alias / ニックネーム候補サジェスト
- 未知 alias 候補を既存人物へ追加して再集計する UI
- LLM 補助分析
- LLM による候補整理の提案表示
- LLM による alias 補完案の表示
- LLM による曖昧コメント分類の表示
- 過去分析一覧画面
- 過去分析からの候補・レポート再表示
- 概要ダッシュボード
- グラフ表示

後続フェーズへ移動:

- 設定画面

## 未実装

### Phase 5: MVP-0 追加改善

MVP-0 の必須 vertical slice は完了済み。次に残す場合は、分析精度や運用性を上げる追加改善として扱う。

- `person`, `group`, `duo` 以外の entity type を折りたたむ表示
- LLM なしの初期検証動画での alias 誤爆確認
- confidence 表示の整理
- 上位コメントの人間確認 workflow

### Phase 6: 返信・再取得

YouTube API quota 消費が増えるため、cache と取得概要 UI が安定してから扱う。

- `reply_fetch_mode=full`
- `comments.list` による返信 full 取得
- 差分更新

### Phase 7: レポート UI 拡張

分析結果を見やすくする拡張であり、MVP-0 の分類・集計成立条件ではない。

- 概要ダッシュボード
- 過去分析一覧画面
- 設定画面
- グラフ表示

### MVP-1: LLM あり分析

完了:

- コメント内のニックネームらしい語のサジェスト
- 説明欄・タイトルにない表記の人物紐づけ候補提示
- 既存人物に対する未知 alias のデルタ分析
- LLM による候補整理
- LLM による alias 候補補完
- 曖昧コメント分類
- LLM cache
- prompt version / schema version / input hash による再利用

未実装:

- 頻出語を「人物候補」「alias 候補」「一般語」「要確認」に分けるレビュー UI
- 魅力カテゴリ分類
- 人物別要約
- low confidence comments 表示
- LLM 失敗時の部分 degraded report

## 次に進める順番

1. Phase 6: `reply_fetch_mode=full`
2. Phase 6: 差分更新

MVP-2 の高度分析は一旦保留です。

### MVP-2: 高度分析

- embedding
- コメントクラスタリング
- 日本語形態素解析
- 固有表現抽出
- 助詞・係り受けを使った alias 文脈判定
- クラスタ名生成
- 共起ネットワーク
- 関係性分析
- 差分更新
- 返信コメント full 取得
- 低信頼レビュー画面

### 分析品質

- 日本語形態素解析
- 固有表現抽出モデル
- alias 誤爆抑制の高度化
- グループ、番組名、企画名、ファン名の扱い強化
- 上位 50 コメントの人間確認 workflow
- confidence の UI 表示整理

### セキュリティ / プライバシー

- LLM 送信前の author 情報除外処理
- 生データ export の明示操作
- API key 表示抑止の UI
- live test と通常 test の分離強化

## 次にやるなら

優先順位は次の順です。

1. LLM なしの MVP-0 を初期検証動画で人間確認し、alias 誤爆を修正する。
2. MVP-1 の LLM 候補整理、曖昧コメント分類、人物別要約へ進む。
3. Phase 7 の過去分析一覧、概要ダッシュボード、グラフへ進む。
4. Phase 6 の full 返信取得と差分更新へ進む。

## 完了判定

MVP-0 は要求仕様書上の vertical slice と usable review flow を満たす状態です。追加改善として次はまだ余地があります。

- 主要人物候補の自動抽出精度
- ユーザーが 1 分以内に候補確認を終えられる UI
- entity_type ごとの折りたたみ
- LLM による曖昧候補整理

そのため、現状は `MVP-0 usable review flow complete`、次の目標は `MVP-1 LLM-assisted analysis` とします。

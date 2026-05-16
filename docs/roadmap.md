# 実装ロードマップ

この文書は [requirements.md](requirements.md) を基準に、現在の実装状況を「完了」「一部完了」「未実装」に分けたものです。

## 現在の到達点

現在は MVP-0 の vertical slice が動く状態です。

```text
URL 入力
  -> video_id 抽出
  -> fixture または YouTube API でコメント取得
  -> コメント保存
  -> 簡易人物候補抽出
  -> 候補確認 UI
  -> accepted alias で分類
  -> 人物別ランキング表示
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

## 一部完了

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

未完了:

- live metadata の UI 表示強化
- YouTube 上の comment count availability
- いいね数分布
- API で全件取得できない場合の詳細表示

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

未完了:

- alias ごとの代表コメント本文表示
- 表記ゆれ統合 UI
- merge 操作
- `person`, `group`, `duo` 以外の折りたたみ表示

### コメント取得

完了:

- `commentThreads.list`
- max comments `5000`
- `reply_fetch_mode=none`
- cache

未完了:

- `reply_fetch_mode=inline_subset`
- `reply_fetch_mode=full`
- `comments.list` による返信 full 取得
- 取得エラーの UI 表示
- 取得済みコメント一覧表示
- 差分更新

### レポート UI

完了:

- 候補確認
- 言及ランキング
- 代表コメント
- section status
- コメント一覧・検索画面
- 人物フィルタ
- 未紐づけコメント表示
- コメント単位の人物紐づけ追加・解除
- 手動紐づけ修正後のランキング再生成

未完了:

- 概要ダッシュボード
- 人物別詳細画面
- 過去分析一覧画面
- 設定画面
- グラフ表示

## 未実装

### MVP-1: LLM あり分析

- LLM による候補整理
- LLM による alias 候補補完
- 曖昧コメント分類
- 魅力カテゴリ分類
- 人物別要約
- low confidence comments 表示
- LLM cache
- prompt version / schema version / input hash による再利用
- LLM 失敗時の部分 degraded report

### MVP-2: 高度分析

- embedding
- コメントクラスタリング
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
- 人物候補 merge
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

1. 候補確認 UI に merge を追加する。
2. 取得エラーと cache 利用状況を UI に明示する。
3. 人物別詳細画面で特徴語と代表コメントを表示する。
4. LLM なしの MVP-0 を一度初期検証動画で人間確認し、alias 誤爆を修正する。
5. その後に MVP-1 の LLM 候補整理と曖昧コメント分類へ進む。

## 完了判定

MVP-0 は「技術的には通る」状態です。ただし要求仕様書上の MVP-0 完了条件のうち、次はまだ改善余地があります。

- 主要人物候補の自動抽出精度
- ユーザーが 1 分以内に候補確認を終えられる UI
- 代表コメントの見やすさ
- コメント単位の紐づけ修正

そのため、現状は `MVP-0 vertical slice complete`、次の目標は `MVP-0 usable review flow complete` とします。

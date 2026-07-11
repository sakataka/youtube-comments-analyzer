# YouTube コメント人物言及分析ツール 要求仕様書

## 1. 背景

YouTube の動画コメント欄には、動画そのものへの反応だけでなく、出演者、ゲスト、MC、グループメンバー、過去回の関係者、ファン内で共有されているニックネームなどへの言及が大量に含まれる。

人間が人気コメントを数十件読むと「この人への反応が多い」「この人はこういう魅力として受け取られている」という感覚は得られる。しかし、コメントが数百件から数千件になると、以下を手作業で把握するのは難しい。

- 誰に対する言及が多いか
- どの表記ゆれ、愛称、ニックネームで呼ばれているか
- 単純な言及数と、いいね数の多いコメントでの存在感が一致しているか
- どの人物が、どの人物との関係性で語られているか
- 各人物の魅力が、コメント上でどのような言葉として現れているか
- 動画内容を事前に知らない状態でも、コメントだけから主要な言及対象を推定できるか

本ツールは、任意の YouTube 動画 URL を入力し、取得したコメントをもとに、コメント欄で言及されている人物・グループ・関係者を抽出し、人物別の言及量、表記ゆれ、共起関係、魅力として語られている内容を分析・可視化するローカル Web アプリである。

### 1.1 現行実装契約（report.v2）

現行 UI は、人物候補の確認を待たずに暫定レポートを先に表示する。レポートの主表示は `概要 / 人物 / 話題・共起 / コメント` の4領域とし、候補・alias・低 confidence コメント・対象別感情の修正は任意のレビューセンターへ集約する。

感情は動画全体と人物別を分け、`positive / neutral / negative / mixed / unclear` を保存する。明示的な評価語と否定表現は再現可能なルールで処理し、曖昧な文脈だけを Codex app server の補助判定対象にする。AI が失敗した場合もルール結果を暫定レポートとして利用できる。

`report.v2` は集計、確度、判定 method、根拠コメント ID を返す。コメント本文の全件配列は含めず、`GET /api/runs/{run_id}/comments` からページング取得する。既存 `report.v1` run は保存済みコメントと人物割り当てから v2 へ再計算し、元データを削除しない。

## 2. 目的

### 2.1 ユーザーが知りたいこと

ユーザーは、特定の YouTube 動画について次を知りたい。

- コメント欄では誰への言及が多いのか
- 出演者のうち、誰がどのような文脈で評価されているのか
- その人の「魅力」はコメント上でどのように表現されているのか
- 上位コメントだけを見た印象と、全体コメントの傾向は一致しているのか
- グループメンバー、MC、ゲスト、比較対象など、動画内外の人物がどう語られているのか
- ニックネームや略称も含めて、できるだけ手間なく分類できるか

### 2.2 ツールとしての到達点

本ツールは、単なるワードクラウドや感情分析ではなく、以下を満たすことを目指す。

- 動画内容を知らなくても、コメントから人物候補を推定できる
- 人物候補と alias は、軽い人間確認で修正できる
- ルール・辞書・統計で機械的に拾えるものはまず機械処理する
- 曖昧なコメントだけ AI に判定させる
- 最終的な分析結果は、根拠コメント・件数・信頼度と一緒に表示する
- Web UI 上でグラフ、ランキング、人物別レポート、代表コメントを確認できる

## 3. 基本方針

### 3.1 AI 任せにしない

全コメントをそのまま LLM に渡して「誰が多いか」を聞く設計にはしない。理由は以下。

- 件数集計の再現性が低い
- alias やニックネームの扱いが曖昧になりやすい
- どのコメントを根拠にしたか追跡しにくい
- 同じ動画を再分析したときに結果が揺れやすい
- コストが上がりやすい

AI は、候補抽出、alias 補完、曖昧コメントの分類、人物別要約に使う。件数集計、正規化、共起分析、代表コメント抽出、可視化用データ生成は Python 側で行う。

### 3.2 人間確認は最小限許容する

人物候補や alias を完全自動で確定しようとすると、誤分類のリスクが高い。特に日本語のコメント欄では、以下のような表記が混在する。

- 本名
- 芸名
- 苗字のみ
- 名前のみ
- 敬称つき
- ちゃん付け
- ファン内の愛称
- 略称
- 誤字
- カタカナ、ひらがな、漢字の混在
- 文脈上の「あの子」「この人」

そのため、MVP では人物候補と alias 候補を UI に出し、ユーザーが採用、除外、編集できるようにする。ただし、この確認作業は分析開始前の短いチェックに留める。

### 3.3 動画内容を知らない前提で設計する

入力は基本的に YouTube URL とコメントである。動画の映像・音声・字幕を必須入力にしない。

ただし、将来的には動画タイトル、概要欄、字幕、チャプター、サムネイル OCR、外部検索結果を補助情報として使える設計にする。

MVP では、コメント、動画タイトル、概要欄を主入力とする。

### 3.4 コメント欄の受け取られ方を分析する

本ツールが分析するのは、動画に実際に誰がどれだけ登場したかではなく、コメント欄で誰がどう語られているかである。

そのため、動画に登場していない人物でも、コメント欄で頻出するなら候補として扱う。逆に、動画に登場していてもコメントでほとんど語られていない人物は低い言及量として扱う。

## 4. 対象ユースケース

### 4.1 想定する動画

- アイドルグループ、タレント、芸人、YouTuber など複数人が出演する動画
- MC とゲストが存在するバラエティ動画
- グループメンバーが 5 人から 10 人程度いる動画
- コメントが数百件から数千件ある動画
- ファン内の愛称や文脈依存の呼び方が多い動画

### 4.2 初期検証対象

初期検証では、次の動画を想定する。

```text
https://www.youtube.com/watch?v=vlpLbiqNhLo
```

検索結果上では、佐久間宣行の NOBROCK TV の `DRAW♡ME` 関連動画であり、タイトルには次の人物が含まれる。

- みりちゃむ
- 福留光帆
- 森脇梨々夏
- 風吹ケイ
- 立野沙紀
- 二瓶有加

また、コメント文脈では次の人物も候補になりうる。

- 佐久間宣行 / 佐久間さん
- ニシダ / ニシちゃん
- その他、コメント欄で頻出する関係者、比較対象、過去回出演者

この初期検証動画に最適化しすぎず、任意動画で動く汎用設計にする。

実装上の禁止事項:

- 初期検証動画の人物名をコードにハードコードしない
- 特定チャンネル専用の alias 辞書を初期実装に入れない
- 検証用データに初期検証動画の人物名を含める場合は `fixtures/` 配下の seed data として分離する
- 本番処理と fixture 依存の期待値を混ぜない

想定 fixture:

```text
fixtures/
  sample_comments_drawme.jsonl
  expected_aliases_drawme.json
```

## 5. レポート要件

### 5.1 レポート全体構成

Web UI で表示するレポートは、以下のセクションを持つ。

1. 動画・取得概要
2. 人物候補と alias
3. 言及ランキング
4. 人物別魅力分析
5. 共起・関係性分析
6. コメントクラスタ
7. 曖昧・低信頼分類
8. 生データ確認

ただし、すべてを最初の MVP-0 で実装しない。セクションごとに実装段階を分ける。

- MVP-0: 動画・取得概要、人物候補と alias、言及ランキング、生データ確認の最小版
- MVP-1: 人物別魅力分析、曖昧・低信頼分類、AI 要約
- MVP-2: 共起・関係性分析、コメントクラスタ、高度なレビュー画面

レポート JSON では、各セクションが利用可能かどうかを明示する。

```json
{
  "sections": {
    "mention_ranking": { "status": "available" },
    "appeal_summary": {
      "status": "skipped",
      "reason": "LLM is disabled"
    },
    "clusters": {
      "status": "skipped",
      "reason": "Embeddings are disabled"
    }
  }
}
```

`status` は次のいずれかとする。

- `available`: 表示可能
- `skipped`: 設定または MVP 段階により実行しなかった
- `failed`: 実行したが失敗した

### 5.2 動画・取得概要

表示項目:

- 動画 URL
- 動画 ID
- 動画タイトル
- チャンネル名
- コメント取得日時
- 取得コメント数
- 取得対象範囲
- トップレベルコメント数
- 返信コメント数
- コメントの総いいね数
- いいね数分布
- 分析ステータス

注意:

- YouTube API の都合で全コメントを取得できない場合は、その旨を明示する。
- ソート順、取得件数、返信を含めたかどうかを表示する。

### 5.3 人物候補と alias

人物候補ごとに以下を表示する。

- 表示名
- 種別
  - 出演者
  - グループ
  - MC
  - ゲスト
  - 関係者
  - 比較対象
  - 不明
- alias 一覧
- alias ごとのヒット件数
- alias ごとの代表コメント
- AI による候補理由
- 採用状態
  - 採用
  - 除外
  - 保留

候補の種別は人物だけに限定しない。コメント欄では番組名、チャンネル名、グループ名、企画名、ファン名、コンビ名なども頻出するため、内部的には `entity_type` として扱う。

`entity_type`:

- `person`
- `group`
- `duo`
- `channel`
- `show`
- `project`
- `fan_group`
- `unknown`

初期表示では `person`, `group`, `duo` を優先し、それ以外は折りたたみまたはフィルタ対象にする。

最終的に提供したいユーザー操作:

- 人物候補の採用
- 人物候補の除外
- 表示名の編集
- alias の追加
- alias の削除
- 複数候補の統合
- 誤って統合された候補の分割

MVP-0 の候補確認 UI では操作を絞る。

- candidate の `accepted` / `rejected` / `pending` 切り替え
- alias の `accepted` / `rejected` / `pending` 切り替え
- alias 追加
- 表示名編集

人物統合・分割は MVP-1 以降とする。

### 5.4 言及ランキング

人物別に以下のランキングを表示する。

- 単純言及コメント数
- コメント全体に対する言及率
- いいね加重スコア
- 上位コメント内での言及数
- 返信を含めた言及数
- 複数人物同時言及数
- 単独言及数

集計は以下を分ける。

- コメント単位の言及数
- alias 出現回数
- いいね加重
- 上位 N 件コメント内の言及

同じコメント内で同一人物の alias が複数回出ても、コメント単位では 1 件として扱う。

MVP における上位コメント:

- 取得済みトップレベルコメントを `like_count` 降順に並べた上位 N 件
- N の初期値は 50
- YouTube UI の人気順とは一致しない可能性がある
- API の `order=relevance` で取得した順序は `api_relevance_order` として別保存する

いいね加重スコア:

```text
comment_weight = 1 + log1p(like_count)
person_like_weighted_score = sum(comment_weight for comments mentioning person)
cooccurrence_like_weighted_score = sum(comment_weight for comments mentioning both persons)
```

レポートでは `raw_like_sum` と `like_weighted_score` を分けて表示する。

```json
{
  "person_id": "person_001",
  "mention_comment_count": 123,
  "raw_like_sum": 4567,
  "like_weighted_score": 312.4
}
```

### 5.5 人物別魅力分析

人物ごとに以下を表示する。

- 言及数
- 主な alias
- よく一緒に出る単語
- よく一緒に出る人物
- 魅力カテゴリ別件数
- 代表コメント
- AI による要約
- AI 要約の根拠コメント
- 信頼度

魅力カテゴリの初期案:

- かわいい
- 面白い
- トーク力
- ツッコミ
- リアクション
- 表情
- キャラクター
- 関係性
- 成長・努力
- 感動
- ビジュアル
- 歌・ダンス・パフォーマンス
- 企画適性
- その他

カテゴリは固定しすぎず、MVP-1 以降でコメント内容から追加候補を出せる設計にする。

魅力カテゴリとは別に、コメントの文脈・トーンを持つ。

`tone`:

- `positive`
- `neutral`
- `mixed`
- `negative`
- `unclear`

レポートでは negative を過度に強調しない。一定件数以上ある場合のみ、人物別詳細の「注意点」として根拠コメントつきで控えめに表示する。

### 5.6 共起・関係性分析

表示する分析:

- 人物 A と人物 B が同じコメントで出る回数
- 共起のいいね加重
- 共起コメントの代表例
- 共起関係の説明
- 関係性カテゴリ

関係性カテゴリ例:

- 掛け合い
- いじり / いじられ
- MC との絡み
- コンビ感
- 比較
- 対比
- グループ全体
- 企画上の対立
- 過去回参照

可視化:

- 共起ネットワーク
- 人物 x 人物のヒートマップ
- 関係性別フィルタ

### 5.7 コメントクラスタ

コメントを embedding または特徴量でクラスタリングし、以下を表示する。

- クラスタ名
- 件数
- 代表コメント
- 含まれる主な人物
- 頻出キーワード
- いいね加重
- AI によるクラスタ説明

クラスタ例:

- 特定人物のリアクションを褒めるコメント
- MC との掛け合いを評価するコメント
- グループ全体への期待
- 告知への反応
- 過去回・外部文脈への言及
- 企画そのものへの感想

### 5.8 曖昧・低信頼分類

以下を表示する。

- 人物推定が低信頼のコメント
- 複数人物のどちらを指すか曖昧なコメント
- alias 候補だが未確定の語
- AI 判定と辞書判定が食い違ったコメント
- 人間確認を推奨する項目

このセクションは、分析結果の品質を上げるための確認画面として使う。

## 6. 推奨アーキテクチャ

### 6.1 全体構成

```text
Web Frontend / TypeScript
  |
  | HTTP API
  v
Local API Server / Python FastAPI
  |
  | MVP: single background asyncio task
  v
Analysis Pipeline / Python
  |
  +-- YouTube Data API
  +-- LLM API
  +-- Embedding API or local embedding model
  |
  v
SQLite + JSONL + report JSON
```

MVP のジョブ実行方式:

- FastAPI 起動プロセス内の background `asyncio` task として実行する
- 同時実行ジョブ数は 1
- 実行中に新しいジョブが来た場合は `queued` にする
- `analysis_runs` に `status`, `stage`, `progress`, `error_message` を保存する
- サーバー再起動後に `running` のまま残っている job は `failed_recoverable` にする

本格的な外部 queue、worker process、subprocess 分離は MVP-1 以降で検討する。

### 6.2 フロントエンド

推奨:

- TypeScript
- Vite
- React
- グラフライブラリは ECharts 系を推奨

理由:

- ローカル Web UI として扱いやすい
- グラフ、表、タブ、フィルタ、詳細展開を作りやすい
- 将来的に LocalWeb のポータルからリンクしやすい
- 分析結果 JSON をそのまま表示しやすい

主な画面:

- 分析開始画面
- ジョブ進捗画面
- 人物候補確認画面
- レポート概要画面
- 人物別詳細画面
- コメント一覧・検索画面
- 過去分析一覧画面
- 設定画面

### 6.3 バックエンド

推奨:

- Python
- FastAPI
- Uvicorn
- SQLite
- pandas
- scikit-learn

理由:

- 日本語テキスト処理、統計処理、クラスタリング、集計に強い
- LLM API や embedding API と連携しやすい
- Web UI からジョブを起動しやすい
- 分析ロジックを Python 側に寄せることで、フロントを表示責務に集中できる

### 6.4 Node/Bun の位置づけ

フロントエンドの開発・ビルドには Node.js LTS と npm を初期選択にする。分析処理は Python に寄せる。

Node/Bun だけで YouTube コメント取得から分析まで行う案も可能だが、以下の理由で MVP では採用しない。

- pandas 相当の処理が Python より書きにくい
- scikit-learn や embedding 後のクラスタリング処理が Python の方が安定している
- 日本語処理や可視化用前処理も Python の方が選択肢が多い

### 6.5 実行方式

ローカルアプリとして起動する。

開発時:

```text
Frontend dev server: Vite
Backend API server: FastAPI
```

本番ローカル運用:

```text
Backend が静的ビルド済み frontend を配信
または
LocalWeb から frontend URL にリンク
```

一時的なデバッグサーバーを起動する場合は、固定ポートにこだわらず、可能なら port 0 または自動割り当てを使う。起動後に実際の URL を確認して使用し、不要になったら Codex が起動したサーバーだけ終了する。

## 7. データフロー

### 7.1 初回分析フロー

```text
1. ユーザーが YouTube URL を入力
2. バックエンドが video_id を抽出
3. YouTube メタデータを取得
4. コメントを取得して保存
5. コメントを正規化
6. 頻出語、固有名詞、敬称つき表現、カタカナ表現を抽出
7. LLM で人物候補と alias 候補を生成
8. フロントに候補確認 UI を表示
9. ユーザーが採用・除外・編集
10. 辞書マッチで一次分類
11. 低信頼・曖昧コメントを LLM で分類
12. Python で集計、共起、クラスタリング
13. LLM で人物別魅力要約を生成
14. report JSON を生成
15. Web UI でレポート表示
```

MVP-0 では 7, 11, 12 のクラスタリング部分, 13 を実行しない。LLM と embedding を使わず、ルールベース候補抽出、候補確認、accepted alias による deterministic な分類、ランキング表示までを完成させる。

### 7.2 再分析フロー

過去に取得済みのコメントがある場合、コメント取得を省略して再分析できる。

再分析で変更可能なもの:

- alias 辞書
- 採用人物
- 魅力カテゴリ
- 上位コメントの定義
- いいね加重の計算式
- AI 分類の対象範囲
- クラスタ数

再分析時の基本ルール:

- コメント取得結果は `comment_snapshot_id` で固定する
- alias や採用人物を変更した場合、該当 run の `comment_mentions` と report は再生成する
- like_count を更新したい場合は、新しい comment snapshot を作る
- LLM 結果は `model`, `prompt_version`, `schema_version`, `input_hash` が一致する場合だけ再利用する
- report JSON の旧版は消さず、analysis run ごとに残す

### 7.3 差分更新フロー

将来的には、同じ動画の新規コメントだけを取得して分析を更新できるようにする。

MVP では必須ではないが、DB 構造は差分更新を妨げない形にする。

## 8. コメント取得

### 8.1 取得方法

公式の YouTube Data API v3 を優先する。

利用する主な API:

- `commentThreads.list`
- 必要に応じて `comments.list`
- `videos.list`

`commentThreads.list` はトップレベルコメントのスレッドを取得する。返信コメントを完全に取得したい場合は `comments.list` が必要になる。

### 8.2 取得パラメータ

初期案:

- `part=snippet,replies`
- `videoId=<video_id>`
- `maxResults=100`
- `textFormat=plainText`
- `order=relevance` または `order=time`
- ページングして最大 N 件まで取得

MVP の初期上限:

- トップレベルコメント最大 1000 件
- 返信コメントは初期 `reply_fetch_mode=none`

返信取得モードは boolean ではなく enum にする。

`reply_fetch_mode`:

- `none`: 返信は取得しない
- `inline_subset`: `commentThreads.list` の `replies` に含まれる分だけ保存する
- `full`: `comments.list` で全返信を取得する

`commentThreads.list` の `replies` は全返信とは限らないため、全件取得が必要な場合だけ `full` を使う。

取得設定として必ず保存する。

- fetch_order: `time` または `relevance`
- max_comments_requested
- max_comments_fetched
- reply_fetch_mode
- include_replies は使わず、reply_fetch_mode に統一する
- fetched_top_level_count
- fetched_reply_count
- total_reply_count_from_threads

### 8.3 保存するコメント属性

コメントごとに保存する。

- comment_id
- parent_comment_id
- video_id
- author_display_name
- author_channel_id
- text_original
- text_normalized
- like_count
- published_at
- updated_at
- is_reply
- reply_count
- source_order
- api_relevance_order
- comment_snapshot_id
- fetched_at

### 8.4 注意点

- コメントが無効化されている動画がある
- YouTube API の quota がある
- 取得順と YouTube UI 上の人気順が一致しない場合がある
- API で取得できるコメントと画面上の表示が完全一致しない場合がある
- 削除済み、保留、スパム判定済みコメントは取得できない場合がある

### 8.5 YouTube URL parsing

対応する URL:

- `https://www.youtube.com/watch?v=vlpLbiqNhLo`
- `https://youtu.be/vlpLbiqNhLo`
- `https://www.youtube.com/shorts/vlpLbiqNhLo`
- `https://www.youtube.com/embed/vlpLbiqNhLo`
- `https://www.youtube.com/watch?v=vlpLbiqNhLo&t=10s`
- `https://www.youtube.com/watch?v=vlpLbiqNhLo&list=...`

不正ケース:

- video_id が 11 文字でない
- URL ではない
- playlist URL だけで video_id がない
- YouTube 以外の URL

URL parsing は unit test で固定する。

## 9. 分析パイプライン

### 9.1 正規化

最低限の正規化:

- Unicode 正規化
- 全角・半角の揺れ吸収
- 大文字・小文字の揺れ吸収
- 連続空白の整理
- URL の抽象化
- 絵文字の扱いを統一
- `さん`、`ちゃん`、`くん` など敬称を alias 解析で扱いやすくする

注意:

- 原文は必ず保持する
- 表示用には原文を使う
- 分析用に正規化テキストを別途持つ

### 9.2 人物候補抽出

入力:

- 動画タイトル
- 動画概要欄
- コメント本文
- 上位いいねコメント
- 頻出 n-gram

抽出候補:

- 日本語人名らしい表現
- カタカナ名
- 英字名
- 敬称つき語
- ハッシュタグ
- `ちゃん`、`さん`、`くん`、`氏` が付く語
- タイトルに含まれる人物名
- コメント中で繰り返し出る固有表現

抽出方法:

- ルールベース
- n-gram 頻度
- 日本語形態素解析または簡易 tokenization
- LLM による候補整理

MVP では高度な固有表現抽出モデルに依存しすぎない。コメント欄では愛称や崩れた表記が多いため、LLM と人間確認の併用を前提にする。

### 9.3 alias 辞書生成

人物候補ごとに alias 候補を生成する。

生成元:

- タイトル上の正式名
- コメント中の頻出表記
- 敬称つき表記
- ひらがな・カタカナ表記
- 苗字のみ
- 名前のみ
- ファン内愛称らしき語
- LLM 推定

alias ごとに以下を保存する。

- alias_text
- normalized_alias
- candidate_person_id
- hit_count
- confidence
- source
  - title
  - description
  - comment_frequency
  - llm
  - user
- status
  - accepted
  - rejected
  - pending

alias 採用ルール:

- 1 文字 alias は default rejected
- ひらがな 2 文字 alias は default pending
- カタカナ 2 文字 alias は default pending
- 漢字 2 文字以上、カタカナ 3 文字以上、英字 3 文字以上は accepted 候補
- 敬称つき alias は敬称なし alias と別に `hit_count` を持つ
- 一般名詞 stoplist に含まれる alias は pending
- 同じ `normalized_alias` が複数 entity に紐づく場合は `ambiguous_alias` として扱う
- pending alias は自動分類には使わず、候補確認 UI にだけ出す
- `ちゃん`, `さん`, `くん`, `氏` など敬称単独は alias にしない

### 9.4 一次分類

採用済み alias 辞書を使って、各コメントを人物に紐付ける。

保存する分類情報:

- comment_id
- person_id
- matched_alias
- match_method
- confidence
- evidence_span

ルール:

- 同一コメントで同一人物が複数 alias で出ても人物言及は 1 件
- 複数人物が出る場合は全員に紐付ける
- alias が短すぎる場合は誤爆防止ルールを設ける
- 一文字 alias は原則禁止または低信頼にする
- 一般名詞と衝突する alias は人間確認必須にする

alias match priority:

1. accepted alias の完全一致
2. 敬称付き pattern の一致
3. normalized alias の一致
4. pending alias は分類には使わず、候補確認 UI にだけ出す

`match_method`:

- `alias_exact`
- `alias_normalized`
- `alias_honorific`
- `llm_inferred`
- `user_corrected`

日本語には英語のような明確な単語境界がないため、MVP では regex ベースでよいが、短い alias は上記ルールで抑制する。コメント 1000 件程度では Aho-Corasick 等の高速化は必須ではない。

### 9.5 曖昧コメントの LLM 分類

LLM に送る対象:

- alias がなくても人物を指していそうなコメント
- `あの子`、`この人`、`あれ` など指示語があるコメント
- 複数人物のどちらを指すか曖昧なコメント
- 辞書マッチしたが alias が短く誤爆しやすいコメント
- 魅力カテゴリ分類が必要なコメント

LLM 出力は必ず JSON schema で受ける。

LLM ambiguous classification の実行契約:

- 1 batch は最大 30 comments
- 入力には `comment_id`, `text_original`, `matched_alias` 候補, candidate entities のみ含める
- `author_display_name`, `author_channel_id`, `published_at`, `updated_at` は送らない
- JSON schema validation に失敗したら最大 2 回 retry
- retry 失敗時は該当コメントを `low_confidence_unclassified` に入れる
- LLM が失敗しても、LLM 任意の run では report 全体を failed にしない
- LLM 必須設定の run で候補抽出自体が失敗した場合のみ failed にする

出力例:

```json
{
  "comment_id": "abc",
  "mentions": [
    {
      "person_id": "person_001",
      "confidence": 0.82,
      "reason": "ニックネームと文脈から該当人物への言及と判断",
      "evidence": "ニシちゃんとの絡み"
    }
  ],
  "appeal_categories": ["関係性", "面白い"],
  "uncertain": false
}
```

LLM を使わない場合:

- 人物候補抽出はルールと頻度ベースで行う
- alias 候補整理は LLM 由来の候補をスキップする
- 曖昧コメント分類は実行しない
- 人物別魅力要約は `skipped` にする
- run は completed 扱いにし、report の該当 sections に skipped reason を入れる

### 9.6 共起分析

人物ペアごとに集計する。

- 同時言及コメント数
- いいね加重
- 代表コメント
- 関係性カテゴリ

共起は、コメント単位で計算する。返信スレッド単位の共起は将来拡張とする。

### 9.7 キーワード分析

人物ごとに、その人物へ言及したコメント集合から頻出語を抽出する。

出すべきもの:

- 頻出単語
- 頻出フレーズ
- 魅力カテゴリごとの単語
- 他人物名を除いた特徴語
- 全体コメントと比べて相対的に多い語

単純頻度だけでなく、人物ごとの特徴語として TF-IDF 的な重みも使う。

### 9.8 クラスタリング

コメントを embedding してクラスタリングする。

クラスタリングは MVP-2 に回す。MVP-0/MVP-1 では、人物別特徴語と代表コメントを先に完成させる。

MVP-2 では以下のどちらか。

- OpenAI embeddings を使う
- sentence-transformers 等のローカル embedding を使う

クラスタリング方法:

- KMeans
- HDBSCAN
- 階層クラスタリング

MVP-2 の初期実装では KMeans で十分。クラスタ数は自動推定または 5 から 12 程度の固定候補から選ぶ。

対象コメント:

- `text_normalized` が 5 文字以上
- URL のみ、絵文字のみ、定型告知は除外

クラスタ数の初期値:

```text
cluster_count = min(8, max(3, sqrt(comment_count / 20)))
```

UI では 5 から 12 の範囲で変更可能にする。

クラスタごとに以下を出す。

- 件数
- 代表コメント
- 主な人物
- 特徴語
- AI によるクラスタ名

クラスタ代表コメント:

- クラスタ中心に近い
- like_count が高い
- 短すぎない
- 同じ author に偏らない。ただし author 情報は LLM へ送らない。

### 9.9 人物別魅力要約

最後に LLM で人物別の要約を生成する。

入力:

- 人物名
- alias
- 言及数
- 特徴語
- 魅力カテゴリ別件数
- 代表コメント
- 共起人物
- 曖昧さ情報

出力:

- 一文サマリ
- 詳細要約
- 主な魅力ポイント 3 から 5 個
- 代表コメント引用
- 注意点
- 信頼度

要約は、根拠コメントにないことを推測しすぎない。外部知識を使った場合は、コメント由来の情報と分けて表示する。

### 9.10 代表コメント選定

人物別代表コメント:

- その人物に紐づくコメント
- mention confidence >= 0.75
- 文字数 10 から 200
- like_count が高い
- 同じ author のコメントが連続しない
- 同じ alias だけに偏らない
- 意味の薄い短文のみで構成しない

alias 代表コメント:

- 該当 alias で match したコメント
- alias の evidence span を持つ
- like_count が高い
- 文字数 10 から 200

共起代表コメント:

- A と B の両方に紐づく
- 双方の mention confidence >= 0.75
- like_count が高い
- 関係性カテゴリが付いているものを優先

### 9.11 confidence の意味としきい値

`confidence` は対象ごとに意味が違うため、UI と schema では文脈を明示する。

- person confidence: この候補が分析対象 entity として妥当か
- alias confidence: この alias がその entity を指す確からしさ
- mention confidence: このコメントがその entity に言及している確からしさ
- appeal confidence: このコメントがその魅力カテゴリに該当する確からしさ
- summary confidence: 要約が根拠コメントに十分支えられている確からしさ

しきい値:

- high: >= 0.8
- medium: >= 0.5 and < 0.8
- low: < 0.5

UI では単に「信頼度」ではなく、「候補信頼度」「alias 信頼度」「分類信頼度」「要約信頼度」のように表示する。

## 10. データモデル

### 10.1 SQLite テーブル案

#### videos

- id
- youtube_video_id
- url
- title
- channel_title
- description
- published_at
- fetched_at

#### comments

- id
- video_id
- comment_snapshot_id
- youtube_comment_id
- parent_comment_id
- author_display_name
- author_channel_id
- text_original
- text_normalized
- like_count
- published_at
- updated_at
- is_reply
- reply_count
- source_order
- api_relevance_order
- fetched_at

#### comment_snapshots

- id
- video_id
- fetch_order
- max_comments_requested
- max_comments_fetched
- reply_fetch_mode
- fetched_top_level_count
- fetched_reply_count
- total_reply_count_from_threads
- fetched_at

#### analysis_runs

- id
- video_id
- comment_snapshot_id
- status
- stage
- progress
- config_json
- created_at
- started_at
- completed_at
- error_message

#### persons

- id
- analysis_run_id
- display_name
- canonical_name
- entity_type
- status
- confidence
- reason
- created_by

`persons.status`:

- `candidate`
- `accepted`
- `rejected`
- `merged`

`entity_type`:

- `person`
- `group`
- `duo`
- `channel`
- `show`
- `project`
- `fan_group`
- `unknown`

#### aliases

- id
- analysis_run_id
- person_id
- alias_text
- normalized_alias
- source
- hit_count
- confidence
- status
- is_ambiguous

#### comment_mentions

- id
- analysis_run_id
- comment_id
- person_id
- alias_id
- matched_text
- match_method
- confidence
- evidence_json

`comment_mentions.alias_id` は nullable とする。

- 辞書マッチの場合: `aliases.id`
- LLM 推定の場合: `null`

`match_method`:

- `alias_exact`
- `alias_normalized`
- `alias_honorific`
- `llm_inferred`
- `user_corrected`

#### appeal_labels

- id
- analysis_run_id
- comment_id
- person_id
- category
- tone
- confidence
- evidence_json

#### clusters

- id
- analysis_run_id
- label
- summary
- size
- representative_comment_ids_json
- keywords_json

#### reports

- id
- analysis_run_id
- report_json
- created_at

#### llm_cache

- id
- task_type
- model
- prompt_version
- schema_version
- input_hash
- output_json
- created_at

#### candidate_action_logs

- id
- analysis_run_id
- action_type
- payload_json
- created_at

### 10.2 ファイル保存

SQLite に加えて、以下の artifact を保存する。

```text
data/
  runs/
    <run_id>/
      raw_comments.jsonl
      normalized_comments.jsonl
      person_candidates.json
      aliases.json
      mentions.jsonl
      clusters.json
      report.json
```

理由:

- 後から分析過程を追える
- LLM の結果をキャッシュできる
- 別ツールから検証しやすい
- DB 破損時にも中間データを確認できる

### 10.3 analysis config

`analysis_runs.config_json` には schema version と処理設定を必ず保存する。

```json
{
  "schema_version": "analysis_config.v1",
  "comment_snapshot_id": "snapshot_001",
  "max_comments": 1000,
  "reply_fetch_mode": "none",
  "fetch_order": "relevance",
  "top_comment_definition": "like_count_desc",
  "top_comment_count": 50,
  "like_weight_formula": "1 + log1p(like_count)",
  "llm_enabled": true,
  "embedding_enabled": false,
  "prompt_version": "2026-05-16.v1"
}
```

## 11. API 設計

### 11.1 基本 API

#### POST /api/videos/inspect

YouTube URL を受け取り、動画 ID とメタデータを確認する。

Request:

```json
{
  "url": "https://www.youtube.com/watch?v=vlpLbiqNhLo"
}
```

Response:

```json
{
  "video_id": "vlpLbiqNhLo",
  "title": "...",
  "channel_title": "...",
  "comment_count_available": true
}
```

#### POST /api/runs

分析ジョブを作成する。

Request:

```json
{
  "url": "https://www.youtube.com/watch?v=vlpLbiqNhLo",
  "max_comments": 1000,
  "reply_fetch_mode": "none",
  "fetch_order": "relevance",
  "use_llm": false,
  "use_embeddings": false
}
```

Response:

```json
{
  "run_id": "run_001",
  "status": "queued"
}
```

#### GET /api/runs/{run_id}

分析ジョブの状態を返す。

Response:

```json
{
  "run_id": "run_001",
  "status": "running",
  "stage": "extracting_candidates",
  "progress": 0.42
}
```

#### GET /api/runs/{run_id}/candidates

人物候補と alias 候補を返す。

Response:

```json
{
  "run_id": "run_001",
  "persons": [
    {
      "person_id": "person_001",
      "display_name": "みりちゃむ",
      "entity_type": "person",
      "status": "accepted",
      "confidence": 0.91,
      "reason": "動画タイトルとコメント頻度から候補化",
      "aliases": [
        {
          "alias_id": "alias_001",
          "alias_text": "みりちゃむ",
          "normalized_alias": "みりちゃむ",
          "hit_count": 42,
          "confidence": 0.98,
          "source": "title",
          "status": "accepted",
          "is_ambiguous": false,
          "representative_comment_ids": ["comment_001"]
        }
      ]
    }
  ]
}
```

#### POST /api/runs/{run_id}/candidate-actions

ユーザーによる候補修正を保存する。

Request:

```json
{
  "actions": [
    {
      "type": "accept_person",
      "person_id": "person_001"
    },
    {
      "type": "reject_alias",
      "alias_id": "alias_003"
    },
    {
      "type": "add_alias",
      "person_id": "person_001",
      "alias_text": "みりちゃん"
    },
    {
      "type": "update_display_name",
      "person_id": "person_001",
      "display_name": "みりちゃむ"
    }
  ]
}
```

MVP-0 では巨大な candidates JSON の丸ごと PATCH は避ける。action-based API にして、操作ログを `candidate_action_logs` に残す。

#### POST /api/runs/{run_id}/continue

候補確認後、分析を再開する。

#### GET /api/runs/{run_id}/report

完成済みレポート JSON を返す。

Response は必ず `schema_version` を持つ。

```json
{
  "schema_version": "report.v2",
  "run_id": "run_001",
  "video": {},
  "fetch_summary": {},
  "analysis_config": {},
  "persons": [],
  "rankings": {},
  "comments": [],
  "sections": {
    "mention_ranking": { "status": "available" },
    "appeal_summary": {
      "status": "skipped",
      "reason": "LLM disabled"
    }
  }
}
```

#### GET /api/runs

過去分析一覧を返す。

### 11.2 ジョブ状態

`status` と `stage` を分ける。

`status`:

- queued
- running
- waiting_for_review
- completed
- failed
- failed_recoverable
- cancelled

`stage`:

- fetching_video
- fetching_comments
- normalizing
- extracting_candidates
- classifying_mentions
- summarizing
- completed

MVP-2 で embedding を追加する場合は `clustering` を stage に追加する。フロントは `status` で大枠を、`stage` で詳細進捗を表示する。

## 12. UI 要件

### 12.1 分析開始画面

要素:

- YouTube URL 入力
- 最大コメント数
- 返信取得モード
- AI 分析を使うか
- embedding クラスタリングを使うか
- 分析開始ボタン

初期設定:

- 最大コメント数: 1000
- 返信取得モード: `none`
- fetch order: `relevance`
- AI 分析: MVP-0 ではオフ、MVP-1 以降はオン
- embedding: MVP-0/MVP-1 ではオフ、MVP-2 以降はオン

### 12.2 進捗画面

表示:

- 現在ステージ
- 進捗率
- 取得済みコメント数
- 処理中の概要
- エラーがあれば内容

### 12.3 人物候補確認画面

最重要画面。ユーザーの手間を最小にする。

表示:

- 候補人物カード一覧
- alias 一覧
- alias ごとのヒット件数
- 代表コメント 1 から 3 件
- 採用 / 除外 / 編集

操作:

- まとめて採用
- 個別除外
- alias 編集
- 分析続行

MVP-0 では人物統合・分割 UI を入れない。alias 追加と表示名編集で吸収できる範囲に留める。

### 12.4 レポート概要画面

表示:

- 言及ランキング棒グラフ
- いいね加重ランキング
- 人物別魅力カテゴリ積み上げグラフ
- 共起ネットワーク
- 主要サマリ

### 12.5 人物詳細画面

表示:

- 人物名
- alias
- 言及件数
- いいね加重スコア
- 魅力カテゴリ
- 特徴語
- 共起人物
- 代表コメント
- AI 要約
- 低信頼コメント

### 12.6 コメント一覧画面

表示:

- コメント本文
- いいね数
- 投稿日時
- 紐付いた人物
- 魅力カテゴリ
- 信頼度

フィルタ:

- 人物
- alias
- 魅力カテゴリ
- 信頼度
- いいね数
- キーワード

## 13. 技術選定

### 13.1 フロントエンド

候補:

- TypeScript
- Vite
- React
- ECharts

注意:

- 新規選定では最新安定版を優先する
- TypeScript は 6 以降を優先する
- Vite は 8 以降を優先する
- 古いメジャーバージョンを初期選択しない
- 実装時点の `package.json` では major を固定する

初期例:

```json
{
  "devDependencies": {
    "typescript": "^6.0.0",
    "vite": "^8.0.0"
  }
}
```

### 13.2 バックエンド

候補:

- Python 3.12 以上
- FastAPI
- Uvicorn
- Pydantic
- SQLite
- pandas
- scikit-learn
- numpy

### 13.3 AI / LLM

MVP-1 以降では OpenAI API を想定してよい。

使い道:

- 人物候補整理
- alias 候補整理
- 曖昧コメント分類
- クラスタ名付け
- 人物別魅力要約

注意:

- API キーは環境変数で扱う
- DB や artifact に API キーを保存しない
- LLM 入出力は `llm_cache` にキャッシュする
- JSON schema で構造化出力を受ける
- 推論結果には confidence と reason を持たせる
- `task_type`, `model`, `prompt_version`, `schema_version`, `input_hash` が一致する場合だけキャッシュを再利用する

### 13.4 Embedding

候補:

- OpenAI embeddings
- sentence-transformers

MVP-2 では実装容易性を優先する。ローカルモデルは環境依存が増えるため、最初は OpenAI embeddings でもよい。

ただし、embedding 処理は抽象化し、将来ローカルモデルへ差し替えられるようにする。

Embedding は MVP-2 で導入する。MVP-0/MVP-1 の実装を embedding に依存させない。

## 14. MVP スコープ

### 14.1 MVP-0: LLM なし vertical slice

最初に MVP-0 を完成させる。MVP-0 では LLM と embedding は使わない。

- YouTube URL 入力
- 動画 ID 抽出
- ダミーコメントまたは YouTube API でコメント取得
- SQLite へのコメント保存
- ルールベースの簡易人物候補抽出
- alias 候補抽出
- 人物候補確認 UI
- 採用済み alias による一次分類
- 人物別言及ランキング
- 人物別特徴語
- 人物別代表コメント
- report.v2 JSON 生成
- Web レポート最小表示

MVP-0 の完了条件:

- API key がなくても dummy comments で通る
- LLM key がなくても completed になる
- 候補確認後に accepted alias だけで deterministic なランキングが出る
- `use_llm=false` の sections が `skipped` として表示される

### 14.2 MVP-1: LLM あり分析

- LLM による候補整理
- LLM による alias 候補補完
- 曖昧コメント分類
- 魅力カテゴリ分類
- 人物別要約
- 低信頼コメントの表示
- 過去分析結果の再表示

### 14.3 MVP-2: 高度分析

- embedding
- クラスタリング
- 共起ネットワーク
- 低信頼レビュー画面
- 差分更新
- 返信コメントの full 取得

### 14.4 初期実装では任意

- 動画字幕の取得
- サムネイル OCR
- 外部検索による出演者補完
- 複数動画横断分析
- チャンネル全体分析
- 独自 ML モデル学習
- 認証付きユーザー管理
- クラウドデプロイ

### 14.5 MVP でやらない

- 完全自動の出演者確定
- 動画映像解析
- コメント投稿や返信
- YouTube アカウント操作
- スパム判定やモデレーション
- 商用 SaaS 前提のマルチテナント設計

## 15. 品質・検証要件

### 15.1 機能検証

初期検証動画で以下を確認する。

- コメントが取得できる
- 人物候補が期待範囲で出る
- alias 候補に明らかな漏れが少ない
- 採用・除外・編集ができる
- 分析を続行できる
- 言及ランキングが表示される
- 代表コメントが根拠として妥当
- MVP-1 以降では AI 要約がコメントに基づいている

### 15.2 分析品質検証

人間が最低限確認する項目:

- 上位 50 コメントの分類が大きく外れていないか
- alias が一般名詞に誤爆していないか
- MVP-1 以降では人物統合が誤っていないか
- MVP-1 以降では AI 要約が根拠にない外部情報を断定していないか
- MVP-1 以降では低信頼コメントが適切に低信頼として扱われているか

### 15.3 回帰テスト

Unit tests:

- YouTube URL から video_id を抽出できる
- コメント正規化が壊れていない
- alias normalization が期待通り動く
- alias マッチが期待通り動く
- 同一コメント内の同一人物重複を 1 件にできる
- 複数人物言及を同時に拾える
- like weighted score が `1 + log1p(like_count)` で計算される
- report JSON の schema が壊れていない

Integration tests:

- dummy comments -> candidates -> review actions -> mentions -> report
- `use_llm=false` で LLM sections が skipped になる
- API key なしでも dummy comments の分析が完了する

Optional live tests:

- YouTube API を使ったコメント取得
- OpenAI API を使った LLM 分類

ライブテストは `RUN_LIVE_TESTS=1` のときだけ実行する。

### 15.4 UI 検証

ブラウザで確認する。

- デスクトップ幅でグラフが崩れない
- モバイル幅でも最低限読める
- 候補確認画面の操作が重くない
- 長いコメントが UI を壊さない
- ローディング、失敗、空データ状態が表示される

## 16. セキュリティ・プライバシー

### 16.1 API キー

- YouTube API key や OpenAI API key は環境変数で扱う
- `.env` は Git 管理しない
- UI に API key を表示しない
- ログに API key を出さない

### 16.2 コメントデータ

コメントは公開データだが、author 情報を含むため扱いに注意する。

- ローカル保存を前提にする
- 外部送信は LLM API への必要最小限に留める
- LLM に送信するコメントは必要範囲に絞る
- 生データ export は明示操作にする

### 16.3 AI 利用時の注意

- AI の分類は推定である
- 分析結果に confidence を表示する
- 断定しすぎない文言にする
- 人物へのネガティブな評価を過度に強調しない
- 名誉毀損や攻撃的なまとめにならないよう注意する

LLM に送ってよいもの:

- comment_id
- text_original または text_normalized
- 既知の候補 entity 一覧
- matched_alias 候補
- like_count bucket

LLM に送らないもの:

- author_display_name
- author_channel_id
- published_at
- updated_at

author 情報は分析・要約に基本不要なので、LLM 入力から外す。

## 17. 設定項目

初期設定:

- 最大コメント数
- 返信取得モード
- fetch order
- 上位コメント判定件数
- いいね加重の重み
- LLM 使用の有無
- embedding 使用の有無
- 低信頼しきい値
- クラスタ数
- 使用モデル

環境変数:

```text
YOUTUBE_API_KEY=
OPENAI_API_KEY=
DATABASE_URL=
DATA_DIR=
```

### 17.1 README 要件

README に必ず含める。

- 必要環境
  - macOS
  - Python 3.12+
  - Node.js LTS
- backend setup
  - `python -m venv .venv`
  - `pip install -r backend/requirements.txt`
- frontend setup
  - `npm install`
- `.env.example`
  - `YOUTUBE_API_KEY`
  - `OPENAI_API_KEY`
  - `DATABASE_URL`
  - `DATA_DIR`
- 起動方法
  - backend
  - frontend
- 最小動作確認
  - `/api/health`
  - YouTube URL inspect
  - ダミーコメント分析

最初から実コメント取得に依存すると API key で詰まりやすいため、dummy comments seed を必ず用意する。

## 18. 実装順序

### Phase 1: 基盤

- repo 初期化
- frontend / backend の構成作成
- FastAPI の疎通
- Vite frontend の疎通
- SQLite 初期 schema
- YouTube URL parsing
- dummy comments fixture
- `/api/health`

### Phase 2: コメント取得

- YouTube API 連携
- コメント保存
- 取得済みコメント一覧表示
- 取得エラー表示
- `comment_snapshots` 保存
- `reply_fetch_mode=none` の実装

### Phase 3: 候補抽出

- コメント正規化
- 頻出語抽出
- ルールベース人物候補抽出
- 候補確認 UI
- action-based candidate API

### Phase 4: 分類・集計

- alias 辞書保存
- 辞書マッチ分類
- 言及ランキング
- 特徴語抽出
- 代表コメント抽出
- report.v2 JSON 生成

ここまでで MVP-0 完了とする。

### Phase 5: AI 分析

- LLM による候補整理
- 曖昧コメント分類
- 魅力カテゴリ分類
- 人物別要約
- low confidence comments 表示

ここまでで MVP-1 完了とする。

### Phase 6: レポート UI

- 概要ダッシュボード
- 人物別詳細
- コメント一覧
- 過去分析一覧

### Phase 7: 高度分析

- embedding
- クラスタリング
- クラスタ名生成
- 共起ネットワーク
- 差分更新

ここまでで MVP-2 完了とする。

### Phase 8: 検証・改善

- 初期検証動画で確認
- alias 誤爆の修正
- report JSON schema の固定
- README 作成
- セットアップ手順整理

## 19. 成功条件

初期検証動画または dummy comments に対して、以下ができれば MVP-0 完了とする。

- URL を入れてコメントを取得できる
- 主要人物候補が自動で出る
- ユーザーが 1 分以内に候補確認を終えられる
- 言及ランキングが表示される
- 代表コメントで根拠を確認できる
- LLM なしでも report.v2 JSON が生成される
- LLM dependent section が skipped として表示される

MVP-1 完了条件:

- 人物別に「何が魅力として語られているか」が読める
- 誤分類や曖昧分類が低信頼として分離される
- 同じ分析結果を後から再表示できる
- LLM 失敗時に report 全体が不要に failed にならない

## 20. 別 Codex への作業指示

この文書を受け取った Codex は、まず実装に入る前に以下を行うこと。

1. 現在の repo が空か、既存構成があるか確認する
2. 新規構成の場合、TypeScript + Vite + React と Python + FastAPI のモノレポ構成を提案する
3. YouTube Data API と LLM API の API key を環境変数で扱う設計にする
4. まず MVP-0 を完成させる。MVP-0 では LLM と embedding は使わない
5. いきなり高度な ML 学習や動画解析に広げない
6. 分析結果は必ず根拠コメントと confidence を持つ
7. ユーザー確認 UI は軽量にし、確認作業を増やしすぎない
8. コメント取得・正規化・alias 分類・集計・レポート生成を明確に分離する
9. 実装後は README に起動方法、必要な env、分析手順を書く
10. 検証では指定動画 `https://www.youtube.com/watch?v=vlpLbiqNhLo` を使う

最初に作るべき最小 vertical slice:

```text
URL 入力
  -> video_id 抽出
  -> ダミーまたは実コメント取得
  -> コメント保存
  -> 簡易人物候補抽出
  -> 候補確認 UI
  -> alias マッチ集計
  -> 人物別ランキング表示
```

この vertical slice が通ってから、LLM 分類、embedding、クラスタリング、人物別魅力要約を追加する。

Codex が実装時に迷った場合の優先順位:

1. dummy comments で deterministic に通る MVP-0
2. report.v2 schema の固定
3. alias 誤爆を減らす候補確認 UI
4. LLM による曖昧分類
5. embedding / clustering

LLM や YouTube API の live 動作より先に、dummy comments の integration test を通すこと。

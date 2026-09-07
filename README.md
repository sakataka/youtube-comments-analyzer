# YouTube コメントインサイト

公開コメントを全件集計し、最大250件の抽出コメントをAstra Light（`gpt-6-astra` / `low`）で要約する個人用ローカルアプリです。全件の検索・並べ替え・集計はAIなしで利用できます。AIは要約と人物辞書に通常各1回、双方の修復込み最大4回です。

## 使い方

1. 動画URLを入力して分析します。コメントの取得は1回最大5,000件で区切り、原文と取得位置を保存します。
2. 全件の集計と原文は、AIの要約が終わる前から表示します。
3. 抽出範囲の話題と反応を読み、「根拠の原文を読む」で引用元を確認します。原文を検索し、いいね順・新しい順・返信の多い順に並べ替えられます。
4. 部分取得の場合は「続きのコメントを取得・要約」で追加できます。停止、保存データからの再試行にも対応します。

通常の要約は1回180秒まで、処理全体には15分の期限を設けています。別の分析が動いている間は新しい分析を開始しません。AI失敗・時間切れでも、取得済みの原文と集計を利用できます。時間内のAI処理成功を保証するものではありません。

親・返信と投稿時期で分けた無作為抽出200件に、高評価・返信の多い投稿を最大50件補足します。長文と入力全体に文字数上限があります。抽出要約から全体の賛否率は推定しません。字幕は通常の要約に使用しません。

## 人物別の言及と参考評価

全件の本文で名前・別名の辞書に一致する投稿を数え、人物別の件数と取得全件に対する割合を表示します。同じ投稿の繰り返し言及は1件、複数人物は各人物へ数えます。肯定・否定・両方・判定できずの内訳は、その人物に一致した全投稿を分母にします。これらはルールによる参考値であり、中立や本音の推定ではありません。

人物の件数や各区分を押すと、原文・一致した呼び名・評価表現・保留理由を確認できます。「人物名・別名の辞書を編集」で登録を修正すると、AIを呼ばずに再集計します。名前を省略した返信や「あの子」などは推定しません。辞書未一致は人物への言及がないという意味ではありません。

既存のv4レポートは「人物集計を追加・再試行」で、保存済み要約を変えずに集計だけを追加できます。詳細は[人物別統計の設計](docs/person-statistics-design.md)を参照してください。

## 環境と起動

macOS、Python 3.14、Bun（`packageManager`に固定）、ログイン済みCodex CLI、YouTube Data API key。

```sh
uv venv --python 3.14 .venv
uv pip install --python .venv/bin/python -r backend/requirements.txt
bun install --frozen-lockfile
cp .env.example .env
```

`.env`に`YOUTUBE_API_KEY`を設定します。`DATA_DIR`と`DATABASE_URL`が空の場合は`data/`と`data/app.sqlite3`を使います。秘密値・原文・実行結果はGitへ登録しません。

```sh
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
bun run dev
```

LocalWebは`dist/`を配信し、`/api`をポート8000へ接続します。

## 保存と互換性

SQLiteに原文・取得カーソル・抽出範囲・検証済み要約・使用量・試行履歴を保存します。同じ動画の保存原文は再利用でき、同じ入力と設定の要約にはキャッシュを使います。AIには投稿者名・投稿者IDを送りません。

新しいレポートは`report.v4`です。旧`report.v3`の原文と結果は保持し、旧方式と表示して閲覧できます。旧方式の続きを実行する機能は終了し、「新しい分析としてやり直す」で保存原文から新方式の別runを作成します。

## 検証

```sh
bun run test
bun run build
bun run test:e2e
```

通常テストとE2Eは実AI・実APIを使いません。E2Eは隔離DBを使い、デスクトップ・420×912px・ダークモードで確認します。実データ2,384件から250件を抽出した2026-09-07の検証では、Astra Lightの1回の呼び出しで60.6秒、引用検証を通過しました。この1例は他動画の品質や速度の保証ではありません。

設計と検証条件は[軽量分析の設計](docs/lightweight-analysis-design.md)、残る確認は[ロードマップ](docs/roadmap.md)、障害時は[復旧手順](docs/troubleshooting.md)を参照してください。

## 実装

`lightweight.py`が抽出・要約・v4の保存とレポート、`opinion_fetch.py`が取得、`codex_client.py`が期限と停止に対応したAI通信を担当します。`opinion_service.py`と`opinion_analysis.py`は共有する原文保存・旧結果閲覧のために残します。新規分析から旧AIパイプラインは呼びません。

主要APIは`POST /api/runs`、`GET /api/runs/{id}/report`、`GET /api/runs/{id}/comments`、`POST /api/runs/{id}/actions`、`POST /api/runs/{id}/reanalyze`です。人物集計だけの実行はactionsの`people`、辞書編集とAIなし再集計は`POST /api/runs/{id}/people`です。commentsの`person_id`・`stance`で参考判定を原文へ辿れます。commentsの`sort`は`newest / likes / replies`。旧字幕再分析・全件分類修正APIは変更を行わずエラーを返します。

# YouTube コメントインサイト

動画URLから公開コメントを取得し、「誰・何が、どの論点で、どう受け取られているか」を根拠付きで整理する個人用ローカルアプリです。

コメント全件を分割してAstra Mediumで読み、意見を統合し、根拠を監査します。件数・割合はプログラムで計算します。固定キーワード分類やローカル感情モデルは使用しません。実装・DB・画面・APIは現在の分析方式だけを扱います。

## 設計変更予定

[軽量分析の設計](docs/lightweight-analysis-design.md)で、全件の機械集計と抽出コメントのAstra Light要約へ変更する方針を定めています。開始から10分を目標とし、AI呼び出しは通常1〜2回、修復を含め最大3回です。現時点のアプリは上記の全件AI方式で、以下の操作説明も現行実装についてのものです。

## 使い方

1. URLを入力して分析します。まず5,000件を区切りに取得し、途中結果を保存します。
2. 「このコメント欄で語られていること」から、主な意見と根拠の原文へ進みます。
3. 人物・商品・企画などで絞り、対象別の評価、親コメントと返信、高評価上位10%との違いを確認します。
4. 「続きのコメントを取得・分析」で次の区切りに進めます。停止・再開にも対応します。
5. 判断保留の根拠を確認し、必要なら対象名・意見・評価を修正できます。

取得したコメントの分析完了と、APIで取得可能なコメントの取得完了は別に表示します。部分取得は新しい投稿に偏ります。非公開・削除済みのコメントや、コメントを投稿しない視聴者の意見は分かりません。

## 環境

macOS、Python 3.14、Bun（`packageManager`に固定）、ログイン済みCodex CLI、YouTube Data API key。字幕の自動取得には`yt-dlp`を使います。字幕が取得できない場合も分析でき、VTT・SRT・YouTube JSON3ファイルの取り込みにも対応します。

```sh
uv venv --python 3.14 .venv
uv pip install --python .venv/bin/python -r backend/requirements.txt
bun install --frozen-lockfile
cp .env.example .env
```

`.env`の`YOUTUBE_API_KEY`にキーを設定します。`DATA_DIR`と`DATABASE_URL`が空の場合は`data/`と`data/app.sqlite3`を使います。秘密値・コメント原文・字幕・実行結果はGitへ登録しません。

```sh
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
bun run dev
```

Viteが表示したURLを開きます。LocalWebではビルド済み`dist/`を配信し、`/api`をポート8000へ接続します。

## 保存と再開

SQLiteの`runs`に、コメント原文・親と返信の取得カーソル・字幕・背景・コメント別の分析・AIキャッシュ・意見グループ・修正・進捗を保存します。APIページとカーソルは同じスナップショットに保存するため、再開で未保存のページ末尾を落としません。

同じ動画・返信条件の保存済み取得データは新しい分析で再利用します。「保存済みデータを使わず最新のコメントを取得する」は新しい取得を開始します。過去の結果を上書きしません。親・本文・字幕が変わると影響する分析を再計算します。AI入力には投稿者名や投稿者IDを送りません。

AI出力の欠落・重複・架空引用は失敗として停止し、未分析のまま残します。意味の監査で支持できない意見は判断保留に残し、確認できた意見だけを要約へ掲載します。AI停止は現在の呼び出し完了後で、最大10分の待ち時間があります。時間と呼び出し回数・文字数を保存しますが、トークン利用量は現在取得していません。

## 検証

```sh
bun run test
bun run build
bun run test:e2e
```

通常テストとE2Eは実API・実AIを使いません。E2Eサーバーは毎回新しい一時DBを作り、通常のDBを参照しません。デスクトップ1280px、モバイル420×912px、ダークモードを確認します。

分析品質の評価は[品質評価手順](docs/quality-evaluation.md)を参照してください。テスト用AIの出力は精度の証明には使いません。

## APIと実装

- `POST /api/runs`：URL、1回の取得件数、返信の有無、最新取得の指定。
- `GET /api/runs`、`GET /api/runs/{id}`：履歴・状態。
- `GET /api/runs/{id}/report`：`report.v3`の要約・集計・取得範囲。
- `GET /api/runs/{id}/comments`：`group_id`、`analysis_status=held`、検索・ページング。
- `POST /api/runs/{id}/actions`：`continue`、`stop`、`resume`。
- `POST /api/runs/{id}/transcript`：時刻付き字幕の取り込みと再分析。
- `POST /api/runs/{id}/opinion-corrections`：意見修正・対象名の統一。
- `POST /api/runs/{id}/review/complete`：人による確認状態。
- `POST /api/runs/{id}/reanalyze`：保存された原文から別の分析を作成。
- `GET /api/runs/{id}/export`：原文・字幕・分析データの書き出し。
- `GET /api/health`、`GET /api/settings`、`GET /api/data/summary`、`POST /api/data/actions`。

`opinion_fetch.py`が取得、`transcripts.py`が字幕、`opinion_analysis.py`がAI処理と集計、`opinion_service.py`が保存と実行、`codex_client.py`が既存Codex app serverとの通信を担当します。

現在の境界条件と保証は[要求仕様](docs/requirements.md)、既知の未検証項目は[ロードマップ](docs/roadmap.md)に記載しています。

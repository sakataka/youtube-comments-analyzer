# YouTube コメント人物言及分析

YouTube 動画 URL を入力し、取得したコメントから人物・グループ・関係者への言及を抽出して、人物候補、alias、言及ランキング、代表コメントを確認するローカル Web アプリです。

現在の実装は MVP-0 です。LLM と embedding は使わず、YouTube Data API または fixture からコメントを保存し、ルールベース候補抽出と accepted alias による deterministic な集計を行います。

## 現在できること

- YouTube URL から `video_id` を抽出する
- `YOUTUBE_API_KEY` があれば YouTube Data API v3 で最大 5000 件のコメントを取得する
- API key がない場合は `fixtures/sample_comments_drawme.jsonl` で動く
- 取得コメントを SQLite と JSONL artifact に保存する
- live API の取得結果を `data/youtube_cache/` に保存し、同条件では再利用する
- 人物候補と alias 候補を表示する
- 候補・alias を採用または除外する
- 採用済み alias でコメントを分類する
- 人物別言及ランキング、いいね加重スコア、代表コメントを表示する
- `report.v1` JSON を生成する

## 必要環境

- macOS
- Python 3.14+
- Bun 1.3+

## セットアップ

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
bun install
```

## 環境変数

`.env.example` をコピーして `.env` を作ります。

```bash
cp .env.example .env
```

設定項目:

```bash
YOUTUBE_API_KEY=
OPENAI_API_KEY=
DATABASE_URL=
DATA_DIR=
```

`YOUTUBE_API_KEY` が空の場合は fixture を使います。`DATABASE_URL` と `DATA_DIR` が空の場合は、それぞれ `data/app.sqlite3` と `data/` を使います。

## 起動

バックエンド:

```bash
set -a
source .env
set +a
.venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

フロントエンド:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8000 bun run dev
```

Vite は空きポートを自動割り当てします。表示された `Local:` の URL をブラウザで開いてください。

## デモ手順

1. バックエンドとフロントエンドを起動する。
2. 画面の URL 欄に YouTube URL を入力する。
3. 最大コメント数を確認する。デフォルトは `5000`。
4. 「分析を開始」を押す。
5. 人物候補と alias を確認し、必要に応じて採用・除外する。
6. 「候補を確定して集計」を押す。
7. 言及ランキング、代表コメント、section status を確認する。

初期検証 URL:

```text
https://www.youtube.com/watch?v=vlpLbiqNhLo
```

## 最小動作確認

```bash
curl http://127.0.0.1:8000/api/health
curl -X POST http://127.0.0.1:8000/api/videos/inspect \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://www.youtube.com/watch?v=vlpLbiqNhLo"}'
bun test
bun run build
```

`bun test` は live API を使わず、fixture で integration test を通します。

## コメント取得データの保存と再利用

YouTube API の quota を無駄にしないため、live API で取得したコメントは次に保存します。

```text
data/youtube_cache/<video_id>/<fetch_order>_<reply_fetch_mode>_<max_comments>.jsonl
data/youtube_cache/<video_id>/<fetch_order>_<reply_fetch_mode>_<max_comments>.metadata.json
```

同じ動画 ID・取得順・返信モード・最大件数で再分析する場合は cache を読み、API を再度呼びません。テストは live API ではなく `fixtures/` の seed data を使います。最大コメント数の現在の上限は `5000` です。

分析 run ごとの中間成果物は次に保存します。

```text
data/runs/<run_id>/
  raw_comments.jsonl
  person_candidates.json
  mentions.jsonl
  report.json
```

## 主な API

- `GET /api/health`
- `POST /api/videos/inspect`
- `POST /api/runs`
- `GET /api/runs/{run_id}`
- `GET /api/runs/{run_id}/candidates`
- `POST /api/runs/{run_id}/candidate-actions`
- `POST /api/runs/{run_id}/continue`
- `GET /api/runs/{run_id}/report`
- `GET /api/runs`

## 実装構成

```text
backend/
  app/
    main.py       FastAPI API
    youtube.py    YouTube URL parsing, API fetch, cache
    pipeline.py   SQLite schema, candidate extraction, mention classification, report
    text.py       text normalization
  tests/
fixtures/
src/
  App.tsx         React UI
  styles.css      UI styles
docs/
  requirements.md 要求仕様書
  roadmap.md      実装ロードマップ
```

## セキュリティ上の注意

- `.env` は Git 管理しません。
- API key をチャット、ログ、README、ソースコードに貼らないでください。
- LLM 連携は未実装です。将来実装時も author 情報は LLM に送らない方針です。
- 現在の API key は Google Cloud Console 側で `YouTube Data API v3` のみに制限してください。

## ロードマップ

完了済み・未実装の整理は [docs/roadmap.md](docs/roadmap.md) を参照してください。

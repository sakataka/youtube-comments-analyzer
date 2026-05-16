# YouTube コメント人物言及分析

YouTube 動画 URL からコメントを保存し、人物候補と alias を確認して、人物別の言及ランキングを生成するローカル Web アプリです。

MVP-0 は LLM と embedding を使いません。API key がない場合でも `fixtures/sample_comments_drawme.jsonl` で deterministic に動きます。

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

`.env.example` を参考にしてください。`YOUTUBE_API_KEY` がない場合は fixture を使います。

```bash
YOUTUBE_API_KEY=
OPENAI_API_KEY=
DATABASE_URL=
DATA_DIR=
```

## 起動

バックエンド:

```bash
. .venv/bin/activate
uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

フロントエンド:

```bash
bun run dev
```

Vite は `--port 0` で空きポートを自動割り当てします。表示された URL を使ってください。

## 最小動作確認

```bash
curl http://127.0.0.1:8000/api/health
bun test
```

Web UI では URL を入力して分析を開始し、候補を採用してから「候補を確定して集計」を押すと `report.v1` のランキングが表示されます。

## コメント取得データの保存と再利用

YouTube API の quota を無駄にしないため、live API で取得したコメントは次に保存します。

```text
data/youtube_cache/<video_id>/<fetch_order>_<reply_fetch_mode>_<max_comments>.jsonl
```

同じ動画 ID・取得順・返信モード・最大件数で再分析する場合は cache を読み、API を再度呼びません。テストは live API ではなく `fixtures/` の seed data を使います。

分析 run ごとの中間成果物は次に保存します。

```text
data/runs/<run_id>/
  raw_comments.jsonl
  person_candidates.json
  mentions.jsonl
  report.json
```

## API

- `GET /api/health`
- `POST /api/videos/inspect`
- `POST /api/runs`
- `GET /api/runs/{run_id}`
- `GET /api/runs/{run_id}/candidates`
- `POST /api/runs/{run_id}/candidate-actions`
- `POST /api/runs/{run_id}/continue`
- `GET /api/runs/{run_id}/report`
- `GET /api/runs`

## MVP-0 の範囲

- YouTube URL parsing
- API key なしの fixture 分析
- live API 取得結果の cache 保存
- SQLite への動画・snapshot・コメント・候補・alias・mention・report 保存
- ルールベース候補抽出
- action-based candidate API
- accepted alias による deterministic な言及分類
- like weighted score `1 + log1p(like_count)`
- `report.v1` 生成
- LLM / embedding dependent section の `skipped` 表示

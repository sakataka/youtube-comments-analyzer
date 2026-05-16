# YouTube コメント人物言及分析

YouTube 動画 URL を入力し、取得したコメントから人物・グループ・関係者への言及を抽出して、人物候補、alias、言及ランキング、代表コメントを確認するローカル Web アプリです。

現在の実装は MVP-1 の一部です。YouTube Data API または fixture からコメントを保存し、ルールベース候補抽出と accepted alias による deterministic な集計を行います。必要に応じて Codex app server 経由の LLM 補助分析を実行できます。

## 現在できること

- YouTube URL から `video_id` を抽出する
- `YOUTUBE_API_KEY` があれば YouTube Data API v3 で最大 5000 件のコメントを取得する
- 返信モードは `none`、`inline_subset`、`full` を選べる
- API key がない場合は `fixtures/sample_comments_drawme.jsonl` で動く
- 取得コメントを SQLite と JSONL artifact に保存する
- live API の取得結果を `data/youtube_cache/` に保存し、同条件では再利用する
- 差分更新を選ぶと live API で再取得し、既存 cache と重複排除して保存する
- 分析開始後に `cache` / `youtube_api` / `fixture` の利用状況を表示する
- 過去分析 run を一覧表示し、保存済み候補・レポートを再表示する
- 動画タイトル、チャンネル名、YouTube 表示コメント数、取得コメント数の差分を表示する
- 取得済みコメント内のいいね数分布を表示する
- 概要ダッシュボードで採用人物数、紐づけ済みコメント数、トップ人物を確認する
- 人物別言及数とコメント分類比率をグラフ表示する
- 人物候補と alias 候補を表示する
- 既存 alias にないニックネームらしい頻出表記を未知 alias 候補として表示する
- 未知 alias 候補を既存人物へ追加し、再集計できる
- Codex app server 経由で LLM 補助分析を実行する
- LLM 補助分析で候補整理、alias 補完案、曖昧コメント分類を確認する
- LLM 補助分析の入力 hash を cache し、同一入力では再利用する
- 低 confidence コメント、LLM の曖昧判定、AI と辞書判定の差分を要確認コメントとして表示する
- 候補・alias を採用または除外する
- 候補の表示名を編集し、alias を手動追加する
- 候補の entity type を人物系と人物外に分けて表示する
- alias を UI から削除する
- 候補を別の人物へ統合する
- 統合済み候補を分割して復元する
- タイトル上のフルネーム候補に、コメント内の短い表記を自動で紐づける
- 表記ごとの検出理由を表示し、集計対象から外す
- 候補信頼度と alias 信頼度を文脈別に表示する
- 表記ごとの代表コメントを候補確認画面で確認する
- 採用済み alias でコメントを分類する
- 人物別言及ランキング、上位コメント内の言及数、単独/同時言及数、raw like sum、いいね加重スコア、代表コメントを表示する
- 人物別詳細で集計表記、ノイズ除外済みの特徴語、代表コメントを確認する
- SudachiPy による日本語形態素解析を使い、`ですよ` などの語尾・機能語・一般語を共通フィルタで除外する
- 分析結果を候補確認、概要、LLM補助、未知 alias、人物詳細、コメント一覧のタブで切り替える
- コメント一覧で本文検索、人物フィルタ、未紐づけ確認を行う
- コメント一覧から人物紐づけの追加・解除を行い、ランキングに反映する
- `report.v1` JSON を生成する

## 必要環境

- macOS
- Python 3.14+
- Bun 1.3+
- SudachiPy + SudachiDict-core

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
DATABASE_URL=
DATA_DIR=
```

`YOUTUBE_API_KEY` が空の場合は fixture を使います。`DATABASE_URL` と `DATA_DIR` が空の場合は、それぞれ `data/app.sqlite3` と `data/` を使います。LLM 補助分析は Codex app server 経由で実行するため、このアプリ専用の OpenAI API key は不要です。

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
4. 返信コメントを含めたい場合は `同梱返信だけ含める` または `返信を追加取得して含める` を選ぶ。
5. 同条件 cache を更新したい場合だけ `差分更新する` を選ぶ。
6. 「分析を開始」を押す。
7. Data Source が `Cache` の場合は同条件の保存済みデータを使っており、YouTube API は再消費していない。
8. YouTube 表示コメント数と取得コメント数の差分を確認する。古い cache や fixture では YouTube 表示コメント数が未取得になる。
9. 人物候補と表記を確認し、必要に応じて採用・除外、表示名編集、表記追加、統合、集計からの除外を行う。
10. 「候補を確定して集計」を押す。
11. タブを切り替えて、概要ダッシュボード、言及ランキング、取得範囲、返信件数、いいね数分布、未知 alias 候補、人物別詳細、代表コメント、section status を確認する。
12. `未知alias` タブで、人物の別表記なら紐づけ先を選んで `alias に追加` する。
13. 必要に応じて `LLM補助` タブで `LLM 補助を実行` を押し、候補整理、alias 補完案、曖昧コメント分類を確認する。
14. `コメント` タブで本文検索や人物フィルタを使い、根拠コメントを確認する。
15. 必要に応じてコメント単位で人物紐づけを追加または解除する。
16. 以前の結果を確認したい場合は、折りたたまれている `過去分析` を開いて run を選ぶ。

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
live API を使う検証は `backend/live_tests/` に分離し、必要なときだけ `bun run test:live` で実行します。

## コメント取得データの保存と再利用

YouTube API の quota を無駄にしないため、live API で取得したコメントは次に保存します。

```text
data/youtube_cache/<video_id>/<fetch_order>_<reply_fetch_mode>_<max_comments>.jsonl
data/youtube_cache/<video_id>/<fetch_order>_<reply_fetch_mode>_<max_comments>.metadata.json
```

同じ動画 ID・取得順・返信モード・最大件数で再分析する場合は cache を読み、API を再度呼びません。テストは live API ではなく `fixtures/` の seed data を使います。最大コメント数の現在の上限は `5000` です。

返信モードの違い:

- `none`: 動画直下のトップレベルコメントだけを取得します。
- `inline_subset`: `commentThreads.list` のレスポンスに同梱される一部返信だけを保存します。全返信は保証しませんが、追加の `comments.list` 呼び出しはありません。
- `full`: `comments.list` で返信を追加ページング取得します。返信数に応じて YouTube API quota を追加消費します。

通常は同条件 cache を再利用します。`force_refresh=true`、または画面の `差分更新する` を選んだ場合だけ live API で再取得し、既存 cache と新規取得結果を `comment_id` で重複排除して保存し直します。

cache metadata には、取得時点で YouTube API から得られた動画タイトル、チャンネル名、YouTube 表示コメント数、再生数、動画いいね数を保存します。過去に作成された古い cache ではこれらの一部が未取得になることがあります。

分析 run ごとの中間成果物は次に保存します。

```text
data/runs/<run_id>/
  raw_comments.jsonl
  person_candidates.json
  mentions.jsonl
  report.json
  llm_assist.json
```

LLM 補助分析の結果は、prompt version と入力内容から作った hash で次にも保存します。

```text
data/llm_cache/<input_hash>.json
```

同一入力では Codex app server を再呼び出しせず、cache 結果を `llm_assist.json` と DB に再保存します。
Codex app server の受信は `turn/completed` だけに依存せず、`agentMessage` 完了イベントまたは thread idle でも完了として扱います。
LLM 補助だけが失敗した場合も、候補抽出・alias・ランキングの通常レポートは有効なまま残し、`sections.llm_assist.status` に `failed` と理由を保存します。

## レビュー UI

- `候補確認`: 人物候補ごとに、entity type フィルタ、集計先の人物名、配下 alias、統合と統合解除を編集します。
- `頻出語レビュー`: 未登録の頻出表記を `alias 候補` / `要確認` / `一般語` に分類し、人物 alias へ追加できます。
- `要確認`: 低 confidence comments、AI 判定と辞書判定の差分、LLM ambiguous classification をまとめて確認できます。
- `人物詳細`: 人物ごとの魅力カテゴリ、tone、要約、根拠コメント、TF-IDF 的に重み付けした特徴語を確認できます。
- `概要`: 言及ランキングで上位コメント内の件数、単独/同時言及、raw likes、weighted score、計算定義を確認できます。
- `関係性`: 同じコメント内で同時に言及された人物ペアの件数、weighted score、代表コメント、簡易カテゴリ、ヒートマップを確認できます。
- `クラスタ`: 5〜12 件の指定クラスタ数を目安に、特徴語ベースでコメント群、代表コメント、主な人物、頻出語を確認できます。
- `コメント`: コメント単位で人物の追加・削除を行い、代表コメントだけでは拾えない言及を補正できます。
- `運用・設定・データ管理`: `YOUTUBE_API_KEY` の読み込み有無、LLM / embedding 状態、保存データ容量、現在 run の JSON export を確認できます。

## 主な API

- `GET /api/health`
- `GET /api/settings`
- `GET /api/data/summary`
- `POST /api/videos/inspect`
- `POST /api/runs`
- `GET /api/runs/{run_id}`
- `GET /api/runs/{run_id}/candidates`
- `POST /api/runs/{run_id}/candidate-actions`
- `POST /api/runs/{run_id}/continue`
- `POST /api/runs/{run_id}/llm-assist`
- `GET /api/runs/{run_id}/report`
- `GET /api/runs/{run_id}/export`
- `GET /api/runs`

## 実装構成

```text
backend/
  app/
    main.py                    FastAPI API
    youtube.py                 YouTube URL parsing, API fetch, cache
    pipeline.py                SQLite schema, run orchestration, persistence
    candidate_extraction.py    rule-based person / alias candidate extraction
    llm_assist.py              Codex app server LLM assist, prompt, cache
    mention_classification.py  alias matching and mention confidence
    report_builder.py          report JSON assembly and fetch coverage summaries
    text.py                    text normalization
    text_filters.py            Japanese morphological analysis and shared keyword filtering
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
- LLM 補助分析は Codex app server 経由で行い、このアプリ専用の OpenAI API key は使いません。
- LLM 補助分析には author 情報を送らず、コメント本文と分析済み候補だけを渡します。
- 現在の API key は Google Cloud Console 側で `YouTube Data API v3` のみに制限してください。

## ロードマップ

完了済み・未実装の整理は [docs/roadmap.md](docs/roadmap.md) を参照してください。

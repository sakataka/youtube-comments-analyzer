# YouTube コメント人物言及分析

YouTube 動画 URL を入力し、取得したコメントから人物・グループ・関係者への言及を抽出して、人物候補、alias、言及ランキング、代表コメントを確認するローカル Web アプリです。

現在の実装は `report.v2` です。YouTube Data API または fixture からコメントを保存し、SudachiPy ベースの日本語解析と accepted alias による deterministic な集計を行います。新規実行時は人物言及・対象別感情・話題カテゴリを含む暫定レポートを先に表示し、曖昧な項目だけを任意のレビューセンターと Codex app server で補正できます。

このリポジトリはローカル実行を前提にしています。YouTube Data API key は各自の環境で `.env` に設定し、取得データや cache は Git 管理しません。

## 現在できること

- YouTube URL から `video_id` を抽出する
- `YOUTUBE_API_KEY` があれば YouTube Data API v3 で最大 5000 件のコメントを取得する
- 返信コメントはデフォルトで追加取得し、返信モードは `none`、`inline_subset`、`full` から選べる
- API key がない場合は `fixtures/sample_comments_drawme.jsonl` で動く
- 取得コメントを SQLite と JSONL artifact に保存する
- live API の取得結果を `data/youtube_cache/` に保存し、同条件では再利用する
- 差分更新を選ぶと live API で再取得し、既存 cache と重複排除して保存する
- 分析開始後に `cache` / `youtube_api` / `fixture` の利用状況を表示する
- 分析 job を同時実行 1 件に制限し、待機中 job を queued として表示する
- サーバー再起動後に `running` / `queued` のまま残った run を `failed_recoverable` にする
- 過去分析 run を一覧表示し、保存済み候補・レポートの再表示、個別削除、一括削除を行う
- 古い run を退避または削除する
- YouTube cache を退避または削除する
- 動画タイトル、チャンネル名、YouTube 表示コメント数、取得コメント数の差分を表示する
- `POST /api/videos/inspect` で cache metadata を確認し、必要時だけ YouTube API で動画 metadata を取得する
- 取得済みコメント内のいいね数分布を表示する
- 概要ダッシュボードで採用人物数、紐づけ済みコメント数、トップ人物を確認する
- 動画全体と人物別に `positive / neutral / negative / mixed / unclear` を集計する
- ルール、固定revisionのローカル日本語モデル、難例だけのAI補助という三段階で感情を判定する
- 感情判定ごとに confidence、method、根拠語句、対象人物を保存する
- 暫定レポートを先に表示し、レビュー完了状態を `provisional / verified` として永続化する
- 分析 job を SQLite に保存し、再起動後も失敗状態と理由を復元する
- 人物別言及数とコメント分類比率をグラフ表示する
- 人物候補と alias 候補を表示する
- 既存 alias にないニックネームらしい頻出表記を未知 alias 候補として表示する
- 未知 alias 候補を既存人物へ追加し、再集計できる
- Codex app server 経由で LLM 補助分析を実行する
- 新規分析時はルール結果を先に表示し、その後にローカルモデルと難例だけのLLM補助をバックグラウンドで反映する
- LLM 補助分析で候補整理、alias 補完案、曖昧コメント分類を確認する。曖昧コメントは自動で人物へ紐づけない
- LLM 補助分析の入力 hash を cache し、同一入力では再利用する
- 人間チェック後の分析結果サマリーを AI に渡し、任意でコメント状況のインサイトを抽出する
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
- SudachiPy の固有名詞/人名、敬称、ひらがな・カタカナ愛称を人物名・愛称候補として抽出する
- 人物名・愛称候補と、特徴語・クラスタ keyword 用の内容語/評価語を分けて抽出する
- `好き`、`良い`、`面白い`、`苦手` などの評価語を、言及済み人物の評価語文脈として人物詳細に表示する
- 外部 NER モデルは初期導入せず、現段階では SudachiPy の人名品詞、敬称パターン、共起で補う方針にする
- 分析結果を `概要 / 人物 / 話題・共起 / コメント` の4領域で確認する
- コメント一覧で本文検索、人物フィルタ、未紐づけ確認を行う
- コメント一覧から人物紐づけの追加・解除を行い、ランキングに反映する
- `report.v2` JSON を生成し、コメント本文はページング API から取得する
- `normalized_comments.jsonl`、`aliases.json`、`clusters.json`、`appeal_labels.json` を run artifact として出力する

## 必要環境

- macOS
- Python 3.14+
- Bun 1.3+
- SudachiPy + SudachiDict-core

## セットアップ

```bash
python3 -m venv .venv
. .venv/bin/activate
uv pip install --python .venv/bin/python -r backend/requirements.txt
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
YOUTUBE_FIXTURE_FALLBACK=
SENTIMENT_LOCAL_MODEL_ENABLED=1
SENTIMENT_MODEL_ID=
SENTIMENT_MODEL_REVISION=
SENTIMENT_CONFIDENCE_THRESHOLD=
SENTIMENT_MODEL_DEVICE=auto
SENTIMENT_MODEL_CACHE_DIR=
```

`YOUTUBE_API_KEY` が空の場合、cache がある動画だけを再分析できます。未cacheの実動画は fixture で代用せず、設定エラーとして止めます。テスト用 fixture を明示的に使う場合だけ `YOUTUBE_FIXTURE_FALLBACK=1` を設定します。`DATABASE_URL` と `DATA_DIR` が空の場合は、それぞれ `data/app.sqlite3` と `data/` を使います。LLM 補助分析は Codex app server 経由で実行するため、このアプリ専用の OpenAI API key は不要です。

ローカル感情モデルは既定で有効です。モデルID、revision、閾値の既定値は `backend/app/sentiment_model_config.json` に固定され、環境変数は一時的な上書きにだけ使います。`SENTIMENT_MODEL_DEVICE=auto` はMPSを優先し、失敗時は同じrunをCPUで再実行します。モデルファイルは `data/model_cache/` に保存され、Gitには追加されません。

## 起動

バックエンド:

```bash
set -a
source .env
set +a
.venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
```

フロントエンド:

```bash
bun run dev
```

Vite は空きポートを自動割り当てします。表示された `Local:` の URL をブラウザで開いてください。開発時の API は Vite proxy が `/api` を `http://127.0.0.1:8000` へ転送します。

## デモ手順

1. バックエンドとフロントエンドを起動する。
2. 画面の URL 欄に YouTube URL を入力する。
3. 最大コメント数を確認する。デフォルトは `5000`。
4. 返信コメントはデフォルトで追加取得される。必要に応じて返信モードを変更する。
5. 同条件 cache を更新したい場合だけ `差分更新する` を選ぶ。
6. 「分析する」を押す。
7. Data Source が `Cache` の場合は同条件の保存済みデータを使っており、YouTube API は再消費していない。
8. 人物言及・感情・話題カテゴリを含む暫定レポートが表示される。
9. `概要` でコメント欄全体の感情、人物ランキング、主要な話題、取得範囲を確認する。
10. `人物` で人物別の言及率、対象別感情、特徴語、根拠コメントを確認する。
11. `話題・共起` で固定キーワードによる話題カテゴリと、同じコメントで一緒に語られた人物を確認する。
12. `コメント` で本文検索と人物フィルタを使い、根拠データをページングして確認する。
13. 必要な場合だけ `レビューセンター` を開き、人物候補や感情判定を修正して確認済みにする。
14. 以前の結果は開始画面の `最近の分析` から開く。

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
bun run test
bun run build
bun run test:e2e
bun run eval:sentiment
```

`bun run test` は live API を使わず、fixture で integration test を通します。評価 fixture では人物言及の precision 90%以上・recall 85%以上と、主要感情3分類の macro-F1 80%以上を下限として検証します。`bun run test:e2e` はデスクトップ 1280px とモバイル 420×912pxで暫定レポートから根拠コメントまでの導線を検証します。

通常テストとE2Eはfake modelを使い、モデルダウンロードを行いません。`bun run eval:sentiment` だけが固定revisionの実モデルを比較し、macro F1、混同行列、閾値、速度、メモリを `/tmp/youtube-comments-analyzer-sentiment-evaluation.json` へ出力します。採用結果は `docs/sentiment-model-evaluation.md` に記録しています。

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
  normalized_comments.jsonl
  person_candidates.json
  aliases.json
  mentions.jsonl
  report.json
  clusters.json
  appeal_labels.json
  llm_assist.json
  ai_insight.json
```

LLM 補助分析の結果は、prompt version と入力内容から作った hash で DB の `llm_cache` に保存します。同一入力では Codex app server を再呼び出さず、cache 結果を run artifact と DB に再保存します。
Codex app server の受信は `turn/completed` だけに依存せず、`agentMessage` 完了イベントまたは thread idle でも完了として扱います。
LLM 補助だけが失敗した場合も、候補抽出・alias・ランキングの通常レポートは有効なまま残し、`sections.llm_assist.status` に `failed` と理由を保存します。
AI インサイトは分析確定後の任意実行です。個別コメント全文ではなく、言及ランキング、共起、クラスタ、魅力カテゴリ、品質確認件数などの集計済みサマリーだけを Codex app server に渡し、結果を `ai_insight.json` と DB に保存します。

分析 job はアプリ内 queue で同時実行 1 件に制限します。現段階では single-process の `ThreadPoolExecutor(max_workers=1)` で十分なため、本格的な外部 worker / queue 分離は複数プロセス運用や長時間 job が必要になった段階で検討します。

## レポート UI

- `概要`: 動画全体の感情分布、人物ランキング、主要な話題、取得範囲、AI サマリーを表示します。
- `人物`: 言及数・言及率・対象別感情を比較し、人物ごとの特徴語と根拠コメントへ掘り下げます。
- `話題・共起`: 固定キーワードによる話題カテゴリと、同じコメント内で一緒に言及された人物ペアを表示します。共起を人間関係そのものとは断定しません。
- `コメント`: コメント本文を DB からページングし、検索と人物フィルタで根拠を確認します。
- `レビューセンター`: 人物候補、低 confidence の紐づけ、感情の曖昧判定だけを任意で修正します。
- `設定とデータ`: API key の読み込み状態、保存容量、YouTube cache の退避・削除を主画面から分離して扱います。

## 主な API

- `GET /api/health`
- `GET /api/settings`
- `GET /api/data/summary`
- `POST /api/data/actions`
- `POST /api/videos/inspect`
- `POST /api/runs`
- `GET /api/jobs/{job_id}`
- `GET /api/runs/{run_id}`
- `GET /api/runs/{run_id}/candidates`
- `POST /api/runs/{run_id}/candidate-actions`
- `POST /api/runs/{run_id}/comment-actions`
- `POST /api/runs/{run_id}/sentiment-actions`
- `POST /api/runs/{run_id}/sentiment/reanalyze`
- `GET /api/runs/{run_id}/sentiment-overrides/export`
- `POST /api/runs/{run_id}/review/complete`
- `POST /api/runs/{run_id}/llm-assist`
- `GET /api/runs/{run_id}/ai-insight`
- `POST /api/runs/{run_id}/ai-insight`
- `GET /api/runs/{run_id}/report`
- `GET /api/runs/{run_id}/comments`
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

## トラブルシューティング

開発中に `Failed to fetch` が出る場合や、Vite proxy とバックエンド URL の確認が必要な場合は [docs/troubleshooting.md](docs/troubleshooting.md) を参照してください。

## ライセンス

MIT License です。詳細は [LICENSE](LICENSE) を参照してください。

## ロードマップ

完了済み・未実装の整理は [docs/roadmap.md](docs/roadmap.md) を参照してください。

# YouTube コメント人物言及分析ツール 現行仕様

この文書は、現在動いている実装の契約と、変更時に守る不変条件だけを記載する。
過去のMVP計画や実装済みの設計案は仕様として扱わず、ソースコードとテストを最終的な根拠とする。

## 目的

YouTube動画のコメント欄から、次の情報を確認できるローカルWebアプリを提供する。

- よく言及されている人物とalias
- 人物別の言及量、感情、特徴語、代表コメント
- コメント欄全体の感情分布と時間変化
- 話題カテゴリと人物の共起
- 低確度または曖昧な判定の根拠
- 集計済みデータを使った任意のAIインサイト

動画そのものの内容や外部情報は分析根拠にせず、取得したコメント、動画タイトル、概要欄、YouTube metadataだけを使う。

## 現行構成

```text
React UI
  -> FastAPI
    -> AnalysisStore (SQLite、run、artifact)
    -> YouTubeCommentClient (API、fixture、cache)
    -> deterministic analysis
    -> local sentiment model
    -> Codex app server (難例と任意インサイト)
```

主要ファイル:

- `backend/app/main.py`: API、単一job executor、設定
- `backend/app/pipeline.py`: SQLite、run orchestration、永続化
- `backend/app/youtube.py`: URL解析、YouTube API、cache
- `backend/app/candidate_extraction.py`: 人物・alias候補抽出
- `backend/app/sentiment.py`: ルール感情判定と統合
- `backend/app/sentiment_service.py`: ローカルモデルとAI補助の再判定
- `backend/app/report_builder.py`: `report.v2` の純粋な集計
- `backend/app/llm_assist.py`: Codex app server、prompt、応答検証
- `src/App.tsx`: 画面状態とAPI操作
- `src/components/ReportView.tsx`: レポート表示
- `src/components/ReviewCenter.tsx`: 人物・感情レビュー

## 守る不変条件

### コメント取得

- 実YouTube URLは、API keyがない場合にfixtureへ自動フォールバックしない。
- fixtureは `YOUTUBE_FIXTURE_FALLBACK=1` を明示したテストだけで使う。
- 同じ動画、取得順、返信モード、最大件数のcacheは再利用する。
- `force_refresh=true` の場合だけ再取得し、`comment_id` で重複排除する。
- 返信モードの既定値は `full` とする。
- YouTube API keyや秘密値をレスポンス、ログ、LLM入力へ含めない。

### 人物とalias

- 集計にはaccepted personのaccepted aliasだけを使う。
- 短いalias、一般語、番組・企画名らしい語は誤爆を抑制する。
- 候補の採用、除外、表示名変更、alias追加・削除、統合・分割を保存する。
- 候補変更後は同じAPI処理内で人物分類とレポートを再生成する。
- 曖昧なコメントをLLM結果だけで自動的に人物へ紐づけない。

### 感情判定

- ルール、固定revisionのローカルモデル、難例だけのAI補助の順に処理する。
- ローカルモデルが失敗してもルール結果を有効なまま残す。
- AI補助が失敗しても通常レポートを有効なまま残す。
- 人間によるoverrideは再判定後に必ず再適用する。
- LLMへ送るコメント数は設定された上限とbatch sizeに従う。
- 通常テストとE2Eではfake modelを使い、モデルをダウンロードしない。

### レポートと永続化

- 現行レポートは `report.v2` とする。
- コメント全文の全件配列をレポートへ埋め込まず、ページングAPIから取得する。
- SQLiteの `reports` はrunごとに現在のレポート1件だけを保持する。
- `clusters` と `appeal_summary` はreport JSONとrun artifactに保存し、派生DBテーブルへ二重保存しない。
- run artifactは再現、確認、エクスポートに使うため維持する。
- APIのGET処理で古いレポートを暗黙に移行したりDBを書き換えたりしない。

### AI入力

- author名、author channel ID、API key、ローカル絶対パスを送らない。
- AIインサイトには集計値と限定した代表コメントだけを送る。
- prompt versionと入力内容からcache keyを作る。
- cache hitではCodex app serverを再呼び出さない。
- JSON応答はschema検証と正規化を通してから保存する。

## データフロー

### 新規分析

1. URLを検証する。
2. cacheまたはYouTube APIからコメントを取得する。
3. 動画、snapshot、コメント、runをSQLiteへ保存する。
4. 人物とalias候補を抽出する。
5. accepted aliasで人物言及を分類する。
6. ルール感情判定と話題集計を行い、暫定レポートを表示する。
7. ローカルモデルと難例だけのAI補助をbackground jobで反映する。
8. 必要な場合だけレビューセンターで修正する。

### 候補修正

1. `candidate-actions` へ操作を送る。
2. action logと候補状態を更新する。
3. 人物言及、感情、レポートを再集計する。
4. 更新済み候補とレポートを同じレスポンスで返す。
5. 必要な感情再判定をbackground jobで開始する。

### 感情再判定

1. コメント全体と人物別targetを準備する。
2. rule結果とローカルモデル結果を統合する。
3. 低確度、不一致、mixed、曖昧表現だけをAI候補にする。
4. 設定上限内の候補をbatch処理する。
5. 人間overrideを再適用する。
6. 現在のレポートとartifactを置き換える。

## 永続化

SQLiteの主要テーブル:

- `videos`
- `comment_snapshots`
- `comments`
- `analysis_runs`
- `analysis_jobs`
- `persons`
- `aliases`
- `comment_mentions`
- `comment_mention_overrides`
- `sentiment_labels`
- `sentiment_overrides`
- `reports`
- `candidate_action_logs`
- `llm_assists`
- `ai_insights`
- `llm_cache`

run artifact:

```text
data/runs/<run_id>/
  raw_comments.jsonl
  normalized_comments.jsonl
  person_candidates.json
  aliases.json
  mentions.jsonl
  sentiment_labels.jsonl
  report.json
  clusters.json
  appeal_labels.json
  llm_assist.json
  ai_insight.json
```

## API

- `GET /api/health`
- `GET /api/settings`
- `GET /api/data/summary`
- `POST /api/data/actions`
- `POST /api/videos/inspect`
- `POST /api/runs`
- `GET /api/jobs/{job_id}`
- `GET /api/runs`
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

## `report.v2` の主要フィールド

- `video`
- `fetch_summary`
- `persons`
- `alias_suggestions`
- `rankings.mention_ranking`
- `sentiment.overall`
- `sentiment.timeline`
- `sentiment.per_person`
- `sentiment.review_items`
- `appeal_summary`
- `topics`
- `clusters`
- `cooccurrence`
- `quality_review`
- `review`
- `evidence`

## 変更時の判断基準

- 削除、統合、既存経路の直線化を優先する。
- ファイル数、関数数、抽象化レイヤーだけを増やす変更は避ける。
- 現在使われていない互換処理は、現行データと利用先を確認して削除する。
- DBとartifactの二重保存は、読み出し用途がなければ追加しない。
- shadcn/RadixのUI primitiveは、アクセシビリティ上の理由があるため利用数だけで削除しない。
- `pipeline.py` の機械的分割は行わず、重複削除後も変更範囲が広すぎる場合だけ再検討する。

## 検証

通常の変更では次を実行する。

```bash
bun run test
bun run build
bun run test:e2e
bunx knip --no-progress
ruff check backend/app backend/tests --select F401,F811,F841
git diff --check
```

UI変更ではデスクトップ、420×912、ダークモード、キーボード操作、フォーカス復帰、横方向overflowも確認する。
永続化やAPIを変更した場合は、repo内テストだけでなく、常駐APIのOpenAPIとliveレスポンスも確認する。

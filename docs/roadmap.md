# 実装ロードマップ

この文書は [requirements.md](requirements.md) を基準に、まだ実装・検証・改善が残っている項目だけを残した backlog です。

完了済みの実装詳細はここには載せません。現状の使い方と実装済み機能は [../README.md](../README.md) を参照してください。

## 現在の前提

- MVP-0 の基本フローは動作済み。
- 今回設定した Step 1 から Step 7 は完了済み。
- MVP-2 の高度分析は一旦保留。
- Codex app server 連携は最小実呼び出しで受信成功を確認済み。

## 次に進める順番

1. 頻出語レビュー UI
2. LLM 失敗時の degraded report
3. 人物別魅力分析
4. 共起・関係性分析
5. コメントクラスタリング
6. 運用・設定・データ管理の整理

## P0: 直近で確認・修正したいもの

### 頻出語レビュー UI

- 頻出語を `人物候補` / `alias 候補` / `一般語` / `要確認` に分類して表示する。
- 未知 alias 候補と統合し、ユーザーが採用・除外・保留を判断できるようにする。
- 一般語や企画名がランキングに混ざる場合の除外導線を整理する。

### degraded report

- LLM 補助分析が失敗しても、通常の候補抽出・分類・ランキングは completed のまま維持する。
- report の section status に `failed` と失敗理由を残す。
- UI で「LLM だけ失敗」「全体分析は有効」を明確に分けて表示する。

## MVP-1: 分析品質

### 人物候補と alias

- `person`, `group`, `duo` 以外の entity type を折りたたみ・フィルタ表示する。
- alias 削除を UI から行えるようにする。
- 誤って統合された候補を分割できるようにする。
- LLM なしの初期検証動画で alias 誤爆を確認し、抑制ルールを追加する。
- confidence 表示を「候補信頼度」「alias 信頼度」「分類信頼度」など文脈別に整理する。

### 低信頼・曖昧コメント

- low confidence comments を一覧表示する。
- AI 判定と辞書判定が食い違ったコメントを表示する。
- 人間確認を推奨する項目をまとめる。
- LLM ambiguous classification の batch、retry、schema validation を実装する。

### 言及ランキング

- 上位 N コメント内での言及数を表示する。
- 複数人物同時言及数を表示する。
- 単独言及数を表示する。
- `raw_like_sum` と `like_weighted_score` を分けて表示する。
- 上位コメントの定義を UI または設定で確認できるようにする。

### 人物別魅力分析

- 魅力カテゴリ別件数を出す。
- tone `positive` / `neutral` / `mixed` / `negative` / `unclear` を分類する。
- 人物別 AI 要約を生成する。
- AI 要約の根拠コメントを表示する。
- negative は過度に強調せず、一定件数以上のみ注意点として表示する。

## MVP-2: 高度分析

MVP-2 は現時点では保留。ただし要件としては残す。

### 共起・関係性分析

- 人物 A と人物 B の同時言及数を集計する。
- 共起のいいね加重を出す。
- 共起代表コメントを表示する。
- 関係性カテゴリを付ける。
- 共起ネットワークまたはヒートマップを表示する。

### コメントクラスタリング

- embedding または特徴量でコメントをクラスタリングする。
- クラスタ名、件数、代表コメント、主な人物、頻出キーワードを表示する。
- AI によるクラスタ説明を生成する。
- クラスタ数を 5 から 12 程度で調整できるようにする。

### 日本語解析

- 日本語形態素解析を導入する。
- 固有表現抽出モデルを検討する。
- 助詞・係り受けを使った alias 文脈判定を検討する。
- 人物ごとの特徴語を単純頻度だけでなく TF-IDF 的に重み付けする。

## 運用・設定・データ管理

### 設定画面

- YouTube API key の読み込み状態を表示する。
- API key の値そのものは表示しない。
- fetch order、reply mode、max comments、差分更新の意味を設定画面でも確認できるようにする。
- LLM / embedding の有効無効を設定として扱う。

### データ管理

- cache / run / backup の容量を UI で確認できるようにする。
- 古い run と cache を削除または退避できるようにする。
- live API test と通常 test を明確に分離する。
- 生データ export は明示操作として実装する。

### ジョブ実行

- 同時実行ジョブ数 1 の queued 状態を実装する。
- 実行中に新しい job が来た場合の待機表示を実装する。
- サーバー再起動後に `running` のまま残った job を `failed_recoverable` にする。
- 本格的な worker / queue 分離を検討する。

## API / データモデルの残り

- `POST /api/videos/inspect` で必要に応じて動画 metadata を確認できるようにする。
- `appeal_labels` 相当の保存を実装する。
- `clusters` 相当の保存を実装する。
- LLM cache の DB 管理を、現在の `llm_assists` / file cache から要件上の汎用 `llm_cache` に寄せるか判断する。
- `normalized_comments.jsonl`、`aliases.json`、`clusters.json` artifact の出力方針を決める。

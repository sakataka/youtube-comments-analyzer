# Product: YouTube コメントインサイト

<!-- impeccable:product-schema 1 -->

2026-09-21。ユーザーのパイロット依頼、README、現行コード、稼働画面に基づく記録。新機能やUI変更を承認する文書ではない。

## Platform

web

## Users

個人でYouTube動画の反応を調べる所有者が主な利用者。個人用の情報密度が高い分析ツールであり、一般向けSaaS、販売ページ、チーム運用製品ではない。

## Product Purpose

公開コメントの全件集計、抽出要約、人物への言及、任意のJev分類を参照し、根拠原文に戻りながら話題と反応を把握する。操作速度、根拠原文への到達、状態の明確さを優先する。

## Operating Context

- macOS / Apple Silicon上のローカルアプリ。開発機はM4 Pro・24GBメモリ。
- React / TypeScript / Vite / Tailwind / Radix系UI、Pythonバックエンド。JavaScriptはBun（package.jsonのpackageManagerが基準）、Pythonは既存uv環境を使う。
- LocalWebの通常ホストは `http://youtube-comments-analyzer.localhost/`。`?run=...` で保存済み分析を開く。
- デスクトップとモバイルWebを扱う。主なモバイル確認対象は420×912 CSS px。周辺幅でも操作できること。OSのダークモードに追従する。
- URL入力→取得と集計→要約・人物集計→必要ならJev分類→原文検索・絞り込み・並べ替え、というワークフロー。

## Capabilities and Constraints

- 全件集計・検索・並べ替えはAIを使わない。「全件」は取得できた範囲であり、削除・非公開の投稿は含まない。
- 取得は1回最大5,000件。要約は最大250件の抽出コメントを使用。親・返信・投稿時期の無作為抽出を中心に高評価・返信多数を補足する。要約から全体の賛否率を推定しない。
- 要約と人物辞書は通常各1回、修復込み最大4回。通常要約180秒、処理全体15分の期限。取得済みデータとチェックポイントを保持する。
- 人物集計は名前・別名辞書の一致を全件から数える。評価はルールによる参考値。「判定できず」は中立ではない。辞書未一致を人物への言及なしと解釈しない。
- Jevは任意。取得済みのいいね上位最大500件を最大10並列・5分で分類し、本文・返信先・動画タイトルをTypeSafeへ送る。種類と5段階評価に加え、賛否混在と判定困難を区別する。低確信度は暫定。過去の固定抽出結果も表示可能。
- 同一入力の分類キャッシュ、停止、途中保存、再試行を維持する。APIキーはサーバー側の.envに置き、UIやGitへ公開しない。
- 旧report.v3の保存結果を保持する。v4を主対象に評価するが旧結果を無断で削除・変換しない。

## Brand Commitments

表示名は「コメントインサイト」／「YouTube コメントインサイト」。日本語で具体的に伝え、分析対象・分母・限界・状態を明示する。派手なSaaS化は不要。見栄えのための販促コピー、架空の利用者や実績、装飾的な画像・動きは追加しない。

## Evidence on Hand

- README.md、docs/lightweight-analysis-design.md、docs/person-statistics-design.md。
- src/components/StartScreen.tsx、LightReportView.tsx、JevClassification.tsx、PersonStatisticsView.tsx、SettingsPanel.tsx、src/styles.css。
- e2e/ の原文到達・検索、人物集計、Jev分類・再利用、設定フォーカス、削除確認のテスト。
- 稼働画面に保存済みv4結果がある。実原文・APIキー・DB・スクリーンショットはこの文書やGitへ転記しない。性能の実例を一般的な保証にしない。

## Product Principles

1. 分析の見栄えより、原文と集計の正確な範囲を確認できること。
2. 取得、要約、人物集計、Jev分類の状態と母集団を混同させないこと。
3. 情報密度を保ちながら、目的の情報へ短い操作で到達できること。
4. 失敗時も取得済みデータを失わず、続行・停止・再試行を理解できること。
5. 既存の利用習慣と標準的な操作を尊重し、装飾のために作業を遅くしないこと。

## Accessibility & Inclusion

キーボード、ラベル、フォーカス、状態通知、文字の読みやすさ、タッチ操作、縮小幅、ダークモードを検証対象とする。WCAG適合認証や実機VoiceOverの検証完了は主張しない。

## Review Boundary

第1段階は導入・記録・critique・auditのみ。UIコードは変更しない。指摘は客観的不具合、有用そうなUX改善、採用不要の美的嗜好を分ける。次のUI修正は別途承認が必要。新規画面の制作手順、ブランド刷新、live編集、hookの有効化は未決定であり、この文書から承認を推定しない。

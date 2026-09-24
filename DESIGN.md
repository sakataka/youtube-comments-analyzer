---
name: YouTube コメントインサイト
description: 原文への到達と状態の明確さを優先する個人用分析ツール
colors:
  primary: "#2f6fdb"
  background: "#fafafa"
  foreground: "#18181b"
  card: "#ffffff"
  muted: "#f4f4f5"
  muted-foreground: "#71717a"
  border: "#e4e4e7"
  accent: "#dce9ff"
  dark-primary: "#78a5f5"
  dark-background: "#18181b"
  dark-foreground: "#fafafa"
  dark-card: "#27272a"
  dark-muted: "#3f3f46"
  dark-muted-foreground: "#d4d4d8"
  dark-border: "#52525b"
typography:
  body:
    fontFamily: 'Inter, "Hiragino Sans", ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    lineHeight: 1.5
    letterSpacing: "0.01em"
  start-heading:
    fontSize: "clamp(28px, 3vw, 36px)"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  report-heading:
    fontSize: "clamp(1.35rem, 2.4vw, 1.9rem)"
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  original:
    lineHeight: 1.9
rounded:
  base: "8px"
  topic-card: "12px"
  person-card: "14px"
  progress: "16px"
spacing:
  controls-gap: "10px"
  grid-gap: "20px"
  card-padding: "24px"
  mobile-inset: "18px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.card}"
    height: "44px"
  topic-card:
    rounded: "{rounded.topic-card}"
    padding: "{spacing.card-padding}"
---

# Design System: YouTube コメントインサイト

## Overview

2026-09-21時点の既存実装を記録した文書。現行CSS・コンポーネントが事実の根拠であり、記載値は新たなスタイル変更命令ではない。実装変更時は本記録も更新する。

個人用の情報密度が高い分析ツール。白・グレー・青、境界線、文字の階層で集計・原文・操作を整理する。操作速度、根拠原文への到達、状態の明確さを優先し、派手なSaaS化は行わない。デスクトップ、420×912pxと周辺幅、ダークモードを維持する。

新しい比喩・雰囲気・ブランド名は選定していない。Impeccableの一般的な「大胆さ」より、依頼された既存UIの維持が優先される。

## Colors

frontmatterはsrc/styles.cssの:rootと.darkからの抜粋。青を操作と強調に使い、本文・補足・背景・区切りに無彩色系トークンを使う。OS設定への追従はsrc/App.tsxが行う。

賛否・評価の区分色は`--fill-positive`（緑）、`--fill-neutral`（グレー）、`--fill-negative`（赤）、`--fill-mixed`（黄土）の固定色。区分名・件数・割合も併記し、色だけに意味を依存しない。感情・人物件数・場面など区分のない棒は青（primary）。

--destructiveは現状ではライト時にforeground、ダーク時に明るいforegroundと同じ色。これも現状記録であり、赤へ変更する方針ではない。

## Typography

既存のsans-serifスタックを維持する。InterはCSSの候補であり、配信フォントの存在を意味しない。日本語はHiragino等の環境フォントにフォールバックする。

本文の基本line-heightは1.5、原文は1.9。補足はおおむね0.8rem、操作は14px前後、見出しには既存のclamp指定がある。数値はtabular-numsを使う箇所がある。見出し・段落にはoverflow-wrap:anywhere、原文にはwhite-space:pre-wrapを設定する。

## Layout

- 開始画面：最大1376px、左右合計64pxの余白。セクション番号と内容を230px / 残幅の2列で配置。
- レポート：最大1120px、左右32px。タイトル→1行の状況バー→追従するタブ（概要・反応・人物・場面・X・原文）。カードは2列。
- 980px以下で開始画面の番号列を100pxへ縮め、履歴を1列にする。
- 開始画面は650px以下で番号列を非表示、URLフォームを1列、左右18pxにする。レポートは760px以下で左右16px、カード・人物・賛否と感情を1列、集計値を2列にする。
- 520px以下で横棒はラベルと数値を上段、バーを下段にする。タブは横スクロールで1行に収める。
- 概要タブは集計値→全体の反応・よく話題にされた人物→AIの話題→Xの要約→「この分析について」。長い注意書きは各タブ末尾のdetailsへまとめる。
- 棒・件数・「根拠の原文を読む」は右側のサイドパネル（幅640px、狭い幅では全画面）に該当原文を30件ずつ開く。閉じると押したボタンへフォーカスを戻す。原文タブは常にマウントし、検索と並べ替えをタブ切り替え後も保持する。
- bodyはmin-width:320px、overflow-x:hidden。ページ幅検査だけでなく、内側の切れ・重なりも確認する。

## Elevation & Depth

主要画面はほぼフラットで、境界線と背景の差で整理する。設定モーダルのbox-shadowはnone。共通Dialog等のライブラリ由来スタイルを含め、全面的に「影なし」とは断定しない。

hover / focusは短い色変化とリングで示す。body等は120ms ease-out、共通ボタンは100ms。CSSのreduced-motionではアニメーションと遷移を0.01msへ短縮し、htmlのsmooth scrollをautoへ変更する。実行中を示す状況バーの点滅とサイドパネルの出現も、この設定で実質的に止まる。

## Shapes

基本半径は8pxで、フォーム・カード・進行状況には6〜16pxの差がある。表面的な半径の統一だけを目的に変更しない。リストは境界線、話題・人物はまとまりを表すカードを用いる。

## Components

- **Button**：Radix Slotとcva、default / outline / secondary / ghost / destructive / link。標準44px、small36px、large52px。disabled、hover、focus-visibleを持つ。タッチ適性はラベルや間隔も含め検査する。
- **入力**：開始フォームと原文検索は共通Input、並べ替えはnative select。
- **ヘッダー**：名称、設定、レポート時の「新しい動画を分析」。横幅を狭めると文字と間隔を縮める。
- **状況バー**：処理段階（点の色で実行中・完了・要対応）、取得件数、要約に使った件数、AI呼び出し回数、停止・再試行・続き取得。
- **タブ**：Radix Tabs。表示中のタブはURLの`tab`に保存する。人物数と原文件数をバッジで示す。
- **サイドパネル**：Radix Dialogを右側に固定。タイトルに絞り込み条件を表示する。
- **人物**：人物ごとの言及数、いいね上位20件中の件数と全いいねの割合、モデル判定の内訳（ルール判定はdetails）。押すと原文を開き、ルール判定で開いた場合は一致名・評価表現・保留理由を表示する。
- **話題カード**：説明、反応、引用、「根拠の原文を読む」。原文の同一性を保つ。
- **Dialog / AlertDialog**：設定・破壊的操作の確認。既存のフォーカス移動、Escape、キャンセル復帰を維持する。

## Do's and Don'ts

- Do: 情報密度と原文への到達を優先し、操作結果・対象・分母・進行状態を明示する。
- Do: 既存の日本語、system font、白・グレー・青、標準的な部品を尊重する。
- Do: 1440pxと420×912px、ライトとダークで、表示・フォーカス・操作・内部overflowを確認する。
- Don't: 汎用の美的警告だけを理由に装飾フォント、彩度、画像、hero、アニメーションを追加しない。
- Don't: ヒューリスティックの「4択まで」「カード禁止」「44px未満はすべて違反」を機械的に適用しない。分析カテゴリの数と標準の適用条件を確認する。
- Don't: 第1段階の指摘をUI変更の承認と解釈しない。

## 承認済みの操作改善

- 2026-09-21：固定追従ナビ、話題から原文への移動時の対象表示、件数表示の正確化。
- 2026-09-24：縦長の1ページをタブ構成へ変更し、原文はサイドパネルで開く形にした。人物の表示を人物タブへ統合し、Jev分類・旧v3詳細画面・重複した説明文を削除した。

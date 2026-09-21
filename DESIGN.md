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
    fontSize: "clamp(1.6rem, 3vw, 2.4rem)"
    lineHeight: 1.45
    letterSpacing: "-0.035em"
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

Jevの評価バーと人物集計には緑、オレンジ、赤、紫、グレーの区分色があり、一部は固定色。区分名・件数・割合も併記し、色だけに意味を依存しない。固定色の存在だけで不具合と判断せず、両テーマの実表示で検証する。

--destructiveは現状ではライト時にforeground、ダーク時に明るいforegroundと同じ色。これも現状記録であり、赤へ変更する方針ではない。

## Typography

既存のsans-serifスタックを維持する。InterはCSSの候補であり、配信フォントの存在を意味しない。日本語はHiragino等の環境フォントにフォールバックする。

本文の基本line-heightは1.5、原文は1.9。補足はおおむね0.8rem、操作は14px前後、見出しには既存のclamp指定がある。数値はtabular-numsを使う箇所がある。見出し・段落にはoverflow-wrap:anywhere、原文にはwhite-space:pre-wrapを設定する。

## Layout

- 開始画面：最大1376px、左右合計64pxの余白。セクション番号と内容を230px / 残幅の2列で配置。
- レポート：最大1180px、左右32px、縦方向のセクション。話題カードは2列。
- 980px以下で開始画面の番号列を100pxへ縮め、履歴を1列にする。
- 650px以下で番号列を非表示、URLフォームと話題カードを1列、左右18pxにする。
- 520px以下でJevバーはラベルと数値を上段、バーを下段にする。
- 現状のレポート順は状況→全件集計→Jev→人物集計→抽出話題→全原文。原文は30件ずつ、Jev原文は20件ずつ表示する。この順序は観測事実であり、改善不可という制約ではない。
- bodyはmin-width:320px、overflow-x:hidden。ページ幅検査だけでなく、内側の切れ・重なりも確認する。

## Elevation & Depth

主要画面はほぼフラットで、境界線と背景の差で整理する。設定モーダルのbox-shadowはnone。共通Dialog等のライブラリ由来スタイルを含め、全面的に「影なし」とは断定しない。

hover / focusは短い色変化とリングで示す。body等は120ms ease-out、共通ボタンは100ms。CSSのreduced-motionではアニメーションと遷移を0.01msへ短縮し、htmlのsmooth scrollをautoへ変更する。JavaScriptから明示するsmooth scrollの扱いは別途検証する。

## Shapes

基本半径は8pxで、フォーム・カード・進行状況には6〜16pxの差がある。表面的な半径の統一だけを目的に変更しない。リストは境界線、話題・人物はまとまりを表すカードを用いる。

## Components

- **Button**：Radix Slotとcva、default / outline / secondary / ghost / destructive / link。標準44px、small36px、large52px。disabled、hover、focus-visibleを持つ。タッチ適性はラベルや間隔も含め検査する。
- **入力**：開始フォームと全原文検索は共通Input。Jev検索はnative input、selectはnative。混在は既存事実。実測の使いづらさがあれば改善候補とする。
- **ヘッダー**：名称、設定、レポート時の「新しい動画を分析」。横幅を狭めると文字と間隔を縮める。
- **状況**：取得件数、抽出件数、要約系AI呼び出し回数、処理段階、停止・再試行。Jevの使用量は別セクション。全体と部分の意味を変えない。
- **Jev**：押せる評価バー、選択状態aria-pressed、種類・論調・本文検索、分類結果と確信度details。旧抽出と新しい上位500件を区別する。
- **人物**：人物ごとの言及数と4区分。押すと原文を絞り込み、一致名・評価表現・保留理由を表示する。
- **話題カード**：説明、反応、引用、「根拠の原文を読む」。原文の同一性を保つ。
- **Dialog / AlertDialog**：設定・破壊的操作の確認。既存のフォーカス移動、Escape、キャンセル復帰を維持する。

## Do's and Don'ts

- Do: 情報密度と原文への到達を優先し、操作結果・対象・分母・進行状態を明示する。
- Do: 既存の日本語、system font、白・グレー・青、標準的な部品を尊重する。
- Do: 1440pxと420×912px、ライトとダークで、表示・フォーカス・操作・内部overflowを確認する。
- Don't: 汎用の美的警告だけを理由に装飾フォント、彩度、画像、hero、アニメーションを追加しない。
- Don't: ヒューリスティックの「4択まで」「カード禁止」「44px未満はすべて違反」を機械的に適用しない。分析カテゴリの数と標準の適用条件を確認する。
- Don't: 第1段階の指摘をUI変更の承認と解釈しない。

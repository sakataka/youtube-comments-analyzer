# Impeccable パイロット導入記録

2026-09-21。UIコードを変更しない第1段階。調査対象の実装コミットは `d870bc8621af0796e66cb402ad0fcafe456f0e35`。

## 導入と根拠

- 公式手順：[GitHub README](https://github.com/pbakaus/impeccable)、[公式docs](https://impeccable.style/docs/)、[FAQ](https://impeccable.style/faq/)。Codexのproject-local skillは `.agents/skills/`。`$impeccable` で呼び出す。
- [公式npmレジストリ](https://registry.npmjs.org/impeccable/latest)でinstaller安定版4.1.0、Node >=22.18.0、optional dependency `@impeccable/cli-darwin-arm64:0.1.5`を確認。
- [公式リリース](https://github.com/pbakaus/impeccable/releases/tag/skill-v4.3.1)のskill 4.3.1がインストールされた。installer版、skill版、engine版は異なる。
- ローカル環境：arm64、Bun 1.4.2、Node v24.21.0。ネイティブengineはMach-O 64-bit arm64。Rosetta不要でcontext/detectが実行できた。
- 通常のinstallerはhookも導入する。実際の `install --help` で `--no-hooks` を確認し、次を実行した。

```sh
bunx impeccable@4.1.0 install -y --providers=codex --scope=project --no-hooks
```

公式例のnpxを既存Bun方針に合わせてbunxへ置き換えた。package.jsonへの恒久依存追加はない。Bunの一時パッケージ取得ログにはSaved lockfileが出るが、プロジェクトのbun.lockは未変更。導入したスキルは次のターンから発見される想定。見えなければタスク／Codexを再読み込みする。今回は導入済みSKILL.mdと参照手順を直接読んで実行した。

## 追加・生成物

- `.agents/skills/impeccable/`：公式Codex向け配布スキル56ファイル、約2.1MB。SKILL、reference、launcher、補助JS、Codex agent定義。プラットフォームengineは別途ローカル配置。
- `PRODUCT.md`：目的・利用者・データの意味・制約。依頼文と既存実装から確認済みの内容を記録。
- `DESIGN.md`：既存トークン・レイアウト・テーマ・部品・維持すべき方針。全面刷新の方向付けではない。
- `.impeccable/design.json`：既存motion/breakpointの最小sidecar。live preview未設定、架空の色階調・部品は生成しない。
- [critique / audit結果](../.impeccable/critique/2026-09-21T08-46-46Z__src-components-lightreportview-tsx.md)。独立A/B、分類、根拠、優先度、E2Eとの重複を記載。
- [機械検出結果](../.impeccable/critique/2026-09-21-detector.json)：27件、リポジトリ相対パス。
- [導入manifest](impeccable-installation.json)：版、実行コマンド、engineとスキル本文のSHA-256。
- `docs/licenses/impeccable/`：公式skill-v4.3.1のLICENSEとNOTICEをそのまま保持。
- `.gitignore`：platform engineとImpeccableの一時生成物を除外。共通文書・critiqueは追跡する。

## hook・依存・動作範囲

`.codex/hooks.json`は存在しない。別providerの設定は作成していない。配布ファイル内のreference/hooks.mdやhook関連コマンドは手動手順の資料であり、自動実行hookの登録ではない。contextも自動hookがactiveでないと報告した。

グローバルなスキル登録、拡張機能、サービス、live-server、CSP変更、CI設定、package依存は追加していない。package.json / bun.lock / AGENTS.md / src / backend / e2e / build設定に差分なし。Bunの一時キャッシュとプロジェクト内native engineは通常のツール取得物として残る。

## 再現・更新・戻し方

```sh
# インストール済みのエンジンを手動利用
.agents/skills/impeccable/scripts/impeccable detect --json src
```

`critique`と`audit`はチャット内のskill手順であり、`impeccable critique`というCLI実行ではない。今回は各referenceを読み、独立レビュー、detector、実ブラウザ検査を組み合わせて実行した。

更新時はdiffを確認し、同じ `--providers=codex --scope=project --no-hooks` 条件を維持する。素の `update` はhookを導入し得るので無条件には実行しない。installer4.1.0指定だけでは将来のskill配布版まで固定されないため、今回の正本はcommitされたファイルとmanifest。再取得時は版とハッシュを照合する。

native engineはGitから除外した。新しいcheckoutでは手動使用時にlauncherがversion-pinned engineをユーザーキャッシュへダウンロードし得る（checksum検証あり）。同じプロジェクト内に置く場合は公式installerで再取得し、生成diffとhook不在を確認する。

戻す場合は本パイロットの導入commitを通常のrevert対象とする。UIやDBを戻す操作は不要。ユーザーが作った他のskill、グローバル設定、APIキーを削除しない。

## 検証と限界

- `context`成功、`detect --json src`成功（exit 2は指摘あり）。Mach-O ARM64を実行。
- 既存E2E：14成功、4件は設定上の重複スキップ。PC・420px・ダークで既存操作を維持。
- 実画面：1440×1000、420×912、ライト・ダーク。開始・レポート・設定・絞り込みとfocusを確認。対象で大きな横overflow・framework overlay・console error/warnなし。
- 一時画像と独立評価本文は `/tmp/impeccable-pilot/` に保持し、Gitに含めない。原文はこの資料へ転載しない。
- A/Bの独立性を維持。AはBやdetectorを読まず、A完了後に親がBを読む方式。
- overlay注入/live編集は実施せず、detectorのソース出力と通常のDOM・AX・実画像を証拠にした。ブラウザのread-only evaluateを偽装して注入したとは主張しない。検査タブ・viewport・一時dark/reduced-motion設定は片付け済み。
- 差分検査は自作文書で通過。公式配布referenceのextract/harden/optimizeに既存の末尾空白・空行が6か所あり、upstreamのハッシュ一致を維持するため整形していない。
- 文書・導入物だけなのでbuild・サービス再起動は不要。未実施のWCAG認証、iPhone/Safari実機、全エラー系、性能測定を完了扱いにしない。

第2段階のUI修正は別途承認。上位3件は、原文到達のfocus/対象表示、Jev表示数の正確化、長いレポート内の区間移動。

# 分析品質の評価

以下は現行report.v3の全件分類に対する評価と過去の記録。次期の抽出要約方式には[軽量分析の検証条件](lightweight-analysis-design.md#検証と完了条件)を適用し、全件分類のprecision・recallや感情分類F1をそのまま合否基準にしない。

自動テストは参照・件数・保存・再開・UI操作の保証であり、分析精度の証明ではない。

## 確認用データを作る

```sh
.venv/bin/python backend/tools/evaluate_opinions.py prepare --output data/quality/review-packet.json
```

保存済み6動画から各60件、計360件を抽出する。高評価、低いいね数、返信、ランダム抽出を混ぜ、本文・親コメントを含める。投稿者の識別情報は含めない。現在の保存動画はエンタメ寄りなので、解説・レビューなどを追加し、3種類以上のジャンルで評価する必要がある。

人が各recordの`gold`に`[{"target":"対象名","stance":"positive"}]`を記入する。対象言及も意見もない場合は`[]`。5分類はpositive / negative / neutral / mixed / unclear。人が確認したときだけ`reviewed_by`へ確認者を記入する。AI生成を未確認のまま正解扱いしない。

動画の`genre`、主要意見、予測グループとの対応、根拠のない断定・少数意見の多数派化・賛否の誤統合・字幕意見の混入の誤り件数を記入する。調整用と未使用評価用は動画単位で固定し、未使用側を見てプロンプトを調整しない。

## 採点

予測JSONLは各行に`video_id`、`comment_id`、`observations: [{target, stance}]`を持つ。APIのexportに保存された観測から作る。

```sh
.venv/bin/python backend/tools/evaluate_opinions.py score data/quality/review-packet.json data/quality/predictions.jsonl
```

合格条件：6動画・3ジャンル以上、300件以上の人手確認、対象precision 90%以上・recall 85%以上、対象別感情5分類macro-F1 80%以上。判定保留率と混同行列も出す。主要意見の対応漏れやレポート誤りがある場合は合格しない。

人手確認が不足している場合、ツールは`passed: false`を返す。未達を隠して数値だけを合格として扱わない。

## 2026-09-06 実装時の確認

- バックエンド22テスト、型チェックを含むビルドが通過。
- 隔離DBのブラウザE2Eは8件通過。デスクトップ、420×912px、ダークモードを確認。履歴・字幕の重複検証4件はdesktopで代表実行。
- 保存済み実コメント6件と実自動字幕2,197区間を、実際のCodex app serverで分析。6件の処理を完了し、根拠を確定できない1件を判断保留へ残した。
- 実データで発見した「監査時の文脈欠落」「原文にない本名の補完」を修正し、呼び名の統一後も対象・評価の不変条件を確認した。
- この少量検証は精度指標や5,000件での性能の証明ではない。360件の確認用データは人手確認待ち。

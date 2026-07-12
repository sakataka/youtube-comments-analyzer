# 感情分類モデル評価

評価日: 2026-07-12  
実行環境: Apple M4 Pro 12-core / 24GB / Python 3.14.6 / PyTorch 2.13.0 / Transformers 5.13.1 / MPS

## 評価方法

`fixtures/sentiment_hybrid_eval.jsonl` の60件を使用した。

- positive / neutral / negative: 各15件
- mixed: 8件
- unclear: 7件
- 三分類45件はクラスごとに calibration 10件、holdout 5件へ分割
- モデル選定はcalibrationのmacro F1を第一基準とし、複雑表現の誤り数、閾値適用後coverage、速度の順で比較
- 閾値はcalibration上で、受理precision 0.90以上、各クラスprecision 0.80以上を保つ最大coverageを選択
- mixed / unclearはモデル選定F1へ含めず、三段階統合のルーティング確認に使用

## 比較結果

| モデル | ライセンス | calibration macro F1 | holdout macro F1 | 採用閾値 | coverage | warm推論 |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `LoneWolfgang/bert-for-japanese-twitter-sentiment` | Apache-2.0 | 0.967 | 0.866 | 0.50 | 1.00 | 1,108 texts/s |
| `christian-phu/bert-finetuned-japanese-sentiment` | CC-BY-SA-4.0 | 0.696 | 0.533 | 助言専用 | 0.00 | 1,045 texts/s |
| `lxyuan/distilbert-base-multilingual-cased-sentiments-student` | Apache-2.0 | 0.363 | 0.172 | 0.75 | 0.13 | 1,863 texts/s |

warm推論は60件を同一プロセス・モデルロード済み・メモリキャッシュ消去後に再実行した値である。採用モデルの初回ダウンロードを含むcold実行は29.9秒、プロセスpeak RSS増分は約997MBで、4GBゲートを満たした。

## 採用結果

- model: `LoneWolfgang/bert-for-japanese-twitter-sentiment`
- revision: `81e5f6f9ef184b27acc908917eb6c182b28109cf`
- license: Apache-2.0
- labels: `0=negative / 1=neutral / 2=positive`
- confidence threshold: `0.50`

holdoutの受理precisionは0.867で、0.85ゲートを満たした。calibrationのクラス別F1はpositive 1.000、neutral 0.947、negative 0.952、holdoutはpositive 0.889、neutral 0.800、negative 0.909だった。

既知難例では「下手にアドリブするよりムズいんじゃないか」をモデル単体がnegativeとした。ただしルール段階が `idiom` と `question` を検出するため、統合段階では自動確定せず `unclear` としてAI補助へ送る。反語、引用、否定の否定をモデルが誤確定した例は採用モデルではなかった。

WRIME由来モデルは、元データがCC BY-NC-ND 4.0で商用利用要件を満たさず、既知候補も二分類またはモデルカード・ライセンス不足だったため採用対象から除外した。

## 再実行

```bash
bun run eval:sentiment
```

完全な予測、混同行列、閾値探索結果、計測値は `/tmp/youtube-comments-analyzer-sentiment-evaluation.json` に出力される。

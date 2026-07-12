from __future__ import annotations

import hashlib
import json
import os
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .sentiment import MODEL_LABELS, classify_sentiment


ROOT_DIR = Path(__file__).resolve().parents[2]
CONFIG_PATH = Path(__file__).with_name("sentiment_model_config.json")


@dataclass(frozen=True)
class LocalSentimentConfig:
    enabled: bool
    model_id: str
    revision: str
    license: str
    label_by_index: tuple[str, ...]
    confidence_threshold: float
    max_length: int
    device: str
    batch_sizes: dict[str, dict[str, int]]
    ai_max_comments: int
    ai_batch_comments: int
    memory_cache_size: int
    cache_dir: Path


def load_local_sentiment_config(path: Path = CONFIG_PATH) -> LocalSentimentConfig:
    payload = json.loads(path.read_text(encoding="utf-8"))
    enabled_env = os.getenv("SENTIMENT_LOCAL_MODEL_ENABLED")
    enabled = bool(payload.get("enabled", True)) if enabled_env is None else enabled_env not in {"0", "false", "False"}
    return LocalSentimentConfig(
        enabled=enabled,
        model_id=os.getenv("SENTIMENT_MODEL_ID") or str(payload["model_id"]),
        revision=os.getenv("SENTIMENT_MODEL_REVISION") or str(payload["revision"]),
        license=str(payload["license"]),
        label_by_index=tuple(payload["label_by_index"]),
        confidence_threshold=float(os.getenv("SENTIMENT_CONFIDENCE_THRESHOLD") or payload["confidence_threshold"]),
        max_length=int(payload["max_length"]),
        device=os.getenv("SENTIMENT_MODEL_DEVICE") or str(payload["device"]),
        batch_sizes=payload["batch_sizes"],
        ai_max_comments=int(payload["ai_max_comments"]),
        ai_batch_comments=int(payload["ai_batch_comments"]),
        memory_cache_size=int(payload["memory_cache_size"]),
        cache_dir=Path(os.getenv("SENTIMENT_MODEL_CACHE_DIR") or ROOT_DIR / "data" / "model_cache"),
    )


class LocalSentimentClassifier:
    def __init__(self, config: LocalSentimentConfig | None = None):
        self.config = config or load_local_sentiment_config()
        self._lock = threading.Lock()
        self._model: Any = None
        self._tokenizer: Any = None
        self._torch: Any = None
        self._device = "not_loaded"
        self._load_error: str | None = None
        self._cache: OrderedDict[str, dict[str, Any]] = OrderedDict()

    def status(self) -> dict[str, Any]:
        status = "disabled" if not self.config.enabled else "failed" if self._load_error else "available" if self._model is not None else "not_loaded"
        return {
            "status": status,
            "model_id": self.config.model_id,
            "revision": self.config.revision,
            "license": self.config.license,
            "confidence_threshold": self.config.confidence_threshold,
            "device": self._device,
            "failure_reason": self._load_error,
            "cache_dir": str(self.config.cache_dir),
        }

    def clear_memory_cache(self) -> None:
        with self._lock:
            self._cache.clear()

    def predict(self, texts: list[str]) -> dict[str, dict[str, Any]]:
        unique_texts = list(dict.fromkeys(texts))
        if not unique_texts:
            return {}
        if not self.config.enabled:
            return {text: self._failure("disabled") for text in unique_texts}
        with self._lock:
            try:
                self._ensure_loaded()
                return self._predict_with_device(unique_texts)
            except Exception as exc:
                if self._device == "mps":
                    try:
                        self._move_to_cpu()
                        return self._predict_with_device(unique_texts)
                    except Exception as cpu_exc:
                        self._load_error = f"MPS failed: {exc}; CPU fallback failed: {cpu_exc}"
                else:
                    self._load_error = str(exc)
                return {text: self._failure(self._load_error or "inference failed") for text in unique_texts}

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self.config.cache_dir.mkdir(parents=True, exist_ok=True)
        self._torch = torch
        torch.set_num_threads(min(8, os.cpu_count() or 1))
        try:
            torch.set_num_interop_threads(1)
        except RuntimeError:
            pass
        self._tokenizer = AutoTokenizer.from_pretrained(
            self.config.model_id,
            revision=self.config.revision,
            cache_dir=self.config.cache_dir,
            trust_remote_code=False,
        )
        self._model = AutoModelForSequenceClassification.from_pretrained(
            self.config.model_id,
            revision=self.config.revision,
            cache_dir=self.config.cache_dir,
            trust_remote_code=False,
        )
        self._model.eval()
        requested = self.config.device
        use_mps = requested == "mps" or (requested == "auto" and torch.backends.mps.is_available())
        self._device = "mps" if use_mps else "cpu"
        self._model.to(self._device)
        if self._device == "mps":
            with torch.inference_mode():
                sample = self._tokenizer(["動作確認"], return_tensors="pt", padding=True)
                self._model(**{key: value.to("mps") for key, value in sample.items()})

    def _move_to_cpu(self) -> None:
        if self._torch is not None and self._device == "mps":
            self._model.to("cpu")
            self._torch.mps.empty_cache()
        self._device = "cpu"
        self._cache.clear()

    def _predict_with_device(self, texts: list[str]) -> dict[str, dict[str, Any]]:
        output: dict[str, dict[str, Any]] = {}
        pending: list[str] = []
        for text in texts:
            key = self._cache_key(text)
            cached = self._cache.get(key)
            if cached is not None:
                self._cache.move_to_end(key)
                output[text] = dict(cached)
            else:
                pending.append(text)
        if not pending:
            return output

        tokenized_lengths = self._tokenizer(pending, add_special_tokens=True, truncation=False)["input_ids"]
        buckets: dict[int, list[tuple[str, bool]]] = {128: [], 256: [], 512: []}
        for text, input_ids in zip(pending, tokenized_lengths, strict=True):
            length = len(input_ids)
            bucket = 128 if length <= 128 else 256 if length <= 256 else 512
            buckets[bucket].append((text, length > self.config.max_length))

        for bucket, rows in buckets.items():
            batch_size = int(self.config.batch_sizes[self._device][str(bucket)])
            for start in range(0, len(rows), batch_size):
                batch = rows[start : start + batch_size]
                output.update(self._predict_batch_resilient(batch))
        return output

    def _predict_batch_resilient(self, rows: list[tuple[str, bool]]) -> dict[str, dict[str, Any]]:
        try:
            return self._predict_batch(rows)
        except Exception as exc:
            if len(rows) == 1:
                if self._device == "mps":
                    raise
                return {rows[0][0]: self._failure(str(exc))}
            middle = len(rows) // 2
            return {
                **self._predict_batch_resilient(rows[:middle]),
                **self._predict_batch_resilient(rows[middle:]),
            }

    def _predict_batch(self, rows: list[tuple[str, bool]]) -> dict[str, dict[str, Any]]:
        texts = [text for text, _ in rows]
        encoded = self._tokenizer(
            texts,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=self.config.max_length,
        )
        encoded = {key: value.to(self._device) for key, value in encoded.items()}
        with self._torch.inference_mode():
            logits = self._model(**encoded).logits
            probabilities = self._torch.softmax(logits.float(), dim=-1).cpu().tolist()
        output: dict[str, dict[str, Any]] = {}
        for (text, truncated), scores in zip(rows, probabilities, strict=True):
            normalized = {
                label: float(scores[index])
                for index, label in enumerate(self.config.label_by_index)
            }
            label = max(normalized, key=normalized.get)
            result = {
                "status": "available",
                "label": label,
                "confidence": normalized[label],
                "probabilities": normalized,
                "model_id": self.config.model_id,
                "revision": self.config.revision,
                "device": self._device,
                "input_truncated": truncated,
            }
            output[text] = result
            self._remember(text, result)
        return output

    def _remember(self, text: str, result: dict[str, Any]) -> None:
        self._cache[self._cache_key(text)] = dict(result)
        self._cache.move_to_end(self._cache_key(text))
        while len(self._cache) > self.config.memory_cache_size:
            self._cache.popitem(last=False)

    def _cache_key(self, text: str) -> str:
        value = f"{self.config.model_id}\n{self.config.revision}\n{self.config.max_length}\n{text}"
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def _failure(self, reason: str) -> dict[str, Any]:
        return {
            "status": "failed",
            "error": reason,
            "model_id": self.config.model_id,
            "revision": self.config.revision,
            "device": self._device,
        }


class FakeLocalSentimentClassifier:
    def __init__(self):
        base = load_local_sentiment_config()
        self.config = LocalSentimentConfig(
            **{
                **base.__dict__,
                "model_id": "fake/sentiment",
                "revision": "e2e-fixed",
                "license": "test-only",
                "confidence_threshold": 0.5,
                "device": "cpu",
            }
        )

    def status(self) -> dict[str, Any]:
        return {
            "status": "available",
            "model_id": self.config.model_id,
            "revision": self.config.revision,
            "license": self.config.license,
            "confidence_threshold": self.config.confidence_threshold,
            "device": "cpu",
            "failure_reason": None,
            "cache_dir": str(self.config.cache_dir),
        }

    def predict(self, texts: list[str]) -> dict[str, dict[str, Any]]:
        output = {}
        for text in dict.fromkeys(texts):
            rule = classify_sentiment(text)
            label = rule["label"] if rule["label"] in MODEL_LABELS else "neutral"
            confidence = 0.4 if "ずっと強い" in text else 0.92
            probabilities = {value: (1 - confidence) / 2 for value in MODEL_LABELS}
            probabilities[label] = confidence
            output[text] = {
                "status": "available",
                "label": label,
                "confidence": confidence,
                "probabilities": probabilities,
                "model_id": self.config.model_id,
                "revision": self.config.revision,
                "device": "cpu",
                "input_truncated": False,
            }
        return output

"""Streaming text-to-speech.

Backends (all local, all open weights):

  * **piper**  — VITS/ONNX. Fastest to first audio, runs on CPU, streams PCM
                 per sentence. The default.
  * **kokoro** — 82M-param Kokoro-82M, very natural, still CPU-friendly.
  * **none**   — no audio, used for wiring tests and CI.

Every backend implements `synthesize_stream(text)`, an iterator that yields
float32 PCM chunks. The session consumes it lazily, so audio for sentence N+1
starts being generated while sentence N is still being sent to the browser.
"""

from __future__ import annotations

import logging
import re
import subprocess
import tempfile
import threading
from abc import ABC, abstractmethod
from collections.abc import Iterator
from pathlib import Path

import numpy as np

from .audio import concat, resample

logger = logging.getLogger(__name__)

DEFAULT_SAMPLE_RATE = 24_000


class TTSBackend(ABC):
    """Streaming TTS contract."""

    sample_rate: int

    @abstractmethod
    def synthesize_stream(self, text: str) -> Iterator[np.ndarray]:
        """Yield float32 PCM chunks for `text`."""

    def synthesize(self, text: str) -> np.ndarray:
        """Synthesize the whole utterance as one float32 array."""
        return concat(self.synthesize_stream(text))

    def close(self) -> None:
        return None


# --------------------------------------------------------------------------- #
# Piper (VITS / ONNX)
# --------------------------------------------------------------------------- #


class PiperTTS(TTSBackend):
    """Piper VITS backend.

    Piper is CPU-only and synthesises a full sentence in tens of milliseconds,
    which is why it is the default for live conversation.
    """

    def __init__(
        self,
        model: str = "en_US-amy-medium",
        data_dir: str | Path | None = None,
        *,
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        length_scale: float = 1.0,
    ) -> None:
        from piper.voice import PiperVoice  # imported lazily

        self._voice = self._load(PiperVoice, model, data_dir, length_scale)
        self.sample_rate = sample_rate
        self._lock = threading.Lock()
        logger.info("piper TTS ready (model=%s)", model)

    @staticmethod
    def _load(
        PiperVoice: type,
        model: str,
        data_dir: str | Path | None,
        length_scale: float,
    ):  # pragma: no cover - depends on local model files
        base = Path(data_dir).expanduser() if data_dir else None
        model_path = base / f"{model}.onnx" if base else Path(f"{model}.onnx")
        config_path = model_path.with_suffix(".onnx.json")

        if not model_path.exists():
            alt = base / model / "en/en_US/amy/medium/en_US-amy-medium.onnx" if base else None
            if alt and alt.exists():
                model_path, config_path = alt, alt.with_suffix(".onnx.json")

        if not model_path.exists():
            raise FileNotFoundError(
                f"Piper voice not found: {model_path}. "
                "Download one with: ./scripts/download_voices.sh"
            )
        return PiperVoice.load(str(model_path), config_path=str(config_path))

    def synthesize_stream(self, text: str) -> Iterator[np.ndarray]:
        cleaned = sanitize_for_speech(text)
        if not cleaned:
            return
        with self._lock:
            for chunk in self._voice.synthesize(cleaned):
                audio = getattr(chunk, "audio_int16_array", None)
                if audio is None:
                    raw = getattr(chunk, "audio_int16_bytes", None)
                    if raw is None:
                        continue
                    audio = np.frombuffer(raw, dtype="<i2")
                samples = np.asarray(audio, dtype=np.float32) / 32767.0
                if samples.size:
                    yield samples


# --------------------------------------------------------------------------- #
# Kokoro
# --------------------------------------------------------------------------- #


class KokoroTTS(TTSBackend):
    """Kokoro-82M backend (via the `kokoro` package)."""

    def __init__(
        self,
        *,
        lang_code: str = "a",  # 'a' => American English
        voice: str = "af_heart",
        sample_rate: int = DEFAULT_SAMPLE_RATE,
        speed: float = 1.0,
    ) -> None:
        from kokoro import KPipeline  # imported lazily

        self._pipeline = KPipeline(lang_code=lang_code)
        self._voice = voice
        self._speed = speed
        self.sample_rate = sample_rate
        self._lock = threading.Lock()
        logger.info("kokoro TTS ready (voice=%s)", voice)

    def synthesize_stream(self, text: str) -> Iterator[np.ndarray]:
        cleaned = sanitize_for_speech(text)
        if not cleaned:
            return
        with self._lock:
            for _graphemes, _phonemes, audio in self._pipeline(
                cleaned, voice=self._voice, speed=self._speed
            ):
                if audio is not None and len(audio):
                    yield np.asarray(audio, dtype=np.float32)


# --------------------------------------------------------------------------- #
# Fallback
# --------------------------------------------------------------------------- #


class SilentTTS(TTSBackend):
    """Emits timing-correct silence.

    Keeps the whole pipeline (VAD -> STT -> LLM -> TTS -> transport) runnable
    for integration tests on machines with no TTS model installed.
    """

    def __init__(self, sample_rate: int = DEFAULT_SAMPLE_RATE, seconds: float = 0.05) -> None:
        self.sample_rate = sample_rate
        self._chunk = int(sample_rate * seconds)

    def synthesize_stream(self, text: str) -> Iterator[np.ndarray]:
        duration = max(0.3, min(12.0, len(text) / 14.0))
        remaining = int(duration * self.sample_rate)
        while remaining > 0:
            size = min(self._chunk, remaining)
            yield np.zeros(size, dtype=np.float32)
            remaining -= size


class EspeakTTS(TTSBackend):
    """espeak-ng fallback for machines with no neural voice available."""

    def __init__(self, *, sample_rate: int = DEFAULT_SAMPLE_RATE) -> None:
        self.sample_rate = sample_rate
        self._lock = threading.Lock()
        try:
            subprocess.run(["espeak-ng", "--version"], capture_output=True, check=True)
        except (FileNotFoundError, subprocess.CalledProcessError) as exc:
            raise RuntimeError("espeak-ng is not installed") from exc

    def synthesize_stream(self, text: str) -> Iterator[np.ndarray]:
        cleaned = sanitize_for_speech(text)
        if not cleaned:
            return
        with self._lock, tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
            path = tmp.name
        try:
            subprocess.run(
                ["espeak-ng", "-v", "en-us", "-s", "165", "-w", path, cleaned],
                capture_output=True,
                check=True,
            )
            raw = Path(path).read_bytes()
        finally:
            Path(path).unlink(missing_ok=True)
        samples, rate = decode_wav(raw)
        yield resample(samples, rate, self.sample_rate)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def sanitize_for_speech(text: str) -> str:
    """Make arbitrary assistant text safe to read aloud."""
    import re

    cleaned = re.sub(r"```[\s\S]*?```", " code block ", text)
    cleaned = re.sub(r"`([^`]*)`", r" \1 ", cleaned)
    cleaned = re.sub(r"\$\$[\s\S]*?\$\$", " mathematical expression ", cleaned)
    cleaned = re.sub(r"\$[^$\n]+\$", " expression ", cleaned)
    cleaned = re.sub(r"!\[[^\]]*\]\([^)]*\)", " image ", cleaned)
    cleaned = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", cleaned)
    cleaned = re.sub(r"https?://\S+", " link ", cleaned)
    cleaned = re.sub(r"[*_#>~|`]", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def decode_wav(data: bytes) -> tuple[np.ndarray, int]:
    """Decode a PCM WAV file to (float32 samples, sample_rate)."""
    import io
    import wave

    with wave.open(io.BytesIO(data), "rb") as wav:
        rate = wav.getframerate()
        channels = wav.getnchannels()
        width = wav.getsampwidth()
        frames = wav.readframes(wav.getnframes())

    if width == 2:
        samples = np.frombuffer(frames, dtype="<i2").astype(np.float32) / 32767.0
    elif width == 1:
        samples = (np.frombuffer(frames, dtype=np.uint8).astype(np.float32) - 128.0) / 128.0
    elif width == 4:
        samples = np.frombuffer(frames, dtype="<i4").astype(np.float32) / 2147483647.0
    else:  # pragma: no cover - unusual width
        raise ValueError(f"unsupported WAV sample width: {width}")

    if channels > 1:
        samples = samples.reshape(-1, channels).mean(axis=1)

    return samples.astype(np.float32), rate


def build_tts(
    backend: str,
    *,
    model: str,
    data_dir: str,
    sample_rate: int,
    speed: float = 1.0,
) -> TTSBackend:
    """Instantiate the configured backend, degrading gracefully on failure."""
    name = backend.lower()
    if name == "piper":
        try:
            return PiperTTS(model=model, data_dir=data_dir, sample_rate=sample_rate)
        except Exception as exc:
            logger.warning("piper unavailable (%s); trying kokoro", exc)
            name = "kokoro"

    if name == "kokoro":
        try:
            return KokoroTTS(sample_rate=sample_rate, speed=speed)
        except Exception as exc:
            logger.warning("kokoro unavailable (%s); using silence", exc)
            name = "none"

    if name == "espeak":
        try:
            return EspeakTTS(sample_rate=sample_rate)
        except Exception as exc:
            logger.warning("espeak unavailable (%s); using silence", exc)

    return SilentTTS(sample_rate=sample_rate)

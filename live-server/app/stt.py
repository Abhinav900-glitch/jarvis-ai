"""Streaming speech-to-text using faster-whisper.

faster-whisper is a batch model, not a token-streaming one, so "streaming" is
implemented the way production systems do it: accumulate audio for the active
speech segment and transcribe it at two points.

  * **Partial** — a cheap, low-quality pass over the audio so far, emitted
    while the user is still talking so the UI can show live captions.
  * **Final** — a full-quality pass once the endpoint (silence) is detected,
    which is what actually gets sent to the LLM.

Partial results are debounced and always superseded by the final one, so a
slightly worse interim caption never leaks into the conversation history.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any, Protocol

import numpy as np

from .audio import AudioRingBuffer, concat, resample

logger = logging.getLogger(__name__)


class SttEngine(Protocol):
    """Minimal contract the session orchestrator depends on."""

    def transcribe(
        self, audio: np.ndarray, *, language: str | None, final: bool
    ) -> str: ...

    def close(self) -> None: ...


@dataclass(slots=True)
class TranscriptResult:
    """A transcription emitted by the STT engine."""

    text: str
    is_final: bool
    latency_ms: int


class FasterWhisperSTT:
    """faster-whisper (CTranslate2) streaming wrapper.

    The model is loaded once and guarded by a lock: faster-whisper's
    `WhisperModel.transcribe` is synchronous and not re-entrant.
    """

    def __init__(
        self,
        model_size_or_path: str = "base",
        *,
        device: str = "cpu",
        compute_type: str = "int8",
        beam_size: int = 1,
        language: str | None = None,
    ) -> None:
        from faster_whisper import WhisperModel  # imported lazily

        logger.info(
            "loading faster-whisper model=%s device=%s compute=%s",
            model_size_or_path,
            device,
            compute_type,
        )
        self._model = WhisperModel(
            model_size_or_path, device=device, compute_type=compute_type
        )
        self._beam_size = beam_size
        self._language = language
        self._lock = threading.Lock()

    def transcribe(
        self, audio: np.ndarray, *, language: str | None = None, final: bool = True
    ) -> str:
        """Transcribe mono float32 audio at 16 kHz.

        Args:
            audio: float32 samples, 16 kHz mono.
            language: ISO-639-1 hint; falls back to the configured default.
            final: True for the high-quality pass, False for a fast partial.
        """
        if audio.size == 0:
            return ""

        started = time.perf_counter()
        lang = language or self._language

        with self._lock:
            segments, _info = self._model.transcribe(
                audio,
                language=lang,
                beam_size=self._beam_size if final else 1,
                best_of=1,
                temperature=0.0,
                # Partial passes are prefix-only: appending to a partial that
                # will be discarded produces duplicated words.
                condition_on_previous_text=final,
                without_timestamps=True,
                vad_filter=False,  # our own VAD already gated this audio
                word_timestamps=False,
            )
            text = " ".join(segment.text.strip() for segment in segments).strip()

        logger.debug(
            "transcribed %.2fs audio in %dms (final=%s): %s",
            audio.size / 16_000,
            int((time.perf_counter() - started) * 1000),
            final,
            text[:80],
        )
        return text

    def close(self) -> None:
        return None


class StreamingTranscriber:
    """Owns the audio buffer for one session and emits partial/final text.

    Responsibilities:
      * buffer audio only while the VAD reports an open segment
      * emit debounced partial captions while speech is in progress
      * emit one final transcript on endpoint, then clear the buffer

    The partial cadence is time-based, not per-frame, so a fast talker does not
    trigger a transcription on every 32 ms hop.
    """

    def __init__(
        self,
        engine: SttEngine,
        *,
        sample_rate: int = 16_000,
        language: str | None = None,
        partial_interval_s: float = 0.6,
        min_speech_s: float = 0.4,
        max_buffer_bytes: int = 4 * 1024 * 1024,
    ) -> None:
        self._engine = engine
        self._sample_rate = sample_rate
        self._language = language
        self._partial_interval = partial_interval_s
        self._min_speech = min_speech_s
        self._buffer = AudioRingBuffer(max_buffer_bytes)
        self._last_partial_at = 0.0
        self._last_partial_text = ""

    def push_audio(self, samples: np.ndarray) -> Iterator[TranscriptResult]:
        """Buffer PCM and yield any transcript produced by this chunk."""
        if samples.size == 0:
            return
        if samples.shape[0] % 1:  # pragma: no cover - defensive
            raise ValueError("unexpected sample shape")
        self._buffer.append(samples)

        now = time.perf_counter()
        pending = self._buffer.snapshot()
        if pending.size / self._sample_rate < self._min_speech:
            return
        if now - self._last_partial_at < self._partial_interval:
            return

        self._last_partial_at = now
        text = self._safe_transcribe(pending, final=False)
        if text and text != self._last_partial_text:
            self._last_partial_text = text
            yield TranscriptResult(
                text=text,
                is_final=False,
                latency_ms=0,
            )

    def finalize(self) -> TranscriptResult | None:
        """Close the current segment and return the final transcript.

        Returns None when there was too little speech to transcribe.
        """
        audio = self._buffer.drain()
        self._last_partial_text = ""
        self._last_partial_at = 0.0

        if audio.size == 0 or audio.size / self._sample_rate < self._min_speech:
            return None

        started = time.perf_counter()
        text = self._safe_transcribe(audio, final=True)
        if not text:
            return None
        return TranscriptResult(
            text=text,
            is_final=True,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )

    def _safe_transcribe(self, audio: np.ndarray, *, final: bool) -> str:
        try:
            return self._engine.transcribe(audio, language=self._language, final=final)
        except Exception as exc:  # pragma: no cover - engine specific
            logger.warning("transcription failed (%s): %s", "final" if final else "partial", exc)
            return ""

    def discard(self) -> None:
        """Drop buffered audio — used when a turn is interrupted."""
        self._buffer.clear()
        self._last_partial_text = ""
        self._last_partial_at = 0.0

    def buffered_seconds(self) -> float:
        return self._buffer.seconds(self._sample_rate)


class TextSegmenter:
    """Splits streaming LLM tokens into speakable sentence chunks.

    Speaking token-by-token sounds robotic and wastes TTS calls, so tokens are
    buffered and flushed at clause boundaries (., !, ?, newline, or a length
    cap). This is what gives token-by-token generation a natural cadence.
    """

    #: Hard cap on a buffered chunk, so long comma-spliced sentences still speak.
    MAX_CHUNK_CHARS = 220
    _BREAKS = ".!?。！？\n"

    def __init__(self, max_chars: int | None = None) -> None:
        self._buffer = ""
        self._max_chars = max_chars or self.MAX_CHUNK_CHARS
        self._offset = 0  # char offset of the current buffer within the full text

    def push(self, token: str) -> list[str]:
        """Add a token; return any complete chunks that are now speakable."""
        if not token:
            return []
        self._buffer += token
        chunks: list[str] = []

        while True:
            idx = self._find_break()
            if idx < 0:
                break
            piece = self._buffer[: idx + 1].strip()
            self._buffer = self._buffer[idx + 1 :]
            self._offset += idx + 1
            if piece:
                chunks.append(piece)

        if len(self._buffer) >= self._max_chars:
            cut = self._buffer.rfind(" ", 0, self._max_chars)
            if cut <= 0:
                cut = self._max_chars
            piece = self._buffer[:cut].strip()
            self._buffer = self._buffer[cut:]
            self._offset += cut
            if piece:
                chunks.append(piece)

        return chunks

    def flush(self) -> list[str]:
        """Emit whatever remains once generation completes."""
        remainder = self._buffer.strip()
        self._buffer = ""
        return [remainder] if remainder else []

    def _find_break(self) -> int:
        """Index of the last sentence/clause break in the buffer, or -1."""
        for i in range(len(self._buffer) - 1, -1, -1):
            if self._buffer[i] in self._BREAKS:
                return i
        return -1

    def spoken_offset(self) -> int:
        """Characters already emitted as chunks (used for interruption cuts)."""
        return self._offset


def strip_for_speech(text: str) -> str:
    """Remove markdown/math/markup that would otherwise be spoken aloud."""
    import re

    cleaned = re.sub(r"```[\s\S]*?```", " (code block) ", text)
    cleaned = re.sub(r"`([^`]*)`", r" \1 ", cleaned)
    cleaned = re.sub(r"\$\$[\s\S]*?\$\$", " (equation) ", cleaned)
    cleaned = re.sub(r"\$[^$\n]+\$", " (expression) ", cleaned)
    cleaned = re.sub(r"!\[[^\]]*\]\([^)]*\)", " (image) ", cleaned)
    cleaned = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", cleaned)
    cleaned = re.sub(r"https?://\S+", " (link) ", cleaned)
    cleaned = re.sub(r"[*_#>~|]", "", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned)
    return cleaned.strip()


def prepare_audio(
    samples: np.ndarray, src_rate: int, dst_rate: int = 16_000
) -> np.ndarray:
    """Normalise arbitrary inbound audio to mono float32 at the STT rate."""
    mono = samples.astype(np.float32, copy=False)
    return resample(mono, src_rate, dst_rate)


__all__ = [
    "FasterWhisperSTT",
    "SttEngine",
    "StreamingTranscriber",
    "TextSegmenter",
    "TranscriptResult",
    "concat",
    "prepare_audio",
    "strip_for_speech",
]

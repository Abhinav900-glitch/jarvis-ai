"""Audio primitives: PCM conversion, resampling, framing, and a ring buffer.

Everything here is pure Python + numpy so it can be unit-tested without any
model dependencies loaded.
"""

from __future__ import annotations

from collections import deque
from collections.abc import Iterable, Iterator

import numpy as np

INT16_MAX = 32767


# --------------------------------------------------------------------------- #
# PCM conversion
# --------------------------------------------------------------------------- #


def bytes_to_pcm16(data: bytes) -> np.ndarray:
    """Decode little-endian int16 bytes to float32 in [-1, 1]."""
    if not data:
        return np.zeros(0, dtype=np.float32)
    if len(data) % 2:
        # Tolerate a truncated final sample rather than dropping the frame.
        data = data[:-1]
    return np.frombuffer(data, dtype="<i2").astype(np.float32) / INT16_MAX


def pcm16_to_bytes(samples: np.ndarray) -> bytes:
    """Encode float32 samples in [-1, 1] as little-endian int16 bytes."""
    if samples.size == 0:
        return b""
    clipped = np.clip(samples, -1.0, 1.0)
    return (clipped * INT16_MAX).astype("<i2").tobytes()


def float_to_pcm16(samples: np.ndarray) -> np.ndarray:
    """Convert float32 [-1, 1] to int16 without an intermediate byte copy."""
    if samples.size == 0:
        return np.zeros(0, dtype=np.int16)
    return (np.clip(samples, -1.0, 1.0) * INT16_MAX).astype(np.int16)


# --------------------------------------------------------------------------- #
# Resampling
# --------------------------------------------------------------------------- #


def resample(samples: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    """Resample mono audio with linear interpolation.

    Linear interpolation is sufficient here: the STT models low-pass their own
    input and the TTS output is played through a browser AudioContext that
    resamples again. It is fast enough to sit in the ingest hot path.
    """
    if src_rate == dst_rate or samples.size == 0:
        return samples.astype(np.float32, copy=False)
    duration = samples.shape[0] / float(src_rate)
    dst_len = max(1, int(round(duration * dst_rate)))
    src_positions = np.arange(samples.shape[0], dtype=np.float64)
    dst_positions = np.linspace(0, samples.shape[0] - 1, dst_len, dtype=np.float64)
    return np.interp(dst_positions, src_positions, samples).astype(np.float32)


# --------------------------------------------------------------------------- #
# Framing
# --------------------------------------------------------------------------- #


def frame_signal(
    samples: np.ndarray, frame_size: int
) -> Iterator[np.ndarray]:
    """Yield consecutive fixed-size frames; the tail is zero-padded.

    Silero-VAD requires a fixed frame size (512 samples at 16 kHz), so the tail
    of every buffer is padded rather than dropped.
    """
    if frame_size <= 0:
        raise ValueError("frame_size must be positive")
    for start in range(0, samples.shape[0], frame_size):
        chunk = samples[start : start + frame_size]
        if chunk.shape[0] < frame_size:
            chunk = np.pad(chunk, (0, frame_size - chunk.shape[0]))
        yield chunk


def rms(samples: np.ndarray) -> float:
    """Root-mean-square level of a frame, used by the energy VAD fallback."""
    if samples.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(samples, dtype=np.float64))))


# --------------------------------------------------------------------------- #
# Ring buffer
# --------------------------------------------------------------------------- #


class AudioRingBuffer:
    """Append-only float32 audio buffer with a hard byte budget.

    The ingest path must never block on a slow consumer, so this drops the
    oldest audio once the cap is reached rather than growing without bound or
    applying back-pressure to the WebSocket reader.
    """

    def __init__(self, max_bytes: int) -> None:
        self._chunks: deque[np.ndarray] = deque()
        self._size = 0
        self._max_bytes = max(1, max_bytes)
        self.dropped_bytes = 0

    def __len__(self) -> int:
        return self._size

    @property
    def size_bytes(self) -> int:
        return self._size

    @property
    def is_full(self) -> bool:
        return self._size >= self._max_bytes

    def append(self, samples: np.ndarray) -> None:
        if samples.size == 0:
            return
        self._chunks.append(samples)
        self._size += samples.nbytes
        self._evict()

    def extend(self, samples: np.ndarray) -> None:
        """Append a buffer, evicting oldest audio if it would overflow."""
        if samples.size == 0:
            return
        nbytes = samples.nbytes
        if nbytes >= self._max_bytes:
            # Incoming chunk alone exceeds the budget: keep only its tail.
            keep = self._max_bytes // samples.itemsize
            self.clear()
            self._chunks.append(samples[-keep:])
            self._size = samples[-keep:].nbytes
            self.dropped_bytes += nbytes - self._size
            return
        self._chunks.append(samples)
        self._size += nbytes
        self._evict()

    def _evict(self) -> None:
        while self._size > self._max_bytes and self._chunks:
            dropped = self._chunks.popleft()
            self._size -= dropped.nbytes
            self.dropped_bytes += dropped.nbytes

    def snapshot(self) -> np.ndarray:
        """Concatenate buffered audio without consuming it."""
        if not self._chunks:
            return np.zeros(0, dtype=np.float32)
        return np.concatenate(tuple(self._chunks)).astype(np.float32, copy=False)

    def drain(self) -> np.ndarray:
        """Return all buffered audio and empty the buffer."""
        data = self.snapshot()
        self.clear()
        return data

    def clear(self) -> None:
        self._chunks.clear()
        self._size = 0

    def seconds(self, sample_rate: int) -> float:
        """Duration currently buffered."""
        return (self._size / 2) / float(sample_rate)


def concat(chunks: Iterable[np.ndarray]) -> np.ndarray:
    """Concatenate float32 chunks, tolerating an empty iterable."""
    items = [c for c in chunks if c.size]
    if not items:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(items).astype(np.float32, copy=False)

"""Streaming voice-activity detection.

The VAD is the single most important component for live feel. It decides two
things in real time:

  1. **Turn boundaries** — when the user has finished a statement, so the STT
     engine can finalise and the LLM can start generating.
  2. **Barge-in** — the instant the user starts talking *over* the assistant,
     so playback can be cancelled and generation stopped.

`SileroVAD` uses the official ONNX Silero model (512-sample frames at 16 kHz).
`EnergyVAD` is a dependency-free fallback using an adaptive noise floor, so the
pipeline still runs if torch/onnxruntime are unavailable.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from pathlib import Path

import numpy as np

from .audio import rms
from .config import Settings

logger = logging.getLogger(__name__)

#: Silero v4/v5 expects exactly 512 samples at 16 kHz (32 ms).
SILERO_FRAME_SAMPLES = 512
SILERO_SAMPLE_RATE = 16_000


class SpeechEvent(str, Enum):
    """Events emitted by a streaming VAD."""

    #: Voiced content began.
    SPEECH_START = "speech_start"
    #: Voiced content ended (silence sustained past the threshold).
    SPEECH_END = "speech_end"


@dataclass(slots=True)
class VadResult:
    """One frame's verdict."""

    event: SpeechEvent | None
    probability: float
    is_speech: bool


class StreamingVad(ABC):
    """Common interface for the frame-at-a-time VADs."""

    frame_samples: int = SILERO_FRAME_SAMPLES

    @abstractmethod
    def process_frame(self, frame: np.ndarray) -> VadResult:
        """Consume one fixed-size float32 frame and report speech state."""

    def reset(self) -> None:
        """Clear internal state between turns."""
        return None

    def close(self) -> None:
        """Release native resources."""
        return None


# --------------------------------------------------------------------------- #
# Silero
# --------------------------------------------------------------------------- #


class SileroVAD(StreamingVad):
    """Official Silero VAD via the `silero-vad` package (ONNX, no torch needed)."""

    frame_samples = SILERO_FRAME_SAMPLES

    def __init__(self, threshold: float = 0.5) -> None:
        from silero_vad import load_silero_vad  # imported lazily

        self._model = load_silero_vad(onnx=True)
        self._threshold = threshold
        self._state = "silence"
        logger.info("Silero VAD loaded (onnx, threshold=%.2f)", threshold)

    def process_frame(self, frame: np.ndarray) -> VadResult:
        if frame.shape[0] != self.frame_samples:
            padded = np.pad(frame, (0, self.frame_samples - frame.shape[0]))
            frame = padded[: self.frame_samples]

        # Silero consumes int16 and reports one probability per frame.
        prob = float(self._model(np.array([frame], dtype=np.float32), SILERO_SAMPLE_RATE).item())
        is_speech = prob >= self._threshold

        event: SpeechEvent | None = None
        if is_speech and self._state == "silence":
            self._state = "speech"
            event = SpeechEvent.SPEECH_START
        elif not is_speech and self._state == "speech":
            self._state = "silence"
            event = SpeechEvent.SPEECH_END

        return VadResult(event=event, probability=prob, is_speech=is_speech)

    def reset(self) -> None:
        self._model.reset_states()
        self._state = "silence"

    def close(self) -> None:
        self._model.reset_states()


# --------------------------------------------------------------------------- #
# Energy fallback
# --------------------------------------------------------------------------- #


class EnergyVAD(StreamingVad):
    """Adaptive RMS gate used when Silero is unavailable.

    Tracks a slow noise floor and fires when the instantaneous level sits
    meaningfully above it. Less accurate than Silero on noisy input, but it has
    no native dependencies and keeps the pipeline runnable everywhere.
    """

    def __init__(
        self,
        threshold: float = 0.5,
        frame_samples: int = SILERO_FRAME_SAMPLES,
        noise_floor: float = 0.008,
        ratio: float = 3.0,
    ) -> None:
        self.frame_samples = frame_samples
        # `threshold` is normalised to 0..1; map it onto an SNR ratio.
        self.ratio = 1.5 + ratio * threshold
        self._floor = noise_floor
        self._state = "silence"

    def process_frame(self, frame: np.ndarray) -> VadResult:
        level = rms(frame)
        floor = max(self._floor, 1e-4)
        is_speech = level > floor * self.ratio

        # Adapt the floor only during silence, and slowly, so a long utterance
        # does not drag the noise floor up and cut itself off.
        if not is_speech:
            self._floor = 0.995 * self._floor + 0.005 * level

        probability = min(1.0, level / max(floor * self.ratio, 1e-6))

        event: SpeechEvent | None = None
        if is_speech and self._state == "silence":
            self._state = "speech"
            event = SpeechEvent.SPEECH_START
        elif not is_speech and self._state == "speech":
            self._state = "silence"
            event = SpeechEvent.SPEECH_END

        return VadResult(event=event, probability=probability, is_speech=is_speech)

    def reset(self) -> None:
        self._state = "silence"


# --------------------------------------------------------------------------- #
# Segmenter
# --------------------------------------------------------------------------- #


class SpeechSegmenter:
    """Turns raw VAD verdicts into debounced speech start/end events.

    A single voiced frame must not open a turn (coughs, keyboard clacks) and a
    single silent frame must not close one (pauses between words). This wrapper
    requires N consecutive agreeing frames before it emits an event, and holds
    the audio buffer for each active segment.
    """

    def __init__(
        self,
        vad: StreamingVad,
        *,
        min_speech_ms: int = 200,
        min_silence_ms: int = 500,
        sample_rate: int = 16_000,
        max_segment_s: float = 30.0,
    ) -> None:
        self._vad = vad
        self._sample_rate = sample_rate
        self._frame_ms = vad.frame_samples * 1000 / sample_rate
        self._min_speech_frames = max(1, round(min_speech_ms / self._frame_ms))
        self._min_silence_frames = max(1, round(min_silence_ms / self._frame_ms))
        self._max_segment_frames = max(1, round(max_segment_s * 1000 / self._frame_ms))

        self._voiced_run = 0
        self._silent_run = 0
        self._segment_frames = 0
        self._in_segment = False
        self._pending_open = False
        self._probability = 0.0

    @property
    def in_segment(self) -> bool:
        """True while a user utterance is being accumulated."""
        return self._in_segment

    @property
    def probability(self) -> float:
        """Most recent speech probability, for UI meters."""
        return self._probability

    def push(self, frame: np.ndarray) -> VadResult:
        """Feed one frame and return the debounced result."""
        result = self._vad.process_frame(frame)
        self._probability = result.probability

        if result.is_speech:
            self._voiced_run += 1
            self._silent_run = 0
        else:
            self._silent_run += 1
            self._voiced_run = 0

        # Open a segment only after sustained voicing.
        if not self._in_segment and not self._pending_open:
            if self._voiced_run >= self._min_speech_frames:
                self._pending_open = True

        if self._pending_open and result.is_speech:
            # First genuinely voiced frame confirms the segment.
            self._pending_open = False
            self._in_segment = True
            self._segment_frames = self._voiced_run
            return VadResult(
                event=SpeechEvent.SPEECH_START,
                probability=result.probability,
                is_speech=True,
            )

        if not self._in_segment:
            return VadResult(None, result.probability, result.is_speech)

        self._segment_frames += 1

        # Close on sustained silence, or when the segment grows too long.
        too_long = self._segment_frames >= self._max_segment_frames
        if self._silent_run >= self._min_silence_frames or too_long:
            self._in_segment = False
            self._voiced_run = 0
            self._silent_run = 0
            return VadResult(
                event=SpeechEvent.SPEECH_END,
                probability=result.probability,
                is_speech=False,
            )

        return VadResult(None, result.probability, result.is_speech)

    def reset(self) -> None:
        """Drop any partial segment (e.g. after an interruption)."""
        self._voiced_run = 0
        self._silent_run = 0
        self._segment_frames = 0
        self._in_segment = False
        self._pending_open = False
        self._vad.reset()


def build_vad(settings: Settings) -> StreamingVad:
    """Instantiate the configured VAD, degrading to energy if needed."""
    if settings.vad_backend.lower() == "silero":
        try:
            return SileroVAD(threshold=settings.vad_threshold)
        except Exception as exc:  # pragma: no cover - depends on optional deps
            logger.warning(
                "Silero VAD unavailable (%s); falling back to energy VAD. "
                "Install with: pip install silero-vad onnxruntime",
                exc,
            )
    return EnergyVAD(threshold=settings.vad_threshold)


def resolve_silero_model_path() -> Path | None:
    """Best-effort discovery of a locally cached Silero checkpoint."""
    candidates = [
        Path.home() / ".cache" / "silero-vad",
        Path.home() / ".cache" / "torch" / "hub" / "checkpoints",
    ]
    for base in candidates:
        if not base.exists():
            continue
        for name in ("silero_vad.onnx", "silero_vad.jit"):
            for found in base.rglob(name):
                return found
    return None

"""Model-free tests for the live pipeline.

These exercise the protocol, framing, VAD debouncing, text segmentation, and
the interruption semantics — everything that can be verified without loading
Whisper, Piper, or an LLM.

    cd live-server && python3 -m pytest tests -q
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import protocol as proto  # noqa: E402
from app.audio import (  # noqa: E402
    AudioRingBuffer,
    bytes_to_pcm16,
    frame_signal,
    pcm16_to_bytes,
    resample,
)
from app.stt import TextSegmenter, strip_for_speech  # noqa: E402
from app.vad import EnergyVAD, SpeechEvent, SpeechSegmenter  # noqa: E402


# --------------------------------------------------------------------------- #
# Protocol
# --------------------------------------------------------------------------- #


def test_frame_roundtrip():
    frame = proto.encode_mic(b"\x01\x02\x03\x04")
    decoded = proto.decode_frame(frame)
    assert decoded.type == proto.FrameType.AUDIO_MIC
    assert decoded.payload == b"\x01\x02\x03\x04"
    assert not decoded.is_final


def test_final_flag_roundtrip():
    decoded = proto.decode_frame(proto.encode_mic(b"\x00" * 640, final=True))
    assert decoded.is_final


def test_control_roundtrip():
    message = {"type": proto.CTRL_STATE, "state": "speaking"}
    decoded = proto.decode_frame(proto.encode_control(message))
    assert decoded.as_control() == message


def test_image_frame_preserves_codec():
    jpeg = b"\xff\xd8\xff\xe0" + b"payload"
    decoded = proto.decode_frame(proto.encode_image(jpeg, proto.ImageCodec.WEBP))
    assert decoded.type == proto.FrameType.IMAGE
    assert decoded.flags == proto.ImageCodec.WEBP
    assert decoded.payload == jpeg


def test_mic_frame_is_20ms_of_16k_pcm():
    # 20 ms at 16 kHz mono int16 == 320 samples == 640 bytes.
    assert proto.MIC_FRAME_SAMPLES == 320
    assert proto.MIC_FRAME_BYTES == 640


def test_decode_rejects_truncated():
    with pytest.raises(ValueError):
        proto.decode_frame(b"\x01")


def test_odd_length_pcm_rejected():
    with pytest.raises(ValueError):
        proto.encode_mic(b"\x01\x02\x03")


# --------------------------------------------------------------------------- #
# Audio
# --------------------------------------------------------------------------- #


def test_pcm_roundtrip_is_close():
    original = np.linspace(-0.5, 0.5, 512, dtype=np.float32)
    restored = bytes_to_pcm16(pcm16_to_bytes(original))
    assert restored.shape == original.shape
    assert np.max(np.abs(restored - original)) < 1e-3


def test_resample_changes_length():
    samples = np.zeros(48_000, dtype=np.float32)
    out = resample(samples, 48_000, 16_000)
    assert out.shape[0] == 16_000


def test_resample_passthrough_when_equal():
    samples = np.ones(10, dtype=np.float32)
    assert resample(samples, 16_000, 16_000) is samples


def test_frame_signal_pads_tail():
    frames = list(frame_signal(np.ones(1000, dtype=np.float32), 512))
    assert len(frames) == 2
    assert all(f.shape[0] == 512 for f in frames)
    assert frames[1][-1] == 0.0  # padded


def test_ring_buffer_drops_oldest():
    buffer = AudioRingBuffer(max_bytes=4000)  # 2000 float samples
    for _ in range(10):
        buffer.append(np.ones(500, dtype=np.float32))
    assert len(buffer) == 2000
    assert buffer.dropped > 0


def test_ring_buffer_drain_empties():
    buffer = AudioRingBuffer(max_bytes=10_000)
    buffer.append(np.ones(100, dtype=np.float32))
    assert buffer.drain().shape[0] == 100
    assert len(buffer) == 0


def test_ring_buffer_oversized_chunk_keeps_tail():
    buffer = AudioRingBuffer(max_bytes=1000)
    buffer.extend(np.arange(5000, dtype=np.float32))
    data = buffer.snapshot()
    assert data.shape[0] == 500
    assert data[-1] == pytest.approx(4999.0)


# --------------------------------------------------------------------------- #
# VAD
# --------------------------------------------------------------------------- #


def _frame(value: float, n: int = 512) -> np.ndarray:
    return np.full(n, value, dtype=np.float32)


def test_segmenter_opens_after_sustained_speech():
    segmenter = SpeechSegmenter(EnergyVAD(), min_speech_ms=64, min_silence_ms=100)
    events = [segmenter.push(_frame(0.4)) for _ in range(12)]
    kinds = [e.event for e in events]
    assert SpeechEvent.SPEECH_START in kinds


def test_segmenter_ignores_single_blip():
    segmenter = SpeechSegmenter(EnergyVAD(), min_speech_ms=96, min_silence_ms=100)
    events = [segmenter.push(_frame(0.4)) for _ in range(2)]
    assert all(e.event is None for e in events)
    assert not segmenter.in_segment


def test_segmenter_closes_after_silence():
    segmenter = SpeechSegmenter(EnergyVAD(), min_speech_ms=64, min_silence_ms=100)
    for _ in range(12):
        segmenter.push(_frame(0.4))
    assert segmenter.in_segment
    events = [segmenter.push(_frame(0.0)) for _ in range(10)]
    assert any(e.event is SpeechEvent.SPEECH_END for e in events)
    assert not segmenter.in_segment


def test_segmenter_resets():
    segmenter = SpeechSegmenter(EnergyVAD(), min_speech_ms=64)
    for _ in range(12):
        segmenter.push(_frame(0.4))
    segmenter.reset()
    assert not segmenter.in_segment


# --------------------------------------------------------------------------- #
# Text segmentation
# --------------------------------------------------------------------------- #


def test_segmenter_emits_on_sentence_end():
    seg = TextSegmenter()
    assert seg.push("Hello there") == []
    assert seg.push(".") == ["Hello there."]


def test_segmenter_flush_returns_remainder():
    seg = TextSegmenter()
    seg.push("no terminator here")
    assert seg.flush() == ["no terminator here"]
    assert seg.flush() == []


def test_segmenter_splits_multiple_sentences():
    seg = TextSegmenter()
    chunks = seg.push("One. Two. Three!")
    assert chunks == ["One.", "Two."]


def test_segmenter_force_splits_long_run():
    seg = TextSegmenter(max_chars=50)
    chunks = []
    for ch in "word " * 40:
        chunks.extend(seg.push(ch))
    assert chunks, "long text should be force-split"
    assert all(len(c) <= 60 for c in chunks)


def test_spoken_offset_tracks_emitted_text():
    seg = TextSegmenter()
    seg.push("Hello.")
    assert seg.spoken_offset() == len("Hello.")


def test_strip_for_speech_removes_markup():
    spoken = strip_for_speech("**Bold** and `code` and [link](http://x.com)")
    assert "*" not in spoken and "`" not in spoken
    assert "http" not in spoken


# --------------------------------------------------------------------------- #
# Control vocabulary
# --------------------------------------------------------------------------- #


def test_clear_buffer_is_a_control_message():
    decoded = proto.decode_frame(
        proto.encode_control({"type": proto.CTRL_CLEAR_BUFFER, "reason": "barge_in"})
    )
    assert decoded.as_control()["type"] == "CLEAR_BUFFER"


def test_session_config_parsing():
    cfg = proto.SessionConfig.from_control(
        {"type": "session.start", "sampleRate": 16000, "language": "hi", "visionContext": 2}
    )
    assert cfg.language == "hi"
    assert cfg.vision_context == 2

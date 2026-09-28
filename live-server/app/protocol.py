"""Binary wire protocol shared by the browser client and the FastAPI server.

Every WebSocket message is a single binary frame:

    +--------+--------+---------------------------+
    | 1 byte | 1 byte | N bytes                   |
    | type   | flags  | payload                   |
    +--------+--------+---------------------------+

`type` and `flags` are unsigned bytes. Audio payloads are raw little-endian
signed 16-bit PCM (no headers, no compression) because that is what both
AudioWorklet capture and the TTS engines natively produce — compressing and
decompressing in the audio hot path would add latency for no benefit.

`flags` is interpreted per frame type:
  * AUDIO_MIC  - reserved (0)
  * AUDIO_OUT  - bit 0 set when this is the final chunk of an utterance
  * IMAGE      - ImageCodec value
  * CONTROL    - reserved (0)

Control frames carry a UTF-8 JSON object, which keeps the control channel
readable while audio stays binary and allocation-free.
"""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass, field
from enum import IntEnum
from typing import Any, Final

# --------------------------------------------------------------------------- #
# Frame types
# --------------------------------------------------------------------------- #


class FrameType(IntEnum):
    """First byte of every frame."""

    #: client -> server. Int16LE mono PCM, 16 kHz.
    AUDIO_MIC = 0x01
    #: server -> client. Int16LE mono PCM at the TTS output rate.
    AUDIO_OUT = 0x02
    #: client -> server. Encoded image (see :class:`ImageCodec`).
    IMAGE = 0x03
    #: Either direction. UTF-8 JSON.
    CONTROL = 0x10


class ImageCodec(IntEnum):
    """`flags` byte for :attr:`FrameType.IMAGE` frames."""

    JPEG = 0
    WEBP = 1
    PNG = 2


#: `flags` bit marking the last audio chunk of an utterance.
AUDIO_FLAG_FINAL: Final[int] = 0x01

HEADER_SIZE: Final[int] = 2

#: Client -> server audio framing. 20 ms at 16 kHz mono.
MIC_SAMPLE_RATE: Final[int] = 16_000
MIC_FRAME_MS: Final[int] = 20
MIC_FRAME_SAMPLES: Final[int] = MIC_SAMPLE_RATE * MIC_FRAME_MS // 1000  # 320
MIC_FRAME_BYTES: Final[int] = MIC_FRAME_SAMPLES * 2  # int16 -> 640

#: Server -> client audio framing. 20 ms at 24 kHz mono.
OUT_SAMPLE_RATE: Final[int] = 24_000
OUT_FRAME_SAMPLES: Final[int] = OUT_SAMPLE_RATE * MIC_FRAME_MS // 1000  # 480
OUT_FRAME_BYTES: Final[int] = OUT_FRAME_SAMPLES * 2  # 960


# --------------------------------------------------------------------------- #
# Encoding
# --------------------------------------------------------------------------- #


def encode_frame(
    frame_type: FrameType,
    payload: bytes = b"",
    flags: int = 0,
) -> bytes:
    """Build one wire frame."""
    if not 0 <= flags <= 0xFF:
        raise ValueError(f"flags out of range: {flags}")
    return struct.pack("<BB", int(frame_type), flags) + payload


def encode_mic(pcm: bytes, *, final: bool = False) -> bytes:
    """Encode a microphone PCM chunk captured at 16 kHz mono."""
    if len(pcm) % 2:
        raise ValueError("PCM payload must be a whole number of int16 samples")
    return encode_frame(
        FrameType.AUDIO_MIC, pcm, AUDIO_FLAG_FINAL if final else 0
    )


def encode_audio_out(pcm: bytes, *, final: bool = False) -> bytes:
    """Encode a TTS PCM chunk for playback on the client."""
    if len(pcm) % 2:
        raise ValueError("PCM payload must be a whole number of int16 samples")
    return encode_frame(
        FrameType.AUDIO_OUT, pcm, AUDIO_FLAG_FINAL if final else 0
    )


def encode_image(data: bytes, codec: ImageCodec) -> bytes:
    """Encode a camera/screen frame."""
    if not data:
        raise ValueError("refusing to send an empty image")
    return encode_frame(FrameType.IMAGE, data, int(codec))


def encode_control(message: dict[str, Any]) -> bytes:
    """Encode a JSON control message."""
    return encode_frame(
        FrameType.CONTROL, json.dumps(message, separators=(",", ":")).encode("utf-8")
    )


# --------------------------------------------------------------------------- #
# Decoding
# --------------------------------------------------------------------------- #


@dataclass(slots=True)
class Frame:
    """A decoded frame. Unrecognised types are preserved, not dropped."""

    type: int
    flags: int
    payload: bytes

    @property
    def is_final(self) -> bool:
        """True when the `AUDIO_FLAG_FINAL` bit is set."""
        return bool(self.flags & AUDIO_FLAG_FINAL)

    def as_control(self) -> dict[str, Any]:
        """Parse the payload as a JSON control message.

        Raises:
            ValueError: if the payload is not a JSON object.
        """
        try:
            parsed = json.loads(self.payload.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ValueError(f"malformed control frame: {exc}") from exc
        if not isinstance(parsed, dict):
            raise ValueError("control frame must be a JSON object")
        return parsed


def decode_frame(data: bytes) -> Frame:
    """Decode one wire frame.

    Raises:
        ValueError: if the buffer is too short to contain a header.
    """
    if len(data) < HEADER_SIZE:
        raise ValueError(f"frame too short: {len(data)} byte(s)")
    frame_type, flags = struct.unpack_from("<BB", data, 0)
    return Frame(type=frame_type, flags=flags, payload=data[HEADER_SIZE:])


# --------------------------------------------------------------------------- #
# Control message vocabulary
# --------------------------------------------------------------------------- #
# These string constants are the contract for the control channel. The client
# mirrors them in src/live/protocol.ts — keep the two in sync.

# --- client -> server ---
CTRL_SESSION_START: Final[str] = "session.start"
CTRL_SESSION_STOP: Final[str] = "session.stop"
CTRL_TEXT: Final[str] = "text"
CTRL_INTERRUPT: Final[str] = "interrupt"
CTRL_AUDIO_END: Final[str] = "audio.end"

# --- server -> client ---
CTRL_SESSION_READY: Final[str] = "session.ready"
CTRL_STATE: Final[str] = "state"
CTRL_TRANSCRIPT_PARTIAL: Final[str] = "transcript.partial"
CTRL_TRANSCRIPT_FINAL: Final[str] = "transcript.final"
CTRL_RESPONSE_DELTA: Final[str] = "response.delta"
CTRL_RESPONSE_DONE: Final[str] = "response.done"
#: Sent the instant barge-in is detected. The client must drop every buffered
#: PCM sample immediately — this is what makes interruption feel instant.
CTRL_CLEAR_BUFFER: Final[str] = "CLEAR_BUFFER"
CTRL_ERROR: Final[str] = "error"


@dataclass(slots=True)
class SessionConfig:
    """Handshake parameters sent by the client in `session.start`."""

    sample_rate: int = MIC_SAMPLE_RATE
    language: str | None = None
    #: Server-side TTS voice name, e.g. "en_US-amy-medium" for Piper.
    voice: str | None = None
    #: How many recent frames to expose to the vision model.
    vision_context: int = 1
    extra: dict[str, Any] = field(default_factory=dict)

    @classmethod
    def from_control(cls, message: dict[str, Any]) -> SessionConfig:
        return cls(
            sample_rate=int(message.get("sampleRate", MIC_SAMPLE_RATE)),
            language=message.get("language"),
            voice=message.get("voice"),
            vision_context=int(message.get("visionContext", 1)),
        )

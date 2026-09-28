"""Asynchronous vision frame buffer.

Camera frames arrive at 1-2 fps and must never interfere with the audio path.
`VisionBuffer` is a bounded, drop-oldest ring: the websocket reader drops the
frame handler onto a task, the handler overwrites the buffer, and the LLM
picks up whatever the most recent frame was when it builds a prompt.

Dropping stale frames is the correct policy — a 2-second-old screenshot is
worse than useless for a live conversation, and back-pressuring the socket
would add latency to the audio stream.
"""

from __future__ import annotations

import asyncio
import base64
import io
import logging
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)

try:  # Pillow is optional; without it we forward JPEG bytes untouched.
    from PIL import Image

    _HAS_PILLOW = True
except Exception:  # pragma: no cover - optional dependency
    _HAS_PILLOW = False


@dataclass(slots=True)
class VisionSnapshot:
    """A point-in-time view of the visual context."""

    frames: list[bytes]
    captured_at: float
    dropped: int


class VisionBuffer:
    """Bounded, drop-oldest store of recent JPEG frames."""

    def __init__(self, max_frames: int = 2, max_edge: int = 768, quality: int = 6) -> None:
        self._max_frames = max(1, max_frames)
        self._max_edge = max_edge
        self._quality = quality
        self._frames: list[bytes] = []
        self._timestamps: list[float] = []
        self.dropped = 0
        self._lock = asyncio.Lock()
        self._new_frame = asyncio.Event()

    async def submit(self, data: bytes) -> None:
        """Store a frame, evicting the oldest when full.

        `data` may be JPEG, WebP, or PNG; it is re-encoded to JPEG when
        Pillow is available so the LLM always receives a supported format.
        """
        jpeg = self._to_jpeg(data)
        if not jpeg:
            return
        async with self._lock:
            if len(self._frames) >= self._max_frames:
                self._frames.pop(0)
                self._timestamps.pop(0)
                self.dropped += 1
            self._frames.append(jpeg)
            self._timestamps.append(time.time())
        self._new_frame.set()

    def _to_jpeg(self, data: bytes) -> bytes:
        if not data:
            return b""
        if not _HAS_PILLOW:
            # Assume the client already sent JPEG.
            return data if data[:2] == b"\xff\xd8" else b""
        try:
            with Image.open(io.BytesIO(data)) as img:
                img = img.convert("RGB")
                if max(img.size) > self._max_edge:
                    scale = self._max_edge / float(max(img.size))
                    img = img.resize(
                        (max(1, int(img.width * scale)), max(1, int(img.height * scale))),
                        Image.Resampling.BILINEAR,
                    )
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=85, optimize=True)
                return buf.getvalue()
        except Exception as exc:
            logger.debug("vision frame decode failed: %s", exc)
            return b""

    async def latest(self) -> VisionSnapshot:
        """Return the frames currently held."""
        async with self._lock:
            return VisionSnapshot(
                frames=list(self._frames),
                captured_at=self._timestamps[-1] if self._timestamps else 0.0,
                dropped=self.dropped,
            )

    async def wait_for_frame(self, timeout: float = 1.0) -> bool:
        """Wait until a frame newer than the last-seen one exists."""
        try:
            await asyncio.wait_for(self._new_frame.wait(), timeout=timeout)
            return True
        except asyncio.TimeoutError:
            return False
        finally:
            self._new_frame.clear()

    def clear(self) -> None:
        self._frames.clear()
        self._timestamps.clear()

    @property
    def count(self) -> int:
        return len(self._frames)


def decode_image_metadata(data: bytes) -> dict[str, int | None]:
    """Best-effort image dimensions, for logging without a full decode."""
    if not _HAS_PILLOW or not data:
        return {"width": None, "height": None}
    try:
        with Image.open(io.BytesIO(data)) as img:
            return {"width": img.width, "height": img.height}
    except Exception:
        return {"width": None, "height": None}


def to_base64_jpeg(data: bytes) -> str:
    return base64.b64encode(data).decode("ascii")

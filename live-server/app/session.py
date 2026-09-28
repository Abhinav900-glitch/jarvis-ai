"""Per-connection session orchestrator.

This is the state machine that makes live mode feel alive. One instance per
WebSocket connection.

    IDLE ──speech_start──> LISTENING ──speech_end──> THINKING
      ^                        ^                        │
      │                        │                        ▼
      │                        └────barge_in──── SPEAKING
      │                                                  │
      └───────────── speech_end / done ─────────────────┘

Interruption is the delicate part. When the user talks over the assistant the
session must, in order:

  a) send ``CLEAR_BUFFER`` so the browser drops queued audio immediately,
  b) cancel the in-flight LLM generation task,
  c) truncate the assistant's reply at the last character that was actually
     *spoken*, so the conversation history reflects what the user really heard
     instead of text that was generated but never played.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import TYPE_CHECKING, Any

import numpy as np

from . import protocol as proto
from .audio import bytes_to_pcm16, pcm16_to_bytes
from .llm import ChatMessage, LLMUnavailable, LocalLLM, VisionFrame
from .stt import (
    FasterWhisperSTT,
    StreamingTranscriber,
    TextSegmenter,
    strip_for_speech,
)
from .vad import SpeechEvent, SpeechSegmenter, StreamingVad

if TYPE_CHECKING:  # pragma: no cover
    from starlette.websockets import WebSocket

    from .config import Settings
    from .tts import TTSBackend
    from .vision import VisionBuffer

logger = logging.getLogger(__name__)


class SessionState(str, Enum):
    """Externally visible session state (mirrored to the client)."""

    IDLE = "idle"
    LISTENING = "listening"
    THINKING = "thinking"
    SPEAKING = "speaking"


@dataclass
class SessionDeps:
    """Shared, process-wide resources injected into each session."""

    settings: Settings
    stt: FasterWhisperSTT
    llm: LocalLLM
    tts: TTSBackend


@dataclass
class TurnState:
    """Everything about the turn currently in flight."""

    user_text: str = ""
    assistant_text: str = ""
    #: Characters of `assistant_text` whose audio has been fully sent.
    spoken_chars: int = 0
    vision: list[VisionFrame] = field(default_factory=list)
    started_at: float = field(default_factory=time.perf_counter)
    interrupted: bool = False


class LiveSession:
    """Owns one live voice session end to end."""

    def __init__(
        self,
        websocket: WebSocket,
        deps: SessionDeps,
        vad: StreamingVad,
        vision: VisionBuffer,
    ) -> None:
        self._ws = websocket
        self._deps = deps
        self._settings = deps.settings

        self._vad = vad
        self._segmenter = SpeechSegmenter(
            vad,
            min_speech_ms=self._settings.vad_min_speech_ms,
            min_silence_ms=self._settings.vad_min_silence_ms,
            sample_rate=proto.MIC_SAMPLE_RATE,
        )
        self._vision = vision
        self._transcriber = StreamingTranscriber(
            deps.stt,
            sample_rate=proto.MIC_SAMPLE_RATE,
            language=None,
            min_speech_s=self._settings.stt_min_speech,
            max_buffer_bytes=self._settings.max_audio_buffer_bytes,
        )

        self._state = SessionState.IDLE
        self._history: list[ChatMessage] = []
        self._turn = TurnState()

        self._generation_task: asyncio.Task[None] | None = None
        self._speak_task: asyncio.Task[None] | None = None
        self._closing = False
        self._send_lock = asyncio.Lock()
        #: Set while playback is live so the VAD knows barge-in is possible.
        self._barge_in_armed_at: float | None = None
        self._partial_text = ""

    # ------------------------------------------------------------------ #
    # Public API
    # ------------------------------------------------------------------ #

    async def run(self) -> None:
        """Consume frames until the socket closes."""
        await self._send_control(
            {
                "type": proto.CTRL_SESSION_READY,
                "sampleRate": proto.MIC_SAMPLE_RATE,
                "outSampleRate": self._deps.tts.sample_rate,
            }
        )
        try:
            while not self._closing:
                message = await self._ws.receive()
                if message.get("type") == "websocket.disconnect":
                    break
                data = message.get("bytes")
                if not data:
                    continue
                try:
                    frame = proto.decode_frame(data)
                except ValueError as exc:
                    logger.debug("dropping malformed frame: %s", exc)
                    continue
                await self._handle_frame(frame)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # pragma: no cover - transport level
            logger.exception("session loop failed: %s", exc)
        finally:
            await self._teardown()

    async def _handle_frame(self, frame: proto.Frame) -> None:
        if frame.type == proto.FrameType.AUDIO_MIC:
            await self._handle_audio(frame.payload)
        elif frame.type == proto.FrameType.IMAGE:
            await self._handle_image(frame.payload)
        elif frame.type == proto.FrameType.CONTROL:
            await self._handle_control(frame.as_control())
        else:
            logger.debug("ignoring frame type 0x%02x", frame.type)

    # ------------------------------------------------------------------ #
    # Audio ingest
    # ------------------------------------------------------------------ #

    async def _handle_audio(self, payload: bytes) -> None:
        if not payload:
            return
        samples = bytes_to_pcm16(payload)

        for frame in self._frames(samples):
            result = self._segmenter.push(frame)

            if result.event is SpeechEvent.SPEECH_START:
                await self._on_speech_start()
            elif result.event is SpeechEvent.SPEECH_END:
                await self._on_speech_end()

            # Partial captions while the user is still talking.
            if self._segmenter.in_segment:
                for transcript in self._transcriber.push_audio(frame):
                    if not transcript.is_final:
                        self._partial_text = transcript.text
                        await self._send_control(
                            {
                                "type": proto.CTRL_TRANSCRIPT_PARTIAL,
                                "text": transcript.text,
                            }
                        )

    def _frames(self, samples: np.ndarray):
        """Yield fixed-size 512-sample frames (Silero's required window)."""
        frame_size = getattr(self._vad, "frame_samples", 512)
        for start in range(0, samples.shape[0], frame_size):
            chunk = samples[start : start + frame_size]
            if chunk.shape[0] < frame_size:
                chunk = np.pad(chunk, (0, frame_size - chunk.shape[0]))
            yield chunk

    async def _on_speech_start(self) -> None:
        """User started speaking — possibly interrupting playback."""
        if self._state is SessionState.SPEAKING:
            if self._barge_in_armed_at is not None:
                elapsed_ms = (time.perf_counter() - self._barge_in_armed_at) * 1000
                if elapsed_ms < self._settings.vad_barge_in_delay_ms:
                    return  # ignore the assistant's own tail
            await self._interrupt("barge_in")
            return

        if self._state is SessionState.THINKING:
            # Spoke over the model while it was still generating.
            await self._interrupt("barge_in_during_thinking")
            return

        if self._state is SessionState.IDLE:
            await self._set_state(SessionState.LISTENING)

    async def _on_speech_end(self) -> None:
        """User finished a statement — run the turn."""
        if self._state is not SessionState.LISTENING:
            return

        result = self._transcriber.finalize()
        if result is None or not result.text.strip():
            self._partial_text = ""
            await self._set_state(SessionState.IDLE)
            return

        text = result.text.strip()
        self._partial_text = ""
        await self._send_control(
            {"type": proto.CTRL_TRANSCRIPT_FINAL, "text": text, "latencyMs": result.latency_ms}
        )
        await self._start_turn(text)

    # ------------------------------------------------------------------ #
    # Turn execution
    # ------------------------------------------------------------------ #

    async def _start_turn(self, user_text: str) -> None:
        frames = await self._vision.latest()
        vision = [
            VisionFrame(jpeg=data, captured_at=frames.captured_at)
            for data in frames.frames
        ]

        self._turn = TurnState(user_text=user_text, vision=vision)
        self._history.append(ChatMessage(role="user", content=user_text, vision=vision))
        await self._set_state(SessionState.THINKING)

        # Run generation off the ingest path so audio keeps flowing.
        self._generation_task = asyncio.create_task(self._generate_and_speak())

    async def _generate_and_speak(self) -> None:
        segmenter = TextSegmenter()
        speak_queue: asyncio.Queue[str | None] = asyncio.Queue()

        async def producer() -> None:
            """Pull LLM tokens and push speakable chunks into the queue."""
            try:
                async for token in self._deps.llm.stream(
                    self._history, vision=self._turn.vision or None
                ):
                    self._turn.assistant_text += token
                    await self._send_control(
                        {"type": proto.CTRL_RESPONSE_DELTA, "text": token}
                    )
                    for chunk in segmenter.push(token):
                        await speak_queue.put(chunk)
            except LLMUnavailable as exc:
                logger.warning("llm unavailable: %s", exc)
                await self._send_control(
                    {"type": proto.CTRL_ERROR, "message": str(exc)}
                )
            except asyncio.CancelledError:
                # Interruption: stop generating, flush anything still queued.
                while not speak_queue.empty():
                    with contextlib.suppress(asyncio.QueueEmpty):
                        speak_queue.get_nowait()
                raise
            finally:
                for chunk in segmenter.flush():
                    await speak_queue.put(chunk)
                await speak_queue.put(None)

        async def consumer() -> None:
            """Synthesise and stream audio, tracking what was actually said."""
            while True:
                chunk = await speak_queue.get()
                if chunk is None:
                    break
                await self._speak_chunk(chunk)
                # Everything up to and including this chunk has been sent.
                self._turn.spoken_chars = len(self._turn.assistant_text)

        producer_task = asyncio.create_task(producer())
        try:
            await asyncio.gather(producer_task, consumer())
        except asyncio.CancelledError:
            producer_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await producer_task
            raise
        finally:
            await self._finish_turn()

    async def _speak_chunk(self, text: str) -> None:
        """Synthesise one chunk and stream it out in small frames."""
        spoken = strip_for_speech(text)
        if not spoken:
            return

        loop = asyncio.get_running_loop()
        for samples in self._deps.tts.synthesize_stream(spoken):
            if self._closing or (self._generation_task and self._generation_task.cancelled()):
                return
            payload = pcm16_to_bytes(samples)
            if not payload:
                continue
            # Chunk the PCM into 20 ms frames to keep the socket smooth.
            step = proto.OUT_FRAME_BYTES
            for offset in range(0, len(payload), step):
                frame = payload[offset : offset + step]
                await self._send_audio(frame, final=False)
                # Yield to the event loop so barge-in stays responsive.
                await asyncio.sleep(0)

        if self._state is not SessionState.SPEAKING:
            await self._set_state(SessionState.SPEAKING)
            self._barge_in_armed_at = time.perf_counter()
            await self._send_audio(b"", final=True)

    async def _finish_turn(self) -> None:
        """Commit the turn to history and return to idle."""
        if self._state is SessionState.SPEAKING:
            await self._send_audio(b"", final=True)

        spoken = self._turn.assistant_text.strip()
        if spoken:
            # Truncate to what the user actually heard.
            if self._turn.interrupted and self._turn.spoken_chars > 0:
                spoken = self._turn.assistant_text[: self._turn.spoken_chars].strip()
            self._history.append(
                ChatMessage(role="assistant", content=spoken, truncated=self._turn.interrupted)
            )
            await self._send_control(
                {
                    "type": proto.CTRL_RESPONSE_DONE,
                    "text": spoken,
                    "truncated": self._turn.interrupted,
                }
            )

        self._barge_in_armed_at = None
        if self._state is not SessionState.IDLE:
            await self._set_state(SessionState.IDLE)

    # ------------------------------------------------------------------ #
    # Interruption
    # ------------------------------------------------------------------ #

    async def _interrupt(self, reason: str) -> None:
        """Barge-in: clear the buffer, cancel generation, truncate memory.

        Order matters. CLEAR_BUFFER goes out first so the user hears silence
        immediately; only then do we stop work that is no longer needed.
        """
        logger.info("interrupting (%s) in state=%s", reason, self._state.value)
        self._turn.interrupted = True

        # (a) Tell the client to drop everything it has buffered.
        await self._send_control({"type": proto.CTRL_CLEAR_BUFFER, "reason": reason})

        # (b) Stop LLM generation and any in-flight synthesis.
        task = self._generation_task
        self._generation_task = None
        if task and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task

        # (c) Commit only what was spoken, then resume listening.
        await self._finish_turn()
        self._transcriber.discard()
        self._segmenter.reset()
        await self._set_state(SessionState.LISTENING)

    # ------------------------------------------------------------------ #
    # Vision + control
    # ------------------------------------------------------------------ #

    async def _handle_image(self, payload: bytes) -> None:
        # Hand off immediately: the socket reader must never block on encoding.
        asyncio.create_task(self._vision.submit(payload))

    async def _handle_control(self, message: dict[str, Any]) -> None:
        kind = message.get("type")
        if kind == proto.CTRL_TEXT:
            text = str(message.get("text", "")).strip()
            if text:
                await self._send_control(
                    {"type": proto.CTRL_TRANSCRIPT_FINAL, "text": text, "latencyMs": 0}
                )
                await self._start_turn(text)
        elif kind == proto.CTRL_INTERRUPT:
            await self._interrupt("client")
        elif kind == proto.CTRL_SESSION_STOP:
            self._closing = True
        elif kind == proto.CTRL_SESSION_START:
            cfg = proto.SessionConfig.from_control(message)
            if cfg.language:
                self._transcriber._language = cfg.language  # noqa: SLF001
            self._history.clear()
            await self._set_state(SessionState.IDLE)
        elif kind == proto.CTRL_AUDIO_END:
            if self._segmenter.in_segment:
                await self._on_speech_end()

    # ------------------------------------------------------------------ #
    # Transport helpers
    # ------------------------------------------------------------------ #

    async def _set_state(self, state: SessionState) -> None:
        if self._state is state:
            return
        self._state = state
        await self._send_control({"type": proto.CTRL_STATE, "state": state.value})

    async def _send_control(self, message: dict[str, Any]) -> None:
        await self._send(proto.encode_control(message))

    async def _send_audio(self, pcm: bytes, *, final: bool) -> None:
        await self._send(proto.encode_audio_out(pcm, final=final))

    async def _send(self, data: bytes) -> None:
        # Serialise writes: concurrent audio + control frames must not
        # interleave on the socket.
        async with self._send_lock:
            if self._closing:
                return
            try:
                await self._ws.send_bytes(data)
            except Exception as exc:  # pragma: no cover - transport
                logger.debug("send failed: %s", exc)
                self._closing = True

    async def _teardown(self) -> None:
        self._closing = True
        for task in (self._generation_task, self._speak_task):
            if task and not task.done():
                task.cancel()
                with contextlib.suppress(asyncio.CancelledError, Exception):
                    await task
        self._transcriber.discard()
        self._vad.close()
        self._vision.clear()

    # ------------------------------------------------------------------ #
    # Introspection (used by tests and /health)
    # ------------------------------------------------------------------ #

    @property
    def state(self) -> SessionState:
        return self._state

    @property
    def history(self) -> list[ChatMessage]:
        return list(self._history)

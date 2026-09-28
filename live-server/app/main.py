"""FastAPI application: WebSocket endpoint, model registry, and health checks.

Run with:

    uvicorn app.main:app --host 127.0.0.1 --port 8787

Models are loaded once at startup and shared across sessions — loading
faster-whisper or Piper per connection would add seconds to every connection.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from . import protocol as proto
from .config import get_settings
from .llm import LocalLLM
from .session import LiveSession, SessionDeps
from .stt import FasterWhisperSTT
from .tts import build_tts
from .vad import build_vad
from .vision import VisionBuffer

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
logger = logging.getLogger("live.main")

#: Populated during startup; shared by every session.
REGISTRY: dict[str, Any] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load models once, then serve."""
    settings = get_settings()
    started = time.perf_counter()

    # STT and TTS load in a thread so the event loop stays responsive.
    stt: FasterWhisperSTT | None = None
    tts = None
    if settings.preload_models:
        logger.info("loading models…")
        stt, tts = await asyncio.gather(
            asyncio.to_thread(
                FasterWhisperSTT,
                settings.stt_model,
                device=settings.stt_device,
                compute_type=settings.stt_compute_type,
                beam_size=settings.stt_beam_size,
            ),
            asyncio.to_thread(
                build_tts,
                settings.tts_backend,
                model=settings.tts_model,
                data_dir=settings.tts_data_dir,
                sample_rate=settings.tts_sample_rate,
                speed=settings.tts_speed,
            ),
            return_exceptions=True,
        )
        if isinstance(stt, BaseException):
            logger.error("STT failed to load: %s", stt)
            stt = None
        if isinstance(tts, BaseException):
            logger.error("TTS failed to load: %s", tts)
            tts = None

    llm = LocalLLM(
        base_url=settings.llm_base_url,
        model=settings.llm_model,
        api_key=settings.llm_api_key,
        temperature=settings.llm_temperature,
        max_tokens=settings.llm_max_tokens,
        timeout_s=settings.llm_timeout_s,
    )

    REGISTRY.update(
        settings=settings,
        stt=stt,
        tts=tts,
        llm=llm,
        ready=stt is not None and tts is not None,
        started_at=started,
    )

    if stt is None or tts is None:
        logger.warning(
            "running in degraded mode (stt=%s tts=%s) — the pipeline will not "
            "produce audio until models load successfully",
            stt is not None,
            tts is not None,
        )

    health = await llm.health()
    if not health.get("ok"):
        logger.warning("LLM server not reachable at %s: %s", settings.llm_base_url, health)
    else:
        logger.info("LLM reachable: %s", health.get("models"))

    logger.info("startup complete in %.1fs", time.perf_counter() - started)
    try:
        yield
    finally:
        with contextlib.suppress(Exception):
            if REGISTRY.get("tts") is not None:
                REGISTRY["tts"].close()
            if REGISTRY.get("stt") is not None:
                REGISTRY["stt"].close()
        logger.info("shutdown complete")


app = FastAPI(title="Freebuff Live Voice + Vision", version="1.0.0", lifespan=lifespan)

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health() -> dict[str, Any]:
    """Readiness plus which models are actually loaded."""
    stt = REGISTRY.get("stt")
    tts = REGISTRY.get("tts")
    llm: LocalLLM | None = REGISTRY.get("llm")
    return {
        "ok": bool(REGISTRY.get("ready")),
        "stt_loaded": stt is not None,
        "tts_loaded": tts is not None,
        "tts_backend": type(tts).__name__ if tts else None,
        "out_sample_rate": getattr(tts, "sample_rate", None),
        "llm": await llm.health() if llm else {"ok": False},
        "uptime_s": round(time.perf_counter() - REGISTRY.get("started_at", time.perf_counter()), 1),
    }


@app.websocket("/ws/live")
async def ws_live(websocket: WebSocket) -> None:
    """One live voice+vision session per connection."""
    await websocket.accept()
    session_id = f"{id(websocket):x}"
    logger.info("session %s connected", session_id)

    settings = get_settings()
    stt = REGISTRY.get("stt")
    tts = REGISTRY.get("tts")
    llm = REGISTRY.get("llm")

    if stt is None or tts is None or llm is None:
        await websocket.send_bytes(
            proto.encode_control(
                {
                    "type": proto.CTRL_ERROR,
                    "message": "Models are not loaded. Check the server logs.",
                }
            )
        )
        await websocket.close(code=1011)
        return

    # Per-session VAD (model state is mutable) and vision buffer.
    vad = build_vad(settings)
    vision = VisionBuffer(
        max_frames=settings.vision_max_frames,
        max_edge=settings.vision_max_edge,
        quality=settings.vision_jpeg_quality,
    )
    deps = SessionDeps(settings=settings, stt=stt, llm=llm, tts=tts)
    session = LiveSession(websocket, deps, vad, vision)

    try:
        await session.run()
    except WebSocketDisconnect:
        logger.info("session %s disconnected", session_id)
    except Exception:
        logger.exception("session %s crashed", session_id)
    finally:
        logger.info("session %s closed", session_id)
        with contextlib.suppress(Exception):
            await websocket.close()

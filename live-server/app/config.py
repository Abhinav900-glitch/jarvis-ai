"""Configuration for the local live voice + vision pipeline.

All settings are read from the environment (optionally via a .env file) so the
same code runs on a laptop, a workstation, or a GPU box without edits.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    """Runtime configuration. Every field is overridable by env var."""

    model_config = SettingsConfigDict(
        env_prefix="LIVE_",
        env_file=(REPO_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- server -----------------------------------------------------------
    host: str = "127.0.0.1"
    port: int = 8787
    #: Comma-separated allowlist; "*" permits any origin. The Vite dev server
    #: must be listed so the browser can open the WebSocket.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    log_level: str = "INFO"

    # --- speech-to-text ---------------------------------------------------
    #: faster-whisper model size or a path to a downloaded model directory.
    stt_model: str = "base"
    #: "int8" for CPU, "float16" for GPU.
    stt_compute_type: str = "int8"
    stt_device: str = "cpu"
    stt_beam_size: int = 1
    #: Silence (seconds) after speech that finalises a transcript.
    stt_endpoint_silence: float = 0.6
    #: Minimum speech length (seconds) before a turn is submitted.
    stt_min_speech: float = 0.4

    # --- text-to-speech ----------------------------------------------------
    #: piper | kokoro | none
    tts_backend: str = "piper"
    tts_model: str = "en_US-amy-medium"
    tts_data_dir: str = "~/.local/share/piper-voices"
    tts_sample_rate: int = 24_000
    tts_speed: float = 1.0

    # --- llm ---------------------------------------------------------------
    #: OpenAI-compatible local server (llama.cpp, Ollama, vLLM, LM Studio).
    llm_base_url: str = "http://127.0.0.1:8080/v1"
    llm_model: str = "local-model"
    llm_api_key: str = "not-needed"
    llm_temperature: float = 0.6
    llm_max_tokens: int = 512
    llm_context_messages: int = 12
    llm_timeout_s: float = 120.0
    #: Vision model id; when set, recent frames are attached to the request.
    llm_vision_model: str | None = None
    llm_vision_interval: float = 0.5

    # --- vision ------------------------------------------------------------
    vision_enabled: bool = True
    vision_max_frames: int = 2
    vision_jpeg_quality: int = 6  # for Pillow, 0-10 scale
    vision_max_edge: int = 768

    # --- vad / interruption ------------------------------------------------
    #: silero | energy
    vad_backend: str = "silero"
    vad_threshold: float = 0.5
    #: Consecutive voiced chunks required to open a speech segment.
    vad_min_speech_ms: int = 200
    #: Consecutive silent chunks required to close one.
    vad_min_silence_ms: int = 500
    #: Grace period after speech onset before barge-in is armed, so the
    #: assistant's own tail does not immediately interrupt itself.
    vad_barge_in_delay_ms: int = 240

    # --- runtime -----------------------------------------------------------
    #: Max buffered inbound PCM bytes per session before back-pressure.
    max_audio_buffer_bytes: int = 4 * 1024 * 1024
    preload_models: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        if self.cors_origins.strip() == "*":
            return ["*"]
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached settings singleton."""
    return Settings()

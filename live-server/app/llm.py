"""Local LLM router.

Targets any OpenAI-compatible server running on localhost — llama.cpp's
`llama-server`, Ollama's `/v1` shim, vLLM, LM Studio, or text-generation-webui.
No third-party API is involved; the base URL defaults to 127.0.0.1.

Responsibilities:
  * stream tokens as they are produced (never buffer the full reply)
  * attach recent camera frames to the prompt when a vision model is configured
  * support hard cancellation mid-generation, which is what barge-in needs
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = (
    "You are Jarvis, a concise voice assistant. You are being listened to, not "
    "read, so reply in short spoken sentences. Never use markdown, bullet "
    "points, code blocks, or emoji. Keep answers under about three sentences "
    "unless the user explicitly asks for detail."
)


@dataclass(slots=True)
class VisionFrame:
    """One camera/screen frame made available to the model."""

    jpeg: bytes
    captured_at: float
    label: str = "camera"

    def to_data_url(self) -> str:
        return "data:image/jpeg;base64," + base64.b64encode(self.jpeg).decode("ascii")


@dataclass(slots=True)
class ChatMessage:
    """A single turn in the conversation history."""

    role: str
    content: str
    #: Set when a reply was cut short by barge-in.
    truncated: bool = False
    #: Frames the user could actually see/say about at this point.
    vision: list[VisionFrame] = field(default_factory=list)

    def to_api(self) -> dict[str, Any]:
        """Render as an OpenAI chat-completions message."""
        if not self.vision:
            return {"role": self.role, "content": self.content}
        parts: list[dict[str, Any]] = [{"type": "text", "text": self.content}]
        for frame in self.vision:
            parts.append({"type": "image_url", "image_url": {"url": frame.to_data_url()}})
        return {"role": self.role, "content": parts}


class LLMUnavailable(RuntimeError):
    """Raised when the local model server cannot be reached."""


class LocalLLM:
    """Streaming client for a local OpenAI-compatible server."""

    def __init__(
        self,
        *,
        base_url: str = "http://127.0.0.1:8080/v1",
        model: str = "local-model",
        api_key: str = "not-needed",
        temperature: float = 0.6,
        max_tokens: int = 512,
        timeout_s: float = 120.0,
        system_prompt: str = SYSTEM_PROMPT,
        max_history: int = 12,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._model = model
        self._api_key = api_key
        self._temperature = temperature
        self._max_tokens = max_tokens
        self._timeout = httpx.Timeout(timeout_s, connect=10.0)
        self._system_prompt = system_prompt
        self._max_history = max_history

    # -- health ---------------------------------------------------------- #

    async def health(self) -> dict[str, Any]:
        """Probe the model server; used by /health and startup warnings."""
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                res = await client.get(f"{self._base_url}/models")
            if res.status_code >= 400:
                return {"ok": False, "status": res.status_code}
            payload = res.json()
            ids = [m.get("id") for m in payload.get("data", [])]
            return {"ok": True, "models": ids}
        except Exception as exc:
            return {"ok": False, "error": str(exc)}

    # -- generation ------------------------------------------------------ #

    async def stream(
        self,
        messages: list[ChatMessage],
        *,
        vision: list[VisionFrame] | None = None,
    ) -> AsyncIterator[str]:
        """Yield response tokens as the local model produces them.

        Args:
            messages: conversation history, oldest first.
            vision: frames to attach to the newest user turn, if the configured
                model is multimodal.

        Raises:
            LLMUnavailable: if the server is unreachable or returns an error.
        """
        api_messages: list[dict[str, Any]] = [
            {"role": "system", "content": self._system_prompt}
        ]
        for message in messages[-self._max_history :]:
            api_messages.append(message.to_api())

        # Attach the newest frames to the final user message.
        if vision:
            if not api_messages or api_messages[-1].get("role") != "user":
                api_messages.append({"role": "user", "content": ""})
            last = api_messages[-1]
            if isinstance(last.get("content"), str):
                parts: list[dict[str, Any]] = [{"type": "text", "text": last["content"]}]
                for frame in vision:
                    parts.append(
                        {"type": "image_url", "image_url": {"url": frame.to_data_url()}}
                    )
                last["content"] = parts

        body = {
            "model": self._model,
            "messages": api_messages,
            "stream": True,
            "temperature": self._temperature,
            "max_tokens": self._max_tokens,
        }

        try:
            async with httpx.AsyncClient(timeout=self._timeout) as client:
                async with client.stream(
                    "POST",
                    f"{self._base_url}/chat/completions",
                    json=body,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Content-Type": "application/json",
                    },
                ) as res:
                    if res.status_code >= 400:
                        detail = (await res.aread()).decode("utf-8", "replace")[:300]
                        raise LLMUnavailable(f"model server {res.status_code}: {detail}")

                    async for token in self._iter_sse(res):
                        if token:
                            yield token
        except httpx.HTTPError as exc:
            raise LLMUnavailable(f"cannot reach model server: {exc}") from exc

    @staticmethod
    async def _iter_sse(res: httpx.Response) -> AsyncIterator[str]:
        """Parse OpenAI-style SSE lines into content deltas."""
        async for line in res.aiter_lines():
            if not line or not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                if data == "[DONE]":
                    return
                continue
            try:
                event = json.loads(data)
            except json.JSONDecodeError:
                continue
            for choice in event.get("choices", []):
                delta = choice.get("delta") or {}
                content = delta.get("content")
                if content:
                    yield content
                # Some servers stream a final usage frame with no choices.
                if choice.get("finish_reason") and not delta.get("content"):
                    continue

    async def complete(
        self,
        messages: list[ChatMessage],
        *,
        vision: list[VisionFrame] | None = None,
    ) -> str:
        """Non-streaming convenience wrapper (used by tests and tooling)."""
        chunks: list[str] = []
        async for token in self.stream(messages, vision=vision):
            chunks.append(token)
        return "".join(chunks)


async def cancel_stream(task: asyncio.Task[Any]) -> None:
    """Cancel an in-flight generation task and wait for it to unwind.

    Cancellation is the second half of barge-in: the transport is already
    cleared, so the generator must stop pulling tokens immediately.
    """
    if task.done():
        return
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, Exception):  # noqa: B014 - both are expected
        pass

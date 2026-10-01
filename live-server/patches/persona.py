"""Session persona — who built Jarvis, handed to the LOCAL model.

Copy this file into your ``live-server/app/`` directory::

    cp live-server/patches/persona.py live-server/app/persona.py

Then make the two edits described in ``live-server/README.md``
("Persona — making live mode answer as the same assistant").

Why this exists
---------------
Live mode runs a model on your own machine (llama.cpp, Ollama, LM Studio).
That model has never heard of this application. Ask it "who made you?" and it
answers with whichever lab trained it — OpenAI, Google, Meta — because from its
point of view that is simply true. It is answering correctly about itself and
wrong about who built the *thing it is running inside*.

The web app already knows the answer, and sends it once at session start in the
``instructions`` field of the ``session.start`` control frame. This module reads
that field and folds it into the system prompt.

Design notes
------------
**The block is APPENDED, never prepended.** The pipeline's own base prompt
usually opens with something like "You are a helpful assistant." Instructions
placed before it get diluted; instructions placed after it are the most recent
thing the model read and therefore the ones it follows. Appending is the whole
trick, and it is why ``compose_prompt`` exists instead of a string
concatenation at the call site.

**Absent means absent, not empty.** An older browser sends ``session.start``
with no ``instructions`` key at all. That must leave behaviour exactly as it
was, not raise and not blank the prompt — so every function here treats a
missing, empty, non-string or over-long value as "no instructions".

**Sticky per session, cleared on stop.** The value is stored on the session
rather than re-read per turn, so it cannot be lost mid-conversation by a
reconnect that raced the first frame. ``LiveSession.clear()`` drops it, so a
different browser session cannot inherit the previous one's identity.
"""

from __future__ import annotations

from typing import Any

__all__ = [
    "MAX_INSTRUCTIONS_CHARS",
    "TRUNCATION_NOTICE",
    "read_instructions",
    "compose_prompt",
    "LivePersona",
]

# A ceiling, because this string is re-sent to the model on every single turn
# inside the system prompt. The browser currently sends roughly 3 KB (identity +
# manners + spoken-output rules) plus whatever the user has written, and
# MAX_INSTRUCTIONS caps that at 4 KB, so 12 KB leaves generous headroom while
# still making it impossible for one oversized field to crowd out the
# conversation itself.
MAX_INSTRUCTIONS_CHARS = 12_000

TRUNCATION_NOTICE = "\n\n[instructions truncated]"


def read_instructions(msg: Any) -> str:
    """Return the ``instructions`` field of a ``session.start`` message.

    ``msg`` may be a dict (decoded JSON) or any object with an ``instructions``
    attribute, so this works whichever shape ``session.py`` hands it over as.

    Returns ``""`` for every unusable input — missing key, ``None``, non-string
    (a client could send a number, a list, an object), empty or whitespace-only
    — and a truncated string if it exceeds :data:`MAX_INSTRUCTIONS_CHARS`.
    """
    raw: Any = None
    if isinstance(msg, dict):
        raw = msg.get("instructions")
    elif msg is not None:
        raw = getattr(msg, "instructions", None)

    # A non-string here means a hand-rolled or malicious client. Coerce nothing:
    # str([...]) would inject a repr of a list into the system prompt.
    if not isinstance(raw, str):
        return ""

    text = raw.strip()
    if not text:
        return ""

    if len(text) > MAX_INSTRUCTIONS_CHARS:
        return text[:MAX_INSTRUCTIONS_CHARS] + TRUNCATION_NOTICE
    return text


def compose_prompt(base_prompt: str, instructions: str) -> str:
    """Fold ``instructions`` into ``base_prompt``, appended so they take priority.

    This is the function the two edits in the README both go through, so there
    is exactly one place where ordering is decided and one place to look when
    the identity rules stop being followed.

    With no instructions, ``base_prompt`` is returned byte-for-byte — a browser
    that predates the field sees no change in behaviour whatsoever.
    """
    instructions = (instructions or "").strip()
    if not instructions:
        return base_prompt

    base_prompt = (base_prompt or "").strip()
    if not base_prompt:
        return instructions

    # The rule about who built the app is absolute; the pipeline's own preamble
    # is a general default. Putting the specific rule after the general one is
    # how instruction-following models resolve the conflict.
    return f"{base_prompt}\n\n---\n{instructions}"


class LivePersona:
    """Per-connection holder for the instructions received at session start.

    Mirrors how ``LiveSession`` already holds ``spoken_chars`` and the history:
    one small object per connection, no globals, so two browser tabs cannot
    overwrite each other's identity.

    Usage::

        persona = LivePersona()

        # in the session.start handler
        persona.set(read_instructions(msg))

        # wherever the system prompt is assembled, every turn
        prompt = persona.apply(base_system_prompt)

        # in the session.stop handler / on disconnect
        persona.clear()
    """

    __slots__ = ("_instructions", "_received")

    def __init__(self) -> None:
        self._instructions: str = ""
        # Whether a client ever sent the field at all. Distinguishes "older
        # browser, no field" from "browser sent an empty one", which look
        # identical in the prompt but mean different things when debugging.
        self._received: bool = False

    def set(self, instructions: str) -> None:
        """Store the block for this session. An empty value clears it."""
        text = (instructions or "").strip()
        self._received = bool(text)
        self._instructions = text

    def load_from(self, msg: Any) -> str:
        """Read ``msg``'s ``instructions`` field and store it. Returns what was stored."""
        text = read_instructions(msg)
        self.set(text)
        return text

    def clear(self) -> None:
        self._instructions = ""
        self._received = False

    def apply(self, base_prompt: str) -> str:
        """The system prompt to actually send this turn."""
        return compose_prompt(base_prompt, self._instructions)

    @property
    def instructions(self) -> str:
        return self._instructions

    @property
    def received(self) -> bool:
        """True once a client has sent a non-empty ``instructions`` field."""
        return self._received

    def status(self) -> dict:
        """A summary for ``/health``, so the wiring can be confirmed without asking a question.

        Reports only lengths — never the text, which contains the user's own
        standing instructions and should not be echoed back over HTTP.
        """
        return {
            "instructions_received": self._received,
            "instructions_chars": len(self._instructions),
        }

    def __repr__(self) -> str:  # pragma: no cover - debugging aid
        return f"LivePersona(received={self._received}, chars={len(self._instructions)})"
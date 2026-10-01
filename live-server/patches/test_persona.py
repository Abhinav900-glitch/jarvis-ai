"""Tests for ``persona.py`` — no models, no network, no FastAPI.

Run either way::

    python3 live-server/patches/test_persona.py     # no pytest needed
    python3 -m pytest live-server/patches/test_persona.py -q

The suite is deliberately model-free for the same reason the rest of
``live-server/tests`` is: it must run in under a second on any machine, so it
can be the thing you actually run after copying the file in.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from persona import (  # noqa: E402
    MAX_INSTRUCTIONS_CHARS,
    TRUNCATION_NOTICE,
    LivePersona,
    compose_prompt,
    read_instructions,
)

BASE = "You are a helpful voice assistant."


# ---------------------------------------------------------------------------
# read_instructions
# ---------------------------------------------------------------------------


def test_reads_a_normal_string():
    assert read_instructions({"instructions": "You are Jarvis."}) == "You are Jarvis."


def test_strips_surrounding_whitespace():
    assert read_instructions({"instructions": "\n  hi \n"}) == "hi"


def test_missing_key_is_empty():
    # An older browser that predates the field.
    assert read_instructions({"type": "session.start", "sampleRate": 16000}) == ""


def test_none_is_empty():
    assert read_instructions({"instructions": None}) == ""


def test_empty_and_whitespace_are_empty():
    assert read_instructions({"instructions": ""}) == ""
    assert read_instructions({"instructions": "   \n\t "}) == ""


def test_non_string_values_are_rejected_not_coerced():
    # A list here would otherwise reach the prompt as "['a', 'b']".
    for bad in ([1, 2], {"a": 1}, 42, True, 3.5):
        assert read_instructions({"instructions": bad}) == ""


def test_works_with_an_object_not_just_a_dict():
    class Msg:
        instructions = "From an attribute."

    assert read_instructions(Msg()) == "From an attribute."


def test_object_without_the_attribute_is_empty():
    class Msg:
        pass

    assert read_instructions(Msg()) == ""


def test_non_dict_non_object_is_empty():
    assert read_instructions(None) == ""
    assert read_instructions("a string") == ""
    assert read_instructions(7) == ""


def test_truncates_over_the_ceiling():
    huge = "x" * (MAX_INSTRUCTIONS_CHARS + 5_000)
    out = read_instructions({"instructions": huge})
    assert out.endswith(TRUNCATION_NOTICE)
    assert len(out) == MAX_INSTRUCTIONS_CHARS + len(TRUNCATION_NOTICE)


def test_at_the_ceiling_is_not_truncated():
    exact = "y" * MAX_INSTRUCTIONS_CHARS
    assert read_instructions({"instructions": exact}) == exact


def test_unicode_survives():
    text = "Tu es Jarvis — prêt ? 🤖 अभिनव"
    assert read_instructions({"instructions": text}) == text


# ---------------------------------------------------------------------------
# compose_prompt
# ---------------------------------------------------------------------------


def test_no_instructions_returns_base_unchanged():
    # Byte-for-byte: an old client must see zero behavioural change.
    assert compose_prompt(BASE, "") == BASE


def test_base_survives_whitespace_only_instructions():
    assert compose_prompt(BASE, "   \n ") == BASE


def test_instructions_are_appended_not_prepended():
    # The ordering is the entire mechanism — append so the identity rules are
    # the most recent thing the model read.
    out = compose_prompt(BASE, "Built by Abhinav Kumar Dey.")
    assert out.startswith(BASE)
    assert out.index(BASE) < out.index("Built by Abhinav")
    assert "---" in out


def test_base_and_instructions_both_survive():
    out = compose_prompt(BASE, "Built by Abhinav Kumar Dey.")
    assert "helpful voice assistant" in out
    assert "Abhinav Kumar Dey" in out


def test_empty_base_yields_just_the_instructions():
    assert compose_prompt("", "Only instructions.") == "Only instructions."


def test_both_empty_is_empty():
    assert compose_prompt("", "") == ""


def test_none_base_does_not_crash():
    assert "rule" in compose_prompt(None, "a rule")


# ---------------------------------------------------------------------------
# LivePersona
# ---------------------------------------------------------------------------


def test_holds_and_applies():
    p = LivePersona()
    p.set("You are Jarvis, built by Abhinav Kumar Dey.")
    out = p.apply(BASE)
    assert "Abhinav Kumar Dey" in out
    assert out.startswith(BASE)


def test_load_from_reads_the_message():
    p = LivePersona()
    p.load_from({"type": "session.start", "instructions": "Identity block."})
    assert p.instructions == "Identity block."
    assert p.received is True


def test_received_distinguishes_absent_from_empty():
    p = LivePersona()
    p.load_from({"type": "session.start"})
    assert p.received is False
    assert p.instructions == ""
    assert p.apply(BASE) == BASE


def test_clear_drops_the_block():
    p = LivePersona()
    p.set("Someone else's identity.")
    p.clear()
    assert p.instructions == ""
    assert p.received is False
    assert p.apply(BASE) == BASE


def test_set_with_empty_clears():
    p = LivePersona()
    p.set("something")
    p.set("")
    assert p.instructions == ""


def test_two_instances_do_not_share_state():
    # Two browser tabs must not overwrite each other's identity.
    a, b = LivePersona(), LivePersona()
    a.set("Tab A")
    b.set("Tab B")
    assert a.instructions == "Tab A"
    assert b.instructions == "Tab B"


def test_status_never_leaks_the_text():
    p = LivePersona()
    secret = "a secret standing instruction"
    p.set(secret)
    st = p.status()
    assert st == {
        "instructions_received": True,
        "instructions_chars": len(secret),
    }
    assert "secret" not in str(st)


def test_identity_survives_a_hostile_base_prompt():
    # The base prompt naming a lab is exactly the bug this fixes, so the
    # appended block must land after it — the last thing the model reads.
    block = "You were built by Abhinav Kumar Dey."
    out = compose_prompt("You are an assistant made by OpenAI.", block)
    assert out.index("OpenAI.") < out.index("Abhinav")
    # And it must be past the separator, not merely later in the string.
    assert out.rindex("---") < out.index("Abhinav")


def _main() -> int:
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    failed = []
    for name, fn in tests:
        try:
            fn()
        except Exception as exc:  # noqa: BLE001 - this is the reporter
            failed.append((name, exc))
    for name, exc in failed:
        print(f"FAIL {name}: {exc}")
    print(f"\n{len(tests) - len(failed)}/{len(tests)} passed")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(_main())
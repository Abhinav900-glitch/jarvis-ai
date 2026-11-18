// The wake gate decides whether a live utterance becomes a turn, so both
// directions are worth pinning: the phrases that should wake Jarvis, and the
// sentences that must not.

import { describe, expect, test } from "bun:test";
import {
  WAKE_PHRASE,
  hasWakeWord,
  normalizeWakePhrase,
  stripWakeWord,
} from "../wake-word";

describe("stripWakeWord", () => {
  test("keeps the command that follows the phrase", () => {
    expect(stripWakeWord("Hey Jarvis, what's the weather")).toEqual({
      text: "what's the weather",
      woke: true,
      onlyWake: false,
    });
    expect(stripWakeWord("hey jarvis open the dashboard").text).toBe(
      "open the dashboard",
    );
  });

  test("the bare name is a wake only when it is the whole utterance", () => {
    expect(stripWakeWord("Jarvis")).toEqual({
      text: "",
      woke: true,
      onlyWake: true,
    });
    expect(stripWakeWord("Jarvis, are you there").woke).toBe(true);
    expect(stripWakeWord("Jervis is a surname").woke).toBe(false);
  });

  test("hesitation before the phrase still wakes it", () => {
    expect(stripWakeWord("um, hey jarvis, play music").text).toBe("play music");
  });

  test("a sentence about the name is not a wake", () => {
    expect(hasWakeWord("tell me about Jarvis")).toBe(false);
    expect(hasWakeWord("is jarvis listening?")).toBe(false);
    expect(hasWakeWord("what's the weather")).toBe(false);
  });
});

describe("custom phrases", () => {
  test("a chosen phrase replaces the default", () => {
    expect(stripWakeWord("Computer, open the dashboard", "Computer")).toEqual({
      text: "open the dashboard",
      woke: true,
      onlyWake: false,
    });
    expect(hasWakeWord("hey jarvis, play music", "Computer")).toBe(false);
  });

  test("two-word phrases keep their own addresser", () => {
    expect(stripWakeWord("Hey Nova, play music", "Hey Nova").text).toBe(
      "play music",
    );
    expect(stripWakeWord("okay nova, play music", "Hey Nova").text).toBe(
      "play music",
    );
  });

  test("a custom name is matched exactly, not fuzzily", () => {
    // "novel" must not wake a phrase whose name is "nova".
    expect(hasWakeWord("novel idea, right", "Hey Nova")).toBe(false);
    expect(hasWakeWord("nova", "Hey Nova")).toBe(true);
  });
});

describe("normalizeWakePhrase", () => {
  test("tidies whitespace and surrounding punctuation", () => {
    expect(normalizeWakePhrase("  hey   nova ")).toBe("hey nova");
    expect(normalizeWakePhrase("“Computer.”")).toBe("Computer");
  });

  test("unusable input falls back to the default", () => {
    expect(normalizeWakePhrase("")).toBe(WAKE_PHRASE);
    expect(normalizeWakePhrase(null)).toBe(WAKE_PHRASE);
    expect(normalizeWakePhrase("   ")).toBe(WAKE_PHRASE);
    expect(normalizeWakePhrase("this is a much too long phrase to speak")).toBe(
      WAKE_PHRASE,
    );
  });
});

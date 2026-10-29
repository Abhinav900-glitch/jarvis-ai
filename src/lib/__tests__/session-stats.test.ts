// Tests for session statistics — the numbers behind /stats.
//
// Deliberately post-decryption plain fields: the transcript has already loaded
// them, so the dialog can open instantly without a query. What matters here:
//
//   - an empty conversation returns zeros rather than dividing by zero,
//   - latency averages over replies that reported one (a missing timing is
//     skipped, not averaged in as 0ms),
//   - engines aggregate by id and the span is driven by createdAt,
//   - engineLabel strips the `provider/` prefix for compact display.

import { describe, expect, test } from "bun:test";
import { engineLabel, sessionStats } from "../session-stats";

describe("sessionStats", () => {
  test("empty conversation returns zeros", () => {
    const s = sessionStats([]);
    expect(s.messages).toBe(0);
    expect(s.userMessages).toBe(0);
    expect(s.replies).toBe(0);
    expect(s.words).toBe(0);
    expect(s.promptTokens).toBe(0);
    expect(s.completionTokens).toBe(0);
    expect(s.avgLatencyMs).toBeNull();
    expect(s.firstAt).toBeNull();
    expect(s.lastAt).toBeNull();
    expect(s.engines).toEqual([]);
    expect(s.feedbackUp).toBe(0);
    expect(s.feedbackDown).toBe(0);
  });

  test("counts messages and words across roles", () => {
    const s = sessionStats([
      { role: "user", content: "hello there", createdAt: 10 },
      { role: "assistant", content: "hi! how can I help?", createdAt: 20 },
      { role: "assistant", content: "", createdAt: 30 },
    ]);
    expect(s.messages).toBe(3);
    expect(s.userMessages).toBe(1);
    expect(s.replies).toBe(2);
    expect(s.words).toBe(7); // "hello there" (2) + "hi! how can I help?" (5)
  });

  test("tokens sum across replies; latency averages over timed replies only", () => {
    const s = sessionStats([
      {
        role: "assistant",
        content: "one",
        createdAt: 1,
        promptTokens: 100,
        completionTokens: 20,
        latencyMs: 1000,
      },
      {
        role: "assistant",
        content: "two",
        createdAt: 2,
        promptTokens: 50,
        completionTokens: 30,
        latencyMs: 2000,
      },
      { role: "assistant", content: "three", createdAt: 3 }, // no timing
    ]);
    expect(s.promptTokens).toBe(150);
    expect(s.completionTokens).toBe(50);
    expect(s.avgLatencyMs).toBe(1500);
  });

  test("engines aggregate by id, most used first; span from createdAt", () => {
    const s = sessionStats([
      {
        role: "assistant",
        content: "a",
        createdAt: 1_000,
        engineId: "openrouter/free",
        feedback: "up",
      },
      {
        role: "assistant",
        content: "b",
        createdAt: 5_000,
        engineId: "openrouter/free",
        feedback: "up",
      },
      {
        role: "assistant",
        content: "c",
        createdAt: 3_000,
        engineId: "googleai/gemini-3.5-flash",
        feedback: "down",
      },
      { role: "user", content: "later", createdAt: 99_999 },
    ]);
    expect(s.engines[0]).toEqual({ id: "openrouter/free", replies: 2 });
    expect(s.engines[1]).toEqual({
      id: "googleai/gemini-3.5-flash",
      replies: 1,
    });
    expect(s.firstAt).toBe(1_000);
    expect(s.lastAt).toBe(99_999);
    expect(s.feedbackUp).toBe(2);
    expect(s.feedbackDown).toBe(1);
  });
});

describe("engineLabel", () => {
  test("unknown engine without a prefix renders as-is", () => {
    expect(engineLabel("mystery-model-x")).toBe("mystery-model-x");
  });

  test("provider prefix is stripped for compact display", () => {
    expect(engineLabel("googleai/gemini-3.5-flash")).toBe("gemini-3.5-flash");
    expect(engineLabel("a/b/c")).toBe("b/c"); // only the first slash
  });
});

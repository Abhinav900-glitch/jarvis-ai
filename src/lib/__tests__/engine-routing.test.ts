// Coverage for the routing features added to the smart router:
//
//   * two new turn profiles — code and translation — plus detection for
//     summaries, which had weights but nothing that ever selected them;
//   * the context guard: an engine whose window is smaller than the prompt is
//     dropped rather than ranked, because a truncated question gets a
//     confident wrong answer;
//   * the `bestFor` affinity bonus, which turns the engine's own prose into a
//     routing signal instead of a comment in the inspector.
//
// These live outside src/convex because Convex loads every file under
// `functions` as a function module — a file exporting `test` fails to deploy.

import { describe, expect, test } from "bun:test";
import { ENGINES, inferTask, rankEngines } from "../../convex/engines";

describe("inferTask", () => {
  test("an image turn is a vision turn whatever the text says", () => {
    expect(inferTask("translate this", true)).toBe("vision");
  });

  test("build-and-fix requests route to the code profile", () => {
    expect(inferTask("write a TypeScript function that debounces a call")).toBe(
      "code",
    );
    expect(inferTask("why does this React component re-render twice?")).toBe(
      "code",
    );
    expect(inferTask("I get a syntax error in my python script")).toBe("code");
  });

  test("translation wins when a code request also asks for one", () => {
    expect(inferTask("translate the comment in this function into Hindi")).toBe(
      "translate",
    );
  });

  test("summaries stop being plain chat", () => {
    expect(inferTask("tl;dr this contract for me")).toBe("summarize");
    expect(inferTask("summarise the key points")).toBe("summarize");
  });

  test("the older profiles still win where they should", () => {
    expect(inferTask("derive the integral of x squared")).toBe("reason");
    expect(inferTask("latest news about the market")).toBe("research");
    expect(inferTask("hello there")).toBe("chat");
  });

  test("ordinary questions are not mistaken for code", () => {
    // "api" and "test" alone were deliberately left out of the code tokens.
    expect(inferTask("what is the weather api for London?")).toBe("chat");
  });
});

describe("context guard", () => {
  const CHARS = 200_000; // ~50k tokens

  test("engines too small for the prompt are not ranked at all", () => {
    const plan = rankEngines({
      task: "chat",
      order: "smart",
      promptChars: CHARS,
    });
    expect(plan.ranked.length).toBeGreaterThan(0);
    for (const entry of plan.ranked) {
      expect(entry.engine.context).toBeGreaterThanOrEqual(CHARS / 4);
    }
  });

  test("a normal prompt keeps the smaller engines in play", () => {
    const hasSmall = ENGINES.some((engine) => engine.context < 32_000);
    if (!hasSmall) return; // registry changed; nothing to compare against
    const plan = rankEngines({
      task: "chat",
      order: "smart",
      promptChars: 2_000,
    });
    expect(plan.ranked.some((entry) => entry.engine.context < 32_000)).toBe(
      true,
    );
  });
});

describe("task affinity", () => {
  test("a code-strong engine explains itself on a code turn", () => {
    const anyCodeEngine = ENGINES.some((engine) => /code/i.test(engine.bestFor));
    if (!anyCodeEngine) return; // registry changed; nothing to match against
    const plan = rankEngines({ task: "code", order: "smart" });
    expect(
      plan.ranked.some((entry) => entry.because.includes("built for code")),
    ).toBe(true);
  });

  test("stable order ignores the affinity bonus", () => {
    const plan = rankEngines({ task: "code", order: "stable" });
    expect(
      plan.ranked.every((entry) => !entry.because.includes("built for code")),
    ).toBe(true);
  });
});

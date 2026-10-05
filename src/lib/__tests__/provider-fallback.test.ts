// Regression tests for the provider fallback ladder.
//
// The bug these lock down: the ladder was built by grouping a ranking into
// per-provider blocks and exhausting each block in turn. Depth therefore
// depended on how many models a provider happened to register — with twelve
// OpenRouter engines in front of Mistral, one withdrawn model cost a dozen
// wasted attempts before any other provider was reachable, on a free tier
// where every attempt spends one of fifty requests a day.
//
// The ladder now round-robins across providers: each provider's best engine,
// then each provider's next best, and so on.
//
// Placement note: outside src/convex because convex.json points
// `"functions": "src/convex/"` and Convex loads every file there as a function
// module — a file exporting `test`/`expect` there fails to deploy.

import { afterEach, describe, expect, test } from "bun:test";
import {
  ENGINES,
  RETIRING,
  isRetired,
  rankEngines,
} from "../../convex/engines";
import { interleaveLadder } from "../../convex/ai";

const KEY_ENVS = [
  "MISTRAL_API_KEY",
  "MISTRAL_KEY",
  "GROQ_API_KEY",
  "EDEN_AI_API_KEY",
  "EDENAI_API_KEY",
  "EDEN_API_KEY",
  "EDEN_AI_TOKEN",
  "HUGGING_FACE_TOKEN",
  "OPENROUTER_API_KEY",
  "OPENROUTER_KEY",
];
const realEnv: Record<string, string | undefined> = {};

/** Marks every provider as configured, so no engine is dropped as unreachable. */
function configureAll() {
  for (const key of KEY_ENVS) {
    if (!(key in realEnv)) realEnv[key] = process.env[key];
    process.env[key] = "test-key";
  }
}

afterEach(() => {
  for (const [key, value] of Object.entries(realEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  for (const key of Object.keys(realEnv)) delete realEnv[key];
});

// `interleaveLadder` is imported from src/convex/ai.ts rather than copied.
// An earlier version of this file reproduced it locally and passed while the
// real function was deliberately broken — a test that cannot fail is worse
// than no test, because it reports safety that does not exist.
const rank = (task: "reason" | "chat" = "reason") =>
  interleaveLadder(rankEngines({ task, order: "smart", promptChars: 5000 }).ranked);

// The real ladder yields `{ provider, entry }` pairs, one per attempt.
type LadderStep = ReturnType<typeof interleaveLadder>[number];

const providersOf = (ranked: LadderStep[]) => ranked.map((step) => step.entry.engine.provider);

const enginesOf = (ranked: LadderStep[]) => ranked.map((step) => step.entry.engine);

const firstIndexOfProvider = (ranked: LadderStep[], id: string) =>
  providersOf(ranked).findIndex((p) => p === id);

describe("provider fallback ladder", () => {
  test("reaches every configured provider within the first few attempts", () => {
    // The regression. Grouped-by-provider walking put Mistral at position 22
    // when OpenRouter registered twelve engines; a single dead OpenRouter
    // model then consumed most of a free day's budget before any fallback.
    configureAll();
    const ranked = rank();

    for (const provider of ["groq", "mistral", "eden", "huggingface", "openrouter"]) {
      const at = firstIndexOfProvider(ranked, provider);
      expect(at).toBeGreaterThanOrEqual(0); // present at all
      expect(at).toBeLessThanOrEqual(4); // and reached almost immediately
    }
  });

  test("still tries the router's top choice first", () => {
    // Interleaving must not demote the engine the router actually preferred.
    configureAll();
    const plan = rankEngines({ task: "reason", order: "smart", promptChars: 5000 });
    const ranked = rank();
    const providers = providersOf(ranked);
    const topProvider = plan.ranked[0].engine.provider;
    expect(providers.indexOf(topProvider)).toBeLessThanOrEqual(1);
  });

  test("keeps every engine and none twice", () => {
    configureAll();
    const ranked = rank();
    const ids = enginesOf(ranked).map((e) => e.id);
    // Compared against the engines that are still live, not the raw table.
    // Once a withdrawal date in RETIRING has passed the ladder is supposed to
    // drop that engine, so asserting against ENGINES.length made this test
    // fail on the withdrawal day itself rather than on a real ladder bug.
    const live = ENGINES.filter((e) => !isRetired(e.id));
    expect(ids.length).toBe(live.length);
    expect(new Set(ids).size).toBe(live.length);
  });

  test("preserves each provider's internal order", () => {
    // Interleaving decides which provider goes next, never which of that
    // provider's own engines wins.
    configureAll();
    const plan = rankEngines({ task: "reason", order: "smart", promptChars: 5000 });
    const ranked = rank();

    for (const provider of new Set(ENGINES.map((e) => e.provider))) {
      const expected = plan.ranked
        .filter((r) => r.engine.provider === provider && r.available)
        .map((r) => r.engine.id);
      const actual = enginesOf(ranked)
        .filter((e) => e.provider === provider)
        .map((e) => e.id);
      expect(actual).toEqual(expected);
    }
  });

  test("drops unavailable engines rather than attempting them", () => {
    // With no keys at all, the ladder is empty rather than full of dead ends.
    const ranked = rank();
    expect(ranked.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The registry must not point at models that are gone
// ---------------------------------------------------------------------------

describe("openrouter registry freshness", () => {
  // Recorded from the live `:free` roster on 2026-10-03. `deepseek-v4-flash:free`
  // was absent from it while still holding the top reasoning slot, so every
  // reasoning step went to a model that no longer existed.
  const LIVE_AS_OF = new Set([
    "nvidia/nemotron-3.5-lightning:free",
    "nvidia/nemotron-3-ultra-550b-a55b:free",
    "inclusionai/ling-3.0-flash-sante:free",
    "qwen/qwen3.8-27b:free",
    "google/gemma-4-26b-a4b-it:free",
    "google/gemma-4-31b-it:free",
    "nvidia/nemotron-3-super-120b-a12b:free",
    "cohere/north-mini-code:free",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    "liquid/lfm-2.5-2.6b:free",
    "apodex/apodex-1.1-mini:free",
    "poolside/laguna-s-2.1:free",
    "poolside/laguna-xs-2.1:free",
    "thinkingmachines/inkling:free",
    "thinkingmachines/inkling-small:free",
    "dots-studio/dots-3-note-preview:free",
  ]);

  test("no registered engine points at a model already known to be gone", () => {
    // Only meaningful for models that claim to be on the free roster: a
    // stealth model is not `:free`-suffixed and is served on another plan, so
    // its absence here says nothing about whether it works.
    const gone = ENGINES.filter(
      (e) =>
        e.provider === "openrouter" &&
        e.modelId.endsWith(":free") &&
        !LIVE_AS_OF.has(e.modelId),
    );
    expect(gone.map((e) => `${e.id} -> ${e.modelId}`)).toEqual([]);
  });

  test("still has a reasoning-capable engine to plan with", () => {
    // The dead model held the top reasoning slot. Dropping it without a
    // replacement would quietly leave the agent with nothing to reason with,
    // which is the part that is easy to miss in review.
    configureAll();
    const ranked = rank("reason");
    expect(enginesOf(ranked).some((e) => e.reasoning)).toBe(true);
  });

  test("every withdrawn engine is either retired or still on the roster", () => {
    // Ties the two mechanisms together so an engine cannot quietly fall
    // through both: a model off the roster and off the retirement calendar.
    // Set membership, not `in` — LIVE_AS_OF is a Set, so `in` would be true
    // for every model and quietly assert nothing.
    const stale = ENGINES.filter(
      (e) =>
        e.provider === "openrouter" &&
        e.modelId.endsWith(":free") &&
        !LIVE_AS_OF.has(e.modelId) &&
        !(e.id in RETIRING),
    );
    expect(stale.map((e) => `${e.id} -> ${e.modelId}`)).toEqual([]);
  });
});
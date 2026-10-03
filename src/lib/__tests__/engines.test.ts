// Regression tests for model-withdrawal handling in the engine registry.
//
// The bug these lock down: RETIRING recorded a published withdrawal date, the
// panel displayed it, and `rankEngines` ignored it completely. A withdrawn
// engine kept its quality score, stayed ranked first, and was attempted on
// every step — failing once to discover something the registry already knew and
// spending one of 50 free daily requests per step to do it.
//
// These tests drive off a synthetic entry in RETIRING rather than the real one
// on purpose. The mechanism is what needs protecting, and a fixture keeps this
// meaningful after the real model is gone from the table for good.
//
// Placement note: these live outside src/convex because convex.json points
// `"functions": "src/convex/"`, and Convex loads every file in there as a
// function module — a file exporting `test`/`expect` there fails to deploy.
// src/lib is typechecked by `tsc -b` and linted, but never scanned by Convex.

import { afterEach, describe, expect, test } from "bun:test";
import {
  ENGINES,
  RETIRING,
  isRetired,
  providerById,
  providerStatuses,
  rankEngines,
  retiringSoon,
} from "../../convex/engines";

const DAY = 86_400_000;
/** A date that is unambiguously in the past, whatever the real clock says. */
const PAST = "2000-01-01";
/** Unambiguously in the future. */
const FUTURE = "2099-12-31";

// ---------------------------------------------------------------------------
// Test scaffolding
// ---------------------------------------------------------------------------

const realNow = Date.now;
/** Env keys this file set, so they can be put back the way they were. */
const touchedEnv: string[] = [];

/**
 * Runs `fn` as if the current time were `iso`, then puts the clock back even if
 * `fn` throws. `isRetired` reads the wall clock through `Date.now` when it is
 * called without an explicit argument, which is how the router calls it — so
 * stubbing the clock is the only way to test the router's real behaviour
 * rather than a parameter it never passes.
 */
function atTime(iso: string, fn: () => void) {
  const target = Date.parse(iso);
  Date.now = () => target;
  try {
    fn();
  } finally {
    Date.now = realNow;
  }
}

/**
 * Gives an engine's provider a key so the engine counts as *available*, which
 * is the condition routing cares about. Read from the registry rather than
 * hardcoded, so this keeps working if provider env names change.
 */
function giveEngineAKey(engineId: string) {
  const engine = ENGINES.find((e) => e.id === engineId);
  const provider = engine ? providerById(engine.provider) : null;
  const key = provider?.keyEnv[0];
  if (!key) throw new Error(`no key env known for ${engineId}`);
  if (!touchedEnv.includes(key)) {
    touchedEnv.push(key);
    realEnv[key] = process.env[key];
  }
  process.env[key] = "test-key";
  return key;
}

const realEnv: Record<string, string | undefined> = {};

/** An engine with no recorded withdrawal date, chosen fresh on each call. */
function fixtureEngine() {
  const engine = ENGINES.find((e) => !(e.id in RETIRING));
  if (!engine) throw new Error("no engine available to use as a fixture");
  return engine;
}

/** Temporarily records `id` as withdrawn on `date`; always undone. */
function withRetirement<T>(id: string, date: string, fn: () => T): T {
  const had = Object.prototype.hasOwnProperty.call(RETIRING, id);
  const previous = RETIRING[id];
  RETIRING[id] = date;
  try {
    return fn();
  } finally {
    if (had) RETIRING[id] = previous;
    else delete RETIRING[id];
  }
}

afterEach(() => {
  Date.now = realNow;
  for (const key of touchedEnv) {
    if (realEnv[key] === undefined) delete process.env[key];
    else process.env[key] = realEnv[key];
  }
  touchedEnv.length = 0;
});

// ---------------------------------------------------------------------------
// isRetired — the date boundary itself
// ---------------------------------------------------------------------------

describe("isRetired", () => {
  test("is false before the withdrawal date and true from that date onward", () => {
    const id = fixtureEngine().id;
    const date = "2026-03-10";

    withRetirement(id, date, () => {
      expect(isRetired(id, Date.parse("2026-03-09"))).toBe(false);
      // Read as UTC midnight, so the engine leaves at the *start* of its
      // withdrawal day rather than at some arbitrary hour of it.
      expect(isRetired(id, Date.parse(date))).toBe(true);
      expect(isRetired(id, Date.parse("2026-03-11"))).toBe(true);
    });
  });

  test("never retires an engine that has no recorded date", () => {
    const id = fixtureEngine().id;
    expect(id in RETIRING).toBe(false);
    expect(isRetired(id, Date.now() + 100 * 365 * DAY)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// The registry table cannot rot silently
// ---------------------------------------------------------------------------

describe("RETIRING table integrity", () => {
  test("every recorded withdrawal refers to an engine that exists", () => {
    // A typo here is the exact failure this feature exists to prevent: the
    // engine is never excluded because its id was never matched.
    for (const id of Object.keys(RETIRING)) {
      expect(ENGINES.some((e) => e.id === id)).toBe(true);
    }
  });

  test("every withdrawal date is a real, canonical calendar date", () => {
    for (const on of Object.values(RETIRING)) {
      expect(on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      const ms = Date.parse(on);
      expect(Number.isNaN(ms)).toBe(false);
      // Round-trips, so 2026-02-31 and friends cannot slip through.
      expect(new Date(ms).toISOString().slice(0, 10)).toBe(on);
    }
  });
});

// ---------------------------------------------------------------------------
// The regression: routing must drop a withdrawn engine
// ---------------------------------------------------------------------------

describe("rankEngines excludes withdrawn engines", () => {
  test("drops the engine once its date has passed", () => {
    const engine = fixtureEngine();
    giveEngineAKey(engine.id);

    atTime("2026-06-15", () => {
      withRetirement(engine.id, PAST, () => {
        const ids = rankEngines({ task: "reason", order: "smart" }).ranked.map(
          (r) => r.engine.id,
        );
        expect(ids).not.toContain(engine.id);
      });
    });
  });

  test("keeps the engine while its date is still in the future", () => {
    // The other half of the same rule: exclusion must key off the date, not
    // merely off "this id appears in the table", or every future-dated engine
    // would vanish from the plan the day it was registered.
    const engine = fixtureEngine();
    giveEngineAKey(engine.id);

    atTime("2026-06-15", () => {
      withRetirement(engine.id, FUTURE, () => {
        const ids = rankEngines({ task: "reason", order: "smart" }).ranked.map(
          (r) => r.engine.id,
        );
        expect(ids).toContain(engine.id);
      });
    });
  });

  test("the chain is left with a usable successor, not nothing", () => {
    // The point of excluding is to route somewhere else. A regression that
    // emptied the plan would satisfy "not.toContain" and still be broken.
    const engine = fixtureEngine();
    giveEngineAKey(engine.id);

    atTime("2026-06-15", () => {
      withRetirement(engine.id, PAST, () => {
        const plan = rankEngines({ task: "reason", order: "smart" });
        expect(plan.usable.length).toBeGreaterThan(0);
        expect(plan.primary).not.toBeNull();
        expect(plan.primary?.engine.id).not.toBe(engine.id);
      });
    });
  });

  test("ignores a pin on a withdrawn engine", () => {
    // `preferred` adds +10 to a score, so a pinned-but-withdrawn engine would
    // otherwise win outright and fail every turn. The pin must not outlive the
    // model it names.
    const engine = fixtureEngine();
    giveEngineAKey(engine.id);

    atTime("2026-06-15", () => {
      withRetirement(engine.id, PAST, () => {
        const plan = rankEngines({
          task: "reason",
          order: "smart",
          preferEngineId: engine.id,
        });
        expect(plan.ranked.some((r) => r.engine.id === engine.id)).toBe(false);
        expect(plan.primary?.engine.id).not.toBe(engine.id);
      });
    });
  });

  test("honours a pin on an engine that is still live", () => {
    // Guards the fix from being over-applied: a pinned, non-withdrawn engine
    // must still win.
    const engine = fixtureEngine();
    giveEngineAKey(engine.id);

    atTime("2026-06-15", () => {
      withRetirement(engine.id, FUTURE, () => {
        const plan = rankEngines({
          task: "reason",
          order: "smart",
          preferEngineId: engine.id,
        });
        expect(plan.primary?.engine.id).toBe(engine.id);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// The surfaces that report on availability
// ---------------------------------------------------------------------------

describe("providerStatuses", () => {
  test("reports a withdrawn engine as unavailable even when its key is set", () => {
    const engine = fixtureEngine();
    giveEngineAKey(engine.id);
    const provider = providerById(engine.provider);
    if (!provider) throw new Error(`unknown provider for ${engine.id}`);

    withRetirement(engine.id, PAST, () => {
      const entry = providerStatuses()
        .find((p) => p.id === provider.id)
        ?.engines.find((e) => e.id === engine.id);
      expect(entry?.available).toBe(false);
    });
  });

  test("still reports a live engine of the same provider as available", () => {
    // The contrast that makes the assertion above meaningful — otherwise it
    // would pass merely because the key was never picked up.
    const engine = fixtureEngine();
    giveEngineAKey(engine.id);
    const provider = providerById(engine.provider);
    if (!provider) throw new Error(`unknown provider for ${engine.id}`);
    const sibling = ENGINES.find(
      (e) => e.provider === provider.id && e.id !== engine.id,
    );
    if (!sibling) throw new Error(`no sibling engine for ${engine.id}`);

    const entry = providerStatuses()
      .find((p) => p.id === provider.id)
      ?.engines.find((e) => e.id === sibling.id);
    expect(entry?.available).toBe(true);
  });
});

describe("retiringSoon", () => {
  test("warns about a future withdrawal and stops once it has passed", () => {
    const engine = fixtureEngine();

    withRetirement(engine.id, FUTURE, () => {
      atTime("2026-06-15", () => {
        expect(retiringSoon().some((r) => r.id === engine.id)).toBe(true);
      });
    });

    withRetirement(engine.id, PAST, () => {
      atTime("2026-06-15", () => {
        // Past dates are filtered out on purpose: they are no longer a thing
        // that needs saying, because the router is already past them.
        expect(retiringSoon().some((r) => r.id === engine.id)).toBe(false);
      });
    });
  });
});
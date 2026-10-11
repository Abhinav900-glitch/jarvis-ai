// Tests for spending more than one AI Horde key.
//
// A single key is a single point of failure in a chain whose job is to never
// come back empty: when it is refused (HTTP 401 `InvalidAPIKey`, verified
// live) or runs out of kudos, the stage should hand over to the next key
// instead of dropping to HuggingFace/Replicate — which need paid tokens, so
// "falling through" there usually means no image at all.
//
// These cover the two decisions that hand-over depends on and which no amount
// of end-to-end testing would pin down: which keys are configured at all, and
// which of them gets spent first.

import { afterEach, describe, expect, test } from "bun:test";
import { hordeApiKeys, hordeKeysByPriority } from "../../convex/cloudinary";

// ---------------------------------------------------------------------------
// Scaffolding — the env and `fetch` are both restored, so a throw inside a
// test cannot leak a stub into the rest of the run.
// ---------------------------------------------------------------------------

const KEY_VARS = ["AIHORDE_API_KEY", "AIHORDE_API_KEY_2", "AIHORDE_API_KEY_3"];
const realEnv: Record<string, string | undefined> = {};
const touchedEnv: string[] = [];
const realFetch = globalThis.fetch;

/** Sets the Horde env exactly as described, blanking everything not listed. */
function configure(entries: Record<string, string>) {
  for (const name of KEY_VARS) {
    if (!touchedEnv.includes(name)) {
      touchedEnv.push(name);
      realEnv[name] = process.env[name];
    }
    process.env[name] = entries[name] ?? "";
  }
}

/**
 * Replaces `fetch` for the duration of a test. `lookup` is keyed on the URL
 * and the apikey, because those are the only things these functions branch on.
 */
function stubFetch(lookup: (url: string, apiKey: string) => Response) {
  const calls: string[] = [];
  globalThis.fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input);
    calls.push(url);
    // The apikey travels in a header, which is how the key under test is
    // identified — `hordeKeysByPriority` sends all of them at once.
    const apiKey = new Headers(init?.headers).get("apikey") ?? "";
    return lookup(url, apiKey);
  }) as typeof fetch;
  return calls;
}

afterEach(() => {
  for (const name of touchedEnv) {
    if (realEnv[name] === undefined) delete process.env[name];
    else process.env[name] = realEnv[name];
  }
  touchedEnv.length = 0;
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------------------
// hordeApiKeys — what is configured
// ---------------------------------------------------------------------------

describe("hordeApiKeys", () => {
  test("is empty when no Horde variable is set, so the stage says so", () => {
    // The stage's error names `AIHORDE_API_KEY` and points at the Keys tab.
    // That only happens if "unset" is distinguishable from "set to junk".
    configure({});
    expect(hordeApiKeys()).toEqual([]);
  });

  test("reads a single key from AIHORDE_API_KEY", () => {
    configure({ AIHORDE_API_KEY: "key-one" });
    expect(hordeApiKeys()).toEqual(["key-one"]);
  });

  test("picks up the spare keys in the numbered variables", () => {
    // The case this feature exists for: an extra key added later, without
    // disturbing the variable already in place.
    configure({
      AIHORDE_API_KEY: "key-one",
      AIHORDE_API_KEY_2: "key-two",
      AIHORDE_API_KEY_3: "key-three",
    });
    expect(hordeApiKeys()).toEqual(["key-one", "key-two", "key-three"]);
  });

  test("accepts several keys inside one variable", () => {
    // So a spare key can be pasted into the existing entry rather than
    // requiring a rename the user has no way to discover.
    configure({ AIHORDE_API_KEY: "key-one,key-two key-three" });
    expect(hordeApiKeys()).toEqual(["key-one", "key-two", "key-three"]);
  });

  test("keeps declared order, so the first variable stays first", () => {
    configure({
      AIHORDE_API_KEY_2: "key-two",
      AIHORDE_API_KEY: "key-one",
    });
    // Numbered variables are read in their own order, not the order they
    // happen to appear in the process environment.
    expect(hordeApiKeys()).toEqual(["key-one", "key-two"]);
  });

  test("trims whitespace and drops empty entries", () => {
    configure({ AIHORDE_API_KEY: "  key-one  ,,  , key-two " });
    expect(hordeApiKeys()).toEqual(["key-one", "key-two"]);
  });

  test("never offers the same key twice", () => {
    // Retrying a key that was just refused costs the same 20s submit and
    // returns the same 401. A user pasting a key into both variables should
    // not silently pay for that.
    configure({
      AIHORDE_API_KEY: "dupe",
      AIHORDE_API_KEY_2: "dupe",
      AIHORDE_API_KEY_3: "other,dupe",
    });
    const keys = hordeApiKeys();
    expect(keys).toEqual(["dupe", "other"]);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ---------------------------------------------------------------------------
// hordeKeysByPriority — which key is spent first
// ---------------------------------------------------------------------------

describe("hordeKeysByPriority", () => {
  test("does not touch the network for a single key", async () => {
    // A balance lookup buys nothing when there is nothing to choose between,
    // and every added request is a new way to be slow.
    const calls = stubFetch(() => {
      throw new Error("fetch must not be called for a single key");
    });
    expect(await hordeKeysByPriority(["only-key"])).toEqual(["only-key"]);
    expect(calls).toHaveLength(0);
  });

  test("spends the key holding the most kudos first", () => {
    // Queue priority is bought with kudos, so the richer key finishes and the
    // poorer one is kept in reserve. Reversing this would burn the spare key
    // on every generation.
    stubFetch((url, apiKey) => {
      if (!url.includes("/find_user")) {
        throw new Error(`unexpected request: ${url}`);
      }
      const kudos = apiKey === "rich" ? 500 : 20;
      return new Response(JSON.stringify({ username: apiKey, kudos }), {
        status: 200,
      });
    });
    return hordeKeysByPriority(["poor", "rich"]).then((ordered) => {
      expect(ordered).toEqual(["rich", "poor"]);
    });
  });

  test("keeps declared order when the balances are equal", () => {
    // Without a stable tie-break the order could differ between generations,
    // spending a different key each time for no reason.
    stubFetch(() => new Response(JSON.stringify({ kudos: 100 }), { status: 200 }));
    return hordeKeysByPriority(["first", "second"]).then((ordered) => {
      expect(ordered).toEqual(["first", "second"]);
    });
  });

  test("sorts an unrecognised key last rather than dropping it", () => {
    // AI Horde answers 404 `UserNotFound` for a key it does not know (verified
    // live). That is a reason to try it last, not to skip it: the balance read
    // is an optimisation, and a misread must not cost a working key.
    stubFetch((_url, apiKey) =>
      apiKey === "unknown"
        ? new Response(JSON.stringify({ rc: "UserNotFound" }), { status: 404 })
        : new Response(JSON.stringify({ kudos: 50 }), { status: 200 }),
    );
    return hordeKeysByPriority(["unknown", "known"]).then((ordered) => {
      expect(ordered).toEqual(["known", "unknown"]);
    });
  });

  test("still returns every key when the balance read fails outright", () => {
    // A blocked or timed-out lookup must not remove keys from the chain —
    // running the provider down over a nicety would be worse than ordering
    // the keys at random.
    stubFetch(() => {
      throw new Error("network unreachable");
    });
    return hordeKeysByPriority(["one", "two", "three"]).then((ordered) => {
      expect(ordered).toHaveLength(3);
      expect(ordered.sort()).toEqual(["one", "three", "two"]);
    });
  });

  test("survives a balance body with no kudos in it", () => {
    // A response that parses but carries nothing usable still has to order
    // the keys rather than throw out of the provider.
    stubFetch(() => new Response(JSON.stringify({ username: "someone" }), { status: 200 }));
    return hordeKeysByPriority(["one", "two"]).then((ordered) => {
      expect(ordered).toHaveLength(2);
    });
  });
});

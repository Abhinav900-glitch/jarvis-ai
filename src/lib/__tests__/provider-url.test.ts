// Regression tests for account-scoped provider endpoints.
//
// The bug: the Cloudflare provider was registered with `{ACCOUNT_ID}` in its
// URL and nothing ever substituted it, so every request would have POSTed to a
// literal `accounts/{ACCOUNT_ID}` path and 404'd — invisible, because the
// provider had no engines registered either, so no one ever got that far.

import { afterEach, describe, expect, test } from "bun:test";
import { providerUrl } from "../../convex/ai";
import { ENGINES, PROVIDERS, providerById } from "../../convex/engines";

const original = process.env.CLOUDFLARE_ACCOUNT_ID;

afterEach(() => {
  if (original === undefined) delete process.env.CLOUDFLARE_ACCOUNT_ID;
  else process.env.CLOUDFLARE_ACCOUNT_ID = original;
});

describe("account-scoped provider URLs", () => {
  test("no registered endpoint is left with a placeholder in it", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "account-under-test";
    for (const provider of PROVIDERS) {
      const url = providerUrl(provider);
      expect(url).not.toContain("{");
      expect(url).not.toContain("}");
    }
  });

  test("the account id lands in the path, not in a query string", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "a1b2c3";
    const cloudflare = providerById("cloudflare");
    expect(cloudflare).toBeDefined();
    expect(providerUrl(cloudflare!)).toBe(
      "https://api.cloudflare.com/client/v4/accounts/a1b2c3/ai/v1/chat/completions",
    );
  });

  test("providers without a placeholder are returned untouched", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "a1b2c3";
    const groq = providerById("groq");
    expect(groq).toBeDefined();
    expect(providerUrl(groq!)).toBe(groq!.url);
  });

  test("a missing account id fails loudly instead of 404ing every engine", () => {
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    const cloudflare = providerById("cloudflare");
    expect(() => providerUrl(cloudflare!)).toThrow(/CLOUDFLARE_ACCOUNT_ID/);
  });

  test("every account-scoped provider has an engine to call", () => {
    // The other half of the same bug: PROVIDERS carried an entry with no
    // engines, so the ladder could never reach it and the fallback test failed
    // on a provider that could not appear.
    for (const provider of PROVIDERS) {
      const engines = ENGINES.filter((e) => e.provider === provider.id);
      expect({ provider: provider.id, engines: engines.length > 0 }).toEqual({
        provider: provider.id,
        engines: true,
      });
    }
  });
});

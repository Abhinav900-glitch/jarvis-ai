// Regression tests for Puter.js failure reporting.
//
// The bug: Puter rejects with a plain `{ code, msg }` object, but the
// integration wrapped every rejection with `String(err)`. That renders
// "[object Object]", so the reason never reached the console or the user —
// and the caller in Dashboard.tsx caught the failure with a bare `catch` and
// replaced it with a generic "all providers failed" message. The two images
// the user attached proved txt2img works; what was broken was reporting why
// it did not.
//
// https://docs.puter.com/Auth/signIn/ documents the codes asserted below.

import { describe, expect, test } from "bun:test";
import {
  describePuterError,
  PUTER_GENERATE_TIMEOUT_MS,
  PUTER_LOAD_TIMEOUT_MS,
} from "../puter";

describe("describePuterError", () => {
  test("never leaks Puter's object shape as [object Object]", () => {
    // The core regression: this is what every failure used to render as.
    for (const err of [
      { code: "popup_blocked", msg: "The popup was blocked" },
      { msg: "Something went wrong" },
      { code: "weird_code" },
      {},
    ]) {
      expect(describePuterError(err)).not.toContain("[object Object]");
      expect(describePuterError(err).length).toBeGreaterThan(0);
    }
  });

  test("explains a blocked sign-in popup", () => {
    // Puter is the third fallback, so by the time it runs the original
    // click's user activation has expired and the browser blocks the popup.
    const text = describePuterError({
      code: "popup_blocked",
      msg: "Popup blocked",
    }).toLowerCase();
    expect(text).toContain("popup");
    expect(text).toContain("blocked");
    expect(text).not.toContain("popup_blocked");
  });

  test("explains a closed sign-in window and a blocked origin", () => {
    expect(describePuterError({ code: "auth_window_closed" })).toMatch(
      /sign-in window/i,
    );
    expect(describePuterError({ code: "unsupported_origin" })).toMatch(
      /origin/i,
    );
  });

  test("explains exhausted credits and rate limiting", () => {
    expect(describePuterError({ code: "insufficient_funds" })).toMatch(
      /credit/i,
    );
    expect(describePuterError({ code: "rate_limit_exceeded" })).toMatch(
      /rate limit/i,
    );
  });

  test("keeps the code and message for codes it does not recognise", () => {
    expect(
      describePuterError({ code: "provider_error", msg: "upstream 503" }),
    ).toBe("provider_error: upstream 503");
    expect(describePuterError({ msg: "just a message" })).toBe(
      "just a message",
    );
  });

  test("passes Error instances through as their message", () => {
    expect(describePuterError(new Error("boom"))).toBe("boom");
  });

  test("handles empty and non-object inputs without throwing", () => {
    for (const err of ["", "   ", null, undefined, 0, []]) {
      const text = describePuterError(err);
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(0);
      expect(text).not.toBe("[object Object]");
    }
  });
});

describe("Puter timeouts", () => {
  test("allow enough time for a cold CDN load and a sign-in popup", () => {
    // 10s to pull the SDK from js.puter.com was tight enough to fail on a
    // cold cache; a first run also has to show the Puter sign-in window.
    expect(PUTER_LOAD_TIMEOUT_MS).toBeGreaterThanOrEqual(30_000);
    expect(PUTER_GENERATE_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
    expect(PUTER_GENERATE_TIMEOUT_MS).toBeGreaterThan(PUTER_LOAD_TIMEOUT_MS);
  });
});

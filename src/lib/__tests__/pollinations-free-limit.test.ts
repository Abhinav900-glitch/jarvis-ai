// Tests for reading Pollinations' free-tier limit.
//
// Pollinations is the only provider in the chain that needs no key, so it is
// the one that must not be dropped by accident. Its free tier allows 1 image
// per 45s per IP and says so with HTTP 402 `FREE_LIMIT` (verified live).
// The previous retry slept a fixed 2s between attempts, which cannot outlast
// that window — the stage gave up in ~4s on the only keyless provider there
// is, and the whole chain reported "all image providers failed".
//
// What these pin down is the decision to wait at all: a recognised limit must
// produce a real delay, and anything unrecognised must return `null` so the
// caller uses its short backoff instead of sleeping on a made-up number.

import { describe, expect, test } from "bun:test";
import { parsePollinationsFreeLimit } from "../../convex/cloudinary";

const FREE_LIMIT_BODY = JSON.stringify({
  status: 402,
  success: false,
  error: {
    code: "FREE_LIMIT",
    message:
      "Free limit reached: 1 image every 45 seconds per IP. Retry after 38s, or get unlimited images with a pollen key at https://enter.pollinations.ai/?ref=classic",
    timestamp: "2026-10-23T07:26:02.440Z",
    fixUrl: "https://enter.pollinations.ai/?ref=classic",
  },
});

describe("parsePollinationsFreeLimit", () => {
  test("reads the seconds the server asked us to wait", async () => {
    // The whole point: this number is what gets the provider to try again
    // after the window opens instead of abandoning the keyless fallback.
    expect(parsePollinationsFreeLimit(FREE_LIMIT_BODY, null)).toBe(38);
  });

  test("ignores the parts of the message that are not a delay", async () => {
    // The same sentence contains "1 image every 45 seconds", which reads as a
    // delay to a looser pattern. Waiting 45s when the server said 38s wastes
    // the window; picking the wrong number entirely would retry too early.
    expect(parsePollinationsFreeLimit(FREE_LIMIT_BODY, null)).not.toBe(45);
  });

  test("falls back to the Retry-After header when the body says nothing", async () => {
    expect(parsePollinationsFreeLimit("", "45")).toBe(45);
  });

  test("prefers the body when both are present", async () => {
    // The body is the server explaining this specific response, so it wins
    // over a header that may describe a different limit.
    expect(parsePollinationsFreeLimit(FREE_LIMIT_BODY, "90")).toBe(38);
  });

  test("returns null for a 402 that is not the free limit", async () => {
    // A non-free-limit 402 will not clear by sleeping. Returning a number
    // here would burn the whole time budget on a failure that is permanent.
    const other = JSON.stringify({ status: 402, error: { code: "OTHER" } });
    expect(parsePollinationsFreeLimit(other, null)).toBeNull();
  });

  test("returns null when there is no limit to read", async () => {
    // The caller must use its short backoff, not wait on an invented delay.
    expect(parsePollinationsFreeLimit("", null)).toBeNull();
    expect(parsePollinationsFreeLimit("<html>502 Bad Gateway</html>", null)).toBeNull();
  });

  test("rejects a header that is not a positive number", async () => {
    // `Retry-After` may legally hold an HTTP-date rather than seconds;
    // `Number()` makes that NaN, and a NaN wait would throw in setTimeout.
    for (const bad of ["nan", "-5", "0", "Fri, 31 Dec 1999 23:59:59 GMT"]) {
      expect(parsePollinationsFreeLimit("", bad)).toBeNull();
    }
  });
});

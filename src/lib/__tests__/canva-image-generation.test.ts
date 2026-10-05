import { describe, expect, test } from "bun:test";
import {
  createCodeChallenge,
  createCodeVerifier,
  toCanvaAspectRatio,
  toCanvaModel,
} from "../../convex/canva";

describe("canva aspect ratio mapping", () => {
  test("maps the app's landscape ratio to Canva's landscape", () => {
    expect(toCanvaAspectRatio("3:2")).toBe("landscape");
  });

  test("maps the app's portrait ratio to Canva's portrait", () => {
    expect(toCanvaAspectRatio("2:3")).toBe("portrait");
  });

  test("maps 1:1 to square", () => {
    expect(toCanvaAspectRatio("1:1")).toBe("square");
  });

  // Canva's enum is square|landscape|portrait only. Anything else sent
  // through would be rejected as an invalid parameter, so the default has to
  // be a value Canva definitely accepts.
  test("falls back to square for an absent or unrecognised ratio", () => {
    expect(toCanvaAspectRatio(undefined)).toBe("square");
    expect(toCanvaAspectRatio("16:9")).toBe("square");
    expect(toCanvaAspectRatio("banana")).toBe("square");
  });

  test("never returns a value outside Canva's enum", () => {
    for (const input of ["1:1", "3:2", "2:3", "", "16:9"]) {
      expect(["square", "landscape", "portrait"]).toContain(
        toCanvaAspectRatio(input),
      );
    }
  });
});

describe("canva model mapping", () => {
  test("passes through a model Canva actually offers", () => {
    expect(toCanvaModel("lucid_origin")).toBe("lucid_origin");
    expect(toCanvaModel("z_image_turbo")).toBe("z_image_turbo");
  });

  // Canva documents that it never substitutes a model: an unknown model
  // fails the job outright. Dropping it lets Canva choose instead.
  test("drops another provider's model rather than forwarding it", () => {
    expect(toCanvaModel("flux")).toBeUndefined();
    expect(toCanvaModel("gpt-image-1")).toBeUndefined();
    expect(toCanvaModel("nano-banana")).toBeUndefined();
    expect(toCanvaModel("default")).toBeUndefined();
  });

  test("treats an absent model as 'let Canva choose'", () => {
    expect(toCanvaModel(undefined)).toBeUndefined();
    expect(toCanvaModel("")).toBeUndefined();
  });

  test("never returns a value outside Canva's enum", () => {
    for (const input of ["flux", "default", "lucid_origin", "sdxl"]) {
      const mapped = toCanvaModel(input);
      expect(mapped === undefined || CANVA_ENUM.includes(mapped)).toBe(true);
    }
  });
});

const CANVA_ENUM = ["lucid_origin", "z_image_turbo"];

describe("canva PKCE", () => {
  // Canva requires the verifier to be 43–128 characters from the unreserved
  // set. Anything outside that range makes the authorize request fail with an
  // error that gives no clue why.
  test("generates verifiers inside Canva's accepted length range", () => {
    for (let i = 0; i < 20; i++) {
      const verifier = createCodeVerifier();
      expect(verifier.length).toBeGreaterThanOrEqual(43);
      expect(verifier.length).toBeLessThanOrEqual(128);
    }
  });

  test("uses only the unreserved character set Canva permits", () => {
    // A verifier carrying + / = would be percent-encoded differently on the
    // way out and the way back in, breaking the exchange.
    for (let i = 0; i < 20; i++) {
      expect(createCodeVerifier()).toMatch(/^[A-Za-z0-9._~-]+$/);
    }
  });

  test("never repeats a verifier", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add(createCodeVerifier());
    expect(seen.size).toBe(50);
  });

  test("derives a deterministic S256 challenge", () => {
    // The RFC 7636 reference vector for verifier "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
    // must hash to "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM". If this
    // fails, the hashing is wrong and every authorize call will fail.
    expect(
      createCodeChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
    ).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  test("produces a base64url challenge with no padding", () => {
    expect(createCodeChallenge(createCodeVerifier())).toMatch(
      /^[A-Za-z0-9_-]{43}$/,
    );
  });
});

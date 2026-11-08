// Two presentation providers, two vocabularies and three key names for the same
// URL. These are the parsing rules the actions rely on.

import { describe, expect, test } from "bun:test";
import {
  deckPrompt,
  normalizeDeckStatus,
  parseGammaStatus,
  parsePresentationsDeck,
} from "../presentations";

describe("normalizeDeckStatus", () => {
  test("both providers' completion spellings collapse", () => {
    expect(normalizeDeckStatus("completed")).toBe("completed");
    expect(normalizeDeckStatus("COMPLETED")).toBe("completed");
    expect(normalizeDeckStatus("succeeded")).toBe("completed");
  });

  test("failures are not mistaken for work in progress", () => {
    expect(normalizeDeckStatus("FAILED")).toBe("failed");
    expect(normalizeDeckStatus("error")).toBe("failed");
  });

  test("everything else keeps polling", () => {
    expect(normalizeDeckStatus("pending")).toBe("pending");
    expect(normalizeDeckStatus("IN_PROGRESS")).toBe("pending");
    expect(normalizeDeckStatus(undefined)).toBe("none");
  });
});

describe("parseGammaStatus", () => {
  // The completed response from GET /v1.0/generations/{id}.
  test("gammaUrl and exportUrl come through with the status", () => {
    expect(
      parseGammaStatus({
        generationId: "xxxxxxxx",
        status: "completed",
        gammaUrl: "https://gamma.app/docs/xxxxxxxx",
        exportUrl: "https://gamma.app/export/xxxxxxxx.pptx",
        credits: { deducted: 150, remaining: 3000 },
      }),
    ).toEqual({
      status: "completed",
      url: "https://gamma.app/docs/xxxxxxxx",
      exportUrl: "https://gamma.app/export/xxxxxxxx.pptx",
    });
  });

  test("pending has no urls yet", () => {
    expect(parseGammaStatus({ status: "pending", generationId: "x" })).toEqual({
      status: "pending",
      url: null,
      exportUrl: null,
    });
  });
});

describe("parsePresentationsDeck", () => {
  test("the export download lives one level down", () => {
    const out = parsePresentationsDeck({
      id: "deck_123",
      status: "COMPLETED",
      deck_url: "https://app.presentations.ai/deck/deck_123",
      status_url: "https://api.presentations.ai/api/v1/requests/req_123",
      export: { download_url: "https://cdn.presentations.ai/deck_123.pptx" },
    });
    expect(out).toMatchObject({
      generationId: "deck_123",
      status: "completed",
      url: "https://app.presentations.ai/deck/deck_123",
      exportUrl: "https://cdn.presentations.ai/deck_123.pptx",
      statusUrl: "https://api.presentations.ai/api/v1/requests/req_123",
    });
  });

  test("a 202 body with no status is still readable", () => {
    const out = parsePresentationsDeck({ request_id: "req_9" });
    expect(out.generationId).toBe("req_9");
    expect(out.status).toBe("none");
    expect(out.url).toBeNull();
  });

  test("junk does not invent a deck", () => {
    expect(parsePresentationsDeck(null)).toEqual({
      generationId: null,
      status: "none",
      url: null,
      exportUrl: null,
      statusUrl: null,
    });
  });
});

describe("deckPrompt", () => {
  test("the instruction leads and the text follows", () => {
    const prompt = deckPrompt("Q4 launch plan");
    expect(prompt).toContain("presentation");
    expect(prompt.trimEnd().endsWith("Q4 launch plan")).toBe(true);
  });

  test("long input is capped", () => {
    const prompt = deckPrompt("x".repeat(50), 20);
    expect(prompt).toContain("x".repeat(20));
    expect(prompt).not.toContain("x".repeat(21));
  });
});

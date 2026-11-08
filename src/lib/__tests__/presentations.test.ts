// Two presentation providers, two vocabularies and three key names for the same
// URL. These are the parsing rules the actions rely on.

import { describe, expect, test } from "bun:test";
import {
  absolutizeUrl,
  deckPrompt,
  normalizeDeckStatus,
  parseGammaStatus,
  parsePresentationsDeck,
  parsePresentonTask,
  presentonEndpoints,
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

describe("presentonEndpoints", () => {
  test("the cloud service is the default and speaks v3", () => {
    const endpoints = presentonEndpoints();
    expect(endpoints.generate).toBe(
      "https://api.presenton.ai/api/v3/presentation/generate/async",
    );
    expect(endpoints.status("task-1")).toBe(
      "https://api.presenton.ai/api/v3/async-task/status/task-1",
    );
    expect(endpoints.templateKey).toBe("standard_template");
  });

  test("a self-hosted base speaks v1 under /ppt", () => {
    const endpoints = presentonEndpoints("http://localhost:5001/");
    expect(endpoints.generate).toBe(
      "http://localhost:5001/api/v1/ppt/presentation/generate/async",
    );
    expect(endpoints.status("task-9")).toBe(
      "http://localhost:5001/api/v1/ppt/presentation/status/task-9",
    );
    // Self-hosted calls the field `template`; cloud renames it.
    expect(endpoints.templateKey).toBe("template");
    expect(endpoints.origin).toBe("http://localhost:5001");
  });
});

describe("absolutizeUrl", () => {
  test("relative paths belong to the instance that generated them", () => {
    expect(
      absolutizeUrl("static/user_data/abc/deck.pptx", "https://api.presenton.ai"),
    ).toBe("https://api.presenton.ai/static/user_data/abc/deck.pptx");
    expect(absolutizeUrl("/static/x.pptx", "http://host:5001")).toBe(
      "http://host:5001/static/x.pptx",
    );
  });

  test("absolute urls pass through and nothing is invented", () => {
    expect(absolutizeUrl("https://cdn/deck.pptx", "https://base")).toBe(
      "https://cdn/deck.pptx",
    );
    expect(absolutizeUrl(null, "https://base")).toBeNull();
    expect(absolutizeUrl("  ", "https://base")).toBeNull();
  });
});

describe("parsePresentonTask", () => {
  test("the task id is enough to start polling", () => {
    expect(
      parsePresentonTask(
        { id: "task-9a827c13f4", status: "pending", message: "created" },
        "https://api.presenton.ai",
      ),
    ).toEqual({
      generationId: "task-9a827c13f4",
      status: "pending",
      url: null,
      exportUrl: null,
      statusUrl: null,
    });
  });

  test("the completed status carries the deck under data", () => {
    const out = parsePresentonTask(
      {
        id: "task-9a827c13f4",
        status: "COMPLETED",
        data: {
          presentation_id: "d3000f96",
          path: "static/user_data/d3000f96/deck.pptx",
          edit_path: "/presentation?id=d3000f96",
        },
      },
      "http://localhost:5001",
    );
    expect(out.status).toBe("completed");
    expect(out.url).toBe("http://localhost:5001/presentation?id=d3000f96");
    expect(out.exportUrl).toBe(
      "http://localhost:5001/static/user_data/d3000f96/deck.pptx",
    );
  });

  test("a failed task is reported, not treated as pending", () => {
    expect(
      parsePresentonTask({ id: "t", status: "FAILED" }, "https://x").status,
    ).toBe("failed");
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

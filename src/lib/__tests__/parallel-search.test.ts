import { describe, expect, test } from "bun:test";
import { parallelRequestBody, parallelResults } from "../parallel-search";

describe("parallelRequestBody", () => {
  test("sends the question as the objective and a short form as the query", () => {
    const body = parallelRequestBody("What changed in the Convex 1.20 release?");
    expect(body.objective).toBe("What changed in the Convex 1.20 release?");
    expect(body.search_queries).toEqual(["What changed in the Convex 1.20 release?"]);
  });

  test("nests the result and excerpt caps under advanced_settings", () => {
    const body = parallelRequestBody("solid state batteries");
    const advanced = body.advanced_settings as Record<string, unknown>;
    expect(advanced.max_results).toBe(8);
    expect(advanced.excerpt_settings).toEqual({ max_chars_per_result: 900 });
    // The beta shape put these at the top level, and /v1 rejects that with a 422.
    expect(body).not.toHaveProperty("max_results");
    expect(body).not.toHaveProperty("excerpts");
  });

  test("asks for fast mode rather than the slower default", () => {
    expect(parallelRequestBody("anything").mode).toBe("fast");
  });

  test("trims a very long question to the query limit but keeps the objective", () => {
    const long = `${"word ".repeat(200)}end`;
    const body = parallelRequestBody(long);
    const queries = body.search_queries as string[];
    expect(queries).toHaveLength(1);
    expect(queries[0].length).toBeLessThanOrEqual(200);
    expect((body.objective as string).length).toBeGreaterThan(200);
  });

  test("collapses whitespace in the query so newlines do not reach the API", () => {
    const body = parallelRequestBody("why  is\n\nthis   slow?");
    expect(body.search_queries).toEqual(["why is this slow?"]);
  });
});

describe("parallelResults", () => {
  test("joins excerpts into one snippet", () => {
    const hits = parallelResults({
      results: [
        {
          title: "Release notes",
          url: "https://example.com/notes",
          excerpts: ["First paragraph.", "Second paragraph."],
        },
      ],
    });
    expect(hits).toEqual([
      {
        title: "Release notes",
        url: "https://example.com/notes",
        snippet: "First paragraph. Second paragraph.",
      },
    ]);
  });

  test("drops hits with no URL and de-duplicates the same page", () => {
    const hits = parallelResults({
      results: [
        { title: "No url", excerpts: ["x"] },
        { title: "A", url: "https://example.com/a" },
        { title: "A again", url: "https://example.com/a" },
      ],
    });
    expect(hits.map((h) => h.url)).toEqual(["https://example.com/a"]);
    expect(hits[0].title).toBe("A");
  });

  test("falls back to a title and leaves the snippet off when there is no excerpt", () => {
    const hits = parallelResults({
      results: [{ url: "https://example.com/empty", title: null }],
    });
    expect(hits[0].title).toBe("Untitled result");
    expect(hits[0].snippet).toBeUndefined();
  });

  test("caps the snippet and the number of hits", () => {
    const hits = parallelResults(
      {
        results: Array.from({ length: 12 }, (_, i) => ({
          url: `https://example.com/${i}`,
          excerpts: ["x".repeat(2_000)],
        })),
      },
      3,
    );
    expect(hits).toHaveLength(3);
    expect(hits[0].snippet?.length).toBe(800);
  });

  test("survives a response with no results at all", () => {
    expect(parallelResults({})).toEqual([]);
    expect(parallelResults({ results: null })).toEqual([]);
  });
});

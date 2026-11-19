import { describe, expect, test } from "bun:test";
import { newAiModeSources } from "../ai-mode-sources";

const page = (url: string, title = `Page ${url}`) => ({
  title,
  url,
  snippet: `excerpt from ${url}`,
});

describe("newAiModeSources", () => {
  test("keeps citations the run does not already have", () => {
    const added = newAiModeSources(
      [{ url: "https://a.test/1" }],
      [page("https://a.test/1"), page("https://b.test/2")],
      6,
    );
    expect(added.map((entry) => entry.url)).toEqual(["https://b.test/2"]);
  });

  test("drops duplicates inside one response", () => {
    // AI Mode routinely cites the same page under two claims.
    const added = newAiModeSources(
      [],
      [page("https://a.test/1"), page("https://a.test/1"), page("https://b.test/2")],
      6,
    );
    expect(added.map((entry) => entry.url)).toEqual([
      "https://a.test/1",
      "https://b.test/2",
    ]);
  });

  test("stops at the room left in the budget", () => {
    const added = newAiModeSources(
      [],
      [page("https://a.test/1"), page("https://b.test/2"), page("https://c.test/3")],
      2,
    );
    expect(added).toHaveLength(2);
  });

  test("adds nothing when there is no room", () => {
    expect(newAiModeSources([], [page("https://a.test/1")], 0)).toEqual([]);
    expect(newAiModeSources([], [page("https://a.test/1")], -4)).toEqual([]);
  });

  test("skips a citation with no address instead of inventing one", () => {
    const added = newAiModeSources(
      [],
      [{ title: "No link", url: "  ", snippet: "text" }, page("https://b.test/2")],
      6,
    );
    expect(added.map((entry) => entry.url)).toEqual(["https://b.test/2"]);
  });

  test("falls back to the URL when a citation has no title", () => {
    const added = newAiModeSources(
      [],
      [{ title: "", url: "https://a.test/1", snippet: "text" }],
      6,
    );
    expect(added[0]?.title).toBe("https://a.test/1");
  });

  test("keeps AI Mode's own ranking", () => {
    const added = newAiModeSources(
      [],
      [page("https://a.test/1"), page("https://b.test/2"), page("https://c.test/3")],
      3,
    );
    expect(added.map((entry) => entry.url)).toEqual([
      "https://a.test/1",
      "https://b.test/2",
      "https://c.test/3",
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import {
  buildPageContext,
  hasReadableText,
  PAGE_CONTEXT_BUDGET,
} from "../pdf-pages";

describe("buildPageContext", () => {
  test("tags every page in order", () => {
    const { text, kept, dropped } = buildPageContext(["Alpha.", "Beta."]);
    expect(text).toBe("[page 1] Alpha.\n\n[page 2] Beta.");
    expect(kept).toEqual(["Alpha.", "Beta."]);
    expect(dropped).toBe(0);
  });

  test("collapses hard-wrapped whitespace inside a page", () => {
    const { text } = buildPageContext(["line one\nline   two\t\tthree"]);
    expect(text).toBe("[page 1] line one line two three");
  });

  test("drops whole pages rather than slicing one", () => {
    const pages = ["a".repeat(60), "b".repeat(60), "c".repeat(60)];
    const { text, kept, dropped } = buildPageContext(pages, 100);
    // First page fits, second does not: nothing is truncated mid-page.
    expect(kept).toHaveLength(1);
    expect(dropped).toBe(2);
    expect(text).toBe(`[page 1] ${"a".repeat(60)}`);
    expect(text).not.toContain("b");
  });

  test("keeps numbering contiguous when pages are dropped", () => {
    const { text } = buildPageContext(["first", "second"], 20);
    expect(text.startsWith("[page 1] first")).toBe(true);
    expect(text).not.toContain("[page 3]");
  });

  test("default budget holds a large document's early pages", () => {
    const pages = Array.from({ length: 40 }, (_, i) => `page ${i + 1} `.repeat(50));
    const { kept } = buildPageContext(pages);
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThanOrEqual(pages.length);
    expect(PAGE_CONTEXT_BUDGET).toBe(60_000);
  });

  test("an empty page still gets a marker, so numbering never shifts", () => {
    const { text } = buildPageContext(["", "Second page"]);
    expect(text).toBe("[page 1] \n\n[page 2] Second page");
  });
});

describe("hasReadableText", () => {
  test("false for whitespace-only extraction", () => {
    expect(hasReadableText(["", "   \n "])).toBe(false);
  });

  test("true when any page has text", () => {
    expect(hasReadableText(["", "something"])).toBe(true);
  });
});

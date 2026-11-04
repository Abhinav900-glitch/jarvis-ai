import { describe, expect, test } from "bun:test";
import { linkPageCitations, pageFromFragment } from "../page-citations";

describe("linkPageCitations", () => {
  test("rewrites a single page reference", () => {
    expect(linkPageCitations("Revenue rose [p. 12] sharply.")).toBe(
      "Revenue rose [p. 12](#pdf-page-12) sharply.",
    );
  });

  test("rewrites a page range", () => {
    expect(linkPageCitations("See [pp. 12-14] for detail.")).toBe(
      "See [pp. 12–14](#pdf-page-12) for detail.",
    );
  });

  test("handles no space, capitals and an en dash", () => {
    expect(linkPageCitations("[P.7]")).toBe("[p. 7](#pdf-page-7)");
    expect(linkPageCitations("[p. 3–5]")).toBe("[pp. 3–5](#pdf-page-3)");
  });

  test("rewrites several references in one answer", () => {
    expect(linkPageCitations("[p. 1] and [p. 2]")).toBe(
      "[p. 1](#pdf-page-1) and [p. 2](#pdf-page-2)",
    );
  });

  test("leaves ordinary links and source citations alone", () => {
    const text = "See [the docs](https://example.com) and [1].";
    expect(linkPageCitations(text)).toBe(text);
  });

  test("leaves prose that is not a page reference alone", () => {
    const text = "[p. something] and [page 4] and [12]";
    expect(linkPageCitations(text)).toBe(text);
  });

  test("does not create nested links for an already-linked citation", () => {
    expect(linkPageCitations("[p. 9](#pdf-page-9)")).toBe(
      "[p. 9](#pdf-page-9)",
    );
  });
});

describe("pageFromFragment", () => {
  test("reads the page out of a citation fragment", () => {
    expect(pageFromFragment("#pdf-page-12")).toBe("12");
  });

  test("rejects other fragments and unusual pages", () => {
    expect(pageFromFragment("#section-2")).toBeNull();
    expect(pageFromFragment("#pdf-page-abc")).toBeNull();
    expect(pageFromFragment("#pdf-page-")).toBeNull();
  });
});

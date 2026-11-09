import { describe, expect, test } from "bun:test";

import {
  PAGE_BRIEF_MAX,
  cleanPageBrief,
  hostLabel,
  isPageUrl,
  pageBriefPrompt,
  pageTitle,
} from "../page-brief";

describe("cleanPageBrief", () => {
  test("keeps a plain description as it is", () => {
    const text = "A silver-haired warrior in a torn orange gi, pale blue aura.";
    expect(cleanPageBrief(text)).toBe(text);
  });

  test("strips fences, wrapping quotes and a leading label", () => {
    expect(cleanPageBrief('```\n"Visual description: a red car"\n```')).toBe(
      "a red car",
    );
    expect(cleanPageBrief("Summary: blue glass tower")).toBe(
      "blue glass tower",
    );
  });

  test("NOTHING and refusals mean no brief", () => {
    expect(cleanPageBrief("NOTHING")).toBe("");
    expect(cleanPageBrief("nothing useful here")).toBe("");
    expect(cleanPageBrief("I cannot read that page.")).toBe("");
    expect(cleanPageBrief("Sorry, no description available.")).toBe("");
    expect(cleanPageBrief("")).toBe("");
  });

  test("caps the length on a sentence boundary", () => {
    const long = `${"A long sentence about the design. ".repeat(60)}`;
    const brief = cleanPageBrief(long);
    expect(brief.length).toBeLessThanOrEqual(PAGE_BRIEF_MAX);
    expect(brief.endsWith(".")).toBe(true);
  });

  test("collapses newlines into one paragraph", () => {
    expect(cleanPageBrief("one\n\ntwo   three")).toBe("one two three");
  });
});

describe("pageBriefPrompt", () => {
  test("carries the url, title and page text", () => {
    const prompt = pageBriefPrompt({
      url: "https://example.com/goku",
      title: "Goku",
      text: "Silver hair and silver eyes.",
    });
    expect(prompt).toContain("Page: https://example.com/goku");
    expect(prompt).toContain("Title: Goku");
    expect(prompt).toContain("Silver hair and silver eyes.");
  });

  test("caps the page text so one long page cannot flood the model", () => {
    const prompt = pageBriefPrompt({
      url: "https://example.com",
      text: "x".repeat(10_000),
    });
    expect(prompt.length).toBeLessThan(4_400);
    expect(prompt).not.toContain("Title:");
  });
});

describe("isPageUrl", () => {
  test("accepts http and bare hosts, rejects non-pages", () => {
    expect(isPageUrl("https://example.com/a")).toBe(true);
    expect(isPageUrl("example.com/a")).toBe(true);
    expect(isPageUrl("")).toBe(false);
    expect(isPageUrl("two words")).toBe(false);
    expect(isPageUrl("mailto:me@example.com")).toBe(false);
  });
});

describe("hostLabel and pageTitle", () => {
  test("host drops www and keeps the domain", () => {
    expect(hostLabel("https://www.fandom.com/wiki/Goku")).toBe("fandom.com");
    expect(hostLabel("not a url")).toBe("not a url");
  });

  test("title is read and decoded from html", () => {
    expect(pageTitle("<html><head><title> Goku &amp; friends </title></head>")).toBe(
      "Goku & friends",
    );
    expect(pageTitle("<html><body>no title</body></html>")).toBe("");
  });
});

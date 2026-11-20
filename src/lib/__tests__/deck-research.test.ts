// Tests for the deck research shaper.
//
// The cases here are the ones a live search actually returns: several pages
// from one site, a result with only a title, and a page whose answer is longer
// than a slide. Each has a different right answer, which is why the function
// cannot just map every hit to a line.

import { describe, expect, test } from "bun:test";
import { domainOf, researchFromHits } from "../pptx/research";
import { outlinePrompt, slidesPrompt } from "../pptx/prompts";

const body = (n: number) => `This page explains the trend in detail${" and more".repeat(n)}.`;

describe("domainOf", () => {
  test("drops the www and keeps the host", () => {
    expect(domainOf("https://www.example.com/a/b")).toBe("example.com");
    expect(domainOf("http://news.example.org/story")).toBe("news.example.org");
  });

  test("junk is not a domain", () => {
    expect(domainOf("not a url")).toBe("");
    expect(domainOf("")).toBe("");
  });
});

describe("researchFromHits", () => {
  test("one fact per domain", () => {
    const research = researchFromHits([
      { title: "Costs", url: "https://example.com/a", snippet: body(2) },
      { title: "Costs again", url: "https://example.com/b", snippet: body(2) },
      { title: "Other", url: "https://other.com/c", snippet: body(2) },
    ]);
    expect(research.facts).toHaveLength(2);
    expect(research.facts[0]).toContain("example.com");
    expect(research.facts[1]).toContain("other.com");
  });

  test("a result with only a headline is not a fact", () => {
    const research = researchFromHits([
      { title: "Something happened", url: "https://example.com/a" },
      { title: "Short", url: "https://example.com/b", snippet: "Too short." },
    ]);
    expect(research).toEqual({ facts: [], sources: [] });
  });

  test("a long page is trimmed, and the source is kept with it", () => {
    const research = researchFromHits([
      { title: "The 2026 report", url: "https://www.example.com/report", snippet: body(80) },
    ]);
    expect(research.facts).toHaveLength(1);
    expect(research.facts[0].length).toBeLessThan(320);
    expect(research.facts[0]).toContain("[The 2026 report · example.com]");
    expect(research.sources).toEqual([
      { title: "The 2026 report", url: "https://www.example.com/report" },
    ]);
  });

  test("the fact limit holds", () => {
    const hits = Array.from({ length: 20 }, (_, i) => ({
      title: `Page ${i}`,
      url: `https://site${i}.com/a`,
      snippet: body(2),
    }));
    expect(researchFromHits(hits).facts).toHaveLength(8);
    expect(researchFromHits(hits, 3).facts).toHaveLength(3);
  });

  test("non-http urls and empty input are ignored, not thrown on", () => {
    expect(
      researchFromHits([
        { title: "Local", url: "/docs/x", snippet: body(2) },
        { title: "Mail", url: "mailto:a@b.c", snippet: body(2) },
      ]),
    ).toEqual({ facts: [], sources: [] });
    expect(researchFromHits([])).toEqual({ facts: [], sources: [] });
  });

  test("markdown headings and the repeated title are stripped", () => {
    const research = researchFromHits([
      {
        title: "On-Device AI Market Size",
        url: "https://example.com/x",
        snippet:
          "# On-Device AI Market Size # On-Device AI Market Size The market reached $41.2 billion in 2026, up 38% on the year before, according to the report.",
      },
    ]);
    expect(research.facts[0].startsWith("The market reached")).toBe(true);
    expect(research.facts[0]).not.toContain("#");
  });

  test("a sentence with a figure beats an opening pleasantry", () => {
    const research = researchFromHits([
      {
        title: "Report",
        url: "https://example.com/y",
        snippet:
          "Welcome to our report on the industry. Here is what we found across the last year of research. Adoption rose to 62% of new devices.",
      },
    ]);
    expect(research.facts[0]).toContain("62%");
  });

  test("a missing title falls back to the domain", () => {
    const research = researchFromHits([
      { title: "   ", url: "https://example.com/x", snippet: body(2) },
    ]);
    expect(research.sources[0].title).toBe("example.com");
  });
});

describe("research in the deck prompts", () => {
  const fact = "Costs fell 40% in two years [The 2026 report · example.com]";

  test("the outline and the slide writer both see the notes", () => {
    const brief = { topic: "Costs", slideCount: 6, research: [fact] };
    expect(outlinePrompt(brief)).toContain(fact);
    const plan = { title: "Costs", sections: [{ title: "A", intent: "b" }], slides: [] };
    const prompt = slidesPrompt(brief, plan, [{ index: 0, kind: "bullets", title: "Costs" }]);
    expect(prompt).toContain(fact);
    expect(prompt).toContain("only figures you may quote");
  });

  test("a deck without research carries no empty research block", () => {
    expect(outlinePrompt({ topic: "Costs", slideCount: 6 })).not.toContain("Research notes");
    expect(
      slidesPrompt(
        { topic: "Costs", slideCount: 6 },
        { title: "Costs", sections: [], slides: [] },
        [{ index: 0, kind: "bullets", title: "Costs" }],
      ),
    ).not.toContain("Research notes");
  });
});

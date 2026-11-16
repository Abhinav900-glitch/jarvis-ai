// Tests for in-place slide editing.
//
// The point of these is that an edit goes through the same cleaning as model
// output: caps that stop a paragraph landing where a title belongs, blank lines
// that must not become empty bullets, and content a layout depends on (a chart,
// a table, a QR link) that an edit to the text must not quietly destroy.

import { describe, expect, test } from "bun:test";
import { applySlideEdit, coerceSlideRewrite } from "../pptx/edit";
import { rewriteSlidePrompt } from "../pptx/prompts";
import type { SlideSpec } from "../pptx/spec";

const bullets: SlideSpec = {
  kind: "bullets",
  title: "Where we are",
  kicker: "Context",
  subtitle: "A short read",
  body: ["Revenue up", "Costs flat"],
  notes: "Say the number first.",
};

describe("applySlideEdit", () => {
  test("replaces the title and trims it", () => {
    expect(applySlideEdit(bullets, { title: "  Where we are now  " }).title).toBe("Where we are now");
  });

  test("refuses an emptied title, keeping the previous one", () => {
    expect(applySlideEdit(bullets, { title: "   " }).title).toBe("Where we are");
  });

  test("caps an over-long title instead of storing it", () => {
    const edited = applySlideEdit(bullets, { title: "x".repeat(400) });
    expect(edited.title.length).toBe(140);
  });

  test("drops blank bullet lines and caps the list", () => {
    const edited = applySlideEdit(bullets, {
      body: ["One", "   ", "Two", ...Array.from({ length: 20 }, (_, i) => `Point ${i}`)],
    });
    expect(edited.body?.[0]).toBe("One");
    expect(edited.body?.[1]).toBe("Two");
    expect(edited.body).toHaveLength(7);
  });

  test("cleaning removes markdown emphasis from edited text", () => {
    const edited = applySlideEdit(bullets, { body: ["**Revenue** up"], notes: "*Emphasis* here" });
    expect(edited.body?.[0]).toBe("Revenue up");
    expect(edited.notes).toBe("Emphasis here");
  });

  test("an emptied subtitle or kicker is removed, not left blank", () => {
    const edited = applySlideEdit(bullets, { subtitle: "", kicker: "  " });
    expect(edited.subtitle).toBeUndefined();
    expect(edited.kicker).toBeUndefined();
  });

  test("editing text keeps a chart, table or QR block intact", () => {
    const chart: SlideSpec = {
      kind: "chart",
      title: "Growth",
      chart: { kind: "line", categories: ["Q1", "Q2"], series: [{ name: "A", values: [1, 2] }] },
    };
    expect(applySlideEdit(chart, { title: "Growth, restated" }).chart?.series[0].values).toEqual([1, 2]);

    const table: SlideSpec = {
      kind: "table",
      title: "Compare",
      table: { columns: ["A", "B"], rows: [["1", "2"]] },
    };
    expect(applySlideEdit(table, { title: "Compared" }).table?.rows).toEqual([["1", "2"]]);

    const qr: SlideSpec = { kind: "qr", title: "Scan", qr: { url: "https://example.com" } };
    const edited = applySlideEdit(qr, { title: "Scan me" });
    expect(edited.kind).toBe("qr");
    expect(edited.qr?.url).toBe("https://example.com");
  });

  test("a quote slide keeps its quote when the title changes", () => {
    const quote: SlideSpec = {
      kind: "quote",
      title: "Quote",
      quote: { text: "One line", attribution: "Someone" },
    };
    const edited = applySlideEdit(quote, { title: "One line, framed" });
    expect(edited.quote?.text).toBe("One line");
    expect(edited.quote?.attribution).toBe("Someone");
  });

  test("a rewrite cannot drop the chart, table or QR the layout is built on", () => {
    const chart: SlideSpec = {
      kind: "chart",
      title: "Growth",
      chart: { kind: "line", categories: ["Q1"], series: [{ name: "A", values: [1] }] },
    };
    expect(coerceSlideRewrite({ kind: "chart", title: "Growth, again" }, chart)).toBeNull();
    expect(
      coerceSlideRewrite({ title: "Growth, again", chart: chart.chart }, chart)?.chart,
    ).toEqual(chart.chart);

    const qr: SlideSpec = { kind: "qr", title: "Scan", qr: { url: "https://example.com" } };
    expect(coerceSlideRewrite({ title: "Scan it" }, qr)).toBeNull();
  });

  test("a rewrite keeps the slide's kind, so it edits rather than replaces", () => {
    const rewritten = coerceSlideRewrite({ kind: "bullets", title: "Shorter", body: ["**One**"] }, bullets);
    expect(rewritten?.kind).toBe("bullets");
    expect(rewritten?.body).toEqual(["One"]);
  });

  test("junk or an empty object is refused", () => {
    expect(coerceSlideRewrite(null, bullets)).toBeNull();
    expect(coerceSlideRewrite("a slide, honestly", bullets)).toBeNull();
    expect(coerceSlideRewrite({}, bullets)).toBeNull();
  });

  test("the rewrite prompt carries the slide, its kind and the instruction", () => {
    const prompt = rewriteSlidePrompt({
      deckTitle: "Quarterly review",
      total: 12,
      index: 3,
      slide: bullets,
      instruction: "add a number",
    });
    expect(prompt).toContain("slide 4 of 12");
    expect(prompt).toContain("Quarterly review");
    expect(prompt).toContain("add a number");
    expect(prompt).toContain('"bullets"');
    expect(prompt).toContain("Costs flat");
  });

  test("without an instruction the prompt still asks for a tighter slide", () => {
    const prompt = rewriteSlidePrompt({ deckTitle: "D", total: 2, index: 0, slide: bullets });
    expect(prompt).toContain("Tighten it");
  });

  test("editing a slide with no body leaves the layout's own content alone", () => {
    const stats: SlideSpec = {
      kind: "stats",
      title: "Numbers",
      metrics: [{ value: "12%", label: "Growth" }],
    };
    expect(applySlideEdit(stats, { notes: "New note" }).metrics).toHaveLength(1);
  });
});

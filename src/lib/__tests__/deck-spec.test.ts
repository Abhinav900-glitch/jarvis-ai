// Tests for the deck spec: what survives contact with a model.
//
// The writer is only as good as its normaliser. A model returns `"3.2x"` for a
// number, a table row one cell short, a chart with no series, or JSON wrapped in
// prose — and every one of those has to become either a valid slide or no slide,
// never a broken file. So these cases are the shapes real replies take, not
// happy-path fixtures.

import { describe, expect, test } from "bun:test";
import {
  MAX_SLIDES,
  extractJson,
  fallbackDeck,
  fallbackPlan,
  fitSlideKind,
  hasContent,
  normalizeDeck,
  normalizePlan,
  normalizeSlide,
  normalizeSlides,
} from "../pptx/spec";
import {
  alignLessonPlan,
  alignPlan,
  fallbackNotes,
  isLessonBrief,
  outlinePrompt,
  slidesPrompt,
} from "../pptx/prompts";
import { suggestTheme, themeById, themeList } from "../pptx/theme";

describe("extractJson", () => {
  test("reads a bare object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  test("ignores a code fence and surrounding prose", () => {
    const raw = 'Here you go:\n```json\n{"title":"Deck"}\n```\nHope that helps.';
    expect(extractJson(raw)).toEqual({ title: "Deck" });
  });

  test("survives a trailing comma", () => {
    expect(extractJson('{"slides":[{"title":"A"},]}')).toEqual({ slides: [{ title: "A" }] });
  });

  test("returns null rather than throwing on nonsense", () => {
    expect(extractJson("I cannot help with that.")).toBeNull();
    expect(extractJson("")).toBeNull();
  });
});

describe("normalizeSlide", () => {
  test("a chart with no series becomes bullets instead of an empty frame", () => {
    const slide = normalizeSlide({ kind: "chart", title: "Growth", body: ["One", "Two"] });
    expect(slide?.kind).toBe("bullets");
    expect(slide?.body).toEqual(["One", "Two"]);
  });

  test("keeps a chart that has categories and values", () => {
    const slide = normalizeSlide({
      kind: "chart",
      title: "Growth",
      chart: { kind: "line", categories: ["Q1", "Q2"], series: [{ name: "A", values: [1, "2"] }] },
    });
    expect(slide?.kind).toBe("chart");
    expect(slide?.chart?.kind).toBe("line");
    expect(slide?.chart?.series[0].values).toEqual([1, 2]);
  });

  test("a pie is padded so every slice has a value", () => {
    const slide = normalizeSlide({
      kind: "chart",
      title: "Mix",
      chart: { kind: "pie", categories: ["A", "B", "C"], values: [2] },
    });
    expect(slide?.chart?.series[0].values).toEqual([2, 0, 0]);
  });

  test("table rows are padded to the column count", () => {
    const slide = normalizeSlide({
      kind: "table",
      title: "Compare",
      table: { columns: ["A", "B", "C"], rows: [["1"], ["2", "3", "4"]] },
    });
    expect(slide?.table?.rows[0]).toEqual(["1", "", ""]);
    expect(slide?.table?.rows[1]).toEqual(["2", "3", "4"]);
  });

  test("a table with no columns degrades to bullets", () => {
    expect(normalizeSlide({ kind: "table", title: "Compare", table: { rows: [["1"]] } })?.kind).toBe("bullets");
  });

  test("keeps a QR slide that has a link, and drops one that does not", () => {
    const withUrl = normalizeSlide({ kind: "qr", title: "Scan", qr: { url: "https://youtu.be/x" } });
    expect(withUrl?.kind).toBe("qr");
    expect(withUrl?.qr?.url).toBe("https://youtu.be/x");
    expect(normalizeSlide({ kind: "qr", title: "Scan", body: ["one"] })?.kind).toBe("bullets");
  });

  test("strips markup and caps the body", () => {
    const slide = normalizeSlide({
      kind: "bullets",
      title: "  Spaced   out  ",
      body: Array.from({ length: 12 }, (_, i) => `Point ${i}`),
    });
    expect(slide?.title).toBe("Spaced out");
    expect(slide?.body).toHaveLength(7);
  });

  test("rejects a slide with no title at all", () => {
    expect(normalizeSlide({ kind: "bullets" })).toBeNull();
    expect(normalizeSlide("not a slide")).toBeNull();
  });

  test("accepts a quote made of a bare string", () => {
    const slide = normalizeSlide({ kind: "quote", title: "Quote", quote: "A line worth pausing on." });
    expect(slide?.quote?.text).toBe("A line worth pausing on.");
  });

  test("refuses a remote image URL but keeps the caption", () => {
    const slide = normalizeSlide({
      kind: "image",
      title: "Visual",
      image: { dataUrl: "https://example.com/a.png", caption: "Remote" },
    });
    // A URL the renderer cannot fetch is dropped; the slide stays a visual beat.
    expect(slide?.image?.dataUrl).toBeUndefined();
    expect(slide?.image?.caption).toBe("Remote");
    expect(slide?.kind).toBe("image");
  });
});

describe("normalizeSlides", () => {
  test("accepts the envelope and a bare array", () => {
    expect(normalizeSlides({ slides: [{ title: "A" }, { title: "B" }] })).toHaveLength(2);
    expect(normalizeSlides([{ title: "A" }])).toHaveLength(1);
    expect(normalizeSlides({ nope: true })).toHaveLength(0);
  });
});

describe("plan shaping", () => {
  const raw = {
    title: "On-device AI",
    sections: [{ title: "Context" }, { title: "Evidence" }],
    slides: [
      { kind: "cover", title: "On-device AI" },
      { kind: "agenda", title: "What this covers" },
      { kind: "bullets", title: "Where we are" },
      { kind: "bullets", title: "Where we are not" },
      { kind: "closing", title: "Thank you" },
    ],
  };

  test("reads sections and slides", () => {
    const plan = normalizePlan(raw, "Fallback", 10);
    expect(plan.title).toBe("On-device AI");
    expect(plan.sections).toHaveLength(2);
    expect(plan.slides).toHaveLength(5);
  });

  test("caps the plan to the requested slide count", () => {
    expect(normalizePlan(raw, "Fallback", 3).slides).toHaveLength(3);
  });

  test("adds a missing agenda and closing", () => {
    const plan = alignPlan(
      {
        title: "Deck",
        sections: [{ title: "One" }],
        slides: [
          { kind: "cover", title: "Deck" },
          { kind: "bullets", title: "A" },
          { kind: "bullets", title: "B" },
          { kind: "bullets", title: "C" },
          { kind: "bullets", title: "D" },
          { kind: "bullets", title: "E" },
          { kind: "bullets", title: "F" },
        ],
      },
      { topic: "Deck", slideCount: 12 },
    );
    expect(plan.slides[0].kind).toBe("cover");
    expect(plan.slides[1].kind).toBe("agenda");
    expect(plan.slides[plan.slides.length - 1].kind).toBe("closing");
  });

  test("trims to the brief without losing the ends", () => {
    const plan = alignPlan(normalizePlan({ ...raw, slides: Array.from({ length: 30 }, (_, i) => ({ kind: "bullets", title: `S${i}` })) }, "Deck", 30), {
      topic: "Deck",
      slideCount: 10,
    });
    expect(plan.slides).toHaveLength(10);
    expect(plan.slides[0].kind).toBe("cover");
    expect(plan.slides[9].kind).toBe("closing");
  });

  test("two bullet slides in a row are broken up", () => {
    const bullets = Array.from({ length: 9 }, (_, i) => ({ kind: "bullets" as const, title: `S${i}` }));
    const plan = alignPlan(normalizePlan({ slides: bullets }, "Deck", 12), { topic: "Deck", slideCount: 12 });
    for (let i = 1; i < plan.slides.length; i += 1) {
      expect(plan.slides[i].kind === "bullets" && plan.slides[i - 1].kind === "bullets").toBe(false);
    }
  });
});

describe("the no-model deck", () => {
  test("honours the requested size and keeps its ends", () => {
    const deck = fallbackDeck("Supply chains", 30, "carbon");
    expect(deck.slides).toHaveLength(30);
    expect(deck.slides[0].kind).toBe("cover");
    expect(deck.slides[deck.slides.length - 1].kind).toBe("closing");
    expect(deck.theme).toBe("carbon");
  });

  test("never produces a slide with nothing to draw", () => {
    const deck = fallbackDeck("Anything", 50, "obsidian");
    for (const slide of deck.slides) {
      expect(hasContent(slide)).toBe(true);
      expect(slide.notes?.length ?? 0).toBeGreaterThan(0);
    }
  });

  test("clamps the count into the supported range", () => {
    expect(fallbackDeck("x", 1, "obsidian").slides.length).toBeGreaterThanOrEqual(8);
    expect(fallbackPlan("x", 5000).slides.length).toBe(MAX_SLIDES);
  });

  test("illustrative figures are labelled as such", () => {
    const deck = fallbackDeck("Numbers", 20, "tide");
    const stats = deck.slides.find((s) => s.kind === "stats");
    const chart = deck.slides.find((s) => s.kind === "chart");
    expect(stats?.metrics?.some((m) => /illustrative/i.test(m.note ?? ""))).toBe(true);
    expect(chart?.chart?.caption ?? "").toMatch(/illustrative/i);
  });
});

describe("prompts", () => {
  test("the outline prompt names the count and the kinds", () => {
    const prompt = outlinePrompt({ topic: "On-device AI", slideCount: 14 });
    expect(prompt).toContain("14-slide");
    expect(prompt).toContain("cover");
    expect(prompt).toContain("JSON");
  });

  test("the slide prompt repeats the requested kind and order", () => {
    const plan = fallbackPlan("On-device AI", 10);
    const prompt = slidesPrompt(
      { topic: "On-device AI", slideCount: 10 },
      plan,
      plan.slides.slice(0, 3).map((s, i) => ({ index: i, ...s })),
    );
    expect(prompt).toContain('kind="cover"');
    expect(prompt).toMatch(/same order and same kind/);
  });

  test("fallback notes name the slide and the topic", () => {
    const notes = fallbackNotes({ kind: "bullets", title: "Costs", body: ["One line"] }, "On-device AI");
    expect(notes).toContain("Costs");
    expect(notes).toContain("On-device AI");
  });
});

describe("fitSlideKind and themes", () => {
  test("leaves a slide whose content fits alone", () => {
    const slide = { kind: "stats" as const, title: "A", metrics: [{ value: "1", label: "B" }] };
    expect(fitSlideKind(slide).kind).toBe("stats");
  });

  test("downgrades an empty timeline", () => {
    expect(fitSlideKind({ kind: "timeline", title: "A" }).kind).toBe("bullets");
  });

  test("every theme is complete and resolvable", () => {
    for (const theme of themeList()) {
      expect(themeById(theme.id).accent).toBe(theme.accent);
      expect(theme.accent).toMatch(/^[0-9A-F]{6}$/i);
      expect(theme.coverSize).toBeGreaterThan(theme.titleSize);
    }
  });

  test("suggestTheme reads the topic, and unknown ids fall back", () => {
    expect(suggestTheme("pitch deck for a seed round").id).toBe("ember");
    expect(suggestTheme("climate and energy policy").id).toBe("moss");
    expect(themeById("nonsense").id).toBe("obsidian");
  });

  test("normalizeDeck keeps the caller's theme and transitions", () => {
    const deck = normalizeDeck({ slides: [{ title: "A" }], transition: "wipe" }, "ivory");
    expect(deck.theme).toBe("ivory");
    expect(deck.transition).toBe("wipe");
    expect(deck.slides).toHaveLength(1);
  });
});

describe("alignLessonPlan", () => {
  const brief = {
    topic: "Photosynthesis",
    slideCount: 10,
    audience: "a first-time biology student",
    tone: "define every term and correct the misconceptions",
  };
  const plan = {
    title: "Photosynthesis",
    subtitle: "How plants make food",
    sections: [],
    slides: [
      { kind: "cover" as const, title: "Photosynthesis" },
      { kind: "agenda" as const, title: "What this deck covers" },
      { kind: "bullets" as const, title: "The equation" },
      { kind: "bullets" as const, title: "The two stages" },
      { kind: "bullets" as const, title: "Where each input comes from" },
      { kind: "bullets" as const, title: "Why the plant needs glucose" },
      { kind: "bullets" as const, title: "What happens without light" },
      { kind: "bullets" as const, title: "Why oxygen is a byproduct" },
      { kind: "closing" as const, title: "Thank you" },
    ],
  };

  test("recognises a learner brief from the ordinary fields", () => {
    expect(isLessonBrief(brief)).toBe(true);
    expect(isLessonBrief({ topic: "Board update", slideCount: 10 })).toBe(false);
  });

  test("adds a worked example, misconceptions and a check before the closing", () => {
    const shaped = alignLessonPlan(plan, brief);
    const titles = shaped.slides.map((slide) => slide.title);
    expect(titles).toContain("A worked example");
    expect(titles).toContain("Common misconceptions, corrected");
    expect(titles).toContain("Check your understanding");
    expect(shaped.slides[shaped.slides.length - 1].kind).toBe("closing");
    expect(shaped.slides[shaped.slides.length - 2].title).toBe("Check your understanding");
    // The requested count is still honoured.
    expect(shaped.slides).toHaveLength(brief.slideCount);
  });

  test("leaves a general deck untouched", () => {
    const shaped = alignLessonPlan(plan, { topic: "Board update", slideCount: 10 });
    expect(shaped.slides).toHaveLength(plan.slides.length);
  });
});

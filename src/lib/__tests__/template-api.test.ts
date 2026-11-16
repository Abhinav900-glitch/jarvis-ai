// Tests for the PowerPoint Generator payload.
//
// The service cannot be called without a bearer token and a template, so the
// contract is pinned here: the upload name must match the payload's `template`,
// every deck slide becomes one entry pointing at the same template slide, and
// `body` is joined while `body_1..6` stay separate. Those three details are the
// difference between a filled template and a 400.

import { describe, expect, test } from "bun:test";
import {
  buildTemplatePayload,
  describeTemplateError,
  slideTags,
  TEMPLATE_API_BASE,
  TEMPLATE_TOKEN_ENV,
} from "../pptx/template-api";
import type { DeckSpec, SlideSpec } from "../pptx/spec";

const deck: DeckSpec = {
  title: "Quarterly review",
  subtitle: "What changed",
  author: "Team",
  theme: "carbon",
  ratio: "16:9",
  transition: "fade",
  slides: [
    { kind: "cover", title: "Quarterly review", subtitle: "What changed" },
    {
      kind: "bullets",
      title: "Where we are",
      kicker: "Context",
      body: ["Revenue up", "**Costs** flat", "Hiring paused"],
      notes: "Say the number first.",
    },
    {
      kind: "stats",
      title: "Numbers",
      metrics: [{ value: "12%", label: "Growth" }, { value: "3x", label: "Speed" }],
    },
    { kind: "qr", title: "Scan", qr: { url: "https://example.com", label: "Open the deck" } },
    {
      kind: "table",
      title: "Compare",
      table: { columns: ["A", "B"], rows: [["1", "2"]] },
    },
  ],
};

const tag = (tags: { key: string; value: string }[], key: string) =>
  tags.find((t) => t.key === key)?.value;

describe("slideTags", () => {
  test("numbers are one-based, and the padded number is its own tag", () => {
    const tags = slideTags(deck.slides[1], 1, 5);
    expect(tag(tags, "index")).toBe("2");
    expect(tag(tags, "total")).toBe("5");
    expect(tag(tags, "number")).toBe("02");
    expect(tag(tags, "title")).toBe("Where we are");
    expect(tag(tags, "kicker")).toBe("Context");
  });

  test("body is joined, and each point has its own tag", () => {
    const tags = slideTags(deck.slides[1], 1, 5);
    expect(tag(tags, "body")).toBe("Revenue up • Costs flat • Hiring paused");
    expect(tag(tags, "body_1")).toBe("Revenue up");
    // Markdown emphasis is stripped: the template renders plain text.
    expect(tag(tags, "body_2")).toBe("Costs flat");
    expect(tag(tags, "body_3")).toBe("Hiring paused");
  });

  test("unused body slots are emptied rather than omitted", () => {
    const tags = slideTags(deck.slides[0], 0, 5);
    expect(tag(tags, "body_1")).toBe("");
    expect(tag(tags, "body_6")).toBe("");
  });

  test("quote, metrics, QR and table cells are addressable", () => {
    expect(tag(slideTags(deck.slides[2], 2, 5), "metric_2_value")).toBe("3x");
    expect(tag(slideTags(deck.slides[3], 3, 5), "qr_url")).toBe("https://example.com");
    expect(tag(slideTags(deck.slides[4], 4, 5), "cell_1_2")).toBe("2");
    const quote = { kind: "quote" as const, title: "Q", quote: { text: "One line", attribution: "Someone" } };
    expect(tag(slideTags(quote, 0, 1), "quote_author")).toBe("Someone");
  });

  test("notes are exposed, because notes often carry the detail", () => {
    expect(tag(slideTags(deck.slides[1], 1, 5), "notes")).toBe("Say the number first.");
  });
});

describe("buildTemplatePayload", () => {
  const payload = buildTemplatePayload(deck, {
    templateName: "brand.pptx",
    slideIndex: 2,
    fileName: "quarterly",
  }) as {
    presentation: {
      template: string;
      export_version: string;
      resultFileName: string;
      tags: { key: string; value: string }[];
      slides: { type: string; slide_index: number; tags: { key: string; value: string }[] }[];
    };
  };

  test("declares the template and output names", () => {
    expect(payload.presentation.template).toBe("brand.pptx");
    expect(payload.presentation.resultFileName).toBe("quarterly");
    expect(payload.presentation.export_version).toBe("Pptx2019");
  });

  test("one entry per deck slide, all on the requested template slide", () => {
    expect(payload.presentation.slides).toHaveLength(deck.slides.length);
    for (const slide of payload.presentation.slides) {
      expect(slide.slide_index).toBe(2);
      expect(slide.type).toBe("slide");
    }
  });

  test("deck-level tags are on the presentation", () => {
    expect(tag(payload.presentation.tags, "deck_title")).toBe("Quarterly review");
    expect(tag(payload.presentation.tags, "deck_slides")).toBe("5");
  });

  test("the slide index defaults to the first template slide", () => {
    const defaulted = buildTemplatePayload(deck, { templateName: "t.pptx" }) as {
      presentation: { slides: { slide_index: number }[] };
    };
    expect(defaulted.presentation.slides[0].slide_index).toBe(0);
  });
});

describe("contract constants and errors", () => {
  test("the endpoint and env var are the documented ones", () => {
    expect(TEMPLATE_API_BASE).toBe("https://gen.powerpointgeneratorapi.com/v1.0");
    expect(TEMPLATE_TOKEN_ENV).toBe("POWERPOINT_GENERATOR_TOKEN");
  });

  test("a rejected token explains how to fix it", () => {
    expect(describeTemplateError(401, '{"message":"Unauthorized"}')).toContain("POWERPOINT_GENERATOR_TOKEN");
  });

  test("quota and validation errors keep the provider's own message", () => {
    expect(describeTemplateError(429, '{"detail":"monthly slide limit exceeded"}')).toContain(
      "monthly slide limit exceeded",
    );
    expect(describeTemplateError(400, '{"details":"missing slide 3"}')).toContain("missing slide 3");
  });

  test("a non-JSON body is not swallowed", () => {
    expect(describeTemplateError(500, "upstream boom")).toContain("upstream boom");
  });
});

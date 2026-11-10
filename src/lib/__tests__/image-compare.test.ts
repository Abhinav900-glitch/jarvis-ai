import { describe, expect, test } from "bun:test";
import {
  imagePickPrompt,
  largestImageIndex,
  parseImagePick,
} from "../image-compare";

const candidates = [
  {
    url: "https://cdn.stocksite.example/aurora-preview.jpg",
    source: "stocksite.example",
    title: "Aurora stock preview",
    width: 640,
    height: 360,
  },
  {
    url: "https://upload.wikimedia.example/aurora.jpg",
    source: "wikimedia.example",
    title: "Aurora over Tromsø",
    width: 4000,
    height: 2667,
  },
  {
    url: "https://blog.example/aurora.png",
    source: "blog.example",
    width: 1200,
    height: 800,
  },
];

describe("imagePickPrompt", () => {
  test("numbers every candidate from 1 with its site and size", () => {
    const prompt = imagePickPrompt("aurora borealis", candidates);
    expect(prompt).toContain("Query: aurora borealis");
    expect(prompt).toContain("1. site: stocksite.example · 640×360");
    expect(prompt).toContain("2. site: wikimedia.example · 4000×2667");
    expect(prompt).toContain("“Aurora over Tromsø”");
    expect(prompt).toContain("3. site: blog.example");
  });

  test("asks for JSON and warns about watermarks", () => {
    const prompt = imagePickPrompt("x", candidates);
    expect(prompt).toContain('{"index"');
    expect(prompt).toMatch(/watermarked/i);
  });

  test("missing metadata degrades instead of printing undefined", () => {
    const prompt = imagePickPrompt("thing", [{ url: "https://a.example/x" }]);
    expect(prompt).toContain("site: unknown · size unknown · untitled");
    expect(prompt).not.toContain("undefined");
  });
});

describe("parseImagePick", () => {
  test("a 1-based number becomes a 0-based index", () => {
    expect(parseImagePick('{"index": 2, "reason": "Highest resolution."}', 3)).toEqual({
      index: 1,
      reason: "Highest resolution.",
    });
  });

  test("fenced JSON is unwrapped", () => {
    const text = '```json\n{"index": 3, "reason": "Only one without a caption bar."}\n```';
    expect(parseImagePick(text, 3)).toEqual({
      index: 2,
      reason: "Only one without a caption bar.",
    });
  });

  test("an out-of-range number is rejected, not clamped to a wrong picture", () => {
    expect(parseImagePick('{"index": 9, "reason": "best"}', 3)).toBeNull();
    expect(parseImagePick('I pick image 7', 3)).toBeNull();
  });

  test("zero is read as the first image", () => {
    expect(parseImagePick('{"index": 0}', 3)?.index).toBe(0);
  });

  test("prose with a keyword still picks", () => {
    const pick = parseImagePick("The best candidate is 3 — it has no watermark.", 3);
    expect(pick?.index).toBe(2);
    expect(pick?.reason).toContain("no watermark");
  });

  test("a bare short answer is accepted", () => {
    expect(parseImagePick("2", 3)?.index).toBe(1);
    expect(parseImagePick("Image 2 — clearest", 3)?.index).toBe(1);
  });

  test("nonsense falls back to the caller's deterministic choice", () => {
    expect(parseImagePick("I cannot decide.", 3)).toBeNull();
    expect(parseImagePick("", 3)).toBeNull();
    expect(parseImagePick('{"index": 1}', 0)).toBeNull();
  });

  test("the reason is capped so one chatty model cannot fill the panel", () => {
    const long = "x".repeat(1000);
    const pick = parseImagePick(JSON.stringify({ index: 1, reason: long }), 3);
    expect(pick?.reason.length).toBeLessThanOrEqual(280);
  });
});

describe("largestImageIndex", () => {
  test("picks the biggest area when dimensions are known", () => {
    expect(largestImageIndex(candidates)).toBe(1);
  });

  test("a portrait beats a smaller landscape by area, not by width", () => {
    expect(
      largestImageIndex([
        { url: "a", width: 1000, height: 300 },
        { url: "b", width: 800, height: 800 },
      ]),
    ).toBe(1);
  });

  test("without dimensions the first candidate wins", () => {
    expect(largestImageIndex([{ url: "a" }, { url: "b" }])).toBe(0);
    expect(largestImageIndex([])).toBe(0);
  });
});

describe("web-first matching", () => {
  test("the prompt asks for a verdict only when one is needed", () => {
    expect(imagePickPrompt("a red barn", candidates)).not.toContain("\"match\"");
    expect(
      imagePickPrompt("a red barn", candidates, { requireMatch: true }),
    ).toContain("\"match\"");
  });

  test("a confirmed match comes back as a normal pick", () => {
    const pick = parseImagePick(
      '{"match": true, "index": 2, "reason": "Right subject, high resolution."}',
      3,
      { requireMatch: true },
    );
    expect(pick).toEqual({
      index: 1,
      matched: true,
      reason: "Right subject, high resolution.",
    });
  });

  test("a rejected match yields no picture rather than the closest one", () => {
    const pick = parseImagePick(
      '{"match": false, "index": 0, "reason": "All three are a different lighthouse."}',
      3,
      { requireMatch: true },
    );
    expect(pick?.index).toBe(-1);
    expect(pick?.matched).toBe(false);
    expect(pick?.reason).toContain("different lighthouse");
  });

  test("an answer with no verdict is not a match", () => {
    expect(parseImagePick("2", 3, { requireMatch: true })).toBeNull();
    expect(parseImagePick('{"index": 2}', 3, { requireMatch: true })?.index).toBe(-1);
  });
});

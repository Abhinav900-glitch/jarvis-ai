// GLiNER's HTTP surface, as a Convex action sees it: a URL that has to be
// normalised to the documented `/gliner` route, a label list, and a payload that
// may be shaped by whichever handler happens to be deployed.

import { describe, expect, test } from "bun:test";
import {
  GLINER_DEFAULT_LABELS,
  glinerEndpoint,
  glinerLabels,
  parseGlinerEntities,
} from "../gliner";

describe("glinerEndpoint", () => {
  test("the route prefix is appended once", () => {
    expect(glinerEndpoint("https://gliner.internal:8000")).toBe(
      "https://gliner.internal:8000/gliner",
    );
    expect(glinerEndpoint("https://gliner.internal:8000/")).toBe(
      "https://gliner.internal:8000/gliner",
    );
    expect(glinerEndpoint("https://gliner.internal:8000/gliner")).toBe(
      "https://gliner.internal:8000/gliner",
    );
    expect(glinerEndpoint("https://gliner.internal:8000/gliner/")).toBe(
      "https://gliner.internal:8000/gliner",
    );
  });

  test("unconfigured stays empty rather than becoming a host", () => {
    expect(glinerEndpoint(undefined)).toBe("");
    expect(glinerEndpoint("   ")).toBe("");
  });
});

describe("glinerLabels", () => {
  test("defaults cover more than the classical four types", () => {
    expect(GLINER_DEFAULT_LABELS).toContain("organization");
    expect(GLINER_DEFAULT_LABELS).toContain("technology");
  });

  test("an env list overrides and is normalised", () => {
    expect(glinerLabels(" Person , organization ,,")).toEqual([
      "person",
      "organization",
    ]);
  });

  test("an empty env list falls back to the defaults", () => {
    expect(glinerLabels("")).toEqual(GLINER_DEFAULT_LABELS);
    expect(glinerLabels(null)).toEqual(GLINER_DEFAULT_LABELS);
  });
});

describe("parseGlinerEntities", () => {
  // The documented response from `python -m gliner.serve`.
  const documented = {
    entities: [
      { start: 0, end: 4, text: "John", label: "person", score: 0.95 },
      {
        start: 15,
        end: 21,
        text: "Google",
        label: "organization",
        score: 0.92,
      },
    ],
  };

  test("the documented shape comes through with offsets", () => {
    const out = parseGlinerEntities(documented);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      text: "John",
      label: "person",
      score: 0.95,
      start: 0,
      end: 4,
    });
  });

  test("alternate wrappers and bare arrays are accepted", () => {
    expect(parseGlinerEntities([{ text: "Paris", label: "location" }])).toEqual([
      { text: "Paris", label: "location", score: 0, start: null, end: null },
    ]);
    expect(parseGlinerEntities({ results: [{ text: "NASA" }] })[0]).toMatchObject(
      { text: "NASA", label: "entity" },
    );
    // A batched call returns one object per text.
    expect(
      parseGlinerEntities([{ entities: [{ text: "A", label: "person" }] }, { entities: [{ text: "B", label: "person" }] }]),
    ).toHaveLength(2);
  });

  test("duplicates collapse and the strongest score leads", () => {
    const out = parseGlinerEntities({
      entities: [
        { text: "OSLO", label: "Location", score: 0.4 },
        { text: "oslo", label: "location", score: 0.9 },
      ],
    });
    expect(out).toHaveLength(1);
    expect(out[0].score).toBe(0.9);
  });

  test("junk yields an empty list instead of throwing", () => {
    expect(parseGlinerEntities(null)).toEqual([]);
    expect(parseGlinerEntities("nope")).toEqual([]);
    expect(parseGlinerEntities({ entities: "nope" })).toEqual([]);
    expect(parseGlinerEntities({ entities: [{ label: "person" }] })).toEqual([]);
  });
});

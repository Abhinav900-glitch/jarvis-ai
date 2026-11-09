import { describe, expect, test } from "bun:test";

import {
  LOOK_MAX,
  PROMPT_MAX,
  characterKey,
  cleanLookBrief,
  composeGroundedPrompt,
  lookSearchQuery,
  parseSubjectNames,
} from "@/lib/character-look";

const goku =
  "Son Goku: spiky black hair with a left-parted fringe, dark eyes, muscular build, orange gi over a blue undershirt, blue wristbands and boots, silver-white hair and eyes in Ultra Instinct";

describe("characterKey", () => {
  test("treats the same character written differently as one subject", () => {
    expect(characterKey("Ben 10")).toBe("ben10");
    expect(characterKey("ben-10")).toBe("ben10");
    expect(characterKey("  BEN10 ")).toBe("ben10");
  });

  test("strips accents rather than the letter", () => {
    expect(characterKey("Saitamá")).toBe("saitama");
  });
});

describe("lookSearchQuery", () => {
  test("asks for design, not plot", () => {
    const q = lookSearchQuery("Gojo Satoru");
    expect(q).toContain("Gojo Satoru");
    expect(q).toContain("appearance");
    expect(q).toContain("latest form");
  });
});

describe("parseSubjectNames", () => {
  test("reads the requested JSON shape", () => {
    expect(parseSubjectNames('{"names":["Goku","Saitama"]}')).toEqual([
      "Goku",
      "Saitama",
    ]);
  });

  test("reads a fenced object", () => {
    expect(parseSubjectNames('```json\n{"names":["Ben 10"]}\n```')).toEqual([
      "Ben 10",
    ]);
  });

  test("reads a bare array", () => {
    expect(parseSubjectNames('["Gojo"]')).toEqual(["Gojo"]);
  });

  test("recovers names from a sentence", () => {
    expect(
      parseSubjectNames("This prompt depicts Goku and Saitama."),
    ).toEqual(["Goku", "Saitama"]);
  });

  test("recovers names from a bulleted list", () => {
    expect(parseSubjectNames("- Goku\n2. Ben 10")).toEqual(["Goku", "Ben 10"]);
  });

  test("returns nothing when the prompt names no character", () => {
    expect(parseSubjectNames('{"names":[]}')).toEqual([]);
    expect(parseSubjectNames("none")).toEqual([]);
    expect(parseSubjectNames("")).toEqual([]);
  });

  test("deduplicates and caps the list", () => {
    expect(parseSubjectNames('["Goku","goku","Saitama","Gojo","Ben 10"]')).toEqual([
      "Goku",
      "Saitama",
    ]);
  });

  test("drops fragments that are not names", () => {
    expect(parseSubjectNames('["a","it","","Goku"]')).toEqual(["Goku"]);
  });
});

describe("cleanLookBrief", () => {
  test("keeps a description as one line", () => {
    expect(cleanLookBrief(goku)).toBe(goku.replace(/[.;,]+$/, ""));
  });

  test("drops a preamble and a label", () => {
    expect(cleanLookBrief(`Sure! Here you go:\n\nCharacter reference: ${goku}`)).toBe(
      goku.replace(/[.;,]+$/, ""),
    );
  });

  test("rejects a refusal instead of painting it", () => {
    expect(cleanLookBrief("I'm sorry, I can't help with copyrighted characters.")).toBe("");
  });

  test("rejects an answer too short to describe anything", () => {
    expect(cleanLookBrief("orange")).toBe("");
  });

  test("skips a reference the prompt already contains", () => {
    const base = `a poster of goku, ${goku}`;
    expect(cleanLookBrief(goku, base)).toBe("");
  });

  test("caps the length on a word boundary", () => {
    const long = Array.from({ length: 200 }, (_, i) => `detail${i}`).join(" ");
    const out = cleanLookBrief(long);
    expect(out.length).toBeLessThanOrEqual(LOOK_MAX);
    expect(long.startsWith(out)).toBe(true);
    expect(out.endsWith(" ")).toBe(false);
  });
});

describe("composeGroundedPrompt", () => {
  test("keeps the user's words first and adds the reference", () => {
    const out = composeGroundedPrompt("goku powering up in a storm", goku);
    expect(out.startsWith("goku powering up in a storm")).toBe(true);
    expect(out).toContain(goku);
    expect(out).toContain("keep this design recognisable");
  });

  test("returns the prompt untouched when there is no reference", () => {
    expect(composeGroundedPrompt("a lighthouse", "")).toBe("a lighthouse");
  });

  test("does not repeat a reference already in the prompt", () => {
    const base = `goku in a storm, ${goku}`;
    expect(composeGroundedPrompt(base, goku)).toBe(base);
  });

  test("stays inside the generator's limit", () => {
    const base = "x".repeat(800);
    const out = composeGroundedPrompt(base, goku);
    expect(out.length).toBeLessThanOrEqual(PROMPT_MAX);
  });

  test("drops the reference rather than crowding out a long prompt", () => {
    const base = "y".repeat(960);
    expect(composeGroundedPrompt(base, goku)).toBe(base);
  });

  test("collapses whitespace from a multi-line base", () => {
    expect(composeGroundedPrompt("a fox   in\nfog", "")).toBe("a fox in fog");
  });
});

// Export sizes: the crop has to be the right region of the picture, every time.
//
// A wrong crop is not a visible bug in the code — it is a face cut in half in
// someone's feed. These tests pin the geometry for the shapes the presets
// actually use, so a "simplification" that trims the wrong side fails here
// rather than in a download.

import { describe, expect, test } from "bun:test";
import {
  EXPORT_PRESETS,
  coverRect,
  exportFileName,
  type ExportPreset,
} from "../image-export";

describe("coverRect", () => {
  test("a square source for a square target is kept whole", () => {
    expect(coverRect(1024, 1024, 1080, 1080)).toEqual({
      sx: 0,
      sy: 0,
      sw: 1024,
      sh: 1024,
    });
  });

  test("a wide source is trimmed at the sides for a square target", () => {
    // 1920x1080 into 1:1 keeps the full height and takes a 1080-wide column.
    expect(coverRect(1920, 1080, 1080, 1080)).toEqual({
      sx: 420,
      sy: 0,
      sw: 1080,
      sh: 1080,
    });
  });

  test("a tall source is trimmed top and bottom for a wide target", () => {
    // 1080x1920 into 16:9 keeps the full width: 1080 / (16/9) = 607.5 → 608.
    const rect = coverRect(1080, 1920, 1920, 1080);
    expect(rect).not.toBeNull();
    expect(rect!.sw).toBe(1080);
    expect(rect!.sh).toBe(608);
    expect(rect!.sx).toBe(0);
    // Centred: the leftover 1312 pixels are split evenly above and below.
    expect(rect!.sy).toBe(Math.round((1920 - 608) / 2));
  });

  test("the crop never leaves the source", () => {
    for (const srcW of [300, 1024, 1921, 4000]) {
      for (const srcH of [200, 768, 1080, 3000]) {
        for (const preset of EXPORT_PRESETS) {
          const rect = coverRect(srcW, srcH, preset.width, preset.height);
          expect(rect).not.toBeNull();
          expect(rect!.sx).toBeGreaterThanOrEqual(0);
          expect(rect!.sy).toBeGreaterThanOrEqual(0);
          expect(rect!.sx + rect!.sw).toBeLessThanOrEqual(srcW);
          expect(rect!.sy + rect!.sh).toBeLessThanOrEqual(srcH);
        }
      }
    }
  });

  test("the crop keeps the target's aspect ratio within a pixel", () => {
    for (const preset of EXPORT_PRESETS) {
      const rect = coverRect(1234, 987, preset.width, preset.height);
      expect(rect).not.toBeNull();
      const wanted = preset.width / preset.height;
      const got = rect!.sw / rect!.sh;
      expect(Math.abs(got - wanted) / wanted).toBeLessThan(0.01);
    }
  });

  test("a source with no area has no crop", () => {
    expect(coverRect(0, 1080, 1080, 1080)).toBeNull();
    expect(coverRect(1080, 0, 1080, 1080)).toBeNull();
    expect(coverRect(1080, 1080, 0, 1080)).toBeNull();
    expect(coverRect(1080, 1080, 1080, -5)).toBeNull();
    expect(coverRect(Number.NaN, 1080, 1080, 1080)).toBeNull();
  });
});

describe("exportFileName", () => {
  const post: ExportPreset = EXPORT_PRESETS[0];

  test("names the size, the prompt and the day", () => {
    const name = exportFileName("A Lighthouse In A Storm", post, new Date(2026, 10, 17, 9, 5));
    expect(name).toBe("a-lighthouse-in-a-storm-post-1080x1080-20261117.png");
  });

  test("an unhelpful prompt still gives a usable file", () => {
    expect(exportFileName(undefined, post, new Date(2026, 0, 2))).toBe(
      "jarvis-image-post-1080x1080-20260102.png",
    );
    expect(exportFileName("!!!", post, new Date(2026, 0, 2))).toBe(
      "jarvis-image-post-1080x1080-20260102.png",
    );
  });

  test("a long prompt is cut at a word boundary, not mid-syllable", () => {
    const name = exportFileName(
      "an extremely long description of a lighthouse standing in a storm at dawn",
      post,
      new Date(2026, 10, 17),
    );
    const slug = name.replace(/-post-1080x1080-20261117\.png$/, "");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slug.endsWith("-")).toBe(false);
    expect(name).toBe(slug + "-post-1080x1080-20261117.png");
  });

  test("every preset has a distinct id and a real pixel size", () => {
    const ids = EXPORT_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const preset of EXPORT_PRESETS) {
      expect(preset.width).toBeGreaterThan(0);
      expect(preset.height).toBeGreaterThan(0);
      expect(Number.isInteger(preset.width) && Number.isInteger(preset.height)).toBe(true);
    }
  });
});

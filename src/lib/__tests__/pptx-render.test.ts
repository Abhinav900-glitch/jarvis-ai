// Tests for the PPTX package itself.
//
// A .pptx that opens is a set of relationships that all resolve: every slide
// listed in the presentation part, every part declared in [Content_Types].xml,
// every relationship pointing at a part that exists. A missing one of those is
// not a rendering glitch — PowerPoint refuses the whole file. Those invariants
// are checked here from the parts, which is faster and far more specific than
// opening the archive.

import { describe, expect, test } from "bun:test";
import { buildPptx, buildPptxParts, deckFileName, withQrImages } from "../pptx/render";
import type { DeckSpec, SlideSpec } from "../pptx/spec";

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mO4I6dBEmIY1TCqYfhqAADhFCIQOz/22gAAAABJRU5ErkJggg==";

const slide = (over: Partial<SlideSpec>): SlideSpec => ({ kind: "bullets", title: "A slide", ...over });

function deckOf(slides: SlideSpec[], over: Partial<DeckSpec> = {}): DeckSpec {
  return {
    title: "Test deck",
    theme: "obsidian",
    ratio: "16:9",
    transition: "fade",
    slides,
    ...over,
  };
}

const fileText = (files: Map<string, string | Uint8Array>, path: string): string => {
  const value = files.get(path);
  if (typeof value !== "string") throw new Error(`${path} is not a text part`);
  return value;
};

describe("package structure", () => {
  const deck = deckOf([
    slide({ kind: "cover", title: "Cover" }),
    slide({ title: "Body", notes: "Say this." }),
    slide({ kind: "chart", title: "Chart", chart: { kind: "column", categories: ["A", "B"], series: [{ name: "S", values: [1, 2] }] } }),
    slide({ kind: "image", title: "Picture", image: { dataUrl: PNG, caption: "Crimson" } }),
  ]);
  const { files } = buildPptxParts(deck);

  test("declares the parts a reader needs first", () => {
    for (const path of [
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "docProps/app.xml",
      "ppt/presentation.xml",
      "ppt/_rels/presentation.xml.rels",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/theme/theme1.xml",
      "ppt/notesMasters/notesMaster1.xml",
    ]) {
      expect(files.has(path)).toBe(true);
    }
  });

  test("writes one slide part per slide, plus its relationships", () => {
    for (let i = 1; i <= 4; i += 1) {
      expect(files.has(`ppt/slides/slide${i}.xml`)).toBe(true);
      expect(files.has(`ppt/slides/_rels/slide${i}.xml.rels`)).toBe(true);
    }
    // The presentation lists all four, in order.
    const presentation = fileText(files, "ppt/presentation.xml");
    expect(presentation.match(/<p:sldId /g)).toHaveLength(4);
    expect(presentation).toContain('cx="12192000" cy="6858000"');
  });

  test("declares every slide and chart in the content types", () => {
    const types = fileText(files, "[Content_Types].xml");
    for (let i = 1; i <= 4; i += 1) {
      expect(types).toContain(`PartName="/ppt/slides/slide${i}.xml"`);
    }
    expect(types).toContain("/ppt/charts/chart1.xml");
    // Media is covered by an extension default, not a part override.
    expect(types).toContain('Extension="png" ContentType="image/png"');
  });

  test("notes exist only for slides that have them", () => {
    expect(files.has("ppt/notesSlides/notesSlide1.xml")).toBe(true);
    expect(files.has("ppt/notesSlides/notesSlide2.xml")).toBe(false);
    const notes = fileText(files, "ppt/notesSlides/notesSlide1.xml");
    expect(notes).toContain("Say this.");
    // The notes slide points back at its slide and at the notes master.
    const rels = fileText(files, "ppt/notesSlides/_rels/notesSlide1.xml.rels");
    expect(rels).toContain("../slides/slide2.xml");
    expect(rels).toContain("../notesMasters/notesMaster1.xml");
  });

  test("a chart is a real chart part, related from its slide", () => {
    const chart = fileText(files, "ppt/charts/chart1.xml");
    expect(chart).toContain("<c:barChart>");
    expect(chart).toContain("<c:numCache>");
    expect(chart).toContain("<c:v>2</c:v>");
    const rels = fileText(files, "ppt/slides/_rels/slide3.xml.rels");
    expect(rels).toContain("../charts/chart1.xml");
  });

  test("an embedded picture is stored and referenced", () => {
    expect(files.get("ppt/media/image1.png")).toBeInstanceOf(Uint8Array);
    const rels = fileText(files, "ppt/slides/_rels/slide4.xml.rels");
    expect(rels).toContain("../media/image1.png");
    expect(fileText(files, "ppt/slides/slide4.xml")).toContain("<p:pic>");
  });

  test("every relationship target is a part that exists", () => {
    const parts = new Set(files.keys());
    for (const [path, value] of files) {
      if (!path.endsWith(".rels") || typeof value !== "string") continue;
      // `_rels/.rels` sits at the package root; every other rels part belongs to
      // the folder its source part lives in.
      const base = path === "_rels/.rels" ? "" : path.replace(/_rels\/[^/]+\.rels$/, "");
      for (const match of value.matchAll(/Target="([^"]+)"/g)) {
        const target = match[1];
        if (/^https?:/.test(target)) continue;
        const resolved = new URL(target, `https://x/${base}`).pathname.slice(1);
        expect(parts.has(resolved)).toBe(true);
      }
    }
  });
});

describe("slide markup", () => {
  test("escapes text rather than emitting raw markup", () => {
    const { files } = buildPptxParts(deckOf([slide({ title: '<A & B> "quoted"', body: ["5 > 3 & 2 < 4"] })]));
    const xml = fileText(files, "ppt/slides/slide1.xml");
    expect(xml).toContain("&lt;A &amp; B&gt; &quot;quoted&quot;");
    expect(xml).toContain("5 &gt; 3 &amp; 2 &lt; 4");
    expect(xml).not.toContain("<A & B>");
  });

  test("a transition is written, and omitted when turned off", () => {
    const faded = fileText(buildPptxParts(deckOf([slide({})])).files, "ppt/slides/slide1.xml");
    expect(faded).toContain("<p:transition");
    expect(faded).toContain("<p:fade/>");

    const none = fileText(
      buildPptxParts(deckOf([slide({})], { transition: "none" })).files,
      "ppt/slides/slide1.xml",
    );
    expect(none).not.toContain("<p:transition");
  });

  test("the 4:3 page size is honoured", () => {
    const presentation = fileText(
      buildPptxParts(deckOf([slide({})], { ratio: "4:3" })).files,
      "ppt/presentation.xml",
    );
    expect(presentation).toContain('cx="12192000" cy="9144000"');
  });

  test("a stats slide renders one card per metric", () => {
    const xml = fileText(
      buildPptxParts(
        deckOf([slide({ kind: "stats", title: "Numbers", metrics: [{ value: "12", label: "A" }, { value: "34", label: "B" }] })]),
      ).files,
      "ppt/slides/slide1.xml",
    );
    expect(xml.match(/name="Metric card"/g)).toHaveLength(2);
  });

  test("a QR slide embeds the rendered code as a picture", () => {
    const xml = fileText(
      buildPptxParts(
        deckOf([
          slide({
            kind: "qr",
            title: "Scan",
            qr: { url: "https://youtu.be/dQw4w9WgXcQ", dataUrl: PNG, label: "Scan to open" },
          }),
        ]),
      ).files,
      "ppt/slides/slide1.xml",
    );
    expect(xml).toContain("<p:pic>");
    expect(xml).toContain("Scan to open");
    expect(xml).toContain("https://youtu.be/dQw4w9WgXcQ");
  });

  test("a QR slide without a picture says so instead of drawing a fake code", () => {
    const xml = fileText(
      buildPptxParts(deckOf([slide({ kind: "qr", title: "Scan", qr: { url: "https://example.com" } })])).files,
      "ppt/slides/slide1.xml",
    );
    expect(xml).not.toContain("<p:pic>");
    expect(xml).toContain("QR unavailable");
  });

  test("a table is a graphic frame with one row per data row", () => {
    const xml = fileText(
      buildPptxParts(
        deckOf([
          slide({
            kind: "table",
            title: "Table",
            table: { columns: ["A", "B"], rows: [["1", "2"], ["3", "4"]] },
          }),
        ]),
      ).files,
      "ppt/slides/slide1.xml",
    );
    expect(xml).toContain("<a:tbl>");
    expect(xml.match(/<a:tr /g)).toHaveLength(3); // header + two rows
  });
});

describe("the archive", () => {
  test("starts with a local file header and ends with an end-of-central-directory", async () => {
    const bytes = await buildPptx(deckOf([slide({}), slide({ title: "Two", notes: "n" })]));
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(bytes.length - 22, true)).toBe(0x06054b50);
    // Two recorded entries, and [Content_Types].xml comes first.
    expect(view.getUint16(bytes.length - 12, true)).toBe(view.getUint16(bytes.length - 14, true));
    const text = new TextDecoder().decode(bytes.slice(30, 60));
    expect(text).toContain("[Content_Types].xml");
  });

  test("QR images are encoded before the archive is assembled", async () => {
    const prepared = await withQrImages(
      deckOf([slide({ kind: "qr", title: "Scan", qr: { url: "https://youtu.be/dQw4w9WgXcQ" } })]),
    );
    expect(prepared.slides[0].qr?.dataUrl?.startsWith("data:image/png;base64,")).toBe(true);
    const bytes = await buildPptx(prepared);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
  });

  test("filenames are safe and slugged", () => {
    expect(deckFileName("On-device AI: what changed?")) .toBe("on-device-ai-what-changed.pptx");
    expect(deckFileName("")).toBe("deck.pptx");
    expect(deckFileName("   ")).toBe("deck.pptx");
  });
});

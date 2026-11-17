// Reading back a .pptx.
//
// The writer and the reader are checked against each other: a deck this app
// produces is opened by the viewer, and the text that comes back has to be the
// text that went in. That catches both a broken zip reader (wrong offsets,
// missing inflate) and a broken extractor (runs glued together, empty slides)
// without a browser.

import { describe, expect, test } from "bun:test";
import { buildPptx } from "../pptx/render";
import { extractLines, readPptx, readZip } from "../pptx/read";
import type { DeckSpec, SlideSpec } from "../pptx/spec";

const slide = (over: Partial<SlideSpec>): SlideSpec => ({ kind: "bullets", title: "A slide", ...over });

function deckOf(slides: SlideSpec[]): DeckSpec {
  return { title: "Reader test deck", theme: "carbon", ratio: "16:9", transition: "fade", slides };
}

describe("extractLines", () => {
  test("paragraphs become lines, runs in a paragraph join", () => {
    const xml =
      "<p:sp><a:p><a:r><a:t>Edge </a:t></a:r><a:r><a:t>computing</a:t></a:r></a:p>" +
      "<a:p><a:r><a:t>Second </a:t></a:r><a:r><a:t>line</a:t></a:r></a:p></p:sp>";
    expect(extractLines(xml)).toEqual(["Edge computing", "Second line"]);
  });

  test("entities are decoded and empty paragraphs dropped", () => {
    const xml =
      "<a:p><a:t>R&amp;D &lt;team&gt; &quot;quoted&quot;</a:t></a:p>" +
      "<a:p><a:t>   </a:t></a:p>" +
      "<a:p><a:t>&#8212; dash</a:t></a:p>";
    expect(extractLines(xml)).toEqual(['R&D <team> "quoted"', "— dash"]);
  });

  test("text outside a run is ignored, so markup never leaks into a slide", () => {
    const xml = '<a:rPr lang="en-US"/><a:p><a:t>only this</a:t></a:p>';
    expect(extractLines(xml)).toEqual(["only this"]);
  });
});

describe("readPptx", () => {
  const slides: SlideSpec[] = [
    slide({ kind: "cover", title: "Quarterly Review", subtitle: "What changed" }),
    slide({ title: "Where we are", body: ["Revenue up", "Costs flat"] }),
    slide({
      kind: "stats",
      title: "Numbers",
      metrics: [
        { value: "12%", label: "Growth" },
        { value: "3x", label: "Speed" },
      ],
    }),
    slide({ kind: "table", title: "Plan", table: { columns: ["A", "B"], rows: [["one", "two"]] } }),
  ];

  test("the zip reader lists the parts the writer produced", async () => {
    const bytes = await buildPptx(deckOf(slides));
    const parts = await readZip(bytes);
    expect(parts.has("ppt/presentation.xml")).toBe(true);
    expect(parts.has("ppt/slides/slide1.xml")).toBe(true);
    expect(parts.has("[Content_Types].xml")).toBe(true);
  });

  test("every slide comes back, in order, with its text", async () => {
    const view = await readPptx(await buildPptx(deckOf(slides)));
    expect(view.slides).toHaveLength(slides.length);
    expect(view.slides.map((s) => s.number)).toEqual([1, 2, 3, 4]);
    expect(view.slides[0].lines).toContain("Quarterly Review");
    expect(view.slides[0].lines).toContain("What changed");
    expect(view.slides[1].lines).toEqual(expect.arrayContaining(["Where we are", "Revenue up", "Costs flat"]));
    expect(view.slides[2].lines).toEqual(expect.arrayContaining(["12%", "Growth", "3x", "Speed"]));
    expect(view.slides[3].lines).toEqual(expect.arrayContaining(["one", "two"]));
  });

  test("titles are the first line, and no slide is empty", async () => {
    const view = await readPptx(await buildPptx(deckOf(slides)));
    expect(view.slides[0].title).toBe("Quarterly Review");
    expect(view.slides[1].title).toBe("Where we are");
    for (const entry of view.slides) {
      expect(entry.lines.length).toBeGreaterThan(0);
      expect(entry.error).toBeUndefined();
    }
  });

  test("the slide size is read from the package, in inches", async () => {
    const view = await readPptx(await buildPptx(deckOf(slides)));
    expect(view.width).toBeGreaterThan(13);
    expect(view.width).toBeLessThan(13.4);
    expect(view.height).toBeGreaterThan(7.4);
    expect(view.height).toBeLessThan(7.6);
    expect(Math.abs(view.width / view.height - 16 / 9)).toBeLessThan(0.01);
  });

  test("images on a slide are read as bytes", async () => {
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mO4I6dBEmIY1TCqYfhqAADhFCIQOz/22gAAAABJRU5ErkJggg==";
    const bytes = await buildPptx(
      deckOf([slide({ kind: "image", title: "Picture", image: { dataUrl: png, caption: "Swatch" } })]),
    );
    const view = await readPptx(bytes);
    expect(view.slides[0].images.length).toBeGreaterThan(0);
    const image = view.slides[0].images[0];
    expect(image.mime).toBe("image/png");
    expect(image.bytes.length).toBeGreaterThan(50);
    // PNG magic, so this is really the picture and not a rels file.
    expect([...image.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  test("a file that is not a zip is rejected with a sentence, not a crash", async () => {
    await expect(readPptx(new TextEncoder().encode("this is not a pptx"))).rejects.toThrow(
      /isn't a \.pptx/,
    );
  });
});

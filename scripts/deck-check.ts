// Temporary end-to-end check for the PPTX writer. Deleted once verified.
import { buildPptx, buildPptxParts } from "../src/lib/pptx/render";
import type { DeckSpec, SlideSpec } from "../src/lib/pptx/spec";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR42mO4I6dBEmIY1TCqYfhqAADhFCIQOz/22gAAAABJRU5ErkJggg==";

const slides: SlideSpec[] = [
  { kind: "cover", title: "Building decks without python-pptx", subtitle: "A native OOXML pipeline in the browser", kicker: "Deck engine", notes: "Open with the constraint." },
  { kind: "agenda", title: "What this deck covers", body: ["The problem", "The pipeline", "What the file contains", "What is missing"] },
  { kind: "section", title: "The pipeline", subtitle: "Spec → OOXML → zip", notes: "Transition." },
  { kind: "bullets", title: "Everything is a part", kicker: "Pipeline", body: ["**Slides** are XML under ppt/slides", "`[Content_Types].xml` decides what each part is", "Charts live in ppt/charts and are related from the slide"], subtitle: "And the zip is the only binary format involved." },
  { kind: "columns", title: "Two readings of the same brief", columns: [{ heading: "Native writer", points: ["No dependency", "Runs offline", "Full layout control"] }, { heading: "Hosted providers", points: ["Instant themes", "Server-side render", "Needs a key"] }] },
  { kind: "quote", title: "Quote", quote: { text: "A file format is a contract, and PowerPoint is strict about it.", attribution: "Someone who debugged a zip" } },
  { kind: "stats", title: "By the numbers", metrics: [{ value: "12", label: "Slide layouts", note: "Illustrative" }, { value: "5", label: "Chart kinds", note: "Illustrative" }, { value: "0", label: "Dependencies" }] },
  { kind: "timeline", title: "How it gets built", steps: [{ when: "Now", title: "Outline" }, { when: "30 days", title: "Content" }, { when: "90 days", title: "Notes" }, { when: "Q+1", title: "Export" }] },
  { kind: "table", title: "Capability check", table: { columns: ["Capability", "Status", "Notes"], rows: [["Text", "Done", "Rich runs"], ["Tables", "Done", "Styled cells"], ["Charts", "Done", "Native parts"]], caption: "Illustrative table." } },
  { kind: "chart", title: "Adoption over four quarters", chart: { kind: "column", categories: ["Q1", "Q2", "Q3", "Q4"], series: [{ name: "Decks", values: [12, 28, 41, 63] }, { name: "Exports", values: [8, 19, 33, 52] }], caption: "Illustrative trend." } },
  { kind: "chart", title: "Mix", chart: { kind: "pie", categories: ["Native", "Hosted"], series: [{ name: "Share", values: [7, 3] }] } },
  { kind: "image", title: "With a picture", image: { dataUrl: `data:image/png;base64,${png}`, caption: "A crimson square." } },
  { kind: "image", title: "Without one", image: { caption: "Placeholder art." } },
  { kind: "closing", title: "Thank you", subtitle: "Questions, and one file to download." },
];

const deck: DeckSpec = {
  title: "Building decks without python-pptx",
  subtitle: "A native OOXML pipeline",
  author: "Jarvis",
  theme: "obsidian",
  ratio: "16:9",
  transition: "fade",
  slides,
};

const parts = buildPptxParts(deck);
console.log("parts:", parts.files.size);
for (const path of ["[Content_Types].xml", "ppt/presentation.xml", "ppt/slides/slide1.xml", "ppt/charts/chart1.xml"]) {
  console.log(path, parts.files.has(path) ? "ok" : "MISSING");
}
const bytes = await buildPptx(deck);
await Bun.write("/tmp/deck-check.pptx", bytes);
console.log("bytes:", bytes.length);

// A second ratio, to prove the page size is honoured.
const wide = await buildPptx({ ...deck, ratio: "4:3", theme: "ivory", transition: "wipe", slides: slides.slice(0, 4) });
await Bun.write("/tmp/deck-check-43.pptx", wide);
console.log("4:3 bytes:", wide.length);

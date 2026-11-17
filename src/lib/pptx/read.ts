// ---------------------------------------------------------------------------
// Reading a .pptx.
//
// The writer next door is native OOXML; this is the other direction, so a deck
// someone already has can be looked at inside Jarvis without PowerPoint, a
// converter, or a network call. Everything happens on the bytes in the tab.
//
// A .pptx is a ZIP. There is no unzip dependency here for the same reason the
// writer has no zip one: the container is a header, a central directory, and
// per-entry deflate — about a hundred lines of binary reading once the checksum
// table already exists. Decompression uses `DecompressionStream("deflate-raw")`,
// which is the same format the writer produces.
//
// What this intentionally does not do: render fonts, shapes, animations or
// SmartArt faithfully. It extracts the slide order, the text in reading order,
// the images and the slide size — enough to read a deck and check it, which is
// what a viewer in a chat app is for.
// ---------------------------------------------------------------------------

export interface SlideImage {
  /** Media part name, e.g. `image2.png`. */
  name: string;
  /** Bytes straight out of the package, for a blob URL. */
  bytes: Uint8Array;
  /** `image/png`, `image/jpeg`, … from the extension. */
  mime: string;
}

export interface SlideView {
  /** 1-based, as PowerPoint numbers them. */
  number: number;
  /** The part name, e.g. `ppt/slides/slide3.xml`. */
  part: string;
  /** Paragraph text in reading order, empty paragraphs dropped. */
  lines: string[];
  /** First line, which is the title for every layout this app writes. */
  title: string;
  images: SlideImage[];
  /** Set when the slide's part could not be parsed; the rest still renders. */
  error?: string;
}

export interface LoadedDeck {
  deck: DeckView;
  /** Object URLs for each slide's images, in the same order as its images. */
  images: string[][];
}

export interface DeckView {
  slides: SlideView[];
  /** Slide size in inches, from `presentation.xml`. */
  width: number;
  height: number;
  /** Decks often carry a title in docProps; null when it is absent. */
  title: string | null;
}

const EMU_PER_INCH = 914_400;

/** The end-of-central-directory record, scanned back from the tail. */
function findEocd(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const earliest = Math.max(0, bytes.length - 65_557);
  for (let at = bytes.length - 22; at >= earliest; at -= 1) {
    if (view.getUint32(at, true) === 0x06054b50) return at;
  }
  return -1;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const Ctor = (globalThis as { DecompressionStream?: typeof DecompressionStream })
    .DecompressionStream;
  if (!Ctor) throw new Error("This browser can't decompress a .pptx (no DecompressionStream).");
  // A fresh buffer: a view can span a SharedArrayBuffer, which the stream
  // constructor does not accept.
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const stream = new Ctor("deflate-raw");
  const writer = stream.writable.getWriter();
  const collected = new Response(stream.readable).arrayBuffer();
  await writer.write(copy);
  await writer.close();
  return new Uint8Array(await collected);
}

/**
 * Every entry in the archive, keyed by part name.
 *
 * Unreadable entries are skipped rather than failing the whole deck: a file
 * with one damaged media part should still show its text.
 */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const eocd = findEocd(bytes);
  if (eocd < 0) throw new Error("That file isn't a .pptx — it isn't a zip archive at all.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  const skip = (k: number) => {
    at += k;
  };

  for (let index = 0; index < count; index += 1) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localOffset = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    skip(46 + nameLength + extraLength + commentLength);

    // A directory entry has no data; the local header still has to be walked
    // to keep the offset arithmetic honest for anything after it.
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.subarray(dataStart, dataStart + compressedSize);
    if (name.endsWith("/")) continue;

    try {
      if (method === 0) out.set(name, data);
      else if (method === 8) out.set(name, await inflateRaw(data));
      // Anything else (bzip2, LZMA) is a rarity PowerPoint never writes.
    } catch {
      // Skip the part; the caller sees a missing part, not a thrown deck.
    }
  }
  return out;
}

/** XML text with the five predefined entities and numeric escapes decoded. */
function decodeXml(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

/**
 * Paragraph text in reading order.
 *
 * Every run is `<a:t>`, every paragraph ends at `</a:p>`, and a table cell adds
 * no newline of its own — so one pass that collects runs and breaks on `</a:p>`
 * reproduces what a person reading the slide would list first: the title, then
 * each body line.
 */
export function extractLines(xml: string): string[] {
  const lines: string[] = [];
  let current = "";
  let inRun = false;

  let at = 0;
  while (at < xml.length) {
    if (!inRun && xml.startsWith("<a:t>", at)) {
      inRun = true;
      at += 5;
      continue;
    }
    if (inRun && xml.startsWith("</a:t>", at)) {
      inRun = false;
      at += 6;
      continue;
    }
    if (xml.startsWith("</a:p>", at)) {
      const text = decodeXml(current).replace(/\s+/g, " ").trim();
      if (text) lines.push(text);
      current = "";
      at += 6;
      continue;
    }
    if (xml[at] === "<" && !inRun) {
      // Skip any other tag wholesale rather than trying to understand it.
      const close = xml.indexOf(">", at);
      if (close === -1) break;
      at = close + 1;
      continue;
    }
    current += xml[at];
    at += 1;
  }

  const tail = decodeXml(current).replace(/\s+/g, " ").trim();
  if (tail) lines.push(tail);
  return lines;
}

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  webp: "image/webp",
  tiff: "image/tiff",
  emf: "image/emf",
  wmf: "image/wmf",
};

/**
 * The slide's title, from its lines.
 *
 * The first line is not always it: layouts this app writes (and most corporate
 * templates) put a small all-caps eyebrow — "JARVIS DECK STUDIO" — above the
 * real heading, and a viewer that calls that the title is wrong on every cover.
 * So the first line with ordinary casing wins, and only a slide that has none
 * falls back to its first line.
 */
export function pickTitle(lines: string[]): string {
  const heading = lines.find((line) => /[a-z]/.test(line) && line.length > 1);
  return heading ?? lines[0] ?? "";
}

/** Slide part names in numeric order — `slide10` sorts after `slide9`. */
function slideNumber(part: string): number {
  const match = /slide(\d+)\.xml$/.exec(part);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

function slideSize(parts: Map<string, Uint8Array>): { width: number; height: number } {
  const xml = parts.get("ppt/presentation.xml");
  if (!xml) return { width: 13.333, height: 7.5 };
  const text = new TextDecoder().decode(xml);
  const match = /<p:sldSz[^>]*cx="(\d+)"[^>]*cy="(\d+)"/.exec(text);
  if (!match) return { width: 13.333, height: 7.5 };
  return {
    width: Number(match[1]) / EMU_PER_INCH,
    height: Number(match[2]) / EMU_PER_INCH,
  };
}

function deckTitle(parts: Map<string, Uint8Array>): string | null {
  const core = parts.get("docProps/core.xml");
  if (!core) return null;
  const text = new TextDecoder().decode(core);
  const match = /<dc:title>([\s\S]*?)<\/dc:title>/.exec(text);
  const title = match ? decodeXml(match[1]).trim() : "";
  return title || null;
}

/** Image parts a slide points at, resolved through its relationships file. */
function slideImages(
  parts: Map<string, Uint8Array>,
  slidePart: string,
  decoder: TextDecoder,
): SlideImage[] {
  const relsPart = slidePart.replace(/slides\/(slide\d+\.xml)$/, "slides/_rels/$1.rels");
  const rels = parts.get(relsPart);
  if (!rels) return [];
  const text = decoder.decode(rels);
  const images: SlideImage[] = [];

  for (const match of text.matchAll(/Target="([^"]+)"/g)) {
    const target = match[1];
    if (!/media\//.test(target)) continue;
    const name = target.split("/").pop() ?? "";
    const part = "ppt/" + target.replace(/^\.\.\//, "");
    const bytes = parts.get(part);
    if (!bytes) continue;
    const ext = (name.split(".").pop() ?? "").toLowerCase();
    images.push({ name, bytes, mime: IMAGE_MIME[ext] ?? "application/octet-stream" });
  }
  return images;
}

/**
 * Read a .pptx into slides.
 *
 * A slide part that fails to parse becomes a slide with an `error` and no
 * lines, so a file with one odd slide still opens instead of throwing.
 */
export async function readPptx(data: ArrayBuffer | Uint8Array): Promise<DeckView> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const parts = await readZip(bytes);
  const decoder = new TextDecoder();

  const slideParts = [...parts.keys()]
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => slideNumber(a) - slideNumber(b));

  if (slideParts.length === 0) {
    throw new Error(
      "That .pptx has no slides this viewer can read. If it is a template, it may have an empty deck.",
    );
  }

  const slides: SlideView[] = slideParts.map((part, index) => {
    const number = slideNumber(part) === Number.MAX_SAFE_INTEGER ? index + 1 : slideNumber(part);
    try {
      const xml = decoder.decode(parts.get(part) ?? new Uint8Array());
      const lines = extractLines(xml);
      return {
        number: index + 1,
        part,
        lines,
        title: pickTitle(lines) || `Slide ${number}`,
        images: slideImages(parts, part, decoder),
      };
    } catch (err) {
      return {
        number: index + 1,
        part,
        lines: [],
        title: `Slide ${number}`,
        images: [],
        error: err instanceof Error ? err.message : "This slide could not be read.",
      };
    }
  });

  const { width, height } = slideSize(parts);
  return { slides, width, height, title: deckTitle(parts) };
}

/** A blob URL for one image part, ready for an `<img src>`. */
function objectUrl(image: SlideImage): string {
  const buffer = new ArrayBuffer(image.bytes.byteLength);
  new Uint8Array(buffer).set(image.bytes);
  return URL.createObjectURL(new Blob([buffer], { type: image.mime }));
}

/**
 * Read a deck and turn its images into blob URLs.
 *
 * Split from `readPptx` so the URLs are created in the handler that opens the
 * file rather than during a render. Callers must `disposeDeck` when they are
 * done, or the blobs stay alive for the life of the tab.
 */
export async function openDeck(bytes: Uint8Array): Promise<LoadedDeck> {
  const deck = await readPptx(bytes);
  const images = deck.slides.map((slide) =>
    slide.images
      .filter((image) => image.mime.startsWith("image/"))
      .map((image) => objectUrl(image)),
  );
  return { deck, images };
}

/** Release the object URLs `openDeck` created. Safe to call twice. */
export function disposeDeck(loaded: LoadedDeck): void {
  for (const list of loaded.images) {
    for (const url of list) URL.revokeObjectURL(url);
  }
}

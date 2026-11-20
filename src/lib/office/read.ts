// ---------------------------------------------------------------------------
// Reading Office files that are not presentations: .xlsx and .docx, plus CSV.
//
// All three are the same shape of promise as the slide viewer next door — a
// file someone already has, opened inside Jarvis with no upload, no converter
// and no network. .xlsx and .docx are zips of XML, so they ride on the zip
// reader the .pptx viewer already uses; only the XML that matters differs.
//
// What is extracted is what a person reads first:
//   • sheets — cell values by position, with shared strings resolved, so a
//     header row lines up under the right columns instead of collapsing left;
//   • documents — paragraphs and tables, in document order;
//   • csv     — rows, quote-aware.
//
// Formatting, merged cells, charts, formulas and styles are not reproduced.
// A formula's *cached* result is shown, which is what a viewer should show.
// ---------------------------------------------------------------------------

import { disposeDeck, openDeck, readZip, type LoadedDeck } from "../pptx/read";

export interface SheetTable {
  name: string;
  /** Rows of cell text, padded so every row has the same width. */
  rows: string[][];
}

export interface DocumentTable {
  rows: string[][];
}

export interface DocumentView {
  paragraphs: string[];
  /** Tables in document order, each a grid of cell text. */
  tables: DocumentTable[];
}

const decoder = new TextDecoder();

/** XML text with entities decoded — Office escapes text the same way OOXML does. */
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
 * Every text node inside a fragment, joined — rich text runs are still one
 * string.
 *
 * The namespace prefix matters: Word writes `<w:t>` and Excel writes `<t>`, so a
 * matcher that insists on the bare tag reads every .docx as an empty document.
 */
function textOf(fragment: string): string {
  let out = "";
  for (const match of fragment.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) {
    out += match[1];
  }
  return decodeXml(out).replace(/\s+/g, " ").trim();
}

/** `A1` → 0, `AB12` → 27. Column letters only. */
export function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/i.exec(ref)?.[1] ?? "";
  let index = 0;
  for (const char of letters.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** `Sheet1!$A$1:$C$9` → the part before the `!`, for error messages and titles. */
function sheetNameOf(ref: string): string {
  return ref.includes("!") ? ref.slice(0, ref.indexOf("!")) : ref;
}

/**
 * The shared string table.
 *
 * Cells of type `s` hold an index into this table rather than text, which is
 * why a naive reader shows `0, 1, 2` for the first three cells of every sheet.
 */
export function parseSharedStrings(xml: string): string[] {
  const strings: string[] = [];
  for (const match of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
    strings.push(textOf(match[1]));
  }
  return strings;
}

interface WorkbookSheet {
  name: string;
  /** Zip part holding the sheet's cells. */
  part: string;
}

/** Sheet names in workbook order, each mapped to the part its r:id points at. */
export function parseWorkbook(workbookXml: string, relsXml: string): WorkbookSheet[] {
  const targets = new Map<string, string>();
  for (const match of relsXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const tag = match[0];
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    if (!id || !target) continue;
    // Targets are relative to `xl/`, and a few producers write `/xl/…`.
    const clean = target.replace(/^\/?xl\//, "").replace(/^\.\//, "");
    targets.set(id, `xl/${clean}`);
  }

  const sheets: WorkbookSheet[] = [];
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*>/g)) {
    const tag = match[0];
    const name = decodeXml(/\bname="([^"]*)"/.exec(tag)?.[1] ?? "");
    const rid = /\br:id="([^"]+)"/.exec(tag)?.[1];
    const part = rid ? targets.get(rid) : undefined;
    if (name && part) sheets.push({ name, part });
  }
  return sheets;
}

/** The cells of one worksheet, laid out by their real column positions. */
export function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  let widest = 0;

  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2] ?? "";
      const ref = /\br="([A-Z]+\d+)"/i.exec(attrs)?.[1] ?? "";
      const type = /\bt="([^"]+)"/.exec(attrs)?.[1] ?? "";
      const column = ref ? columnIndex(ref) : cells.length;

      let value = "";
      if (type === "s") {
        const index = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "-1");
        value = shared[index] ?? "";
      } else if (type === "inlineStr") {
        value = textOf(body);
      } else if (type === "b") {
        value = /<v>1<\/v>/.test(body) ? "TRUE" : "FALSE";
      } else {
        // Numbers, dates as their serial, and cached formula results.
        value = decodeXml(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? "").trim();
        if (!value) value = textOf(body);
      }

      while (cells.length < column) cells.push("");
      cells[column] = value;
    }
    widest = Math.max(widest, cells.length);
    rows.push(cells);
  }

  // Trailing empty cells are common in real sheets; keeping the grid rectangular
  // is what lets the viewer render a table without special cases.
  for (const row of rows) {
    while (row.length < widest) row.push("");
  }
  return rows;
}

/** Read every sheet of a .xlsx. */
export async function readXlsx(bytes: Uint8Array): Promise<SheetTable[]> {
  const parts = await readZip(bytes);
  const workbook = parts.get("xl/workbook.xml");
  if (!workbook) throw new Error("That .xlsx has no workbook part — it may not be a spreadsheet.");

  const rels = parts.get("xl/_rels/workbook.xml.rels");
  const sheets = parseWorkbook(
    decoder.decode(workbook),
    rels ? decoder.decode(rels) : "",
  );
  const sharedParts = parts.get("xl/sharedStrings.xml");
  const shared = sharedParts ? parseSharedStrings(decoder.decode(sharedParts)) : [];

  const tables: SheetTable[] = [];
  for (const sheet of sheets) {
    const xml = parts.get(sheet.part);
    if (!xml) continue;
    tables.push({ name: sheet.name, rows: parseSheet(decoder.decode(xml), shared) });
  }
  if (tables.length === 0) throw new Error("That .xlsx has no readable sheets.");
  return tables;
}

/**
 * Paragraphs and tables of a .docx, in document order.
 *
 * Tables are lifted out first because a paragraph inside a cell is not a body
 * paragraph: keeping them separate is the difference between "the document in
 * reading order" and "every string in the file, jumbled".
 */
export function parseDocument(xml: string): DocumentView {
  const tables: DocumentTable[] = [];
  let rest = xml;

  for (;;) {
    const start = rest.indexOf("<w:tbl>");
    if (start === -1) break;
    const end = rest.indexOf("</w:tbl>", start);
    if (end === -1) break;
    const tableXml = rest.slice(start, end + 8);
    rest = rest.slice(0, start) + rest.slice(end + 8);

    const rows: string[][] = [];
    for (const rowMatch of tableXml.matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)) {
      const cells: string[] = [];
      for (const cellMatch of rowMatch[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)) {
        const paragraphs = [...cellMatch[1].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
          .map((match) => textOf(match[1]))
          .filter(Boolean);
        cells.push(paragraphs.join(" "));
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) tables.push({ rows });
  }

  const paragraphs = [...rest.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)]
    .map((match) => textOf(match[1]))
    .filter(Boolean);

  return { paragraphs, tables };
}

/** Read a .docx. */
export async function readDocx(bytes: Uint8Array): Promise<DocumentView> {
  const parts = await readZip(bytes);
  const document = parts.get("word/document.xml");
  if (!document) throw new Error("That .docx has no document part — it may not be a Word file.");
  const view = parseDocument(decoder.decode(document));
  if (view.paragraphs.length === 0 && view.tables.length === 0) {
    throw new Error("That .docx is empty — there is no text to show.");
  }
  return view;
}

/**
 * Split CSV/TSV text into rows.
 *
 * Quote-aware because a spreadsheet export routinely contains a comma inside a
 * quoted cell, and splitting on the delimiter alone turns one row into three.
 * `""` inside a quoted field is a literal quote.
 */
export function readCsv(text: string, delimiter = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  // A byte-order mark would otherwise become part of the first header cell.
  const body = text.replace(/^\uFEFF/, "");

  for (let at = 0; at < body.length; at += 1) {
    const char = body[at];
    if (quoted) {
      if (char === '"') {
        if (body[at + 1] === '"') {
          field += '"';
          at += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      quoted = true;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && body[at + 1] === "\n") at += 1;
      row.push(field);
      field = "";
      // A blank line is not a row.
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }

  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

/** Guess the delimiter from the first line: tab first, then semicolon, then comma. */
export function guessDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (char: string) => firstLine.split(char).length - 1;
  if (count("\t") >= count(",") && count("\t") > 0) return "\t";
  if (count(";") > count(",")) return ";";
  return ",";
}

export type OfficeKind = "slides" | "sheet" | "doc" | "csv" | "pdf" | "image";

/** Image extensions the viewer will draw, and the type a blob URL needs. */
const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
};

/** The image type from the name, then from the first bytes, then a safe default. */
function imageMimeOf(name: string, bytes: Uint8Array): string {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? "";
  if (IMAGE_MIME[ext]) return IMAGE_MIME[ext];
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  return "image/*";
}

/** What a filename or a zip's parts say this file is. */
export function detectKind(name: string, parts: Map<string, Uint8Array> | null): OfficeKind | null {
  const lower = name.toLowerCase();
  if (lower.endsWith(".pptx")) return "slides";
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) return "sheet";
  if (lower.endsWith(".docx")) return "doc";
  if (lower.endsWith(".csv") || lower.endsWith(".tsv")) return "csv";
  if (lower.endsWith(".pdf")) return "pdf";
  const ext = /^.+?\.([a-z0-9]+)$/.exec(lower)?.[1] ?? "";
  if (IMAGE_MIME[ext]) return "image";
  if (!parts) return null;
  if (parts.has("ppt/presentation.xml")) return "slides";
  if (parts.has("xl/workbook.xml")) return "sheet";
  if (parts.has("word/document.xml")) return "doc";
  return null;
}

export { sheetNameOf };

/** One file, already read, in whichever shape its type produced. */
export type OpenedFile =
  | { kind: "slides"; name: string; deck: LoadedDeck }
  | { kind: "sheet"; name: string; sheets: SheetTable[] }
  | { kind: "doc"; name: string; view: DocumentView }
  | { kind: "csv"; name: string; rows: string[][]; delimiter: string }
  /**
   * A PDF is not parsed: the browser's own viewer draws it from a blob URL.
   * That is the honest ceiling without adding a PDF engine — pages, text and
   * links are real, but nothing here can search or extract them.
   */
  | { kind: "pdf"; name: string; url: string }
  /** An image is drawn as-is from a blob URL, at whatever its own size is. */
  | { kind: "image"; name: string; url: string };

/**
 * Read any supported file by name and bytes.
 *
 * The viewers call this from the handler that opens a file — never during a
 * render — because the slide branch creates blob URLs that need a home.
 */
export async function openOfficeFile(name: string, bytes: Uint8Array): Promise<OpenedFile> {
  const kind = detectKind(name, null) ?? (await detectKindFromBytes(bytes));
  if (kind === "slides") return { kind, name, deck: await openDeck(bytes) };
  if (kind === "sheet") return { kind, name, sheets: await readXlsx(bytes) };
  if (kind === "doc") return { kind, name, view: await readDocx(bytes) };
  if (kind === "csv") {
    const text = new TextDecoder().decode(bytes);
    const delimiter = guessDelimiter(text);
    return { kind, name, rows: readCsv(text, delimiter), delimiter };
  }
  if (kind === "pdf") {
    // Owned by this function, released by `disposeOpenedFile` — the same rule
    // as the slide branch's image URLs.
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: "application/pdf" }));
    return { kind, name, url };
  }
  if (kind === "image") {
    const url = URL.createObjectURL(new Blob([bytes.slice()], { type: imageMimeOf(name, bytes) }));
    return { kind, name, url };
  }
  throw new Error(
    "That file type isn't supported here. Open a .pdf, .png, .jpg, .webp, .pptx, .xlsx, .docx, .csv or .tsv.",
  );
}

/** Zip-backed types are identified by the part that only they contain. */
async function detectKindFromBytes(bytes: Uint8Array): Promise<OfficeKind | null> {
  // A PDF has no zip parts and its signature is the first five bytes, so it is
  // checked before the zip attempt: a reader that only looked at extensions
  // would refuse a file the browser can display perfectly.
  const head = new TextDecoder().decode(bytes.slice(0, 5));
  if (head === "%PDF-") return "pdf";
  // The same argument for images with the wrong (or no) extension. Only the
  // four signatures worth checking are here; the rest rely on the name.
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image";
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image";
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return "image";
  if (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image";
  }
  try {
    const parts = await readZip(bytes);
    return detectKind("", parts);
  } catch {
    return null;
  }
}

/** Release anything an opened file allocated. Safe on any kind. */
export function disposeOpenedFile(file: OpenedFile): void {
  if (file.kind === "slides") disposeDeck(file.deck);
  if (file.kind === "pdf" || file.kind === "image") URL.revokeObjectURL(file.url);
}

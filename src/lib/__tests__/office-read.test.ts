// Reading .xlsx, .docx and CSV.
//
// The packages here are the smallest real ones: a zip with the parts Excel and
// Word actually write. Building them by hand keeps the tests honest about the
// details that break naive readers — shared-string indices, cells that skip a
// column, `w:tr`/`w:tc` nesting, quoted commas.

import { describe, expect, test } from "bun:test";
import { zipFiles } from "../pptx/zip";
import {
  columnIndex,
  detectKind,
  disposeOpenedFile,
  guessDelimiter,
  openOfficeFile,
  parseDocument,
  parseSharedStrings,
  parseSheet,
  parseWorkbook,
  readCsv,
  readDocx,
  readXlsx,
} from "../office/read";

const encoder = new TextEncoder();

async function pack(parts: Record<string, string>): Promise<Uint8Array> {
  return await zipFiles(
    Object.entries(parts).map(([path, text]) => ({ path, data: encoder.encode(text) })),
  );
}

describe("columnIndex", () => {
  test("letters map to zero-based columns", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("B2")).toBe(1);
    expect(columnIndex("Z9")).toBe(25);
    expect(columnIndex("AA1")).toBe(26);
    expect(columnIndex("AB12")).toBe(27);
    expect(columnIndex("")).toBe(-1);
  });
});

describe("xlsx", () => {
  const sharedStrings =
    '<?xml version="1.0"?><sst count="3"><si><t>Name</t></si>' +
    "<si><r><t>Rev</t></r><r><t>enue</t></r></si><si><t>Note &amp; more</t></si></sst>";

  const workbook =
    '<workbook><sheets><sheet name="Summary" sheetId="1" r:id="rId1"/>' +
    '<sheet name="Detail" sheetId="2" r:id="rId2"/></sheets></workbook>';
  const rels =
    '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>';

  const sheet1 =
    "<worksheet><sheetData>" +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>' +
    '<row r="2"><c r="A2" t="inlineStr"><is><t>Widgets</t></is></c>' +
    '<c r="B2"><v>42</v></c><c r="C2"><f>B2*2</f><v>84</v></c></row>' +
    '<row r="3"><c r="A3" t="s"><v>2</v></c><c r="B3" t="b"><v>1</v></c></row>' +
    "</sheetData></worksheet>";
  const sheet2 = '<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>';

  test("shared strings, including rich-text runs and entities", () => {
    expect(parseSharedStrings(sharedStrings)).toEqual(["Name", "Revenue", "Note & more"]);
  });

  test("sheet names map to their parts through the relationship ids", () => {
    expect(parseWorkbook(workbook, rels)).toEqual([
      { name: "Summary", part: "xl/worksheets/sheet1.xml" },
      { name: "Detail", part: "xl/worksheets/sheet2.xml" },
    ]);
  });

  test("cells land in their real columns, formulas show their cached value", () => {
    const rows = parseSheet(sheet1, ["Name", "Revenue", "Note & more"]);
    expect(rows[0]).toEqual(["Name", "", "Revenue"]);
    expect(rows[1]).toEqual(["Widgets", "42", "84"]);
    // Padded to the widest row, so the viewer can draw a plain grid.
    expect(rows[2]).toEqual(["Note & more", "TRUE", ""]);
    expect(rows.every((row) => row.length === 3)).toBe(true);
  });

  test("a whole workbook reads back with both sheets", async () => {
    const bytes = await pack({
      "xl/workbook.xml": workbook,
      "xl/_rels/workbook.xml.rels": rels,
      "xl/sharedStrings.xml": sharedStrings,
      "xl/worksheets/sheet1.xml": sheet1,
      "xl/worksheets/sheet2.xml": sheet2,
    });
    const sheets = await readXlsx(bytes);
    expect(sheets.map((s) => s.name)).toEqual(["Summary", "Detail"]);
    expect(sheets[0].rows[1][0]).toBe("Widgets");
    expect(sheets[1].rows).toEqual([["7"]]);
  });

  test("a zip that is not a workbook is rejected", async () => {
    const bytes = await pack({ "word/document.xml": "<w:document/>" });
    await expect(readXlsx(bytes)).rejects.toThrow(/no workbook part/);
  });
});

describe("docx", () => {
  const document =
    '<w:document><w:body>' +
    "<w:p><w:r><w:t>Quarterly </w:t></w:r><w:r><w:t>review</w:t></w:r></w:p>" +
    "<w:p><w:r><w:t>Second paragraph &amp; a note</w:t></w:r></w:p>" +
    "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Region</w:t></w:r></w:p></w:tc>" +
    "<w:tc><w:p><w:r><w:t>Sales</w:t></w:r></w:p></w:tc></w:tr>" +
    "<w:tr><w:tc><w:p><w:r><w:t>North</w:t></w:r></w:p></w:tc>" +
    "<w:tc><w:p><w:r><w:t>1,240</w:t></w:r></w:p></w:tc></w:tr></w:tbl>" +
    "<w:p><w:r><w:t>Closing line</w:t></w:r></w:p>" +
    "</w:body></w:document>";

  test("paragraphs and tables are separated, in document order", () => {
    const view = parseDocument(document);
    expect(view.paragraphs).toEqual(["Quarterly review", "Second paragraph & a note", "Closing line"]);
    expect(view.tables).toHaveLength(1);
    expect(view.tables[0].rows).toEqual([
      ["Region", "Sales"],
      ["North", "1,240"],
    ]);
  });

  test("a whole .docx reads back", async () => {
    const bytes = await pack({ "word/document.xml": document });
    const view = await readDocx(bytes);
    expect(view.paragraphs[0]).toBe("Quarterly review");
    expect(view.tables[0].rows[1][0]).toBe("North");
  });

  test("an empty document says so instead of showing nothing", async () => {
    const bytes = await pack({ "word/document.xml": "<w:document><w:body></w:body></w:document>" });
    await expect(readDocx(bytes)).rejects.toThrow(/empty/);
  });
});

describe("csv", () => {
  test("quoted commas and doubled quotes survive", () => {
    const rows = readCsv('name,note\n"Acme, Inc","He said ""hi"""\n');
    expect(rows).toEqual([
      ["name", "note"],
      ["Acme, Inc", 'He said "hi"'],
    ]);
  });

  test("CRLF, a BOM and blank lines are handled", () => {
    const rows = readCsv("\uFEFFa,b\r\n1,2\r\n\r\n");
    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("a tab-separated export is split on its own delimiter", () => {
    expect(readCsv("a\tb\n1\t2", "\t")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(guessDelimiter("a\tb\tc")).toBe("\t");
    expect(guessDelimiter("a;b;c")).toBe(";");
    expect(guessDelimiter("a,b,c")).toBe(",");
  });
});

describe("detectKind", () => {
  test("names decide first, then the zip's parts", () => {
    expect(detectKind("deck.pptx", null)).toBe("slides");
    expect(detectKind("Book.XLSX", null)).toBe("sheet");
    expect(detectKind("notes.docx", null)).toBe("doc");
    expect(detectKind("export.csv", null)).toBe("csv");
    expect(detectKind("report.pdf", null)).toBe("pdf");
    expect(detectKind("REPORT.PDF", null)).toBe("pdf");
    expect(detectKind("photo.png", null)).toBe("image");
    expect(detectKind("photo.JPG", null)).toBe("image");
    expect(detectKind("scan.webp", null)).toBe("image");
    expect(detectKind("mystery", new Map([["xl/workbook.xml", new Uint8Array()]]))).toBe("sheet");
    expect(detectKind("mystery", new Map([["word/document.xml", new Uint8Array()]]))).toBe("doc");
    expect(detectKind("mystery", null)).toBeNull();
  });

  test("an image with no extension is recognised from its bytes", async () => {
    // The PNG signature, and nothing else — an image dropped in with a broken
    // name still opens, which is the whole point of sniffing.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const opened = await openOfficeFile("no-extension", png);
    expect(opened.kind).toBe("image");
    if (opened.kind === "image") {
      expect(opened.url.startsWith("blob:")).toBe(true);
      disposeOpenedFile(opened);
    }
  });
});

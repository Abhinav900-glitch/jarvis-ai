// The conversion map is the contract between the button and the server: the
// action accepts exactly what `conversionTargets` offers. These tests pin the
// parts that would be silent if broken — a PDF offering "Word" twice, a name
// gaining a second extension, a target that arrives with different casing.

import { describe, expect, test } from "bun:test";
import {
  conversionTargets,
  convertedName,
  extensionOf,
  findTarget,
  mimeForTarget,
} from "../convert-formats";

const exts = (name: string) => conversionTargets(name).map((target) => target.ext);

describe("extensionOf", () => {
  test("reads the last dotted part", () => {
    expect(extensionOf("report.docx")).toBe("docx");
    expect(extensionOf("Q3.REPORT.PDF")).toBe("pdf");
    expect(extensionOf("  deck.pptx ")).toBe("pptx");
  });

  test("a name without an extension is not a format", () => {
    expect(extensionOf("notes")).toBe("");
    expect(extensionOf("archive.tar.gz")).toBe("gz");
  });
});

describe("conversionTargets", () => {
  test("a document offers PDF but not itself", () => {
    expect(exts("brief.docx")).toContain("pdf");
    expect(exts("brief.docx")).not.toContain("docx");
  });

  test("a PDF offers an editable format and an image", () => {
    expect(exts("scan.pdf")).toEqual(expect.arrayContaining(["docx", "txt", "jpg"]));
  });

  test("a spreadsheet can become CSV", () => {
    expect(exts("numbers.xlsx")).toContain("csv");
  });

  test("an image is never offered a document format", () => {
    expect(exts("photo.png")).toEqual(expect.arrayContaining(["pdf", "jpg"]));
    expect(exts("photo.png")).not.toContain("docx");
  });

  test("unknown extensions still get the safe pair, junk gets nothing", () => {
    expect(exts("model.blend")).toEqual(["pdf", "jpg"]);
    expect(exts("LICENSE")).toEqual([]);
  });

  test("no list repeats a target", () => {
    for (const name of ["a.pdf", "a.docx", "a.xlsx", "a.pptx", "a.png", "a.csv"]) {
      const list = exts(name);
      expect(new Set(list).size).toBe(list.length);
    }
  });
});

describe("convertedName", () => {
  test("replaces the extension instead of appending it", () => {
    expect(convertedName("q3.report.v2.docx", "pdf")).toBe("q3.report.v2.pdf");
    expect(convertedName("brief.docx", "pdf")).toBe("brief.pdf");
  });

  test("a dotfile is not treated as having an extension", () => {
    // `.env` is a name, not an extension, so there is no base to keep.
    expect(convertedName(".env", "pdf")).toBe("converted.pdf");
  });
});

describe("findTarget and mimeForTarget", () => {
  test("targets are case-insensitive, unknown pairs are null", () => {
    expect(findTarget("brief.docx", "PDF")?.ext).toBe("pdf");
    expect(findTarget("brief.docx", "gif")).toBeNull();
  });

  test("each offered target has a real mime type", () => {
    for (const name of ["a.pdf", "a.docx", "a.xlsx", "a.png", "a.csv"]) {
      for (const target of conversionTargets(name)) {
        expect(mimeForTarget(target.ext)).not.toBe("application/octet-stream");
      }
    }
  });
});

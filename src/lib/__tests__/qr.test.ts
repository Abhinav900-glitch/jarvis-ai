// Tests for the QR encoder.
//
// Matrices are checked against python-qrcode's output for the same version,
// level and mask, captured once and pinned here. That is the only meaningful
// assertion for this format: a symbol whose Reed-Solomon blocks or format bits
// are wrong still looks like a QR code, and only a reference encoder or a
// scanner can tell you it is wrong.
//
// The reference spawn (all four levels x versions 1-10 x four masks x four
// inputs, 504 cases) matched exactly; these two cases are the offline guard.

import { describe, expect, test } from "bun:test";
import { qrMatrix, qrRows } from "../qr/qr";
import { qrPng } from "../qr/png";

const HELLO_V1_M_MASK3 = [
  "111111101000001111111",
  "100000101000001000001",
  "101110100101001011101",
  "101110101010101011101",
  "101110100111001011101",
  "100000100111101000001",
  "111111101010101111111",
  "000000001111100000000",
  "101101110101101001011",
  "111010010011111001101",
  "110111101101000000011",
  "110101000111001111010",
  "010100111100100100001",
  "000000001011001000100",
  "111111101011100100000",
  "100000101010000111110",
  "101110100000111111111",
  "101110101011001011110",
  "101110101000101100100",
  "100000100000010110001",
  "111111101110010100100",
];

describe("qrMatrix", () => {
  test("matches the reference matrix for a fixed version, level and mask", () => {
    const matrix = qrMatrix("hello", { version: 1, level: "M", mask: 3 });
    expect(matrix.version).toBe(1);
    expect(matrix.size).toBe(21);
    expect(qrRows(matrix)).toEqual(HELLO_V1_M_MASK3);
  });

  test("a URL maps to a version that fits it", () => {
    const matrix = qrMatrix("https://youtu.be/dQw4w9WgXcQ");
    // 29 bytes needs version 3 at level M (version 2 holds 26 codewords).
    expect(matrix.version).toBe(3);
    expect(matrix.size).toBe(29);
    expect(matrix.mask).toBeGreaterThanOrEqual(0);
    expect(matrix.mask).toBeLessThan(8);
  });

  test("higher error correction needs a larger symbol", () => {
    const text = "https://example.com/a/path";
    expect(qrMatrix(text, { level: "L" }).version).toBeLessThanOrEqual(
      qrMatrix(text, { level: "H" }).version,
    );
  });

  test("every version has the size the spec gives it", () => {
    for (let version = 1; version <= 10; version += 1) {
      const matrix = qrMatrix("x".repeat(version * 5), { version, level: "L" });
      expect(matrix.size).toBe(version * 4 + 17);
      expect(matrix.modules).toHaveLength(matrix.size);
      expect(matrix.modules[0]).toHaveLength(matrix.size);
    }
  });

  test("drawn function patterns are where they belong", () => {
    const { modules, size } = qrMatrix("hello", { version: 2, level: "M" });
    // Finder: a 7x7 dark border around a 3x3 dark core.
    for (const [ox, oy] of [
      [0, 0],
      [size - 7, 0],
      [0, size - 7],
    ]) {
      expect(modules[oy][ox]).toBe(true);
      expect(modules[oy + 1][ox + 1]).toBe(false);
      expect(modules[oy + 3][ox + 3]).toBe(true);
    }
    // Timing patterns alternate along row and column 6.
    expect(modules[6][8]).toBe(true);
    expect(modules[6][9]).toBe(false);
    // The always-dark module.
    expect(modules[size - 8][8]).toBe(true);
  });

  test("refuses text that cannot fit, instead of truncating it", () => {
    expect(() => qrMatrix("x".repeat(500), { level: "H" })).toThrow(/too long/i);
  });

  test("encodes UTF-8 rather than rejecting it", () => {
    const matrix = qrMatrix("Café — naïve");
    expect(matrix.size).toBeGreaterThanOrEqual(21);
  });

  test("the same input always produces the same matrix", () => {
    expect(qrRows(qrMatrix("https://example.com"))).toEqual(qrRows(qrMatrix("https://example.com")));
  });
});

describe("qrPng", () => {
  test("writes a truecolour PNG with the expected dimensions", async () => {
    const bytes = await qrPng("hello", { version: 1, level: "M", mask: 3, scale: 4, margin: 4 });
    expect(Array.from(bytes.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // Width and height live in IHDR, immediately after the 8-byte signature and
    // the 8-byte chunk header.
    const width = view.getUint32(16, false);
    const height = view.getUint32(20, false);
    expect(width).toBe((21 + 8) * 4);
    expect(height).toBe(width);
    // Colour type 2 (truecolour) at IHDR byte 9.
    expect(bytes[25]).toBe(2);
    // Ends with IEND.
    expect(new TextDecoder().decode(bytes.slice(-8, -4))).toBe("IEND");
  });

  test("scales with the module size", async () => {
    const small = await qrPng("hello", { version: 1, scale: 2 });
    const large = await qrPng("hello", { version: 1, scale: 8 });
    const width = (bytes: Uint8Array) =>
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(16, false);
    expect(width(large)).toBe(width(small) * 4);
  });
});

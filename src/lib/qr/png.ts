// ---------------------------------------------------------------------------
// QR code → PNG.
//
// PowerPoint embeds raster images, so a QR code has to become bytes before it
// can go on a slide. This writes a truecolour PNG by hand: signature, IHDR,
// one zlib-compressed IDAT and IEND, each with a CRC. That is the whole format
// for an image with no metadata, and it avoids pulling in an encoder for
// 70 lines of chunk bookkeeping.
//
// The image is drawn at an integer number of pixels per module — a fractional
// scale is what makes a printed QR code look slightly blurred and scan badly.
// ---------------------------------------------------------------------------

import { crc32 } from "../pptx/zip";
import { qrMatrix, type QrOptions } from "./qr";

export interface QrPngOptions extends QrOptions {
  /** Pixels per module. Bigger is sharper and heavier. */
  scale?: number;
  /** Quiet zone, in modules. Four is the minimum the spec allows. */
  margin?: number;
  /** Dark module colour, `RRGGBB`. */
  dark?: string;
  /** Light module colour, `RRGGBB`. */
  light?: string;
}

const ADLER_MOD = 65521;

function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % ADLER_MOD;
    b = (b + a) % ADLER_MOD;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib stream: a header, deflate data, and an Adler-32 of the input. */
async function zlib(bytes: Uint8Array): Promise<Uint8Array> {
  const Ctor = (globalThis as { CompressionStream?: typeof CompressionStream })
    .CompressionStream;
  if (Ctor) {
    try {
      const stream = new Ctor("deflate");
      const collected = new Response(stream.readable).arrayBuffer();
      const writer = stream.writable.getWriter();
      const chunk = new Uint8Array(bytes.byteLength);
      chunk.set(bytes);
      await writer.write(chunk);
      await writer.close();
      return new Uint8Array(await collected);
    } catch {
      // Fall through to stored blocks: a larger file beats no file.
    }
  }

  // Stored blocks: 0x78 0x01 header, then chunks of at most 65535 bytes.
  const blocks: Uint8Array[] = [];
  const header = new Uint8Array([0x78, 0x01]);
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, adler32(bytes), false);
  for (let at = 0; at < bytes.length || at === 0; at += 65535) {
    const slice = bytes.subarray(at, Math.min(bytes.length, at + 65535));
    const final = at + 65535 >= bytes.length ? 1 : 0;
    const block = new Uint8Array(5 + slice.length);
    block[0] = final;
    new DataView(block.buffer).setUint16(1, slice.length, true);
    new DataView(block.buffer).setUint16(3, ~slice.length & 0xffff, true);
    block.set(slice, 5);
    blocks.push(block);
    if (slice.length === 0) break;
  }
  const total = 2 + blocks.reduce((sum, b) => sum + b.length, 0) + 4;
  const out = new Uint8Array(total);
  out.set(header, 0);
  let at = 2;
  for (const block of blocks) {
    out.set(block, at);
    at += block.length;
  }
  out.set(tail, at);
  return out;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const name = new TextEncoder().encode(type);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(name, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(name.length + data.length);
  crcInput.set(name, 0);
  crcInput.set(data, name.length);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return out;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function rgb(hex: string, fallback: Rgb): Rgb {
  const clean = (hex ?? "").replace(/[^0-9a-fA-F]/g, "");
  if (clean.length !== 6) return fallback;
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

/** Rasterise a QR code to PNG bytes. */
export async function qrPng(text: string, options: QrPngOptions = {}): Promise<Uint8Array> {
  const matrix = qrMatrix(text, options);
  const scale = Math.max(1, Math.round(options.scale ?? 8));
  const margin = Math.max(0, Math.round(options.margin ?? 4));
  const modules = matrix.size + margin * 2;
  const width = modules * scale;
  const dark = rgb(options.dark ?? "000000", { r: 0, g: 0, b: 0 });
  const light = rgb(options.light ?? "FFFFFF", { r: 255, g: 255, b: 255 });

  const stride = 1 + width * 3;
  const raw = new Uint8Array(stride * width);
  for (let y = 0; y < width; y += 1) {
    const row = y * stride;
    raw[row] = 0; // filter: none
    const my = Math.floor(y / scale) - margin;
    for (let x = 0; x < width; x += 1) {
      const mx = Math.floor(x / scale) - margin;
      const isDark =
        my >= 0 && my < matrix.size && mx >= 0 && mx < matrix.size && matrix.modules[my][mx];
      const colour = isDark ? dark : light;
      const at = row + 1 + x * 3;
      raw[at] = colour.r;
      raw[at + 1] = colour.g;
      raw[at + 2] = colour.b;
    }
  }

  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, width, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", await zlib(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A `data:` URL, for the spec's image slots. */
export async function qrDataUrl(text: string, options: QrPngOptions = {}): Promise<string> {
  const bytes = await qrPng(text, options);
  // btoa needs a binary string; building it in chunks keeps a large image off
  // the argument stack.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

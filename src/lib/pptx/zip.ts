// ---------------------------------------------------------------------------
// A ZIP writer for OPC packages.
//
// A .pptx is a ZIP of XML parts, so building one needs a real archive: entry
// data, CRC-32 per entry, a central directory and an end-of-central-directory
// record. There is no library here on purpose — the archive is 20 lines of
// binary bookkeeping once the checksum exists, and a dependency for it would
// be larger than this file.
//
// Compression uses `CompressionStream("deflate-raw")`, which is what ZIP's
// method 8 is. Environments that lack it (a test runner on an old runtime) fall
// back to stored entries: a valid-but-large archive is much better than a
// thrown exception, and every reader accepts method 0.
// ---------------------------------------------------------------------------

export interface ZipEntry {
  /** Forward-slashed path inside the archive, e.g. `ppt/slides/slide1.xml`. */
  path: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let bit = 0; bit < 8; bit += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  const Ctor = (globalThis as { CompressionStream?: typeof CompressionStream })
    .CompressionStream;
  if (!Ctor) return null;
  try {
    const stream = new Ctor("deflate-raw");
    const writer = stream.writable.getWriter();
    // A fresh view over a fresh buffer: a Uint8Array can in principle span a
    // SharedArrayBuffer, which `BufferSource` does not accept.
    const chunk = new Uint8Array(bytes.byteLength);
    chunk.set(bytes);
    // Start reading before writing. A large part is larger than the transform
    // stream's queue, so awaiting the write first would deadlock: the writer
    // waits for the (not yet reading) reader to drain.
    const collected = new Response(stream.readable).arrayBuffer();
    await writer.write(chunk);
    await writer.close();
    const buffer = await collected;
    const out = new Uint8Array(buffer);
    // Storing is smaller for tiny parts, and never larger than the input plus
    // a few bytes, so an unhelpful deflate is simply not used.
    return out.length < bytes.length ? out : null;
  } catch {
    return null;
  }
}

/** DOS date/time, in the local zone, as two 16-bit fields. */
function dosStamp(date: Date): { time: number; date: number } {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    Math.floor(date.getSeconds() / 2);
  const day =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, date: day };
}

/**
 * Build a ZIP archive.
 *
 * Entries keep the order they are given, which matters for neither readers nor
 * writers but does make the output stable enough to diff.
 */
export async function zipFiles(
  entries: ZipEntry[],
  date: Date = new Date(),
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const stamp = dosStamp(date);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const crc = crc32(entry.data);
    const deflated = await deflateRaw(entry.data);
    const payload = deflated ?? entry.data;
    const method = deflated ? 8 : 0;

    const local = new Uint8Array(30 + name.length + payload.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header
    lv.setUint16(4, 20, true); // version needed to extract
    // Bit 11 flags the name as UTF-8, which is required for part names that are
    // ASCII but also correct if a slide title ever reaches a filename.
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, stamp.time, true);
    lv.setUint16(12, stamp.date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, entry.data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);
    local.set(name, 30);
    local.set(payload, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory header
    cv.setUint16(4, 20, true); // made by
    cv.setUint16(6, 20, true); // needed
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, stamp.time, true);
    cv.setUint16(14, stamp.date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, entry.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attrs
    cv.setUint32(38, 0, true); // external attrs
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);

    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const total =
    offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of locals) {
    out.set(part, at);
    at += part.length;
  }
  for (const part of centrals) {
    out.set(part, at);
    at += part.length;
  }
  out.set(end, at);
  return out;
}

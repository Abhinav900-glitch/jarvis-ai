// ---------------------------------------------------------------------------
// Zip writing, dependency-free.
//
// Settings → Plugins stores archives and can read them back (zip-inspect.ts).
// The built-in plugin packs need the other direction: turn a handful of text
// files into a real zip the same pipeline can store, inspect and download.
//
// Entries are written with method 0 (stored, no compression). A skill pack is
// a few KB of Markdown, so deflate would buy almost nothing, and stored
// entries mean the reader never needs DecompressionStream on either side.
// ---------------------------------------------------------------------------

export interface ZipInputFile {
  /** Forward-slash path inside the archive, e.g. `skills/research-brief.md`. */
  name: string;
  text: string;
}

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_DIR_ENTRY = 0x02014b50;
const END_OF_CENTRAL_DIR = 0x06054b50;
/** 20 = zip 2.0: stored entries and no zip64, which is all this writes. */
const VERSION = 20;

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) === 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS date/time, the only timestamp format every unzip tool agrees on. */
function dosStamp(date: Date): { time: number; date: number } {
  const year = Math.max(date.getFullYear(), 1980);
  return {
    time:
      (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Build a valid .zip in memory from text files. */
export function buildZip(files: ZipInputFile[], when = new Date()): Blob {
  const encoder = new TextEncoder();
  const stamp = dosStamp(when);

  const prepared = files.map((file) => {
    const name = encoder.encode(file.name.replace(/^\/+/, ""));
    const data = encoder.encode(file.text);
    return { name, data, crc: crc32(data), offset: 0 };
  });

  const localSize = prepared.reduce(
    (sum, p) => sum + 30 + p.name.length + p.data.length,
    0,
  );
  const centralSize = prepared.reduce((sum, p) => sum + 46 + p.name.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);
  let at = 0;

  const u16 = (value: number) => {
    view.setUint16(at, value, true);
    at += 2;
  };
  const u32 = (value: number) => {
    view.setUint32(at, value >>> 0, true);
    at += 4;
  };
  const bytes = (value: Uint8Array) => {
    out.set(value, at);
    at += value.length;
  };

  // Local headers + their data.
  for (const entry of prepared) {
    entry.offset = at;
    u32(LOCAL_FILE_HEADER);
    u16(VERSION);
    u16(0); // flags: no data descriptor, no UTF-8 bit — names are ASCII here
    u16(0); // method 0 = stored
    u16(stamp.time);
    u16(stamp.date);
    u32(entry.crc);
    u32(entry.data.length); // compressed size == uncompressed size when stored
    u32(entry.data.length);
    u16(entry.name.length);
    u16(0); // extra field length
    bytes(entry.name);
    bytes(entry.data);
  }

  const centralStart = at;
  for (const entry of prepared) {
    u32(CENTRAL_DIR_ENTRY);
    u16(VERSION); // version made by
    u16(VERSION); // version needed
    u16(0);
    u16(0);
    u16(stamp.time);
    u16(stamp.date);
    u32(entry.crc);
    u32(entry.data.length);
    u32(entry.data.length);
    u16(entry.name.length);
    u16(0); // extra
    u16(0); // comment
    u16(0); // disk number start
    u16(0); // internal attributes
    u32(0); // external attributes
    u32(entry.offset);
    bytes(entry.name);
  }

  // The size of the central directory has to be measured before the EOCD
  // record is written, not after: `at` moves as those fields are written, and
  // folding them in makes every reader reject the archive.
  const centralDirSize = at - centralStart;
  u32(END_OF_CENTRAL_DIR);
  u16(0); // this disk
  u16(0); // disk with the central directory
  u16(prepared.length);
  u16(prepared.length);
  u32(centralDirSize);
  u32(centralStart);
  u16(0); // archive comment length

  return new Blob([out], { type: "application/zip" });
}

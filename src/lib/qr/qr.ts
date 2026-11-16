// ---------------------------------------------------------------------------
// A QR code encoder.
//
// A QR code is a small, unforgiving format: version selection depends on the
// byte length, the Reed-Solomon block layout changes per version and level, and
// a single misplaced format bit makes the symbol unscannable while still
// looking perfectly plausible. So this follows the published algorithm step by
// step — byte mode, versions 1-10, levels L/M/Q/H, all eight masks — rather than
// approximating it.
//
// Why write it at all: a QR code belongs inside the .pptx (a closing "scan this"
// slide is the common case), and a hosted QR API would mean posting the user's
// link to a third party, paying per code, and failing offline. Encoding locally
// makes the same bytes available to the deck writer and to the panel preview.
//
// Not implemented on purpose: kanji/numeric/alphanumeric compaction (a URL is
// bytes anyway), versions above 10 (a 213-byte capacity at level M is far more
// than a link needs), and structured append.
// ---------------------------------------------------------------------------

export type QrLevel = "L" | "M" | "Q" | "H";

export interface QrOptions {
  /** Error correction level. M is the default the spec recommends for URLs. */
  level?: QrLevel;
  /** Pin a version instead of choosing the smallest that fits. */
  version?: number;
  /** Pin a mask 0-7; omitted means choose by penalty score. */
  mask?: number;
  /** Throws when the data does not fit, instead of silently truncating. */
  strict?: boolean;
}

export interface QrMatrix {
  version: number;
  level: QrLevel;
  mask: number;
  /** Modules per side, excluding the quiet zone. */
  size: number;
  /** Row-major, `modules[row][col]`, true = dark. */
  modules: boolean[][];
}

// ---------------------------------------------------------------------------
// Capacity tables
// ---------------------------------------------------------------------------

interface BlockSpec {
  /** EC codewords per block. */
  ec: number;
  /** [block count, data codewords per block], for each group. */
  groups: [number, number][];
}

/** Alignment pattern centres, per version (version 1 has none). */
const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const BLOCKS: Record<number, Record<QrLevel, BlockSpec>> = {
  1: {
    L: { ec: 7, groups: [[1, 19]] },
    M: { ec: 10, groups: [[1, 16]] },
    Q: { ec: 13, groups: [[1, 13]] },
    H: { ec: 17, groups: [[1, 9]] },
  },
  2: {
    L: { ec: 10, groups: [[1, 34]] },
    M: { ec: 16, groups: [[1, 28]] },
    Q: { ec: 22, groups: [[1, 22]] },
    H: { ec: 28, groups: [[1, 16]] },
  },
  3: {
    L: { ec: 15, groups: [[1, 55]] },
    M: { ec: 26, groups: [[1, 44]] },
    Q: { ec: 18, groups: [[2, 17]] },
    H: { ec: 22, groups: [[2, 13]] },
  },
  4: {
    L: { ec: 20, groups: [[1, 80]] },
    M: { ec: 18, groups: [[2, 32]] },
    Q: { ec: 26, groups: [[2, 24]] },
    H: { ec: 16, groups: [[4, 9]] },
  },
  5: {
    L: { ec: 26, groups: [[1, 108]] },
    M: { ec: 24, groups: [[2, 43]] },
    Q: { ec: 18, groups: [[2, 15], [2, 16]] },
    H: { ec: 22, groups: [[2, 11], [2, 12]] },
  },
  6: {
    L: { ec: 18, groups: [[2, 68]] },
    M: { ec: 16, groups: [[4, 27]] },
    Q: { ec: 24, groups: [[4, 19]] },
    H: { ec: 28, groups: [[4, 15]] },
  },
  7: {
    L: { ec: 20, groups: [[2, 78]] },
    M: { ec: 18, groups: [[4, 31]] },
    Q: { ec: 18, groups: [[2, 14], [4, 15]] },
    H: { ec: 26, groups: [[4, 13], [1, 14]] },
  },
  8: {
    L: { ec: 24, groups: [[2, 97]] },
    M: { ec: 22, groups: [[2, 38], [2, 39]] },
    Q: { ec: 22, groups: [[4, 18], [2, 19]] },
    H: { ec: 26, groups: [[4, 14], [2, 15]] },
  },
  9: {
    L: { ec: 30, groups: [[2, 116]] },
    M: { ec: 22, groups: [[3, 36], [2, 37]] },
    Q: { ec: 20, groups: [[4, 16], [4, 17]] },
    H: { ec: 24, groups: [[4, 12], [4, 13]] },
  },
  10: {
    L: { ec: 18, groups: [[2, 68], [2, 69]] },
    M: { ec: 26, groups: [[4, 43], [1, 44]] },
    Q: { ec: 24, groups: [[6, 19], [2, 20]] },
    H: { ec: 28, groups: [[6, 15], [2, 16]] },
  },
};

const MAX_VERSION = 10;

/** Data codewords available at a version and level. */
function dataCodewords(version: number, level: QrLevel): number {
  const spec = BLOCKS[version][level];
  return spec.groups.reduce((sum, [count, words]) => sum + count * words, 0);
}

// ---------------------------------------------------------------------------
// Galois field arithmetic (GF(256), primitive polynomial 0x11D)
// ---------------------------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const gfMul = (a: number, b: number): number =>
  a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];

/** The generator polynomial for `count` error-correction codewords. */
function generator(count: number): number[] {
  let poly = [1];
  for (let i = 0; i < count; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  // Drop the leading 1: the encoder only needs the remaining coefficients.
  return poly.slice(1);
}

function reedSolomon(data: number[], ecCount: number): number[] {
  const poly = generator(ecCount);
  const remainder = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecCount; i += 1) {
        remainder[i] ^= gfMul(poly[i], factor);
      }
    }
  }
  return remainder;
}

// ---------------------------------------------------------------------------
// Data encoding
// ---------------------------------------------------------------------------

class BitBuffer {
  bits: number[] = [];
  push(value: number, length: number) {
    for (let i = length - 1; i >= 0; i -= 1) this.bits.push((value >>> i) & 1);
  }
}

function byteCountBits(version: number): number {
  return version < 10 ? 8 : 16;
}

function chooseVersion(bytes: number, level: QrLevel): number | null {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const capacity = dataCodewords(version, level) * 8;
    const need = 4 + byteCountBits(version) + bytes * 8;
    if (need <= capacity) return version;
  }
  return null;
}

function encodeData(bytes: Uint8Array, version: number, level: QrLevel): number[] {
  const capacity = dataCodewords(version, level) * 8;
  const buffer = new BitBuffer();
  buffer.push(0b0100, 4); // byte mode
  buffer.push(bytes.length, byteCountBits(version));
  for (const byte of bytes) buffer.push(byte, 8);

  // Terminator, then pad to a byte boundary.
  buffer.push(0, Math.min(4, capacity - buffer.bits.length));
  while (buffer.bits.length % 8 !== 0) buffer.bits.push(0);

  const words: number[] = [];
  for (let i = 0; i < buffer.bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | buffer.bits[i + j];
    words.push(byte);
  }
  // Alternating pad codewords, as the spec requires.
  const pads = [0xec, 0x11];
  for (let i = 0; words.length < capacity / 8; i += 1) words.push(pads[i % 2]);
  return words;
}

/** Split into blocks, add EC codewords, and interleave — the order matters. */
function interleave(words: number[], version: number, level: QrLevel): number[] {
  const spec = BLOCKS[version][level];
  const blocks: { data: number[]; ec: number[] }[] = [];
  let at = 0;
  for (const [count, size] of spec.groups) {
    for (let i = 0; i < count; i += 1) {
      const data = words.slice(at, at + size);
      at += size;
      blocks.push({ data, ec: reedSolomon(data, spec.ec) });
    }
  }

  const out: number[] = [];
  const maxData = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  }
  for (let i = 0; i < spec.ec; i += 1) {
    for (const block of blocks) out.push(block.ec[i]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Matrix construction
// ---------------------------------------------------------------------------

type Grid = boolean[][];
type Marks = boolean[][];

const makeGrid = (size: number, fill = false): Grid =>
  Array.from({ length: size }, () => new Array<boolean>(size).fill(fill));

function drawFunctionPatterns(modules: Grid, reserved: Marks, version: number): void {
  const size = modules.length;
  const set = (x: number, y: number, dark: boolean) => {
    modules[y][x] = dark;
    reserved[y][x] = true;
  };

  // Timing patterns.
  for (let i = 0; i < size; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Finder patterns with their separators.
  for (const [cx, cy] of [
    [3, 3],
    [size - 4, 3],
    [3, size - 4],
  ]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }

  // Alignment patterns, skipping the three that would overlap a finder.
  const centers = ALIGNMENT[version] ?? [];
  for (const cy of centers) {
    for (const cx of centers) {
      const corner =
        (cx === 6 && cy === 6) ||
        (cx === 6 && cy === size - 7) ||
        (cx === size - 7 && cy === 6);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const distance = Math.max(Math.abs(dx), Math.abs(dy));
          set(cx + dx, cy + dy, distance !== 1);
        }
      }
    }
  }

  // Reserve the format areas; the bits themselves depend on the mask.
  for (let i = 0; i < 9; i += 1) {
    if (!reserved[8][i]) set(i, 8, false);
    if (!reserved[i][8]) set(8, i, false);
  }
  for (let i = 0; i < 8; i += 1) {
    set(size - 1 - i, 8, false);
    set(8, size - 1 - i, false);
  }
  set(8, size - 8, true); // the always-dark module

  // Version information, for versions 7 and up.
  if (version >= 7) {
    let rem = version;
    for (let i = 0; i < 12; i += 1) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (version << 12) | rem;
    for (let i = 0; i < 18; i += 1) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      set(a, b, bit);
      set(b, a, bit);
    }
  }
}

function drawFormat(modules: Grid, level: QrLevel, mask: number): void {
  const size = modules.length;
  const levelBits = { L: 1, M: 0, Q: 3, H: 2 }[level];
  const data = (levelBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i += 1) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  const bits = ((data << 10) | rem) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;

  for (let i = 0; i <= 5; i += 1) modules[i][8] = bit(i);
  modules[7][8] = bit(6);
  modules[8][8] = bit(7);
  modules[8][7] = bit(8);
  for (let i = 9; i < 15; i += 1) modules[8][14 - i] = bit(i);

  for (let i = 0; i < 8; i += 1) modules[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i += 1) modules[size - 15 + i][8] = bit(i);
  modules[size - 8][8] = true;
}

function placeData(modules: Grid, reserved: Marks, codewords: number[]): void {
  const size = modules.length;
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (reserved[y][x]) continue;
        const bit =
          index < codewords.length * 8
            ? ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1
            : false;
        modules[y][x] = bit;
        index += 1;
      }
    }
  }
}

const MASKS: ((row: number, col: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(modules: Grid, reserved: Marks, mask: number): void {
  const fn = MASKS[mask];
  for (let y = 0; y < modules.length; y += 1) {
    for (let x = 0; x < modules.length; x += 1) {
      if (!reserved[y][x] && fn(y, x)) modules[y][x] = !modules[y][x];
    }
  }
}

/**
 * Penalty score, used to pick the mask.
 *
 * The four rules are the ones the spec defines: long runs, 2x2 blocks,
 * finder-like 1:1:3:1:1 patterns, and a dark/light balance penalty. A mask that
 * scores badly still scans; the score just makes scanning more reliable on a
 * cheap camera, which is exactly the situation a printed slide is in.
 */
function penalty(modules: Grid): number {
  const size = modules.length;
  let score = 0;

  const runs = (get: (i: number, j: number) => boolean) => {
    for (let i = 0; i < size; i += 1) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        if (get(i, j) === get(i, j - 1)) {
          run += 1;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  };
  runs((i, j) => modules[i][j]);
  runs((i, j) => modules[j][i]);

  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const v = modules[y][x];
      if (v === modules[y][x + 1] && v === modules[y + 1][x] && v === modules[y + 1][x + 1]) {
        score += 3;
      }
    }
  }

  const pattern = [true, false, true, true, true, false, true];
  const matches = (line: boolean[], start: number) =>
    pattern.every((value, i) => line[start + i] === value);
  const quiet = (line: boolean[], from: number, to: number) => {
    for (let i = from; i < to; i += 1) {
      if (i < 0 || i >= line.length) continue;
      if (line[i]) return false;
    }
    return true;
  };
  for (let i = 0; i < size; i += 1) {
    const row = modules[i];
    const col = modules.map((r) => r[i]);
    for (let j = 0; j + 7 <= size; j += 1) {
      if (matches(row, j) && (quiet(row, j - 4, j) || quiet(row, j + 7, j + 11))) score += 40;
      if (matches(col, j) && (quiet(col, j - 4, j) || quiet(col, j + 7, j + 11))) score += 40;
    }
  }

  const dark = modules.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;
  return score;
}

/**
 * Encode `text` as a QR matrix.
 *
 * Byte mode with UTF-8: a URL is ASCII, and anything else (an emoji, accented
 * text) survives as its UTF-8 bytes, which is what scanners expect.
 */
export function qrMatrix(text: string, options: QrOptions = {}): QrMatrix {
  const level = options.level ?? "M";
  const bytes = new TextEncoder().encode(text);
  if (bytes.length === 0) throw new Error("There is nothing to encode.");

  const version = options.version ?? chooseVersion(bytes.length, level);
  if (!version || version < 1 || version > MAX_VERSION) {
    throw new Error(
      `That text is too long for a QR code at level ${level} (max ${dataCodewords(MAX_VERSION, level)} bytes).`,
    );
  }
  if (bytes.length > dataCodewords(version, level) - 3) {
    if (options.strict) throw new Error("That text is too long for this QR version.");
  }

  const size = version * 4 + 17;
  const codewords = interleave(encodeData(bytes, version, level), version, level);
  const base = makeGrid(size);
  const reserved = makeGrid(size);
  drawFunctionPatterns(base, reserved, version);
  placeData(base, reserved, codewords);

  const candidates: QrMatrix[] = [];
  const masks = options.mask === undefined ? [0, 1, 2, 3, 4, 5, 6, 7] : [options.mask];
  for (const mask of masks) {
    const modules = base.map((row) => [...row]);
    applyMask(modules, reserved, mask);
    drawFormat(modules, level, mask);
    candidates.push({ version, level, mask, size, modules });
  }

  if (candidates.length === 1) return candidates[0];
  return candidates.reduce((best, candidate) =>
    penalty(candidate.modules) < penalty(best.modules) ? candidate : best,
  );
}

/** The modules as `0`/`1` rows — handy for tests and for drawing a preview. */
export function qrRows(matrix: QrMatrix): string[] {
  return matrix.modules.map((row) => row.map((dark) => (dark ? "1" : "0")).join(""));
}

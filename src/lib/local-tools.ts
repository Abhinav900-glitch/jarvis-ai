// ---------------------------------------------------------------------------
// Local tools — the answers that should never cost a model call.
//
// Counting words, converting units, formatting JSON, hashing text: a language
// model can approximate all of it and get base64, hashes and diffs wrong. These
// run in the browser, return in a millisecond, and are exactly correct, which is
// also why they are testable in a way the prompt features are not.
//
// Every tool takes the text after the command and returns a title plus a body of
// plain text. Errors are returned rather than thrown: a typo in a unit is a
// message in a dialog, not a crash.
// ---------------------------------------------------------------------------

export interface ToolResult {
  title: string;
  body: string;
}

export interface ToolError {
  error: string;
}

export type ToolOutcome = ToolResult | ToolError;

export interface LocalTool {
  aliases: string[];
  summary: string;
  argHint?: string;
  example: string;
  /** True when the tool is pointless without input, so it waits in the composer. */
  needsArg?: boolean;
  run: (args: string) => ToolOutcome | Promise<ToolOutcome>;
}

const fail = (error: string): ToolError => ({ error });
const ok = (title: string, body: string): ToolResult => ({ title, body });

/** Fixed decimals, trailing zeros trimmed — 6.2137 rather than 6.21371192. */
function num(value: number, decimals = 4): string {
  if (!Number.isFinite(value)) return "not a number";
  const fixed = value.toFixed(decimals);
  return fixed.replace(/\.?0+$/, "") || "0";
}

const words = (text: string): string[] => text.trim().split(/\s+/).filter(Boolean);

// ---- /count ---------------------------------------------------------------

const STOPWORDS = new Set(
  "the a an and or but if then than that this these those of to in on at for with from by as is are was were be been being it its i you he she they we not no do does did so just about into over under".split(
    " ",
  ),
);

function countTool(args: string): ToolOutcome {
  const text = args.trim();
  if (!text) return fail("Paste some text after /count.");
  const wordList = words(text);
  const sentences = text.split(/[.!?]+(?:\s|$)/).filter((s) => s.trim()).length;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim()).length;
  const chars = [...text].length;
  const nonSpace = chars - (text.match(/\s/g)?.length ?? 0);
  const minutes = wordList.length / 200;

  const frequencies = new Map<string, number>();
  for (const word of wordList) {
    const key = word.toLowerCase().replace(/[^a-z0-9'-]/g, "");
    if (key.length < 3 || STOPWORDS.has(key)) continue;
    frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  }
  const top = [...frequencies.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5);

  const reading =
    minutes < 1
      ? `${Math.max(1, Math.round(minutes * 60))} s`
      : `${num(minutes, 1)} min`;

  return ok("Text count", [
    `${wordList.length} words`,
    `${chars} characters (${nonSpace} without spaces)`,
    `${sentences} sentences · ${paragraphs} paragraphs`,
    `~${reading} to read at 200 wpm`,
    top.length
      ? `Most used: ${top.map(([word, n]) => `${word} ×${n}`).join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n"));
}

// ---- /json ----------------------------------------------------------------

function jsonTool(args: string): ToolOutcome {
  const text = args.trim();
  if (!text) return fail("Paste JSON after /json.");
  try {
    const parsed = JSON.parse(text) as unknown;
    const pretty = JSON.stringify(parsed, null, 2);
    const shape = JSON.stringify(parsed);
    return ok("JSON", [
      `Valid JSON · ${pretty.length} characters formatted`,
      `Root: ${Array.isArray(parsed) ? `array of ${parsed.length}` : typeof parsed}`,
      `Minified: ${shape.length} characters`,
      "",
      pretty,
    ].join("\n"));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not parse that.";
    return fail(message);
  }
}

// ---- /base64 --------------------------------------------------------------

const B64 = /^[A-Za-z0-9+/\s]+={0,2}$/;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64Tool(args: string): ToolOutcome {
  const text = args.trim();
  if (!text) return fail("Paste text after /base64 to encode, or base64 to decode.");

  // Padded base64 is a multiple of four *including* the = signs; measuring
  // without them made every padded string look like something to encode.
  const compact = text.replace(/\s+/g, "");
  if (B64.test(text) && compact.length % 4 === 0) {
    try {
      const binary = atob(compact);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      // Only claim it is base64 when the result is text; a hash or an image
      // decodes into bytes, which show up as control characters here.
      const printable = [...decoded].every(
        (ch) => ch >= " " || ch === "\n" || ch === "\t" || ch === "\r",
      );
      if (decoded && printable && !decoded.includes("\ufffd")) {
        return ok("Base64 decoded", decoded);
      }
    } catch {
      // Not base64 after all — fall through to encoding it.
    }
  }

  const encoded = bytesToBase64(new TextEncoder().encode(text));
  return ok("Base64 encoded", encoded);
}

// ---- /hash ----------------------------------------------------------------

async function hashTool(args: string): Promise<ToolOutcome> {
  const text = args.trim();
  if (!text) return fail("Type the text to hash after /hash.");
  const data = new TextEncoder().encode(text);
  const hex = (buffer: ArrayBuffer) =>
    [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

  const [sha256, sha1] = await Promise.all([
    crypto.subtle.digest("SHA-256", data),
    crypto.subtle.digest("SHA-1", data),
  ]);

  return ok("Hashes", [
    `SHA-256  ${hex(sha256)}`,
    `SHA-1    ${hex(sha1)}`,
    "",
    "SHA-1 is shown for compatibility only — never use it for passwords.",
  ].join("\n"));
}

// ---- /uuid ----------------------------------------------------------------

function uuidTool(args: string): ToolOutcome {
  const requested = Number.parseInt(args.trim(), 10);
  const count = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 20) : 1;
  const ids = Array.from({ length: count }, () => crypto.randomUUID());
  return ok(`${count} UUID${count === 1 ? "" : "s"} (v4)`, ids.join("\n"));
}

// ---- /ts ------------------------------------------------------------------

function timestampTool(args: string): ToolOutcome {
  const text = args.trim();
  if (!text) {
    const now = Date.now();
    return ok("Now", describeTime(now));
  }

  let ms: number;
  // Digits only are unix time: up to ten of them is seconds, eleven to
  // thirteen is milliseconds. Everything else is a date to parse.
  if (/^-?\d{1,10}$/.test(text)) ms = Number(text) * 1000;
  else if (/^-?\d{11,13}$/.test(text)) ms = Number(text);
  else if (/^-?\d+\.\d+$/.test(text)) ms = Number(text) * 1000;
  else {
    const parsed = Date.parse(text);
    if (Number.isNaN(parsed)) {
      return fail("Give a unix timestamp in seconds or milliseconds, or a date like 2026-11-05 14:30.");
    }
    ms = parsed;
  }

  return ok("Timestamps", describeTime(ms));
}

function describeTime(ms: number): string {
  const date = new Date(ms);
  const delta = Math.round((Date.now() - ms) / 1000);
  const relative =
    Math.abs(delta) < 60
      ? `${Math.abs(delta)} s ${delta >= 0 ? "ago" : "from now"}`
      : Math.abs(delta) < 3600
        ? `${Math.round(Math.abs(delta) / 60)} min ${delta >= 0 ? "ago" : "from now"}`
        : Math.abs(delta) < 86_400
          ? `${Math.round(Math.abs(delta) / 3600)} h ${delta >= 0 ? "ago" : "from now"}`
          : `${Math.round(Math.abs(delta) / 86_400)} days ${delta >= 0 ? "ago" : "from now"}`;
  return [
    `ISO        ${date.toISOString()}`,
    `Local      ${date.toLocaleString()}`,
    `Unix (s)   ${Math.floor(ms / 1000)}`,
    `Unix (ms)  ${ms}`,
    `Relative   ${relative}`,
  ].join("\n");
}

// ---- /convert -------------------------------------------------------------

type Unit = { base: string; factor: number };

const UNITS: Record<string, Unit> = {};
const addUnits = (base: string, table: Record<string, number>) => {
  for (const [unit, factor] of Object.entries(table)) UNITS[unit] = { base, factor };
};

addUnits("length", {
  mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144,
  mi: 1609.344, nmi: 1852,
});
addUnits("mass", {
  mg: 1e-6, g: 0.001, kg: 1, t: 1000, oz: 0.028349523125, lb: 0.45359237, st: 6.35029318,
});
addUnits("data", {
  b: 1, kb: 1000, mb: 1e6, gb: 1e9, tb: 1e12,
  kib: 1024, mib: 1024 ** 2, gib: 1024 ** 3, tib: 1024 ** 4,
});
addUnits("volume", {
  ml: 0.001, l: 1, cup: 0.2365882365, pt: 0.473176473, qt: 0.946352946,
  gal: 3.785411784, floz: 0.0295735295625,
});
addUnits("speed", { mps: 1, kph: 1 / 3.6, mph: 0.44704, knot: 0.514444444 });
addUnits("time", { s: 1, min: 60, h: 3600, day: 86_400, week: 604_800, year: 31_557_600 });

const TEMP = new Set(["c", "f", "k", "celsius", "fahrenheit", "kelvin"]);

const normaliseUnit = (raw: string): string => {
  const unit = raw.toLowerCase().replace(/[°º]/g, "").replace(/degrees?/, "").trim();
  const alias: Record<string, string> = {
    meters: "m", metre: "m", metres: "m", kilometer: "km", kilometers: "km",
    centimetre: "cm", centimeters: "cm", millimeters: "mm", miles: "mi",
    mile: "mi", feet: "ft", foot: "ft", inch: "in", inches: "in", yards: "yd",
    pounds: "lb", pound: "lb", lbs: "lb", ounces: "oz", ounce: "oz",
    grams: "g", kilogram: "kg", kilograms: "kg", tonnes: "t", tons: "t",
    bytes: "b", kilobytes: "kb", megabytes: "mb", gigabytes: "gb", terabytes: "tb",
    litres: "l", liters: "l", liter: "l", gallons: "gal", gallon: "gal",
    minutes: "min", minute: "min", hours: "h", hour: "h",
    seconds: "s", sec: "s", second: "s", days: "day", weeks: "week", years: "year",
    "km/h": "kph", kmh: "kph", "mi/h": "mph", knots: "knot", "m/s": "mps",
  };
  return alias[unit] ?? unit;
};

function toCelsius(value: number, unit: string): number {
  if (unit === "f") return ((value - 32) * 5) / 9;
  if (unit === "k") return value - 273.15;
  return value;
}

function fromCelsius(value: number, unit: string): number {
  if (unit === "f") return (value * 9) / 5 + 32;
  if (unit === "k") return value + 273.15;
  return value;
}

function convertTool(args: string): ToolOutcome {
  const match = args
    .trim()
    .match(/^(-?\d+(?:\.\d+)?)\s*([a-zA-Z°/]+)\s*(?:to|in|as|->)\s*([a-zA-Z°/]+)$/);
  if (!match) return fail("Write it as “10 km to mi” — a number, a unit, then the unit you want.");

  const value = Number(match[1]);
  const from = normaliseUnit(match[2]);
  const to = normaliseUnit(match[3]);

  if (TEMP.has(from) && TEMP.has(to)) {
    const result = fromCelsius(toCelsius(value, from), to);
    return ok(
      "Converted",
      `${num(value, 2)} ${from.toUpperCase()} = ${num(result, 2)} ${to.toUpperCase()}`,
    );
  }

  const a = UNITS[from];
  const b = UNITS[to];
  if (!a) return fail(`I do not know the unit “${match[2]}”.`);
  if (!b) return fail(`I do not know the unit “${match[3]}”.`);
  if (a.base !== b.base) {
    return fail(`“${from}” measures ${a.base}, “${to}” measures ${b.base} — those do not convert.`);
  }

  const result = (value * a.factor) / b.factor;
  return ok("Converted", `${num(value, 4)} ${from} = ${num(result, 4)} ${to}`);
}

// ---- /color ---------------------------------------------------------------

function parseColor(raw: string): { r: number; g: number; b: number } | null {
  const text = raw.trim().toLowerCase();
  const hex = text.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const full = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }
  const rgb = text.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (rgb) {
    return { r: Number(rgb[1]), g: Number(rgb[2]), b: Number(rgb[3]) };
  }
  return null;
}

function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function toHsl({ r, g, b }: { r: number; g: number; b: number }): [number, number, number] {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn), min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, Math.round(lightness * 100)];
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue: number;
  if (max === rn) hue = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) hue = ((bn - rn) / delta + 2) / 6;
  else hue = ((rn - gn) / delta + 4) / 6;
  return [Math.round(hue * 360), Math.round(saturation * 100), Math.round(lightness * 100)];
}

function colorTool(args: string): ToolOutcome {
  const color = parseColor(args);
  if (!color) return fail("Give a colour as hex (#2f6feb), rgb(47 111 235) or a name-free hex triple.");
  const [h, s, l] = toHsl(color);
  const lum = luminance(color);
  const contrast = (other: number) =>
    (Math.max(lum, other) + 0.05) / (Math.min(lum, other) + 0.05);
  const onWhite = contrast(1);
  const onBlack = contrast(0);
  const grade = (ratio: number) =>
    ratio >= 7 ? "AAA" : ratio >= 4.5 ? "AA" : ratio >= 3 ? "AA large only" : "fails";

  return ok("Colour", [
    `HEX   #${[color.r, color.g, color.b].map((c) => c.toString(16).padStart(2, "0")).join("")}`,
    `RGB   rgb(${color.r} ${color.g} ${color.b})`,
    `HSL   hsl(${h} ${s}% ${l}%)`,
    "",
    `On white  ${num(onWhite, 2)}:1  ${grade(onWhite)}`,
    `On black  ${num(onBlack, 2)}:1  ${grade(onBlack)}`,
    `Best text colour: ${onBlack > onWhite ? "white" : "black"}`,
  ].join("\n"));
}

// ---- /diff ----------------------------------------------------------------

function diffTool(args: string): ToolOutcome {
  const separator = args.includes("\n---\n") ? "\n---\n" : args.includes(" ||| ") ? " ||| " : null;
  if (!separator) {
    return fail("Put the two versions in one message, separated by a line containing only --- .");
  }
  const [left, right] = args.split(separator);
  const a = left.trimEnd().split(/\r?\n/);
  const b = right.trimEnd().split(/\r?\n/);
  if (a.length > 400 || b.length > 400) return fail("Keep each version under 400 lines.");

  // Longest common subsequence over lines: enough for prose and small diffs.
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] =
        a[i] === b[j]
          ? table[i + 1][j + 1] + 1
          : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const lines: string[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push(`  ${a[i]}`);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      lines.push(`- ${a[i]}`);
      removed += 1;
      i += 1;
    } else {
      lines.push(`+ ${b[j]}`);
      added += 1;
      j += 1;
    }
  }
  while (i < a.length) {
    lines.push(`- ${a[i]}`);
    removed += 1;
    i += 1;
  }
  while (j < b.length) {
    lines.push(`+ ${b[j]}`);
    added += 1;
    j += 1;
  }

  return ok(
    "Diff",
    [`${added} added, ${removed} removed`, "", ...lines].join("\n"),
  );
}

// ---- /case ----------------------------------------------------------------

function caseTool(args: string): ToolOutcome {
  const text = args.trim();
  if (!text) return fail("Give the text to convert after /case.");
  const parts = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase());
  if (parts.length === 0) return fail("Nothing to convert in that text.");
  const cap = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  const joined = parts.join("");

  return ok("Case", [
    `camel        ${parts[0]}${parts.slice(1).map(cap).join("")}`,
    `Pascal       ${parts.map(cap).join("")}`,
    `snake        ${parts.join("_")}`,
    `kebab        ${parts.join("-")}`,
    `CONSTANT     ${parts.join("_").toUpperCase()}`,
    `Title Case   ${parts.map(cap).join(" ")}`,
    `Sentence     ${cap(parts.join(" "))}`,
    `slug         ${joined}`,
  ].join("\n"));
}

// ---- /password ------------------------------------------------------------

const LOWER = "abcdefghijkmnopqrstuvwxyz";
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const DIGITS = "23456789";
const SYMBOLS = "!@#$%^&*-_=+?";

function passwordTool(args: string): ToolOutcome {
  const requested = Number.parseInt(args.trim(), 10);
  const length = Number.isFinite(requested) ? Math.min(Math.max(requested, 8), 128) : 20;
  const alphabet = LOWER + UPPER + DIGITS + SYMBOLS;
  const picks = new Uint32Array(length);
  crypto.getRandomValues(picks);

  // One character from each class first, so the result is never all letters.
  const seed = [LOWER, UPPER, DIGITS, SYMBOLS].map((set, index) => {
    const at = picks[index] % set.length;
    return set[at];
  });
  let password = seed.join("");
  for (let index = seed.length; index < length; index += 1) {
    password += alphabet[picks[index] % alphabet.length];
  }
  // Shuffle so the seeded characters are not always the first four.
  const shuffle = new Uint32Array(password.length);
  crypto.getRandomValues(shuffle);
  const chars = password.split("");
  for (let index = chars.length - 1; index > 0; index -= 1) {
    const swap = shuffle[index] % (index + 1);
    [chars[index], chars[swap]] = [chars[swap], chars[index]];
  }

  const bits = Math.round(length * Math.log2(alphabet.length));
  const crack =
    bits >= 100 ? "centuries at 10^11 guesses/s" : bits >= 70 ? "decades" : bits >= 50 ? "hours to days" : "weak";

  return ok(
    "Password",
    [
      chars.join(""),
      "",
      `${length} characters from a ${alphabet.length}-symbol alphabet`,
      `~${bits} bits of entropy — ${crack}`,
      "Generated locally; it was never sent anywhere.",
    ].join("\n"),
  );
}

// ---- /lorem ---------------------------------------------------------------

const LOREM = "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum".split(
  " ",
);

function loremTool(args: string): ToolOutcome {
  const requested = Number.parseInt(args.trim(), 10);
  const paragraphs = Number.isFinite(requested) ? Math.min(Math.max(requested, 1), 10) : 3;
  const pick = (seed: number) => LOREM[seed % LOREM.length];

  const output = Array.from({ length: paragraphs }, (_, p) => {
    const sentences = 3 + (p % 3);
    return Array.from({ length: sentences }, (_, s) => {
      const length = 8 + ((p * 3 + s * 5) % 9);
      const body = Array.from({ length }, (_, w) => pick(p * 37 + s * 11 + w * 3)).join(" ");
      return body.charAt(0).toUpperCase() + body.slice(1) + ".";
    }).join(" ");
  });

  return ok("Lorem ipsum", output.join("\n\n"));
}

// ---- registry -------------------------------------------------------------

export const LOCAL_TOOLS: Record<string, LocalTool> = {
  count: {
    aliases: ["wc", "wordcount"],
    summary: "Words, characters, sentences, reading time",
    argHint: "<text>",
    example: "/count paste your text here",
    needsArg: true,
    run: countTool,
  },
  json: {
    aliases: ["format"],
    summary: "Validate and pretty-print JSON",
    argHint: "<json>",
    example: '/json {"a":1}',
    needsArg: true,
    run: jsonTool,
  },
  base64: {
    aliases: ["b64"],
    summary: "Encode text to base64, or decode it",
    argHint: "<text or base64>",
    example: "/base64 hello",
    needsArg: true,
    run: base64Tool,
  },
  hash: {
    aliases: ["sha"],
    summary: "SHA-256 and SHA-1 of the text",
    argHint: "<text>",
    example: "/hash hello",
    needsArg: true,
    run: hashTool,
  },
  uuid: {
    aliases: ["id"],
    summary: "Generate v4 UUIDs",
    argHint: "[how many]",
    example: "/uuid 5",
    run: uuidTool,
  },
  ts: {
    aliases: ["timestamp", "epoch"],
    summary: "Unix timestamps and dates, both ways",
    argHint: "[unix time or date]",
    example: "/ts 0",
    run: timestampTool,
  },
  convert: {
    aliases: ["unit"],
    summary: "Convert units exactly — length, mass, data, volume, speed, time, temperature",
    argHint: "<10 km to mi>",
    example: "/convert 10 km to mi",
    needsArg: true,
    run: convertTool,
  },
  color: {
    aliases: ["colour"],
    summary: "Hex, RGB, HSL and WCAG contrast",
    argHint: "<#2f6feb>",
    example: "/color #2f6feb",
    needsArg: true,
    run: colorTool,
  },
  diff: {
    aliases: ["compare"],
    summary: "Line diff between two versions of a text",
    argHint: "<before --- after>",
    example: "/diff old line --- new line",
    needsArg: true,
    run: diffTool,
  },
  case: {
    aliases: ["casing"],
    summary: "Convert to camel, snake, kebab, CONSTANT and more",
    argHint: "<text>",
    example: "/case user profile ID",
    needsArg: true,
    run: caseTool,
  },
  password: {
    aliases: ["pass"],
    summary: "Generate a strong password locally",
    argHint: "[length]",
    example: "/password 24",
    run: passwordTool,
  },
  lorem: {
    aliases: ["ipsum"],
    summary: "Placeholder paragraphs",
    argHint: "[paragraphs]",
    example: "/lorem 3",
    run: loremTool,
  },
};

/** Runs a local tool by command name, or returns null when it is not one. */
export async function runLocalTool(name: string, args: string): Promise<ToolOutcome | null> {
  const tool = LOCAL_TOOLS[name];
  if (!tool) return null;
  try {
    return await tool.run(args);
  } catch (err) {
    return fail(err instanceof Error ? err.message : "That tool could not run.");
  }
}

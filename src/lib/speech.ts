// ---------------------------------------------------------------------------
// sanitizeForSpeech — turn a written Jarvis reply into speakable prose.
//
// A reply is written for the screen: markdown headings, tables, LaTeX, code
// fences, citation links, emoji. None of that should be read aloud — a TTS
// engine will happily pronounce "hash", "pipe", "backslash" and read a raw
// URL character by character. Every speech path (live mode, the per-message
// play button, and the Convex `speak` action itself) runs its text through
// this first, so the audio is always the *message*, never the markup.
//
// Pure, dependency-free and isomorphic: safe to import from the browser and
// from Convex server code alike.
// ---------------------------------------------------------------------------

/** Longest text we ever hand to a TTS engine (~2.5 min of speech). */
const DEFAULT_MAX_CHARS = 1400;

/** Symbols that add nothing when spoken. */
const PUNCTUATION = /[.!?…:;,'"“”‘’`()]/;

// ---------------------------------------------------------------------------
// Pronunciation
//
// Stripping the markup is only half the job. A TTS engine is a phonetic
// machine, not a reader: it has no idea that "°C" means "degrees celsius", so
// it spells it out letter by letter, and it happily shouts "WARNING" in the
// same flat voice it uses for "warning". Everything below rewrites the symbols
// and shorthand a reply uses on screen into the words a person would say.
// ---------------------------------------------------------------------------

const ONES = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
  "sixteen", "seventeen", "eighteen", "nineteen",
];
const TENS = [
  "", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy",
  "eighty", "ninety",
];

/** Spell out 0–999. Used for times, ordinals and fractions. */
function numberWords(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 999) return String(value);
  if (value < 20) return ONES[value];
  if (value < 100) {
    const tens = TENS[Math.floor(value / 10)];
    const ones = value % 10;
    return ones ? `${tens}-${ONES[ones]}` : tens;
  }
  const hundreds = `${ONES[Math.floor(value / 100)]} hundred`;
  const rest = value % 100;
  return rest ? `${hundreds} ${numberWords(rest)}` : hundreds;
}

/** 1st → first, 22nd → twenty-second, 31st → thirty-first. */
function ordinalWords(value: number): string {
  const irregular: Record<number, string> = {
    1: "first", 2: "second", 3: "third", 5: "fifth", 8: "eighth",
    9: "ninth", 12: "twelfth",
  };
  if (irregular[value]) return irregular[value];
  if (value < 20) return `${ONES[value]}th`;
  if (value >= 100) return `${numberWords(value)}th`;
  const tens = TENS[Math.floor(value / 10)];
  switch (value % 10) {
    // Hyphenated so the synthesiser reads them as two words: "twenty-first".
    case 1: return `${tens}-first`;
    case 2: return `${tens}-second`;
    case 3: return `${tens}-third`;
    // The "-eth" forms are single words already: twentieth, thirtieth.
    default: return `${tens.replace(/y$/, "ie")}th`;
  }
}

/** "1.5" → "one point five"; plain integers are left as digits. */
function numberPhrase(value: string): string {
  if (!value.includes(".")) return value;
  const [whole, fraction] = value.split(".");
  const wholeWords = whole && Number(whole) <= 999 ? numberWords(Number(whole)) : whole;
  const fractionWords = (fraction ?? "")
    .split("")
    .map((d) => ONES[Number(d)])
    .join(" ");
  return `${wholeWords} point ${fractionWords}`;
}

const MAGNITUDES: Record<string, string> = {
  k: "thousand", m: "million", b: "billion", t: "trillion",
};

const CURRENCY: Record<string, string> = {
  $: "dollars",
  "€": "euros",
  "£": "pounds",
  "₹": "rupees",
  "¥": "yen",
};

/** Denominator → fraction noun, e.g. 4 → quarter. */
const FRACTION_NOUNS: Record<number, [string, string]> = {
  2: ["half", "halves"],
  3: ["third", "thirds"],
  4: ["quarter", "quarters"],
  5: ["fifth", "fifths"],
  6: ["sixth", "sixths"],
  8: ["eighth", "eighths"],
  10: ["tenth", "tenths"],
};

/**
 * Rewrites symbols, units and shorthand into spoken words. Runs on prose only
 * (markup is already gone), so it never fights the markdown stripper.
 */
export function pronounceForSpeech(input: string): string {
  let text = input;
  if (!text) return "";

  // --- Degrees: the "°C" case, before the bare degree sign -------------------
  text = text
    .replace(/[℃]/g, " degrees celsius")
    .replace(/[℉]/g, " degrees fahrenheit")
    .replace(/°\s*C\b/gi, " degrees celsius")
    .replace(/°\s*F\b/gi, " degrees fahrenheit")
    .replace(/\bdeg(?:rees?)?\.?\s*C\b/gi, " degrees celsius")
    .replace(/\bdeg(?:rees?)?\.?\s*F\b/gi, " degrees fahrenheit")
    .replace(/°/g, " degrees ");

  // --- Units ----------------------------------------------------------------
  const UNITS: Array<[RegExp, string]> = [
    [/\bkilomet(?:er|re)s?\s*(?:per|\/)\s*h(?:ou)?r/gi, "kilometres per hour"],
    [/\bmiles?\s*(?:per|\/)\s*h(?:ou)?r/gi, "miles per hour"],
    [/\bkm\s*\/\s*h\b/gi, "kilometres per hour"],
    [/\bmph\b/gi, "miles per hour"],
    [/\bkm\s*\/\s*s\b/gi, "kilometres per second"],
    [/\bcm\b/gi, "centimetres"],
    [/\bmm\b/gi, "millimetres"],
    [/\bkm\b/gi, "kilometres"],
    [/\bmg\b/gi, "milligrams"],
    [/\bkg\b/gi, "kilograms"],
    [/\bml\b/gi, "millilitres"],
    [/\bms\b/gi, "milliseconds"],
    [/\bgb\b/gi, "gigabytes"],
    [/\bmb\b/gi, "megabytes"],
    [/\bhz\b/gi, "hertz"],
    [/\bghz\b/gi, "gigahertz"],
    [/\bmhz\b/gi, "megahertz"],
    [/\bhrs?\b/gi, "hours"],
    [/\bsecs?\b/gi, "seconds"],
    [/\bmins?\b/gi, "minutes"],
    [/\bfps\b/gi, "frames per second"],
    [/\brpm\b/gi, "revolutions per minute"],
    [/\bmetres?\s*\/\s*s\b/gi, "metres per second"],
    [/\bm\s*\/\s*s\b/g, "metres per second"],
    [/\bknots?\b/gi, "knots"],
  ];
  for (const [pattern, words] of UNITS) text = text.replace(pattern, words);

  // --- Percentages, maths and operators -------------------------------------
  // Two-character comparisons go first, or they decompose into nonsense
  // ("<=" would become "less than equals").
  text = text
    .replace(/<=/g, " less than or equal to ")
    .replace(/>=/g, " greater than or equal to ")
    .replace(/!=/g, " is not equal to ")
    .replace(/==/g, " equals ")
    .replace(/%/g, " percent ")
    .replace(/&/g, " and ")
    .replace(/&amp;/gi, " and ")
    .replace(/=/g, " equals ")
    .replace(/</g, " less than ")
    .replace(/>/g, " greater than ")
    .replace(/~/g, " approximately ")
    .replace(/@/g, " at ")
    .replace(/\+/g, " plus ")
    .replace(/\*/g, " times ")
    .replace(/⁄/g, " slash ")
    .replace(/²/g, " squared")
    .replace(/³/g, " cubed")
    // 1/2 → one half, 3/4 → three quarters
    .replace(/\b(\d+)\s*\/\s*(\d+)\b/g, (match, num: string, den: string) => {
      const noun = FRACTION_NOUNS[Number(den)];
      if (!noun) return match;
      return Number(num) === 1 ? noun[0] : `${numberWords(Number(num))} ${noun[1]}`;
    });

  // --- Currency and magnitudes ----------------------------------------------
  // "$1.5M" → "one point five million dollars", "2.5k" → "two point five thousand".
  const withMagnitude = (num: string, gap = "", mag?: string) =>
    `${numberPhrase(num)}${gap}${mag ? ` ${MAGNITUDES[mag.toLowerCase()]}` : ""}`;

  text = text
    .replace(
      /([$€£₹¥])(\s*)(\d+(?:\.\d+)?)(\s*)([kmbtKMBT])?/g,
      (_m, sym: string, pre: string, num: string, post: string, mag?: string) =>
        `${CURRENCY[sym]} ${pre}${withMagnitude(num, "", mag)}${post}`,
    )
    .replace(
      /(\d+(?:\.\d+)?)(\s*)([$€£₹¥])/g,
      (_m, num: string, gap: string, sym: string) =>
        `${withMagnitude(num)}${gap || " "}${CURRENCY[sym]}`,
    )
    .replace(
      /\b(\d+(?:\.\d+)?)(\s*)([kmbtKMBT])\b/g,
      (m, num: string, gap: string, mag: string) =>
        // Leave "5 ft" style lone letters alone; only expand known magnitudes.
        MAGNITUDES[mag.toLowerCase()]
          ? `${withMagnitude(num, gap || " ", mag)}`
          : m,
    )
    .replace(/[$€£₹¥]/g, "");

  // --- Unicode vulgar fractions ---------------------------------------------
  const VULGAR: Record<string, string> = {
    "½": "one half", "¼": "one quarter", "¾": "three quarters",
    "⅓": "one third", "⅔": "two thirds", "⅛": "one eighth",
  };
  text = text.replace(/[½¼¾⅓⅔⅛]/g, (m) => VULGAR[m] ?? m);

  // --- Numbers: clock times, ratios, ranges, negative values, ordinals -----
  text = text
    // 3:30 → "half past three", 9:00 → "nine o'clock"
    .replace(/\b(\d{1,2}):(\d{2})\b/g, (_m, h: string, min: string) => {
      const hour = Number(h);
      const minute = Number(min);
      if (minute === 0) return `${numberWords(hour)} o'clock`;
      if (minute === 30) return `half past ${numberWords(hour)}`;
      return `${numberWords(hour)} ${numberWords(minute)}`;
    })
    // 16:9 → "sixteen by nine" (aspect ratios and similar)
    .replace(/\b(\d+):(\d+)\b/g, (_m, a: string, b: string) =>
      Number(a) <= 999 && Number(b) <= 999
        ? `${numberWords(Number(a))} by ${numberWords(Number(b))}`
        : `${a} to ${b}`,
    )
    // 5'9" → "five foot nine"
    .replace(/\b(\d+)\s*['′]\s*(\d+(?:\.\d+)?)\s*["″]/g,
      (_m, feet: string, inches: string) =>
        `${numberWords(Number(feet))} foot ${numberWords(Number(inches))}`,
    )
    // 10-20 → "10 to 20" (word-anchored so "COVID-19" is left alone)
    .replace(/(^|[\s(])(\d+)\s*[-–—]\s*(\d+)/g, "$1$2 to $3")
    // -4 → "minus four", once ranges have already been consumed
    .replace(/(^|[\s(])[-−]\s*(\d)/g, "$1 minus $2")
    // 21st → "twenty-first"
    .replace(/\b(\d{1,2})(?:st|nd|rd|th)\b/gi, (_m, n: string) => ordinalWords(Number(n)));

  // --- Abbreviations a synthesiser reads as letter soup ---------------------
  const ABBREVIATIONS: Array<[RegExp, string]> = [
    [/\be\.g\.,?/gi, "for example"],
    [/\bi\.e\.,?/gi, "that is"],
    [/\betc\.,?/gi, "et cetera"],
    [/\bvs\.?/gi, "versus"],
    [/\bapprox\.,?/gi, "approximately"],
    [/\bno\.\s*/gi, "number "],
    [/\bfig\.\s*/gi, "figure "],
    [/\bDr\./g, "Doctor"],
    [/\bMr\./g, "Mister"],
    [/\bMrs\./g, "Missus"],
    [/\bMs\./g, "Miss"],
    [/\bProf\./g, "Professor"],
    [/\bSt\./g, "Saint"],
    [/\bJr\./g, "Junior"],
    [/\bSr\./g, "Senior"],
    [/\bJan\./g, "January"],
    [/\bFeb\./g, "February"],
    [/\bMar\./g, "March"],
    [/\bApr\./g, "April"],
    [/\bJun\./g, "June"],
    [/\bJul\./g, "July"],
    [/\bAug\./g, "August"],
    [/\bSep\./g, "September"],
    [/\bSept\./g, "September"],
    [/\bOct\./g, "October"],
    [/\bNov\./g, "November"],
    [/\bDec\./g, "December"],
  ];
  for (const [pattern, words] of ABBREVIATIONS) text = text.replace(pattern, words);

  // --- Tone -----------------------------------------------------------------
  // Emphasis headers should not be shouted in a flat synthetic voice, and a
  // run of punctuation reads as noise rather than emphasis.
  text = text.replace(
    /\b(IMPORTANT|WARNING|NOTICE|CAUTION|URGENT|CRITICAL|TIP|NOTE|SUMMARY|ANSWER|EXAMPLE)\b/g,
    (word) => word[0] + word.slice(1).toLowerCase(),
  );
  text = text
    .replace(/!{2,}/g, "!")
    .replace(/\?{2,}/g, "?")
    .replace(/…{1,}|\.{3,}/g, ", ")
    .replace(/\s*(?:—|--)\s*/g, ", ")
    .replace(/\s+([,.!?;:])/g, "$1");

  return text;
}

/** Common LaTeX macros → words, so an equation isn't read as gibberish. */
const LATEX_WORDS: Array<[RegExp, string | ((match: string) => string)]> = [
  [/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1 over $2"],
  [/\\dfrac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1 over $2"],
  [/\\tfrac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "$1 over $2"],
  [/\\sqrt\s*\{([^{}]*)\}/g, "square root of $1"],
  [/\\cdot|\\times/g, " times "],
  [/\\div/g, " divided by "],
  [/\\pm/g, " plus or minus "],
  [/\\mp/g, " minus or plus "],
  [/\\leq|\\le\b/g, " less than or equal to "],
  [/\\geq|\\ge\b/g, " greater than or equal to "],
  [/\\neq|\\ne\b/g, " not equal to "],
  [/\\approx/g, " approximately "],
  [/\\equiv/g, " is identical to "],
  [/\\infty/g, " infinity "],
  [/\\sum\b/g, " sum "],
  [/\\prod\b/g, " product "],
  [/\\int\b/g, " integral "],
  [/\\lim\b/g, " limit "],
  [/\\log\b|\\ln\b|\\exp\b/g, " log "],
  [/\\sin\b|\\cos\b|\\tan\b|\\sec\b|\\csc\b|\\cot\b/g, (m: string) => m.slice(1)],
  [/\\rightarrow|\\to\b|\\Rightarrow/g, " implies "],
  [/\\leftarrow/g, " is implied by "],
  [/\\Rightarrow/g, " therefore "],
  [/\\in\b/g, " in "],
  [/\\pi\b/g, " pi "],
  [/\\theta\b/g, " theta "],
  [/\\alpha\b/g, " alpha "],
  [/\\beta\b/g, " beta "],
  [/\\lambda\b/g, " lambda "],
  [/\\mu\b/g, " mu "],
  [/\\sigma\b/g, " sigma "],
  [/\\omega\b/g, " omega "],
  [/\\ldots|\\dots|\\cdots/g, ", "],
  [/\\quad|\\qquad|\\,|\\;|\\!|\\ /g, " "],
  [/\\left|\\right|\\displaystyle|\\textstyle/g, " "],
  [/\\text\s*\{([^{}]*)\}/g, "$1"],
  [/\\mathrm\s*\{([^{}]*)\}/g, "$1"],
  [/\\mathbf\s*\{([^{}]*)\}/g, "$1"],
  [/\\(?:begin|end)\s*\{[^{}]*\}/g, " "],
];

/** Strip everything a screen reader of a chat reply would never say. */
export function sanitizeForSpeech(
  input: string,
  maxChars: number = DEFAULT_MAX_CHARS,
): string {
  if (!input) return "";

  let text = String(input);

  // --- Media & embeds -------------------------------------------------------
  // --- Links, references and citations (before bare URLs) --------------------
  // A markdown link must be unwrapped before the URL strip, otherwise the
  // URL regex eats the target and leaves the orphaned "[1](" behind.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " "); // images / image markdown
  text = text.replace(/!\[[^\]]*\]\[[^\]]*\]/g, " ");
  // A citation is just a number in a link — drop it rather than read "1".
  text = text.replace(/\[\s*\d+\s*\]\([^)]*\)/g, " ");
  text = text.replace(/\[\s*\d+\s*\]\[[^\]]*\]/g, " ");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1"); // [label](url)
  text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1"); // [label][ref]
  text = text.replace(/<\/?[a-zA-Z][^>]*>/g, " "); // stray HTML tags
  text = text.replace(/<https?:\/\/[^>]+>/g, " ");
  text = text.replace(/https?:\/\/\S+/g, " "); // bare URLs
  text = text.replace(/(?:^|(?<=\s))www\.\S+/g, " ");

  // --- Code ----------------------------------------------------------------
  // Code is never spoken; a short cue keeps the reply from feeling truncated.
  text = text.replace(/```[\s\S]*?```/g, " (code omitted) ");
  text = text.replace(/~~~[\s\S]*?~~~/g, " (code omitted) ");
  text = text.replace(/`([^`]*)`/g, "$1");
  // Emphasis goes before the sub/superscript pass so "_italics_" doesn't turn
  // into "italics sub".
  text = text.replace(/([*_~]{1,3})(?=\S)([^\n]*?\S)\1/g, "$2");

  // --- Maths ---------------------------------------------------------------
  text = text.replace(/\\begin\{(equation|align|gather|array|cases|bmatrix)[\s\S]*?\\end\{\1\}/g, " (equation) ");
  text = text.replace(/\$\$[\s\S]*?\$\$/g, " (equation) ");
  text = text.replace(/\\\[[\s\S]*?\\\]/g, " (equation) ");
  text = text.replace(/\$[^$\n]+\$/g, " (equation) ");
  text = text.replace(/\\\([\s\S]*?\\\)/g, " (equation) ");
  // Superscripts: a caret is unambiguous even mid-token (m/s^2).
  text = text.replace(
    /([A-Za-z0-9)\]])\^\{?([^\s,.;:)\]}]+?)\}?(?=[\s,.;:)\]}]|$)/g,
    "$1 to the power of $2 ",
  );
  // Subscripts: only at a word boundary, so snake_case survives intact.
  text = text.replace(
    /(^|[\s(])_\{?([^\s,.;:)\]}]+?)\}?(?=[\s,.;:)\]}]|$)/g,
    "$1$2 sub ",
  );
  for (const [pattern, replacement] of LATEX_WORDS) {
    text =
      typeof replacement === "function"
        ? text.replace(pattern, replacement)
        : text.replace(pattern, replacement);
  }
  // Any remaining LaTeX control sequences are noise.
  text = text.replace(/\\[a-zA-Z]+/g, " ");

  // --- Citations ------------------------------------------------------------
  text = text.replace(/\[\s*\d+\s*\]/g, " "); // citation markers [1]

  // --- Tables --------------------------------------------------------------
  text = text.replace(/^\s*\|?[\s:|-]{4,}\|?\s*$/gm, " "); // |---|---|
  text = text.replace(/^\s*\|(.+)\|\s*$/gm, (_m, row: string) =>
    row
      .split("|")
      .map((cell) => cell.trim())
      .filter(Boolean)
      .join(", ") + ".",
  );
  text = text.replace(/\|/g, " ");

  // --- Block markup --------------------------------------------------------
  text = text.replace(/^\s{0,3}>\s?/gm, ""); // blockquote
  text = text.replace(/^\s*([-*_]\s*){3,}$/gm, " "); // horizontal rules
  text = text.replace(/^\s{0,3}#{1,6}\s*/gm, ""); // headings
  text = text.replace(/^\s*[-*+]\s+/gm, ""); // bullets
  text = text.replace(/^\s*\d+[.)]\s+/gm, ""); // numbered lists
  text = text.replace(/^\s*[-*+]\s{2,}\[[ xX]\]\s*/gm, ""); // task boxes
  text = text.replace(/[*_~]{1,3}/g, ""); // leftover emphasis / rules
  text = text.replace(/^#{1,6}\s*$/gm, " ");
  text = text.replace(/\|+/g, " ");

  // --- Emoji ---------------------------------------------------------------
  text = text.replace(
    /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F1E6}-\u{1F1FF}\u{2B00}-\u{2BFF}]/gu,
    " ",
  );

  // --- Shape the prose -----------------------------------------------------
  // Symbols first: whatever the markup strippers could not express as a word
  // (arrows, comparison signs, the odd glyph) gets spoken here, then the whole
  // line is normalised to words by the pronunciation pass.
  text = text
    .replace(/[→⇒]/g, " leads to ")
    .replace(/[←⇐]/g, " comes from ")
    .replace(/[↔⇔]/g, " is related to ")
    .replace(/≤/g, " less than or equal to ")
    .replace(/≥/g, " greater than or equal to ")
    .replace(/≠/g, " not equal to ")
    .replace(/≈/g, " approximately ")
    .replace(/[×✕]/g, " times ")
    .replace(/÷/g, " divided by ")
    .replace(/±/g, " plus or minus ")
    // Note: < and > are deliberately left for the pronunciation pass, which
    // turns them into "less than" / "greater than".
    .replace(/[{}[\]|]/g, " ");

  // Turn what is left into words a person would actually say.
  text = pronounceForSpeech(text);

  // One sentence per source line: a line that doesn't already end in
  // punctuation gets a full stop so the TTS engine pauses in the right place
  // instead of running two list items together.
  text = text
    .split(/\n+/)
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .map((line) => (PUNCTUATION.test(line.slice(-1)) ? line : `${line}.`))
    .join(" ");

  text = text.replace(/\s+/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
  text = text.replace(/([,.;:!?]){2,}/g, "$1");
  text = text.replace(/\s+/g, " ").trim();

  // A reply that was nothing but code/math has no words to say — speaking
  // "(code omitted)" out loud is worse than staying quiet and listening.
  const words = text
    .replace(/\((?:code|equation|image|link)[^)]*\)/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 2) return "";

  if (text.length > maxChars) {
    const clipped = text.slice(0, maxChars);
    const lastStop = Math.max(
      clipped.lastIndexOf(". "),
      clipped.lastIndexOf("! "),
      clipped.lastIndexOf("? "),
    );
    // Prefer a sentence boundary; only fall back to a word boundary.
    const cut =
      lastStop > maxChars * 0.4 ? lastStop + 1 : clipped.lastIndexOf(" ") || maxChars;
    text = `${clipped.slice(0, cut).replace(/[\s,;:]+$/, "")}.`;
  }

  return text.trim();
}

/** Split spoken prose into sentence-sized chunks (crisper barge-in, less robotic). */
export function speechSentences(text: string): string[] {
  return (text.match(/[^.!?…]+[.!?…]+(?=\s|$)|[^.!?…]+$/g) ?? [text])
    .map((s) => s.trim())
    .filter(Boolean);
}

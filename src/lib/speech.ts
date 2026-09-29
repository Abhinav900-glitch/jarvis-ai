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
  // Arrows and other symbols that a TTS engine would spell out letter by letter.
  text = text
    .replace(/[→⇒]/g, " leads to ")
    .replace(/[←⇐]/g, " comes from ")
    .replace(/[↔⇔]/g, " is related to ")
    .replace(/[⇒]/g, " therefore ")
    .replace(/≤/g, " less than or equal to ")
    .replace(/≥/g, " greater than or equal to ")
    .replace(/≠/g, " not equal to ")
    .replace(/≈/g, " approximately ")
    .replace(/[×✕]/g, " times ")
    .replace(/÷/g, " divided by ")
    .replace(/±/g, " plus or minus ")
    .replace(/[<>{}[\]|]/g, " ");
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

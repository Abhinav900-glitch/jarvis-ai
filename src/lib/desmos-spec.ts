// ---------------------------------------------------------------------------
// Desmos ```desmos block parsing — pure, no React.
//
// ```desmos
// mode: graphing | 3d | scientific | geometry   (default: graphing)
// zoom: <number>                                (optional)
// expressions:
// y = x^2
// y = 2x + 1
// ```
//
// Every line is normalised to Desmos LaTeX before it reaches the calculator.
// The model is asked for plain ASCII maths, but it does not always obey: it
// writes `π`, `²`, `≤`, `\frac`, `d/dx`, bullets, or a whole sentence, and
// Desmos then draws nothing at all — silently, because a rejected expression
// is indistinguishable from an empty graph. So the parser accepts all of it
// and rewrites it into the canonical form `setExpressions({ latex })` expects.
// ---------------------------------------------------------------------------

export interface DesmosSpec {
  mode: "graphing" | "3d" | "scientific" | "geometry" | "fourfunction";
  zoom?: number;
  expressions: string[];
}

/** `mode:` values the model reaches for, mapped to the calculator it means. */
const MODE_ALIASES: Record<string, DesmosSpec["mode"]> = {
  graphing: "graphing",
  graph: "graphing",
  graph2d: "graphing",
  "2d": "graphing",
  cartesian: "graphing",
  plot: "graphing",
  plotting: "graphing",
  // Desmos has no polar or parametric calculator: both are ordinary
  // expressions in the 2D calculator (`r = …`, `(cos(t), sin(t))`).
  polar: "graphing",
  parametric: "graphing",
  implicit: "graphing",
  "3d": "3d",
  "3": "3d",
  threed: "3d",
  surface: "3d",
  scientific: "scientific",
  sci: "scientific",
  calculator: "scientific",
  fourfunction: "fourfunction",
  fourfunc: "fourfunction",
  four: "fourfunction",
  basic: "fourfunction",
  simple: "fourfunction",
  geometry: "geometry",
  geometric: "geometry",
  construction: "geometry",
};

/** Words that only ever appear in a sentence, never in an expression. */
const PROSE_WORDS = new Set([
  "the", "this", "that", "these", "those", "then", "there", "here", "is",
  "are", "was", "were", "be", "note", "see", "so", "also", "just", "about",
  "shows", "shown", "represents", "means", "gives", "where", "with", "from",
  "into", "above", "below", "between", "before", "after", "graph", "graphed",
  "plot", "plotted", "sketch", "sketched", "draw", "drawn", "curve", "curves",
  "line", "lines", "point", "points", "axis", "axes", "grid", "blue", "red",
  "green", "orange", "purple", "dashed", "solid", "dotted", "shaded", "fill",
  "function", "functions", "desmos", "calculator", "slider", "window", "view",
]);

/** Unicode maths a model emits far more often than ASCII, and its LaTeX form. */
const UNICODE_MAP: [RegExp, string][] = [
  [/[−–—]/g, "-"],
  [/[×·⋅∙]/g, "\\cdot "],
  [/÷/g, "/"],
  [/≤/g, "\\le "],
  [/≥/g, "\\ge "],
  [/≠/g, "\\ne "],
  [/≈/g, "\\approx "],
  [/∞/g, "\\infty "],
  [/√/g, "sqrt"],
  [/π/g, "\\pi "],
  [/θ/g, "\\theta "],
  [/α/g, "\\alpha "],
  [/β/g, "\\beta "],
  [/γ/g, "\\gamma "],
  [/δ/g, "\\delta "],
  [/λ/g, "\\lambda "],
  [/μ/g, "\\mu "],
  [/φ/g, "\\phi "],
  [/ω/g, "\\omega "],
  [/Δ/g, "\\Delta "],
  [/Σ/g, "\\sum "],
  [/∫/g, "\\int "],
  [/∂/g, "\\partial "],
  [/→/g, "\\to "],
  [/²/g, "^{2}"],
  [/³/g, "^{3}"],
  [/⁴/g, "^{4}"],
  [/¹/g, "^{1}"],
  [/⁰/g, "^{0}"],
  [/[′’]/g, "'"],
  [/°/g, "^{\\circ}"],
];

/** Functions Desmos renders from a backslash command of the same name. */
const NAMED_FUNCTIONS = [
  "arcsinh", "arccosh", "arctanh", "arcsin", "arccos", "arctan",
  "sinh", "cosh", "tanh", "coth", "sin", "cos", "tan", "sec", "csc", "cot",
  "ln", "log", "exp", "det",
];

// No leading `\b`: `2cos(x)` is legitimate Desmos input for 2·cos(x), and a
// word boundary does not exist between a digit and a letter. The lookbehind
// still stops `sin` from matching inside `arcsin`, and `\sin` from doubling up.
const FUNCTION_RE = new RegExp(
  `(?<![a-zA-Z\\\\])(${NAMED_FUNCTIONS.join("|")})\\b(?=\\s*[(a-zA-Z0-9\\\\])`,
  "g",
);

/** Greek letters written as words, which Desmos wants as commands. */
const GREEK = [
  "pi", "theta", "alpha", "beta", "gamma", "delta", "epsilon", "lambda",
  "mu", "nu", "rho", "sigma", "tau", "phi", "psi", "omega",
  "Delta", "Sigma", "Omega",
];
const GREEK_RE = new RegExp(`(?<![a-zA-Z\\\\])(${GREEK.join("|")})\\b`, "g");

/** Replace `word(...)` with build(inner), balancing nested parens. */
function replaceBalanced(
  input: string,
  word: string,
  build: (arg: string) => string,
): string {
  const re = new RegExp(`\\b${word}\\s*\\(`, "g");
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input))) {
    out += input.slice(last, m.index);
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < input.length && depth > 0) {
      if (input[i] === "(") depth++;
      else if (input[i] === ")") depth--;
      if (depth > 0) i++;
    }
    out += build(input.slice(m.index + m[0].length, i));
    last = i + 1; // skip the closing paren
  }
  out += input.slice(last);
  return out;
}

/** `^` / `_` followed by one token → braced group: `x^2` → `x^{2}`. */
function braceScripts(tex: string): string {
  let out = "";
  for (let i = 0; i < tex.length; i++) {
    const ch = tex[i];
    if (ch === "^" || ch === "_") {
      out += ch;
      i++;
      if (tex[i] === "{") {
        let depth = 1;
        let j = i + 1;
        while (j < tex.length && depth > 0) {
          if (tex[j] === "{") depth++;
          else if (tex[j] === "}") depth--;
          if (depth > 0) j++;
        }
        out += tex.slice(i, j + 1);
        i = j;
      } else if (tex[i] === "(") {
        let depth = 1;
        let j = i + 1;
        while (j < tex.length && depth > 0) {
          if (tex[j] === "(") depth++;
          else if (tex[j] === ")") depth--;
          if (depth > 0) j++;
        }
        out += `{${tex.slice(i + 1, j)}}`;
        i = j;
      } else if (tex[i] === "-") {
        // `x^-1` must become `x^{-1}`, not `x^{-}1`.
        const next = tex[i + 1];
        out += next !== undefined ? `{-${next}}` : "{-}";
        i++;
      } else if (i < tex.length) {
        out += `{${tex[i]}}`;
      }
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * LaTeX written before this function (or a previous run) is already canonical:
 * `\left(`/`\right)` are dropped so the paren pass below can re-add them
 * consistently, and the spacing commands Desmos ignores are removed.
 */
function stripExplicitSyntax(tex: string): string {
  return tex
    // Unescape first, so `\left\{` becomes `\left{` and the pass below can
    // drop the `\left` like any other delimiter prefix.
    .replace(/\\\{/g, "{")
    .replace(/\\\}/g, "}")
    .replace(/\\left(?![a-zA-Z])/g, "")
    .replace(/\\right(?![a-zA-Z])/g, "")
    .replace(/\\(?:quad|qquad)\b/g, " ")
    .replace(/\\[,;:!]/g, " ")
    .replace(/\\displaystyle\b/g, "")
    .replace(/\\limits\b/g, "")
    .replace(/\\[dt]frac\b/g, "\\frac")
    // `\text{for }` / `\mathrm{cm}` carry units and labels Desmos cannot plot.
    .replace(/\\(?:text|textrm|mathrm|mathit|operatorname)\s*\{([^{}]*)\}/g, "$1")
    .replace(/\\operatorname\s*\{(arcsin|arccos|arctan|sin|cos|tan|ln|log)\}/g, "\\$1")
    // `\theta )` → `\theta)`: the space the unicode map adds for separation is
    // only wanted between two operands.
    .replace(/\s+([),}\]]\.?)/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Turn `{0 < x < 5}` (a domain restriction or a piecewise branch) into
 * `\left\{0 < x < 5\right\}`, which is what Desmos expects.
 *
 * Only brace groups that actually contain a condition are converted: braces
 * that belong to a command (`\frac{a}{b}`, `\sqrt{x}`) or to a script
 * (`x^{2}`) must be left exactly as they are, or the expression stops parsing.
 */
function braceSets(tex: string): string {
  const isCondition = (inner: string) =>
    /[<>]|\\[lg]e\b|\\[lg]t\b/.test(inner);

  let out = "";
  let i = 0;
  while (i < tex.length) {
    if (tex[i] !== "{") {
      out += tex[i];
      i++;
      continue;
    }
    // Find the matching close, honouring nesting.
    let depth = 1;
    let j = i + 1;
    while (j < tex.length && depth > 0) {
      if (tex[j] === "{") depth++;
      else if (tex[j] === "}") depth--;
      if (depth > 0) j++;
    }
    const before = out.replace(/\s+$/, "");
    const isScript = /[\^_]$/.test(before);
    const isCommandArg = /\\[a-zA-Z]+$/.test(before);
    const inner = tex.slice(i + 1, j);
    if (isScript || isCommandArg || !isCondition(inner)) {
      out += tex.slice(i, j + 1);
    } else {
      out += `\\left\\{${inner}\\right\\}`;
    }
    i = j + 1;
  }
  return out;
}

/**
 * `\begin{cases} a & x<0 \\ b & x\ge 0 \end{cases}` → the piecewise form
 * Desmos uses: `{x<0: a, x\ge 0: b}`. A model asked for a piecewise function
 * reaches for `cases` far more often than for Desmos's own notation.
 */
function casesToPiecewise(tex: string): string {
  return tex.replace(
    /\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g,
    (_match, body: string) => {
      const branches = body
        .split(/\\\\/)
        .map((row) => row.trim())
        .filter(Boolean)
        .map((row) => {
          const parts = row.split("&").map((p) => p.trim());
          if (parts.length < 2) return parts[0] ?? "";
          return `${parts[1]}: ${parts[0]}`;
        })
        .filter(Boolean);
      return `{${branches.join(", ")}}`;
    },
  );
}

/**
 * One line of a ```desmos block → the LaTeX Desmos should plot.
 *
 * Returns null for anything that is not an expression (prose, headers,
 * bullets containing words, an empty line), so a stray sentence can never
 * become a red error box in the graph.
 */
export function normalizeDesmosExpression(raw: string): string | null {
  let line = raw.trim();
  if (!line) return null;

  // Fences, list markers and numbering the model adds out of habit.
  line = line.replace(/^```[a-z]*\s*/i, "").replace(/```$/, "").trim();
  line = line.replace(/^(?:[-*•+>]|\(?\d{1,2}[.)])\s+/, "").trim();
  line = line.replace(/^expressions?\s*:\s*/i, "").trim();

  // Drop math delimiters: the block is already maths, and `$` makes Desmos
  // treat the line as text.
  line = line.replace(/^\${1,2}/, "").replace(/\${1,2}$/, "").trim();
  line = line.replace(/^\\[([\]]/, "").replace(/\\[)\]]$/, "").trim();
  line = line.replace(/[;,.]+$/, "").trim();
  if (!line) return null;

  // A sentence, not an expression.
  const words = line.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 2);
  if (words.filter((w) => PROSE_WORDS.has(w)).length >= 2) return null;

  // Nothing in the line could be plotted or evaluated.
  if (!/[=<>]|[(,]|\\|\^|_|\|/.test(line)) return null;

  let tex = line;
  for (const [re, replacement] of UNICODE_MAP) tex = tex.replace(re, replacement);

  tex = casesToPiecewise(tex);
  tex = stripExplicitSyntax(tex);

  // `d/dx` and `d^2/dx^2` — how a model writes a derivative, and what Desmos
  // calls `\frac{d}{dx}`.
  tex = tex.replace(/\bd\s*\^\s*(\d)\s*\/\s*dx\s*\^\s*\1\b/g, "\\frac{d^{$1}}{dx^{$1}}");
  tex = tex.replace(/\bd\s*\/\s*dx\b/g, "\\frac{d}{dx}");
  tex = tex.replace(/\bdy\s*\/\s*dx\b/g, "\\frac{d}{dx}");
  tex = tex.replace(/\bpartial\s*\/\s*partial\s*x\b/g, "\\frac{\\partial}{\\partial x}");

  // Roots, absolutes, and function names: `sqrt(x)` → `\sqrt{x}`.
  tex = replaceBalanced(tex, "sqrt", (arg) => `\\sqrt{${arg}}`);
  tex = tex.replace(/\\sqrt\s*(?!\{)([a-zA-Z0-9]|\\[a-zA-Z]+)/g, "\\sqrt{$1}");
  tex = replaceBalanced(tex, "abs", (arg) => `\\left|${arg}\\right|`);
  tex = tex.replace(/(?<!\\left)\|([^|]+)\|/g, "\\left|$1\\right|");
  tex = tex.replace(GREEK_RE, "\\$1");
  tex = tex.replace(FUNCTION_RE, "\\$1");

  // Comparisons: Desmos understands `<=` too, but `\le` is canonical and is
  // what the CSV/LaTeX paths already produce.
  tex = tex
    .replace(/<=|≤/g, "\\le ")
    .replace(/>=|≥/g, "\\ge ")
    .replace(/!=/g, "\\ne ")
    .replace(/=?<(?!=)/g, (m) => (m === "<" ? "<" : m))
    .replace(/\*/g, "\\cdot ");

  tex = braceScripts(tex);
  tex = braceSets(tex);

  // Balanced parens become delimited ones, matching every expression Desmos
  // writes itself. Unbalanced input is left alone rather than half-converted.
  const opens = (tex.match(/\(/g) ?? []).length;
  const closes = (tex.match(/\)/g) ?? []).length;
  if (opens > 0 && opens === closes) {
    tex = tex.replace(/\(/g, "\\left(").replace(/\)/g, "\\right)");
  }

  tex = tex.replace(/\s{2,}/g, " ").trim();
  // A line of pure decoration (`---`, `...`) is not maths.
  if (!/[a-zA-Z0-9\\]/.test(tex)) return null;
  return tex;
}

export function parseDesmosSpec(source: string): DesmosSpec {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const spec: DesmosSpec = { mode: "graphing", expressions: [] };
  const seen = new Set<string>();

  const push = (line: string) => {
    const latex = normalizeDesmosExpression(line);
    if (!latex || seen.has(latex)) return;
    seen.add(latex);
    spec.expressions.push(latex);
  };

  let inExpressions = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^```/.test(line)) continue;

    if (!inExpressions) {
      const modeMatch = /^mode\s*[:=]\s*([a-z0-9 _-]+)$/i.exec(line);
      if (modeMatch) {
        const key = modeMatch[1].toLowerCase().replace(/[\s_-]+/g, "");
        const mode = MODE_ALIASES[key];
        if (mode) spec.mode = mode;
        continue;
      }
      const zoomMatch = /^zoom\s*[:=]\s*(\d+(?:\.\d+)?)$/i.exec(line);
      if (zoomMatch) {
        spec.zoom = parseFloat(zoomMatch[1]);
        continue;
      }
      if (/^(?:expressions?|exprs?)\s*:\s*$/i.test(line)) {
        inExpressions = true;
        continue;
      }
    }
    // Tolerant: an unprefixed line that normalises into maths counts too, so a
    // block that omits the `expressions:` header still plots.
    push(line);
  }
  return spec;
}

/**
 * A Desmos expression → TeX for the on-screen list.
 *
 * Since `parseDesmosSpec` already emits LaTeX this is nearly the identity, but
 * it still has to accept a hand-written block (the composer inserts an empty
 * one) and a live expression Desmos has rewritten itself.
 */
export function expressionToTex(src: string): string {
  const trimmed = src.trim();
  if (!trimmed) return "";
  if (/\\\\?[a-zA-Z]+/.test(trimmed)) return trimmed;
  return normalizeDesmosExpression(trimmed) ?? trimmed;
}

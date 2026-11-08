// ---------------------------------------------------------------------------
// Auto-plot — Jarvis's own guarantee that a graphing answer comes with a graph.
//
// The model is asked to emit a ```desmos block, and usually does. Usually is
// not good enough for a maths answer: a forgotten block leaves the user reading
// prose about a curve they cannot see, and a wrong one leaves an empty
// calculator. This module does the part that does not need a model. Given the
// question and the reply, it extracts the function the question was about and
// builds the block deterministically, using the same normaliser the model's own
// blocks go through.
//
// Deliberately conservative: it returns nothing unless the user actually asked
// to see something plotted AND an expression can be recovered with confidence.
// A shrug is better than a graph of the wrong function.
// ---------------------------------------------------------------------------

import { normalizeDesmosExpression } from "./desmos-spec";

/** Words that mean "show me the picture", not "explain it". */
const PLOT_INTENT =
  /\b(graph|graphed|plot|plotted|sketch|draw|visuali[sz]e|curve|parabola|hyperbola|ellipse|tangent|asymptote|surface|contour|intercept|shade|3d)\b/i;

/** A request that is really about the shape of a function. */
const FUNCTION_INTENT =
  /\b(y\s*=|f\s*\(\s*x\s*\)|function|derivative|integral|area under|slope|limit)\b/i;

/** Strip the request's own words so what is left is the expression. */
function stripRequest(question: string): string {
  return question
    .replace(/^\/(?:plot|graph|solve|math)\s+/i, "")
    // `3d graph z = …` and `in 3d: …` lead with the mode, not the maths.
    .replace(/^\s*(?:in\s+)?3\s*-?\s*d\s*[:,]?\s*/i, "")
    .replace(
      /^(?:please\s+)?(?:can you\s+)?(?:show me|draw|sketch|plot|graph|visuali[sz]e)\b\s*(?:the\s+)?(?:graph|plot|curve|function)?\s*(?:of|for)?\s*(?:the\s+)?/i,
      "",
    )
    .replace(/\b(?:in|on)\s+(?:a\s+)?(?:graph|desmos|chart)\b/gi, "")
    .replace(/\bplease\b/gi, "")
    .trim();
}

/** Trim trailing prose punctuation that would make Desmos reject the line. */
function tidy(expression: string): string {
  return expression
    .replace(/[.;,:\s]+$/, "")
    .replace(/^[=:]\s*/, "")
    .trim();
}

/**
 * An expression written in the question, e.g. `graph x^2 - 4` or
 * `plot y = sin(x) + 1`. The first is an implicit `y = …`, which is what the
 * user meant and what Desmos needs.
 */
function fromQuestion(question: string): string | null {
  const stripped = tidy(stripRequest(question));
  if (!stripped) return null;
  // A sentence is not an expression: three or more word-length letter runs.
  if ((stripped.match(/\b[a-zA-Z]{2,}\b/g) ?? []).length > 2) return null;
  const candidate = /[=]/.test(stripped) ? stripped : `y = ${stripped}`;
  return normalizeDesmosExpression(candidate);
}

/**
 * Definitions stated in the answer, in source order. Only `y = …` and
 * `f(x) = …` are taken: those are the forms that draw something, and taking
 * more would risk plotting an intermediate step the answer was discarding.
 */
function fromReply(reply: string): string[] {
  const found: string[] = [];
  const lines = reply
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);

  for (const line of lines) {
    // A display-math line may hold several statements separated by `,` or `\\`.
    for (const part of line.split(/,|\\\\/)) {
      const candidate = part
        .replace(/\$/g, "")
        .replace(/\\\(|\\\)|\\\[|\\\]/g, "")
        .trim();
      if (!candidate) continue;
      if (!/^(?:y\s*=|f\s*\(\s*x\s*\)\s*=)/i.test(candidate)) continue;
      const latex = normalizeDesmosExpression(candidate);
      if (latex && !found.includes(latex)) found.push(latex);
      if (found.length >= 3) return found;
    }
  }
  return found;
}

export interface AutoGraph {
  /** The ```desmos block body, ready for `DesmosCalculator`. */
  source: string;
  /** Label shown above the graph so it never looks like the model drew it. */
  note: string;
}

/**
 * Build a graph for a reply that came back without one.
 *
 * Returns null when the model already plotted, when the question was not a
 * plotting request, or when nothing plottable could be recovered.
 */
export function autoGraphFor(
  question: string,
  reply: string,
): AutoGraph | null {
  if (!question.trim() || !reply.trim()) return null;
  // The model did its job — its block is authoritative.
  if (/```\s*desmos/i.test(reply)) return null;
  if (!PLOT_INTENT.test(question) && !FUNCTION_INTENT.test(question)) return null;

  const expressions: string[] = [];
  const asked = fromQuestion(question);
  if (asked) expressions.push(asked);
  for (const latex of fromReply(reply)) {
    if (!expressions.includes(latex)) expressions.push(latex);
    if (expressions.length >= 3) break;
  }
  if (expressions.length === 0) return null;

  // A bare `f(x) = …` defines a function but draws nothing; the curve the user
  // asked about is `y = f(x)`.
  if (expressions.every((e) => /^f\\left\(x\\right\)\s*=/.test(e))) {
    expressions.push("y = f\\left(x\\right)");
  }

  const wants3d = /\b3d\b|\bz\s*=|surface|\bcontour\b/i.test(question);
  const body = expressions.join("\n");
  return {
    source: `mode: ${wants3d ? "3d" : "graphing"}\nexpressions:\n${body}`,
    note: asked
      ? "Plotted from your question"
      : "Plotted from the functions in the answer",
  };
}

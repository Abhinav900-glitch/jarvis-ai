// ---------------------------------------------------------------------------
// Word-level diff, for comparing two answers to the same question.
//
// Pure and dependency-free. The branch compare view is the only consumer, but
// it is a general utility: nothing here knows about messages, branches or
// Jarvis.
//
// The algorithm is a classic LCS over words with the usual linear-space trick
// — one row of lengths plus a backtrack table — because a whole LCS table for
// two long answers is tens of thousands of entries, and this runs while the
// user is looking at the panel.
// ---------------------------------------------------------------------------

export type DiffOp = "same" | "add" | "remove";

export interface DiffPart {
  op: DiffOp;
  text: string;
}

/**
 * Split into comparable tokens.
 *
 * Words *and* the whitespace between them are kept as separate tokens, because
 * dropping whitespace makes "not good" and "good" differ only by a word that
 * happens to be glued to the wrong one. Punctuation rides along with its word.
 */
function tokenize(text: string): string[] {
  return text.match(/\s+|[^\s]+/g) ?? [];
}

/**
 * Word-level diff of `a` (the original) against `b` (the alternative).
 *
 * Returns runs rather than a per-token list, which is what a view wants to
 * render: "these four words are new" is one highlight, not four.
 */
export function diffWords(a: string, b: string): DiffPart[] {
  const left = tokenize(a);
  const right = tokenize(b);

  // Trim the shared prefix and suffix first. Two answers to the same question
  // almost always diverge in the middle, and this turns an O(n·m) problem into
  // a small one for the overwhelming majority of comparisons.
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) {
    start++;
  }
  let endLeft = left.length;
  let endRight = right.length;
  while (endLeft > start && endRight > start && left[endLeft - 1] === right[endRight - 1]) {
    endLeft--;
    endRight--;
  }

  const midLeft = left.slice(start, endLeft);
  const midRight = right.slice(start, endRight);

  const parts: DiffPart[] = [];
  const push = (op: DiffOp, text: string) => {
    if (!text) return;
    const last = parts[parts.length - 1];
    if (last && last.op === op) last.text += text;
    else parts.push({ op, text });
  };

  push("same", left.slice(0, start).join(""));

  // Guard against a pathological pair: the table is O(n·m), and two answers
  // with nothing in common would allocate it in full.
  const MAX_CELLS = 400_000;
  if (midLeft.length * midRight.length > MAX_CELLS) {
    // Too different for a line-level diff to be informative. Saying so
    // honestly beats rendering a wall of struck-through text.
    push("remove", midLeft.join(""));
    push("add", midRight.join(""));
  } else {
    for (const part of lcsDiff(midLeft, midRight)) {
      push(part.op, part.text);
    }
  }

  push("same", left.slice(endLeft).join(""));
  return parts;
}

/** LCS table walk, returning one part per surviving token. */
function lcsDiff(left: string[], right: string[]): DiffPart[] {
  const n = left.length;
  const m = right.length;

  // lengths[i][j] would be (n+1)*(m+1) numbers; only the last row is kept and
  // the choice is recovered from a compact direction table instead.
  const lengths: number[] = new Array((n + 1) * (m + 1)).fill(0);
  const width = m + 1;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lengths[i * width + j] =
        left[i] === right[j]
          ? lengths[(i + 1) * width + (j + 1)] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + (j + 1)]);
    }
  }

  const out: DiffPart[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      out.push({ op: "same", text: left[i] });
      i++;
      j++;
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + (j + 1)]) {
      out.push({ op: "remove", text: left[i] });
      i++;
    } else {
      out.push({ op: "add", text: right[j] });
      j++;
    }
  }
  while (i < n) out.push({ op: "remove", text: left[i++] });
  while (j < m) out.push({ op: "add", text: right[j++] });
  return out;
}

/** How much of `b` is new relative to `a`, 0..1. Cheap sanity signal. */
export function changeRatio(parts: DiffPart[]): number {
  let added = 0;
  let total = 0;
  for (const part of parts) {
    const words = part.text.split(/\s+/).filter(Boolean).length;
    if (part.op === "add") added += words;
    if (part.op !== "same") total += words;
  }
  return total === 0 ? 0 : added / total;
}
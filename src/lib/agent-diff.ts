// ---------------------------------------------------------------------------
// Line diff, for the edit approval view.
//
// Shown before an edit lands, so the user is deciding on the change rather than
// on a description of it. That is the whole safety argument for an agent that
// can rewrite files, and it only works if the diff is honest and cheap enough
// to render on every proposal.
//
// Pure and dependency-free: it runs in the panel, not on the server, so it must
// not pull anything in.
// ---------------------------------------------------------------------------

export type DiffKind = "same" | "add" | "del";

export interface DiffLine {
  kind: DiffKind;
  text: string;
  /** 1-based line number in the original, absent for additions. */
  from?: number;
  /** 1-based line number in the new file, absent for deletions. */
  to?: number;
}

/** Above this, an exact LCS is no longer worth the memory. */
const LCS_LINE_CAP = 1500;
/** Longest unchanged run rendered; past this it is collapsed to a marker. */
const CONTEXT_LINES = 3;

const split = (text: string): string[] => (text ?? "").split("\n");

/**
 * Diff two file versions line by line.
 *
 * Exact below the cap. Above it, the shared prefix and suffix are matched off
 * first and only the middle is diffed — which is both fast and, for the case
 * this actually has to handle (an edit in the middle of a big file), identical
 * to the exact answer.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = split(before);
  const b = split(after);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;

  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  const out: DiffLine[] = [];
  for (let i = 0; i < start; i++) {
    out.push({ kind: "same", text: a[i], from: i + 1, to: i + 1 });
  }

  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);
  const middle =
    midA.length + midB.length > LCS_LINE_CAP
      ? naiveMiddle(midA, midB)
      : lcsDiff(midA, midB);

  out.push(...middle);

  for (let i = 0; i < a.length - endA; i++) {
    out.push({
      kind: "same",
      text: a[endA + i],
      from: endA + i + 1,
      to: endB + i + 1,
    });
  }
  return out;
}

/** Standard LCS walk. Tables are built and consumed in one pass each. */
function lcsDiff(a: string[], b: string[]): DiffLine[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) {
    return b.map((text, i) => ({ kind: "add" as const, text, to: i + 1 }));
  }
  if (m === 0) {
    return a.map((text, i) => ({ kind: "del" as const, text, from: i + 1 }));
  }

  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i], from: i + 1, to: j + 1 });
      i++;
      j++;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      out.push({ kind: "del", text: a[i], from: i + 1 });
      i++;
    } else {
      out.push({ kind: "add", text: b[j], to: j + 1 });
      j++;
    }
  }
  while (i < n) out.push({ kind: "del", text: a[i], from: ++i });
  while (j < m) out.push({ kind: "add", text: b[j], to: ++j });
  return out;
}

/** Whole-block replacement. What a size guard degrades to. */
function naiveMiddle(a: string[], b: string[]): DiffLine[] {
  return [
    ...a.map((text, i) => ({ kind: "del" as const, text, from: i + 1 })),
    ...b.map((text, i) => ({ kind: "add" as const, text, to: i + 1 })),
  ];
}

export interface DiffStats {
  added: number;
  removed: number;
}

export function diffStats(lines: DiffLine[]): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.kind === "add") added++;
    else if (line.kind === "del") removed++;
  }
  return { added, removed };
}

/**
 * Collapse long unchanged runs around the edits.
 *
 * A 400-line file with a one-line change should show one line of change, not
 * 400 lines of context. Whole-file views belong to the file viewer; this view
 * exists to make a diff legible.
 */
export function withContext(lines: DiffLine[]): DiffLine[] {
  const keep = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].kind === "same") continue;
    for (let j = Math.max(0, i - CONTEXT_LINES); j <= Math.min(lines.length - 1, i + CONTEXT_LINES); j++) {
      keep.add(j);
    }
  }
  if (keep.size === lines.length) return lines;

  const out: DiffLine[] = [];
  let skipping = 0;
  for (let i = 0; i < lines.length; i++) {
    if (keep.has(i)) {
      if (skipping > 0) {
        out.push({ kind: "same", text: `… ${skipping} unchanged line${skipping === 1 ? "" : "s"}` });
        skipping = 0;
      }
      out.push(lines[i]);
    } else {
      skipping++;
    }
  }
  if (skipping > 0) {
    out.push({ kind: "same", text: `… ${skipping} unchanged line${skipping === 1 ? "" : "s"}` });
  }
  return out;
}
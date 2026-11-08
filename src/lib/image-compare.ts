/**
 * Comparing images found on different sites, so the AI makes the choice.
 *
 * A web image search returns nine photographs of the same person from nine
 * different domains, and only one of them is the picture the user meant: the
 * rest are watermarked stock previews, news thumbnails with caption bars,
 * unrelated people with the same name, or a screenshot used as a meme. Picking
 * by resolution alone picks the watermarked one; picking by position picks
 * whatever Google ranked first, which is often a stock preview.
 *
 * So the candidates are described to the model in text and it answers with a
 * number and one sentence of reasoning. Both halves live here, away from the
 * Convex action, because the model's answer is the part that needs a defensive
 * parser: it is prose from an LLM, not a schema.
 */

export interface ImageCandidate {
  url: string;
  source?: string;
  title?: string;
  width?: number;
  height?: number;
}

export interface ImagePick {
  /** Zero-based index into the candidate array. */
  index: number;
  reason: string;
}

const MAX_REASON = 280;

/**
 * What makes one web image better than another, stated as rules rather than
 * vibes: a model asked for "the best image" tends to return the first one.
 */
const RULES = [
  "Choose the single image that best matches the query, as a careful person would after opening all of them.",
  "Prefer a correct, recognisable subject at high resolution, from a well-known source.",
  "Reject: watermarked previews and stock-photo overlays, caption or letterbox bars, logos and interface screenshots, memes, tiny thumbnails, and pictures of something else that merely shares a name.",
  "When two sites carry the same photograph, prefer the more reputable site.",
  "Judge only from the metadata listed. Never describe an image you cannot see.",
].join(" ");

/** One line per candidate, numbered from 1 because models are reliable there. */
export function imagePickPrompt(query: string, candidates: ImageCandidate[]): string {
  const lines = candidates.map((c, i) => {
    const size =
      c.width && c.height ? `${c.width}×${c.height}` : "size unknown";
    const title = c.title ? `“${c.title.replace(/\s+/g, " ").trim().slice(0, 120)}”` : "untitled";
    return `${i + 1}. site: ${c.source?.trim() || "unknown"} · ${size} · ${title} · ${c.url.slice(0, 220)}`;
  });

  return [
    `Query: ${query.trim().slice(0, 240)}`,
    "",
    "Candidates:",
    ...lines,
    "",
    RULES,
    "",
    'Answer with JSON and nothing else: {"index": <candidate number>, "reason": "<one short sentence>"}',
  ].join("\n");
}

/** First usable number under any of the keys a model might choose. */
function readIndex(parsed: Record<string, unknown>): number | null {
  for (const key of ["index", "pick", "best", "choice", "candidate", "number", "image"]) {
    const value = parsed[key];
    const n =
      typeof value === "number"
        ? value
        : typeof value === "string" && /^\s*\d{1,2}\s*$/.test(value)
          ? Number(value)
          : NaN;
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readReason(parsed: Record<string, unknown>, fallback: string): string {
  for (const key of ["reason", "why", "explanation", "rationale", "note"]) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim()) {
      return value.replace(/\s+/g, " ").trim().slice(0, MAX_REASON);
    }
  }
  return fallback;
}

/**
 * The model's pick, or null when its answer cannot be trusted.
 *
 * Candidates are numbered from 1 in the prompt, so the number is converted;
 * a stray `0` is read as the first image rather than rejected, since that is
 * plainly what the model meant. Anything outside the list is null and the
 * caller falls back to a deterministic choice — silently returning candidate
 * #0 for a nonsense number is how a wrong picture ends up labelled "AI pick".
 */
export function parseImagePick(text: string, count: number): ImagePick | null {
  if (!text || count <= 0) return null;
  // Fenced JSON is common enough to be worth unwrapping before parsing.
  const body = text.replace(/```(?:json)?/gi, " ").trim();

  const block = /\{[\s\S]*\}/.exec(body);
  if (block) {
    try {
      const parsed = JSON.parse(block[0]) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        const n = readIndex(parsed);
        const index = toIndex(n, count);
        if (index !== null) return { index, reason: readReason(parsed, "") };
      }
    } catch {
      // Not JSON after all; the keyword scan below may still find the number.
    }
  }

  const keyword = /\b(?:index|image|candidate|pick|choice|best|number)\b\D{0,16}(\d{1,2})/i.exec(
    body,
  );
  if (keyword) {
    const index = toIndex(Number(keyword[1]), count);
    if (index !== null) {
      return { index, reason: body.replace(/\s+/g, " ").trim().slice(0, MAX_REASON) };
    }
  }

  // A short bare answer ("2" or "Image 2 — clearest") is still an answer.
  if (body.length <= 60) {
    const only = body.match(/\d{1,2}/g);
    if (only?.length === 1) {
      const index = toIndex(Number(only[0]), count);
      if (index !== null) return { index, reason: "" };
    }
  }

  return null;
}

/** 1-based model number → 0-based index, or null when it is out of range. */
function toIndex(n: number | null, count: number): number | null {
  if (n === null || !Number.isFinite(n)) return null;
  if (n === 0) return 0;
  const oneBased = Math.trunc(n);
  if (oneBased < 1 || oneBased > count) return null;
  return oneBased - 1;
}

/**
 * Deterministic fallback: the biggest picture, because for photographs that is
 * almost always the real one rather than a thumbnail of it.
 */
export function largestImageIndex(candidates: ImageCandidate[]): number {
  let best = 0;
  let bestArea = -1;
  candidates.forEach((c, i) => {
    const area = (c.width ?? 0) * (c.height ?? 0);
    if (area > bestArea) {
      bestArea = area;
      best = i;
    }
  });
  return best;
}

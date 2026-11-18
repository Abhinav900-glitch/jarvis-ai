/**
 * Reviewing and refining a render: the studio's second opinion.
 *
 * "Best" is not a property of a single picture — it is a comparison. Four takes
 * from the same prompt fail in different ways (a face merged into a lantern, a
 * hand with six fingers, the subject wandering off-centre), and which one is
 * worth keeping is exactly the judgement a person makes after looking. A
 * prompt rewrite before rendering cannot make that judgement, because it runs
 * before there is anything to look at.
 *
 * So the renders are shown to a vision model, which scores each one against the
 * brief and — on request — writes the one prompt change that would fix the
 * biggest remaining flaw. The score is what makes "keep the better one" honest:
 * the refined picture replaces the original only when it actually scored
 * higher, so a refinement pass that made things worse is discarded rather than
 * presented as an improvement.
 *
 * The model's answer is prose pretending to be data, so the parser here is as
 * defensive as `parseImagePick` and for the same reason: a review that cannot be
 * read must fall back to "no review", never to a fabricated score.
 */
import { cleanEnhancedPrompt } from "./enhance-prompt";

/** The brief is quoted back to the model, so it is capped like a prompt. */
export const JUDGE_IDEA_LIMIT = 700;

export interface ImageJudgementEntry {
  /** 0–100. Zero means the model did not score that image. */
  score: number;
  /** One short sentence: what is right or wrong with that picture. */
  verdict: string;
}

export interface ImageJudgement {
  /** One entry per image, in the order the images were shown. */
  entries: ImageJudgementEntry[];
  /** Zero-based index of the strongest image. */
  best: number;
  /** A rewritten prompt that fixes the best image's biggest flaw, if asked. */
  refine: string | null;
}

/** What a picture is judged against, stated as rules rather than taste. */
const RULES = [
  "Score each render 0–100 for how well it satisfies the request: is the named subject present and recognisably right, is the setting, light and composition as described, is the framing sensible, and is it free of text, watermarks, logos, extra or merged limbs, malformed faces and other artefacts.",
  "Reserve 90 and above for a picture you could not improve; a competent but generic render belongs in the 60s and 70s.",
  "Judge what is visible, never what you assume the prompt meant.",
].join(" ");

const REFINE_RULE =
  "Then write one replacement prompt for the strongest render that fixes its single biggest flaw — the thing that most keeps it from being the picture asked for — while keeping its subject, framing and any look the request already chose. " +
  "Do not mention the review, the score, the models or these instructions. Write only the prompt, one line, plain text, under 90 words.";

/**
 * The message that accompanies the images. The images themselves follow as
 * multimodal parts; the numbering here is what the answer's `image` field
 * refers to.
 */
export function judgePrompt(
  idea: string,
  count: number,
  opts: { refine?: boolean } = {},
): string {
  const brief = idea.replace(/\s+/g, " ").trim().slice(0, JUDGE_IDEA_LIMIT);
  const shown =
    count === 1
      ? "You are shown one render of that request."
      : `You are shown ${count} renders of that request, in this order: 1 to ${count}.`;

  return [
    `The picture asked for: ${brief || "(no description given)"}`,
    "",
    shown,
    "",
    RULES,
    ...(opts.refine ? ["", REFINE_RULE] : []),
    "",
    opts.refine
      ? 'Answer with JSON and nothing else: {"scores":[{"image":<number>,"score":<0-100>,"verdict":"<one short sentence>"}],"best":<number>,"refine":"<rewritten prompt>"}'
      : 'Answer with JSON and nothing else: {"scores":[{"image":<number>,"score":<0-100>,"verdict":"<one short sentence>"}],"best":<number>}',
  ].join("\n");
}

const SCORE_KEYS = ["scores", "ratings", "images", "results", "reviews", "verdicts"];
const VERDICT_KEYS = ["verdict", "reason", "note", "comment", "why", "explanation", "feedback"];
const INDEX_KEYS = ["image", "index", "n", "number", "id", "position"];
const VALUE_KEYS = ["score", "rating", "value", "points", "grade"];
const BEST_KEYS = ["best", "best_image", "bestImage", "winner", "pick", "choice", "index"];
const REFINE_KEYS = [
  "refine",
  "refined",
  "refined_prompt",
  "refine_prompt",
  "improved_prompt",
  "rewrite",
  "next_prompt",
  "prompt",
];

/** `"82"`, `"82%"`, `"82/100"` and `82` all mean the same thing. */
function readScore(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const text = value
    .trim()
    .replace(/\s*\/\s*100\s*$/, "")
    .replace(/[%\s]/g, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** The first usable number under any of the keys a model might choose. */
function readNumber(
  parsed: Record<string, unknown>,
  keys: string[],
): number | null {
  for (const key of keys) {
    const n = readScore(parsed[key]);
    if (n !== null) return n;
  }
  return null;
}

function readText(
  parsed: Record<string, unknown>,
  keys: string[],
  limit = 240,
): string {
  for (const key of keys) {
    const value = parsed[key];
    if (typeof value === "string" && value.trim()) {
      return value.replace(/\s+/g, " ").trim().slice(0, limit);
    }
  }
  return "";
}

/** The score list, however the model chose to shape it. */
function scoreItems(
  value: unknown,
): { index: number | null; score: number | null; verdict: string }[] {
  if (Array.isArray(value)) {
    return value.map((item) => {
      const score = readScore(item);
      if (score !== null) return { index: null, score, verdict: "" };
      if (!item || typeof item !== "object") {
        return { index: null, score: null, verdict: "" };
      }
      const record = item as Record<string, unknown>;
      return {
        index: readNumber(record, INDEX_KEYS),
        score: readNumber(record, VALUE_KEYS),
        verdict: readText(record, VERDICT_KEYS),
      };
    });
  }
  // Keyed by number: `{"1": 82, "2": 74}` or `{"1": {"score": 82}}`.
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => {
      const score = readScore(item);
      const index = readScore(key);
      if (score !== null) return { index, score, verdict: "" };
      if (!item || typeof item !== "object") {
        return { index, score: null, verdict: "" };
      }
      const record = item as Record<string, unknown>;
      return {
        index: index ?? readNumber(record, INDEX_KEYS),
        score: readNumber(record, VALUE_KEYS),
        verdict: readText(record, VERDICT_KEYS),
      };
    });
  }
  return [];
}

/**
 * The model's review, or null when its answer cannot be trusted.
 *
 * A missing score is kept as zero — "not scored" — rather than filled in with a
 * guess, so the UI can show a badge only where there is a real number. One
 * usable score is enough for a review: with the `refine` field that is the
 * whole point of the call, and discarding it over a second image the model
 * forgot to mention would waste the render it was meant to improve.
 *
 * Answers in a 0–10 scale are accepted and widened, because the model is told
 * 0–100 and still sometimes answers 8/10. The check is on the whole set: one
 * score above ten means the scale already is 0–100.
 */
export function parseImageJudgement(
  text: string,
  count: number,
): ImageJudgement | null {
  if (!text || count <= 0) return null;
  const body = text.replace(/```(?:json)?/gi, " ").trim();

  const block = /\{[\s\S]*\}/.exec(body);
  if (!block) return null;

  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(block[0]) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    parsed = value as Record<string, unknown>;
  } catch {
    return null;
  }

  const raw = SCORE_KEYS.map((key) => parsed[key]).find(
    (value) => value !== undefined && value !== null,
  );
  const items = scoreItems(raw);

  const entries: ImageJudgementEntry[] = Array.from({ length: count }, () => ({
    score: 0,
    verdict: "",
  }));
  const seen = new Set<number>();

  items.forEach((item, position) => {
    if (item.score === null) return;
    // Numbering starts at 1, so an explicit `image` is one-based. A bare list
    // is ordered the way the images were shown.
    const index =
      item.index === null
        ? position
        : item.index === 0
          ? 0
          : Math.trunc(item.index) - 1;
    if (index < 0 || index >= count || seen.has(index)) return;
    seen.add(index);
    entries[index] = { score: item.score, verdict: item.verdict };
  });

  if (seen.size === 0) return null;

  const highest = Math.max(...entries.map((entry) => entry.score));
  const scale = highest <= 10 && highest > 0 ? 10 : 1;
  for (const index of seen) {
    entries[index] = {
      ...entries[index],
      score: Math.min(100, Math.max(0, Math.round(entries[index].score * scale))),
    };
  }

  const claimed = readNumber(parsed, BEST_KEYS);
  let best =
    claimed === null ? -1 : claimed === 0 ? 0 : Math.trunc(claimed) - 1;
  if (best < 0 || best >= count || !seen.has(best)) {
    best = -1;
    entries.forEach((entry, index) => {
      if (!seen.has(index)) return;
      if (best < 0 || entry.score > entries[best].score) best = index;
    });
  }
  if (best < 0) return null;

  const refineRaw = readText(parsed, REFINE_KEYS, 900);
  const refine = refineRaw
    ? cleanEnhancedPrompt(stripOpener(refineRaw), "") || null
    : null;

  return { entries, best, refine };
}

/**
 * Remove a same-line opener: "Here's the improved prompt: …".
 *
 * `cleanEnhancedPrompt` drops such a line when it stands alone, which on a
 * one-line answer would take the prompt with it. The opener is peeled off
 * first so the rest is still the thing the model was actually asked for.
 */
function stripOpener(text: string): string {
  return text.replace(
    /^\s*(?:here(?:'s|’s| is)|sure|certainly|of course|absolutely)\b[^:\n]{0,80}:\s*/i,
    "",
  );
}

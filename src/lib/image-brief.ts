/**
 * A long visual brief for one image type, written by the free text model.
 *
 * The image providers this app talks to read only the first few hundred
 * characters of a prompt — Pollinations takes 800, Perchance 500, Replicate
 * 950 — so a literal 500-word prompt would be cut off long before it changed
 * the picture. The brief therefore has two halves:
 *
 *   • `brief` is the 500-word description, shown to the user and copyable;
 *   • `prompt` is a compact one-line version of it, which is what the image
 *     model actually receives.
 *
 * Both come from the same answer so they cannot drift apart. Everything here
 * is pure: the network call lives in `ai.imagePromptBrief`, which keeps the
 * parsing testable and the deployed action small.
 */

/** The target the instruction asks for; an answer may land either side of it. */
export const BRIEF_TARGET_WORDS = 500;

/**
 * How much of the compact prompt is kept.
 *
 * The studio appends the style suffix, extra instructions and exclusions after
 * this, and `cloudinary.generateImage` refuses anything over 1,000 characters.
 * 420 leaves room for all three even when each is filled to its own cap.
 */
export const BRIEF_PROMPT_LIMIT = 420;

export interface PromptBriefParts {
  /** What the user typed. */
  prompt: string;
  /** The chosen style's suffix, which is also the image type. */
  style?: string;
  /** Extra directions the user added. */
  instructions?: string;
  /** What the user does not want in the picture. */
  avoid?: string;
}

/**
 * The instruction sent to the keyless text model.
 *
 * The word target is broken into six paragraphs rather than stated only as a
 * total: a model asked for "500 words" tends to stop around 350, while one
 * asked for six 80–90-word paragraphs reaches the target and gives the brief a
 * useful shape. The compact prompt is requested in the same JSON so both
 * halves describe the same picture.
 */
export const BRIEF_SYSTEM_PROMPT =
  "You write detailed visual briefs for image generation. Reply with ONLY a " +
  "JSON object, no markdown: {\"brief\": string, \"prompt\": string}. The brief " +
  "must be 480 to 520 words. Write it as six substantial paragraphs separated " +
  "by newlines, about 80 to 90 words each, with no headings: (1) subject and " +
  "action, (2) environment and background, (3) lighting, (4) composition and " +
  "camera or rendering medium, (5) colour and texture, (6) mood and finishing " +
  "details. Every sentence must be specific to this subject; never pad with " +
  "generic filler. The prompt is one line under 420 characters, comma-separated " +
  "phrases a diffusion model can use, containing the essential visual details " +
  "from the brief. Never invent named people, brands, text or licensed " +
  "characters. Respect every exclusion.";

/** The user turn: what to draw, for which kind of image, and what to avoid. */
export function briefRequest(parts: PromptBriefParts): string {
  const lines = [`Subject: ${parts.prompt.trim()}`];
  const style = parts.style?.trim();
  lines.push(`Image type: ${style || "general-purpose image"}`);
  const instructions = parts.instructions?.trim();
  if (instructions) lines.push(`Extra instructions: ${instructions}`);
  const avoid = parts.avoid?.trim();
  if (avoid) lines.push(`Exclude: ${avoid}`);
  return lines.join("\n");
}

/** Words as a reader counts them: runs of non-whitespace. */
export function countBriefWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

export interface ParsedImageBrief {
  brief: string;
  prompt: string;
  words: number;
  reason: string | null;
}

/**
 * Reduce the model's answer to a brief and a compact prompt.
 *
 * JSON is the requested shape, but a model that wraps it in a fence, adds a
 * sentence before it, or ignores the instruction entirely must not cost the
 * user the answer. The fallbacks keep whatever prose came back as the brief
 * and derive a compact prompt from its opening, which is still usable.
 */
export function parseImageBrief(
  raw: string,
  fallbackPrompt: string,
): ParsedImageBrief {
  const fallback = fallbackPrompt.trim();
  const text = stripFence(raw);
  if (!text) {
    return {
      brief: "",
      prompt: fallback,
      words: 0,
      reason: "The brief came back empty. Try again in a moment.",
    };
  }

  const slice = jsonObjectSlice(text);
  if (slice) {
    try {
      const parsed = JSON.parse(slice) as {
        brief?: unknown;
        prompt?: unknown;
      };
      if (
        typeof parsed.brief === "string" &&
        countBriefWords(parsed.brief) >= 40
      ) {
        const brief = tidyBrief(parsed.brief);
        const words = countBriefWords(brief);
        const derived = compactPrompt(brief, fallback);
        const prompt =
          typeof parsed.prompt === "string"
            ? compactPrompt(parsed.prompt, derived)
            : derived;
        return {
          brief,
          prompt,
          words,
          reason:
            words < 300
              ? `The model wrote ${words} words instead of about ${BRIEF_TARGET_WORDS}.`
              : null,
        };
      }
    } catch {
      // Not JSON after all; the prose fallback below still has value.
    }
  }

  const brief = tidyBrief(text);
  const words = countBriefWords(brief);
  if (words < 40) {
    return {
      brief: "",
      prompt: fallback,
      words: 0,
      reason: "The brief came back too short to use.",
    };
  }
  return {
    brief,
    prompt: compactPrompt(brief, fallback),
    words,
    reason:
      "The model replied in prose, so the brief is kept and the prompt was shortened from its opening.",
  };
}

/**
 * How long the free text tier says to wait, in seconds, or null when this is
 * not its rate-limit response.
 *
 * The text API uses the same 402 / `Retry-After` shape as the image API, which
 * is why the wording matches `parsePollinationsFreeLimit` in `cloudinary.ts`.
 * It is repeated here rather than imported so the text action does not pull the
 * whole image-provider module (and its SDKs) into its bundle for ten lines.
 */
export function freeTextWaitSeconds(
  body: string,
  retryAfterHeader: string | null,
): number | null {
  if (body.includes("FREE_LIMIT")) {
    const fromMessage = body.match(/retry after (\d+)s/i);
    if (fromMessage) return Number(fromMessage[1]);
  }
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  }
  return null;
}

/** A fenced answer is the model's habit even when told not to use markdown. */
function stripFence(raw: string): string {
  const text = raw.trim();
  const fenced = /```[a-z]*\n?([\s\S]*?)```/i.exec(text);
  return (fenced?.[1] ?? text).trim();
}

/** The outermost `{…}` in an answer that may carry a sentence around it. */
function jsonObjectSlice(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  return text.slice(start, end + 1);
}

/**
 * Presentation cleanup for the brief: paragraph breaks are meaningful, so they
 * survive; markdown emphasis and heading marks are not, so they are removed.
 */
function tidyBrief(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/__(.*?)__/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .trim();
}

/**
 * One line, under the provider budget, cut at a word boundary.
 *
 * A label the model adds anyway ("Prompt: …") is removed first; leaving it in
 * would send the word "Prompt" to the image model as a subject.
 */
function compactPrompt(raw: string, fallback: string): string {
  let text = raw.replace(/\s+/g, " ").trim();
  text = text.replace(/^(?:generation\s+)?prompt\s*[:–—-]\s*/i, "").trim();
  text = text.replace(/^["'`*_]+/, "").replace(/["'`*_]+$/, "").trim();
  if (text.length > BRIEF_PROMPT_LIMIT) {
    const cut = text.slice(0, BRIEF_PROMPT_LIMIT);
    const lastSpace = cut.lastIndexOf(" ");
    text = (
      lastSpace > BRIEF_PROMPT_LIMIT * 0.6 ? cut.slice(0, lastSpace) : cut
    ).trim();
  }
  return text || fallback;
}

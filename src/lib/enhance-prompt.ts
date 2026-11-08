/**
 * Turning a rough description into a prompt the image models act on.
 *
 * The rewrite is done by a chat model, so the answer arrives as prose: often
 * prefaced ("Here's a sharper prompt:"), fenced, quoted, or written as a
 * bullet list. Everything here exists to get that answer down to the single
 * line the generator receives — the same discipline as `parseImagePick`, for
 * the same reason: the model was asked for data and replied with a sentence.
 */

/**
 * The generator rejects anything past 1000 characters
 * (cloudinary.generateImage), so the rewrite is kept comfortably under it: the
 * style suffix and the user's own instructions are appended afterwards.
 */
export const ENHANCE_LIMIT = 700;

/** Below this a "prompt" is a label, not a description. */
const MIN_LENGTH = 8;

export interface PromptParts {
  /** What the user typed. */
  prompt: string;
  /** The style preset's suffix, e.g. "oil painting, textured brushwork". */
  style?: string;
  /** Extra instructions the user added. */
  instructions?: string;
  /** What the user does not want in the picture. */
  avoid?: string;
}

/**
 * The message sent to the model. It restates what the user already chose
 * rather than asking the model to infer it: a rewrite that drops "cinematic
 * lighting" because the sentence did not mention it is a regression, not an
 * improvement.
 */
export function enhancePromptRequest(parts: PromptParts): string {
  const lines = [`What the user typed: ${parts.prompt.trim()}`];
  const style = parts.style?.trim();
  // The suffix is appended again at render time, so the rewrite shows the
  // style's effect instead of naming the medium twice.
  if (style) {
    lines.push(`Style already chosen, applied separately: ${style} (show its effect, do not name it)`);
  }
  const instructions = parts.instructions?.trim();
  if (instructions) lines.push(`They also asked for: ${instructions}`);
  const avoid = parts.avoid?.trim();
  if (avoid) lines.push(`They do not want: ${avoid}`);
  return lines.join("\n");
}

/**
 * Reduce a model's answer to one clean prompt.
 *
 * Falls back to the original text whenever the answer is unusable — empty,
 * too short to be a description, or identical to what was typed. The caller
 * treats "same text back" as a failure so the button never silently does
 * nothing while looking like it worked.
 */
export function cleanEnhancedPrompt(raw: string, fallback: string): string {
  const original = fallback.trim();
  let text = raw.trim();
  if (!text) return original;

  // A fenced block is the model's habit when told to reply with only the
  // prompt; the fence itself is never part of the picture.
  const fenced = /```[a-z]*\n?([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) text = fenced[1];

  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    // Preamble on its own line. Anything after it is still kept.
    .filter(
      (line) =>
        !/^(?:here(?:'s| is)\b|sure[,!]|certainly[,!]|of course[,!])/i.test(line),
    )
    // List markers, so a bulleted answer joins into one sentence instead of
    // reading as "first, second, third".
    .map((line) => line.replace(/^(?:[-*•]|\d+[.)])\s+/, ""));

  let joined = lines.join(" ");

  // A label before the prompt: "Improved prompt: ...", "**Prompt** — ...".
  joined = joined.replace(
    /^\s*(?:#{1,6}\s*|\*{1,2}\s*)?(?:improved|sharper|refined|final|better)?\s*prompt\s*[:\-–—]\s*/i,
    "",
  );
  // Wrapping quotes, emphasis and the space left behind by a stripped label:
  // `**Prompt:** "…"` leaves the closing asterisks before the quote.
  joined = joined
    .replace(/^[\s"'“”‘’`*_]+/, "")
    .replace(/[\s"'“”‘’`*_]+$/, "");
  joined = joined.replace(/\s+/g, " ").trim();

  if (joined.length > ENHANCE_LIMIT) {
    const cut = joined.slice(0, ENHANCE_LIMIT);
    const lastSpace = cut.lastIndexOf(" ");
    // Cut at a word boundary when there is one near the end; a half word at
    // the limit is worse than a clause missing from it.
    joined = (lastSpace > ENHANCE_LIMIT * 0.7 ? cut.slice(0, lastSpace) : cut).trim();
  }

  if (joined.length < MIN_LENGTH) return original;
  if (joined.toLowerCase() === original.toLowerCase()) return original;
  return joined;
}

// ---------------------------------------------------------------------------
// What live mode sends to the local pipeline as its system instructions.
//
// Chat and live mode are two different models on two different stacks: chat
// runs through Groq/HuggingFace, live mode runs a model on the user's own
// machine behind `live-server/`. That model knows nothing about this
// application — asked "who made you?" it names whichever lab trained it — so
// the identity block has to be handed to it explicitly. It is the same block
// chat uses (see `identity.ts`), not a paraphrase, so the two paths cannot
// drift apart.
//
// Two things are deliberately NOT sent:
//
//   1. `DEFAULT_BEHAVIOR_INSTRUCTIONS`. The house style is written for a text
//      UI and tells the model to use `**bold**`, bullet lists, tables and
//      fenced code blocks. Live mode speaks its reply through TTS, which
//      reads "asterisk asterisk bold asterisk asterisk" out loud. Sending it
//      would make the assistant worse, not more like itself. The rules that
//      survive the trip to speech are carried by `VOICE_FORMAT_RULES` instead.
//
//   2. The user's instructions *if they have none*. The fallback for "no
//      custom instructions" is that markdown house style, which is exactly
//      what must not be spoken. So silence falls back to identity + manners,
//      not to the text house style.
//
// Everything the user *has* written is sent, because that is the part where
// chat and voice genuinely should agree.
// ---------------------------------------------------------------------------

import { IDENTITY_INSTRUCTIONS } from "./identity";
import { MANNERS_RULES } from "./emotional-intelligence";

/**
 * How to write a reply that is going to be spoken rather than rendered.
 *
 * Placed LAST in the block on purpose. A user's own standing instructions may
 * well ask for markdown — the chat house style does exactly that — and a
 * voice engine will dutifully read the punctuation out loud. This block says
 * so explicitly and claims precedence, which is the only reliable way to win
 * against an instruction the model was given earlier.
 */
export const VOICE_FORMAT_RULES = [
  `VOICE OUTPUT — your reply is spoken aloud by a speech synthesiser, not rendered on screen:`,
  `- Plain spoken prose only. Never use Markdown, bold or italic markers, bullet symbols, numbered lists, tables, headings, or code fences.`,
  `- Never spell out formatting characters. Writing \`**bold**\` does not look bold when heard; it is read as "asterisk asterisk bold asterisk asterisk".`,
  `- For code, spell it out: say "open parenthesis", not "(". Say "dot" or "dot com" for addresses.`,
  `- For a list, use short spoken clauses — "First, ... Second, ..." — which sound natural where hyphens do not.`,
  `- Keep it short. Long replies become a long wait; two or three sentences is the norm unless the user asked for more detail.`,
  `- These rules override any instruction above that asks for formatting.`,
].join("\n");

export interface LiveInstructionsInput {
  /**
   * The user's own instructions and active persona, as stored in settings.
   *
   * Expected to already exclude the default markdown house style — see
   * `api.workspace.livePersona`, which builds exactly that.
   */
  userBlock?: string | null;
  /**
   * Fully replaces the composed block. Used when a caller wants to drive the
   * local model's behaviour manually instead of inheriting the app's.
   */
  override?: string | null;
}

/**
 * The instruction block for one live session.
 *
 * Order is deliberate:
 *
 *   identity → manners → voice format → the user's own instructions
 *
 * The user's instructions come last so they win, matching how chat treats
 * them ("outrank your usual habits"). The voice rules sit above them but
 * declare that they override formatting, which is the one case where the
 * user's preference genuinely cannot be honoured: a markdown table cannot be
 * read out loud, and hearing one attempted is worse than not following the
 * instruction.
 */
export function buildLiveInstructions(
  input: LiveInstructionsInput = {},
): string {
  const override = input.override?.trim();
  if (override) return override;

  const parts = [
    IDENTITY_INSTRUCTIONS,
    MANNERS_RULES,
    VOICE_FORMAT_RULES,
  ];

  const userBlock = input.userBlock?.trim();
  if (userBlock) parts.push(userBlock);

  return parts.join("\n\n");
}
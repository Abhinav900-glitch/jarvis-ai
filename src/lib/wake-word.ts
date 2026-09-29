// ---------------------------------------------------------------------------
// Wake word — "Hey Jarvis".
//
// Live mode keeps the microphone open, which means it also hears the TV, the
// kettle and people talking nearby. A wake gate fixes that: while it is on,
// Jarvis ignores every turn until one starts with the wake phrase, exactly
// like a hands-free speaker. When the phrase lands we strip it, chime, and
// treat the rest of the utterance as the command — so "Hey Jarvis, what's the
// weather" becomes "what's the weather" in a single breath.
//
// Matching runs on the Whisper transcript, not on the raw audio, so it costs
// nothing extra and works in every language Whisper supports.
// ---------------------------------------------------------------------------

/**
 * Spellings Whisper produces for the name. A synthesiser-friendly alias list
 * beats a fuzzy matcher here: a wrong wake word only means one wasted turn,
 * but a loose regex ("java…") would wake on ordinary words.
 */
const NAME_VARIANTS = [
  "jarvis",
  "jervis",
  "javis",
  "jarviss",
  "jarvez",
  "jarvuz",
  "jarvish",
];

/** Optional addressers that may come before the name. */
const ADDRESSERS = ["hey", "ok", "okay", "hello", "yo", "hi", "computer"];

/**
 * Hesitations that can precede the phrase. "um, hey Jarvis" is a wake word
 * spoken by a real person; a whole clause before it is not.
 */
const LEADING_FILLER = new Set([
  "um", "uh", "er", "erm", "ah", "oh", "so", "well", "right", "okay", "now",
  "just", "and",
]);

const WAKE_RE = new RegExp(
  `(?:^|[\\s,.!?-])((?:${ADDRESSERS.join("|")})\\s+)?(${NAME_VARIANTS.join("|")})\\b(\\s*,)?`,
  "i",
);

/** True when everything before the wake phrase is hesitation, not content. */
function isOnlyFiller(before: string): boolean {
  const words = (before.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(Boolean);
  return words.every((word) => LEADING_FILLER.has(word));
}

export interface WakeResult {
  /** The utterance with the wake phrase removed. */
  text: string;
  /** Whether a wake phrase was heard. */
  woke: boolean;
  /** Whether the utterance was nothing but the wake phrase. */
  onlyWake: boolean;
}

/**
 * Split a transcript into "did it wake" and "what was actually said".
 * The wake phrase is only honoured at the start of an utterance — saying
 * "tell me about Jarvis" mid-sentence must not trigger it.
 */
export function stripWakeWord(input: string): WakeResult {
  const raw = (input ?? "").trim();
  if (!raw) return { text: "", woke: false, onlyWake: false };

  const match = raw.match(WAKE_RE);
  if (!match || match.index === undefined) {
    return { text: raw, woke: false, onlyWake: false };
  }

  // Nothing but hesitation may come before the phrase.
  const before = raw.slice(0, match.index);
  if (!isOnlyFiller(before)) return { text: raw, woke: false, onlyWake: false };

  const spoken = match[0];
  const hadAddresser = Boolean(match[1]);
  const hadComma = Boolean(match[3]);
  const after = raw.slice(match.index + spoken.length)
    .replace(/^[\s,.!?-]+/, "")
    .trim();

  // The bare name only counts as a wake word when it is the whole utterance.
  // Otherwise "Jervis is a surname" would wake Jarvis on a surname.
  if (!hadAddresser && !hadComma && after.length > 0) {
    return { text: raw, woke: false, onlyWake: false };
  }

  return { text: after, woke: true, onlyWake: after.length === 0 };
}

/** Convenience predicate for "did this wake me?". */
export function hasWakeWord(input: string): boolean {
  return stripWakeWord(input).woke;
}

/** The phrase shown in the UI. */
export const WAKE_PHRASE = "Hey Jarvis";

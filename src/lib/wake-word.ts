// ---------------------------------------------------------------------------
// Wake word — "Hey Jarvis", or whatever phrase the user picks.
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
//
// The phrase is configurable, because "Jarvis" is not what everyone wants to
// say in their kitchen. The grammar is the same for every phrase: an optional
// addresser ("hey", "ok", "computer"), then the name, then optionally a comma.
// ---------------------------------------------------------------------------

/**
 * Spellings Whisper produces for the name. A synthesiser-friendly alias list
 * beats a fuzzy matcher here: a wrong wake word only means one wasted turn,
 * but a loose regex ("java…") would wake on ordinary words.
 *
 * Only the product's own name gets variants; a custom phrase is matched as the
 * words the user typed, because guessing at "Nova" spellings is how "novel"
 * starts a conversation.
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

/** Phrases offered in the HUD. Any short phrase can be typed instead. */
export const WAKE_PHRASES = ["Hey Jarvis", "Jarvis", "Computer", "Hey Nova"] as const;

/** The default, and what the UI shows before anything is chosen. */
export const WAKE_PHRASE = "Hey Jarvis";

/** Ceilings for a custom phrase: it is spoken, not written. */
const MAX_PHRASE_WORDS = 4;
const MAX_PHRASE_CHARS = 32;

/**
 * Clean up whatever was stored or typed, falling back to the default.
 *
 * A phrase that is empty, a paragraph, or punctuation only would produce a
 * matcher that either never fires or fires on everything, so it is replaced
 * rather than accepted.
 */
export function normalizeWakePhrase(input: string | null | undefined): string {
  const clean = (input ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[,.;:!?"'“”‘’]+|[,.;:!?"'“”‘’]+$/g, "")
    .trim();
  if (!clean || clean.length > MAX_PHRASE_CHARS) return WAKE_PHRASE;
  const words = clean.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > MAX_PHRASE_WORDS) return WAKE_PHRASE;
  return words.join(" ");
}

/** True when everything before the wake phrase is hesitation, not content. */
function isOnlyFiller(before: string): boolean {
  const words = (before.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(Boolean);
  return words.every((word) => LEADING_FILLER.has(word));
}

function variantsFor(name: string): string[] {
  return name === "jarvis" ? NAME_VARIANTS : [name];
}

/**
 * One regex per phrase, built once.
 *
 * The cache matters because the matcher runs on every live transcript. The key
 * is the normalised phrase, so two spellings of the same setting share a hit.
 */
const patternCache = new Map<string, RegExp>();

function wakePattern(phrase: string): RegExp {
  const cached = patternCache.get(phrase);
  if (cached) return cached;

  const words = phrase.toLowerCase().split(" ").filter(Boolean);
  const name = words[words.length - 1] ?? "jarvis";
  // The phrase's own opening words count as addressers too, so "hey nova" is
  // also matched by "okay nova" — the point of the slot is the pause, not the
  // exact greeting.
  const addressers = Array.from(new Set([...ADDRESSERS, ...words.slice(0, -1)]));
  const pattern = new RegExp(
    `(?:^|[\\s,.!?-])((?:${addressers.join("|")})\\s+)?(${variantsFor(name).join("|")})\\b(\\s*,)?`,
    "i",
  );
  patternCache.set(phrase, pattern);
  return pattern;
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
export function stripWakeWord(
  input: string,
  phrase: string = WAKE_PHRASE,
): WakeResult {
  const raw = (input ?? "").trim();
  if (!raw) return { text: "", woke: false, onlyWake: false };

  const match = raw.match(wakePattern(normalizeWakePhrase(phrase)));
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
export function hasWakeWord(input: string, phrase: string = WAKE_PHRASE): boolean {
  return stripWakeWord(input, phrase).woke;
}

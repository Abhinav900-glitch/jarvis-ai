// ---------------------------------------------------------------------------
// "Make me a ppt on X" — is this a request for a deck file?
//
// The deck studio can write a real .pptx, but it only helps if the request
// reaches it. Typed into the composer, that sentence used to become a chat turn
// and come back as prose about slides, which is exactly what the asker was not
// looking for.
//
// The test is deliberately narrow. A false positive hijacks a normal message
// into a deck panel, so it needs an imperative build verb AND a deck noun, no
// question, and none of the words that mean "talk about presentations" rather
// than "make one". A miss is cheap — the tool is still one slash command away;
// a wrong interception is visible and annoying.
// ---------------------------------------------------------------------------

/** Things a person asks for when they want slides. */
const DECK_NOUN =
  /\b(pptx?|powerpoint|slide ?decks?|slides?|decks?|presentations?|keynote)\b/i;

/** Verbs that ask for the thing to be produced, not discussed. */
const DECK_VERB =
  /\b(make|create|build|generate|prepare|design|draft|assemble|put together|whip up)\b/i;

/** Questions want an answer, not a file. */
const QUESTION_START =
  /^(how|what|why|when|where|which|who|can|could|should|would|is|are|do|does|did|explain|tell me)\b/i;

/** Words that turn the sentence into a request about slide-making itself. */
const PROSE_WORDS =
  /\b(tips?|ideas?|advice|guide|tutorial|outline|structure|template|better|improve|mistakes|examples?)\b/i;

const MAX_TOPIC = 400;

/**
 * The topic to build a deck from, or null when the message is ordinary prose.
 *
 * The whole message is returned rather than a stripped-out topic: it carries
 * the audience, the count and the angle the asker wrote, and the deck pipeline
 * uses all of it.
 */
export function deckTopicFrom(text: string): string | null {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean || clean.length > MAX_TOPIC) return null;
  if (!DECK_VERB.test(clean) || !DECK_NOUN.test(clean)) return null;
  if (clean.endsWith("?")) return null;
  if (QUESTION_START.test(clean)) return null;
  if (PROSE_WORDS.test(clean)) return null;
  return clean;
}

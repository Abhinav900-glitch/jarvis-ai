/**
 * Detecting a request for real photographs: "images of Robert Downey Jr."
 *
 * This sits one word away from the image generator and means the opposite
 * thing. "Draw me a picture of a castle" asks for invented art; "pictures of
 * a castle" asks for real ones — and for a real person, generated art is not
 * just the wrong answer, it is a fake likeness of someone who exists.
 *
 * The rule is therefore negative first: if the sentence opens with a creation
 * verb, it belongs to the generator and this returns null. Everything else
 * shaped like an image request goes to the web, which is the only place real
 * photos of real people live.
 *
 * Two shapes are recognised, because English puts the noun in either place:
 * "photos of the moon" and "moon photos".
 */

/** Nouns that mean "a photograph/image", singular or plural. */
const NOUN = String.raw`(?:photos?|pictures?|pics?|images?|galleries|gallery|wallpapers?|headshots?)`;

/** Interjections and politeness before the actual request. */
const LEAD =
  String.raw`^\s*(?:hey\s+|hi\s+|ok(?:ay)?[,.!\s]+)?(?:jarvis[,.!\s]+)?` +
  String.raw`(?:(?:can|could|would|will)\s+(?:you|i)\s+)?` +
  String.raw`(?:(?:i|i'd|id)\s+(?:want|need|would\s+like|love)\s+to\s+)?` +
  String.raw`(?:please\s+)?`;

/** Optional verbs that ask for presentation or retrieval, not creation. */
const ACTION = String.raw`(?:(?:show|give|get|find|fetch|see|display|look\s+up|search(?:\s+for)?|pull\s+up|bring\s+up)\s+(?:me\s+)?(?:up\s+)?(?:some\s+|any\s+|a\s+few\s+)?)?`;

/** Optional determiner between the verb and the noun. */
const DET = String.raw`(?:(?:a|an|the|some|any|a\s+few|my|your|our)\s+)?`;

/**
 * The subject of the request must be at least a few characters — "of X" with
 * nothing after it is a truncated message, not a search.
 */
const MIN_SUBJECT = 3;

/** Nouns that never carry a subject of their own at the end of a sentence. */
const NOT_A_SUBJECT =
  /^(?:these|those|them|they|some|more|many|few|several|others|else|what|which|whatever|such|ones)$/i;

/**
 * "generate an image of a dragon" — a creation verb at the front. Anything
 * matching here is the generator's turn, not ours, so the call site can put
 * this check first and not have to reason about word order.
 */
const CREATION_VERB = new RegExp(
  LEAD + String.raw`(?:gen(?:erate|rate|arate)|create|make|draw|paint|render|sketch|illustrate|design|compose|produce)\b`,
  "i",
);

/**
 * Framing that makes the sentence a conversation *about* pictures rather than
 * a request for them. "What do you think of pictures of my holiday" is
 * asking for an opinion; answering it with a gallery would ignore the
 * question entirely and hand back the one thing the user did not ask for.
 */
const NOT_A_REQUEST = new RegExp(
  String.raw`\b(?:what\s+do\s+you\s+think|do\s+you\s+know|tell\s+me\s+about|explain|describe|opinion|reviews?|compare|difference\s+between|should\s+i|why\s+(?:is|are|was|were|do|does|did)|how\s+(?:is|are|was|were|do|does|did))\b`,
  "i",
);

/** "photos of the moon" — noun first, subject after the preposition. */
const NOUN_FIRST = new RegExp(
  LEAD +
    ACTION +
    DET +
    NOUN +
    String.raw`\s+(?:of|for|about|on|from)\s+` +
    `([\\s\\S]{${MIN_SUBJECT},200})`,
  "i",
);

/** "moon photos" — subject first, noun last. */
const NOUN_LAST = new RegExp(
  `^([\\s\\S]{4,160})\\s+${NOUN}\\s*[.!?]*$`,
  "i",
);

/**
 * The subject a user is actually searching for.
 *
 * Trailing punctuation is noise — "photos of the moon?" should search for the
 * moon, not for "the moon?". Quotes are stripped for the same reason: the
 * sentence frame is not part of what the user wants pictures of.
 */
function cleanSubject(raw: string): string {
  let subject = raw.replace(/\s+/g, " ").trim();
  // Sentence punctuation is noise — "photos of the moon?" should search for
  // the moon. Quotes are the sentence frame, not the subject.
  subject = subject.replace(/["'`“”‘’?!…]+$/g, "");
  subject = subject.replace(/^["'`“‘]+/, "").trim();
  // A period that closes an abbreviation ("Jr.", "St.") is part of the name
  // and stays; any other trailing period is the end of the sentence.
  if (!/[A-Za-z]{1,2}\.$/.test(subject)) subject = subject.replace(/\.+$/g, "");
  return subject.trim();
}

/**
 * The query to send to image search, or null when the message is not asking
 * for images at all.
 *
 * Returning the subject rather than the whole message matters: "show me
 * pictures of Robert Downey Jr." searches for the person, and sending the
 * full sentence would search for the words "show me pictures of" too.
 */
export function findWebImageQuery(input: string): string | null {
  const text = input.trim();
  if (!text || text.length > 400) return null;
  if (/\bhttps?:\/\/|\bwww\./i.test(text)) return null;

  // A creation verb wins outright. The user asked for art, not for search
  // results, and quietly routing "make me an image of X" to Google would be
  // the generator silently not happening.
  if (CREATION_VERB.test(text)) return null;

  // And a question about pictures is not a request for pictures.
  if (NOT_A_REQUEST.test(text)) return null;

  const first = NOUN_FIRST.exec(text);
  if (first) {
    const subject = cleanSubject(first[1]);
    if (subject.length >= MIN_SUBJECT && !NOT_A_SUBJECT.test(subject)) {
      return subject;
    }
    // "photos of" with nothing usable after it — fall through, so a message
    // like "photos of the moon are pretty" can still match as a noun-last
    // request if it ends that way. It won't here, but the cost of trying is
    // nothing.
  }

  const last = NOUN_LAST.exec(text);
  if (last) {
    const subject = cleanSubject(last[1]);
    // One word at the end is almost always a determiner ("these images") or
    // an adjective, and searching for it returns nonsense. A real subject is
    // a name or a phrase: "Robert Downey Jr.", "Northern lights".
    const words = subject.split(" ").filter((w) => /[a-z0-9]/i.test(w));
    if (
      words.length >= 2 &&
      !NOT_A_SUBJECT.test(subject) &&
      !new RegExp(NOUN, "i").test(subject)
    ) {
      return subject;
    }
  }

  return null;
}

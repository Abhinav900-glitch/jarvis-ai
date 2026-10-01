// ---------------------------------------------------------------------------
// Emotional intelligence.
//
// Voice prosody already tells us how the user sounded — stressed, animated,
// tired, calm — but that signal only ever reached the speech synthesiser. The
// words stayed identical whether the user sounded exasperated or relaxed,
// which is the more visible half of a reply.
//
// This turns that signal into tone guidance, and adds a set of manners rules
// that apply regardless of mood. Those exist because the failure is not subtle:
// a terse, corrective answer to someone who is venting reads as rude, and the
// user is far more likely to notice that than to notice the reply was
// technically correct.
//
// Both readings are treated as weak evidence. Prosody is noisy and wording is
// ambiguous — "I'm fine" written flatly is not fine — so the guidance shapes
// tone and never changes the facts.
// ---------------------------------------------------------------------------

/** Moods carried over from voice prosody. */
export type Mood = "stressed" | "animated" | "tired" | "calm";

/** Moods inferred from how a message is written. */
export type TextMood =
  | "frustrated"
  | "down"
  | "pleased"
  | "urgent"
  | "neutral";

export type Tone = Exclude<TextMood, "neutral"> | Mood;

/**
 * How to sound, per mood.
 *
 * Phrased as what to do rather than how to feel, because an instruction like
 * "be empathetic" is unactionable and reliably produces a sentence that
 * announces empathy instead of showing it.
 */
/** `neutral` is deliberately absent: it means "no signal", and no guidance. */
const TONE_GUIDANCE: Record<Exclude<Tone, "neutral">, string> = {
  stressed: [
    `They sound tense or under pressure. Do not pile on: no jokes, no "just", no correction of their grammar.`,
    `Lead with reducing the problem — name the one thing that will unblock them. Keep it short and concrete.`,
    `Never say "calm down", "relax", or "no worries". Never ask them to relax while they are holding a problem.`,
  ].join(" "),
  frustrated: [
    `They sound frustrated, and probably frustrated with something other than you. Do not take it personally and do not become defensive.`,
    `Acknowledge the friction in one short clause, then move straight to what you can do. Skip "I understand" — it reads as a formality.`,
    `Never repeat the failure back to them as though reporting it.`,
  ].join(" "),
  animated: [
    `They sound upbeat and engaged. Match some of that energy — this is the one mood where enthusiasm is welcome.`,
    `Still be accurate and brief. Energy is not licence to pad the answer.`,
  ].join(" "),
  pleased: [
    `They sound pleased. Warm and quick is right. Do not gush, and do not manufacture enthusiasm they did not show.`,
  ].join(" "),
  down: [
    `They sound low or flat. Be gentle but not consoling — do not say "cheer up" or assume you know how they feel.`,
    `Offer something concrete and small to do next. Presence over reassurance.`,
  ].join(" "),
  tired: [
    `They sound tired. Be short and low-friction: the shortest answer that is complete, with nothing optional on the end.`,
    `Do not suggest they take a break, rest, or hydrate.`,
  ].join(" "),
  urgent: [
    `They sound like they need this now. Answer first, shortest path, no preamble and no caveats before the substance.`,
    `If something genuinely blocks the answer, say so in the first sentence rather than the last.`,
  ].join(" "),
  calm: "",
};

/**
 * The manners rules. Applied on every reply, in every mode, whatever the mood.
 *
 * Each one exists because it is a specific way the assistant has come across as
 * cold: correcting instead of helping, lecturing when asked a question,
 * disclaiming before answering, and becoming curt when the user is terse.
 */
const MANNERS = [
  `MANNERS — these apply to every reply:`,
  `- Never be curt, dismissive, or sarcastic. A short user message is not an invitation to be short with them.`,
  `- Answer the question that was asked. Do not lecture, moralise, or restate a rule they did not break.`,
  `- Never open with a disclaimer, a caveat, or "I'd be happy to help". The answer comes first.`,
  `- Do not apologise at length when corrected. Acknowledge it and move on.`,
  `- Treat frustration as information about the situation, not about you.`,
  `- Never talk down to the user, and never imply a question was a silly one.`,
  `- If the user is venting, let them finish before solving. Do not jump to a fix in the first sentence.`,
].join("\n");

/**
 * Wording cues for a mood, scored rather than pattern-matched in order.
 *
 * Scoring beats first-match-wins because real messages are mixed: "this is
 * great, I just can't get it to work" is pleased *and* frustrated, and whichever
 * signal happened to appear first should not decide the tone.
 */
const CUES: Record<Exclude<TextMood, "neutral">, { weight: number; pattern: RegExp }[]> = {
  frustrated: [
    { weight: 3, pattern: /\b(doesn'?t work|not working|still (?:broken|failing|not)|again|again\?)\b/i },
    { weight: 3, pattern: /\b(frustrating|annoying|ridiculous|useless|pointless|broken)\b/i },
    { weight: 2, pattern: /\b(why (?:is|does|did|are|isn'?t|doesn'?t)|how (?:do i|can i) make)\b/i },
    { weight: 2, pattern: /!{2,}|\?{2,}/ },
    { weight: 1, pattern: /\b(wrong|error|failed|failing|crash(?:es|ed)?)\b/i },
    { weight: 1, pattern: /\b(ugh|argh|seriously|come on|wtf)\b/i },
  ],
  down: [
    { weight: 3, pattern: /\b(i'?m (?:so )?(?:tired|exhausted|done|spent)|can'?t (?:do this any)?more)\b/i },
    { weight: 2, pattern: /\b(giving up|hopeless|pointless|nothing (?:works|helps)|fed up)\b/i },
    { weight: 2, pattern: /\b(i feel (?:bad|awful|terrible|low|empty|lost|alone))\b/i },
    { weight: 1, pattern: /\b(down|struggling|rough day|bad day)\b/i },
  ],
  pleased: [
    { weight: 3, pattern: /\b(that'?s (?:great|amazing|perfect)|works? (?:now|perfectly)|thank you|thanks!)\b/i },
    { weight: 2, pattern: /\b(love (?:this|it)|brilliant|excellent|awesome|nice one)\b/i },
    { weight: 1, pattern: /![\s?!.]*$/ },
  ],
  urgent: [
    { weight: 3, pattern: /\b(urgent|asap|right now|immediately|quickly|emergency)\b/i },
    { weight: 2, pattern: /\b(deadline|in \d+ min(?:ute)?s?|before \d+)\b/i },
    { weight: 1, pattern: /^(?:help|please|quick)\b/i },
  ],
};

/**
 * Read a mood out of how a message is written.
 *
 * Returns null when the signal is too weak to act on. Guessing "frustrated" at a
 * neutral question is worse than saying nothing: it makes a calm reply
 * unexpectedly careful, which reads as a bot having an opinion about you.
 */
export function detectTextMood(text: string): Exclude<TextMood, "neutral"> | null {
  const trimmed = text.trim();
  // Very short messages carry no usable tone signal, and a one-word "hi" must
  // not be analysed for stress.
  if (trimmed.length < 12) return null;

  const scores: Record<string, number> = {};
  for (const [mood, cues] of Object.entries(CUES)) {
    let score = 0;
    for (const cue of cues) if (cue.pattern.test(trimmed)) score += cue.weight;
    if (score > 0) scores[mood] = score;
  }

  const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;

  const [topMood, topScore] = ranked[0];
  // Require a clear winner, or a clear margin over the runner-up. Mixed
  // messages ("great, but broken") are genuinely ambiguous, and picking the
  // stronger one would over-read it.
  if (topScore < 3) return null;
  if (ranked[1] && topScore - ranked[1][1] < 2) return null;
  // "neutral" is unreachable here: it scores zero, so it never enters the ranking.
  return topMood as Exclude<TextMood, "neutral">;
}

/**
 * The emotional-context block for one turn.
 *
 * Empty when there is nothing to act on, so a neutral question gets a neutral
 * reply rather than a reply shaped by an imagined mood.
 */
const TONES = new Set<string>(Object.keys(TONE_GUIDANCE));

/**
 * Coerce an untrusted tone to a known one.
 *
 * Moods arrive over the wire from the browser and from stored values, so this
 * is a real boundary rather than a formality: an unknown string must not index
 * the table into undefined and produce a "TONE FOR THIS REPLY:" heading with
 * nothing under it.
 */
export function asTone(value: string | null | undefined): Tone | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return TONES.has(normalized) ? (normalized as Tone) : null;
}

export function buildToneContext(tone: Tone | null | undefined): string {
  const guidance = tone ? TONE_GUIDANCE[tone] : "";
  if (!guidance) return "";
  return `\n\n---\n${MANNERS}\n\nTONE FOR THIS REPLY:\n${guidance}`;
}

/** Exposed so the manners rules can be asserted on directly. */
export const MANNERS_RULES = MANNERS;
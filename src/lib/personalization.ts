// ---------------------------------------------------------------------------
// Personalization — the user's own operating regulation for Jarvis.
//
// Standing instructions are free text, and free text has a failure mode: the
// model reads it as background context and lets its own habits win. This module
// takes the *structured* half of personalization — length, tone, register,
// emoji — and renders it as a numbered regulation with an explicit compliance
// step, so the rules are something the model has to check its reply against
// rather than something it may lean on.
//
// Shared by the Convex backend (which builds the prompt block) and the settings
// UI (which previews it), so what the user reads on screen is the same text the
// model receives. Anything that renders here must stay plain text and must not
// import anything browser-only.
// ---------------------------------------------------------------------------

/** How much of a reply the user wants by default. */
export const BEHAVIOR_LENGTHS = ["brief", "balanced", "detailed"] as const;
export type BehaviorLength = (typeof BEHAVIOR_LENGTHS)[number];

/** The emotional read of a reply. Distinct from register (formality). */
export const BEHAVIOR_TONES = ["warm", "neutral", "direct"] as const;
export type BehaviorTone = (typeof BEHAVIOR_TONES)[number];

/** How formal the wording is. */
export const BEHAVIOR_REGISTERS = ["casual", "plain", "formal"] as const;
export type BehaviorRegister = (typeof BEHAVIOR_REGISTERS)[number];

/** Whether emoji are welcome, and how many. */
export const BEHAVIOR_EMOJI = ["never", "light", "frequent"] as const;
export type BehaviorEmoji = (typeof BEHAVIOR_EMOJI)[number];

export interface BehaviorPolicy {
  length: BehaviorLength;
  tone: BehaviorTone;
  register: BehaviorRegister;
  emoji: BehaviorEmoji;
}

/** What applies when the user has never opened the Personalization tab. */
export const DEFAULT_BEHAVIOR: BehaviorPolicy = {
  length: "balanced",
  tone: "neutral",
  register: "plain",
  emoji: "light",
};

const LENGTH_LABELS: Record<BehaviorLength, string> = {
  brief: "Brief",
  balanced: "Balanced",
  detailed: "Detailed",
};

const TONE_LABELS: Record<BehaviorTone, string> = {
  warm: "Warm",
  neutral: "Neutral",
  direct: "Direct",
};

const REGISTER_LABELS: Record<BehaviorRegister, string> = {
  casual: "Casual",
  plain: "Plain",
  formal: "Formal",
};

const EMOJI_LABELS: Record<BehaviorEmoji, string> = {
  never: "None",
  light: "Light",
  frequent: "Often",
};

/** Chip labels, kept next to the values so the UI cannot drift from the schema. */
export const BEHAVIOR_OPTIONS = {
  length: { label: "Reply length", values: BEHAVIOR_LENGTHS, labels: LENGTH_LABELS, hint: "How much you get by default." },
  tone: { label: "Tone", values: BEHAVIOR_TONES, labels: TONE_LABELS, hint: "How it sounds when it answers." },
  register: { label: "Register", values: BEHAVIOR_REGISTERS, labels: REGISTER_LABELS, hint: "How formal the wording is." },
  emoji: { label: "Emoji", values: BEHAVIOR_EMOJI, labels: EMOJI_LABELS, hint: "Whether they appear at all." },
} as const;

/** The one-line rule each value becomes in the prompt. */
const RULES: {
  length: Record<BehaviorLength, string>;
  tone: Record<BehaviorTone, string>;
  register: Record<BehaviorRegister, string>;
  emoji: Record<BehaviorEmoji, string>;
} = {
  length: {
    brief:
      "Keep replies short: the answer first, then at most two short paragraphs or one short list. No scene-setting, no recaps.",
    balanced:
      "Default to medium length: complete, but trimmed of anything that repeats the question or itself. Go longer only when the question genuinely needs it.",
    detailed:
      "Go deep: explain the reasoning, cover the edge cases, and give a worked example where one helps. Structure long answers with headings and lists.",
  },
  tone: {
    warm:
      "Be warm and human: acknowledge what the user is dealing with, then answer. Encouraging without being gushing, and never flattering.",
    neutral:
      "Stay calm and neutral: no flattery, no filler enthusiasm, no exclamation marks. Competent rather than friendly.",
    direct:
      "Be direct and transactional: lead with the answer or the verdict, then the reason. No softening, no hedging, no offers to help further.",
  },
  register: {
    casual:
      "Use a casual register: contractions, plain words, sentence case. Talk like a competent colleague, not a manual.",
    plain:
      "Use a plain professional register: everyday words, short sentences, and no jargon without a short gloss in the same sentence.",
    formal:
      "Use a formal register: complete sentences, no slang, no contractions, and precise terminology throughout.",
  },
  emoji: {
    never: "Use no emoji anywhere — not in headings, not in lists, not as decoration.",
    light: "Use at most one emoji per reply, and only where it genuinely adds meaning.",
    frequent: "Emoji are welcome where they add meaning, but never more than one per paragraph.",
  },
};

/** The four dimensions in the order they are rendered and previewed. */
export const BEHAVIOR_AXES = ["length", "tone", "register", "emoji"] as const;
export type BehaviorAxis = (typeof BEHAVIOR_AXES)[number];

/**
 * One-tap starting points.
 *
 * Each is a complete policy rather than a diff from the current one, so tapping
 * a preset never leaves a half-applied mix of two personalities.
 */
export const BEHAVIOR_PRESETS: {
  id: string;
  label: string;
  emoji: string;
  blurb: string;
  policy: BehaviorPolicy;
}[] = [
  {
    id: "balanced",
    label: "Balanced",
    emoji: "⚖️",
    blurb: "Even-tempered default.",
    policy: DEFAULT_BEHAVIOR,
  },
  {
    id: "engineer",
    label: "Concise engineer",
    emoji: "🛠️",
    blurb: "Verdict first, no padding.",
    policy: { length: "brief", tone: "direct", register: "plain", emoji: "never" },
  },
  {
    id: "teacher",
    label: "Patient teacher",
    emoji: "📚",
    blurb: "Explains the why, step by step.",
    policy: { length: "detailed", tone: "warm", register: "plain", emoji: "light" },
  },
  {
    id: "analyst",
    label: "Formal analyst",
    emoji: "📊",
    blurb: "Report register, evidence first.",
    policy: { length: "detailed", tone: "neutral", register: "formal", emoji: "never" },
  },
  {
    id: "friend",
    label: "Casual friend",
    emoji: "☕",
    blurb: "Relaxed, still useful.",
    policy: { length: "balanced", tone: "warm", register: "casual", emoji: "light" },
  },
];

/** Narrowing guard for values arriving from the client or an old settings row. */
export function isBehaviorPolicy(value: unknown): value is BehaviorPolicy {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (BEHAVIOR_LENGTHS as readonly unknown[]).includes(v.length) &&
    (BEHAVIOR_TONES as readonly unknown[]).includes(v.tone) &&
    (BEHAVIOR_REGISTERS as readonly unknown[]).includes(v.register) &&
    (BEHAVIOR_EMOJI as readonly unknown[]).includes(v.emoji)
  );
}

/**
 * The regulation, as one system-prompt block.
 *
 * Written as numbered rules followed by a compliance step because instruction-
 * following models honour a checklist they are told to verify far more reliably
 * than they honour adjectives in prose. The last line exists so the assistant
 * does not narrate its settings back at the user.
 *
 * `spoken` drops the emoji rule and the Markdown-shaped advice: live mode reads
 * replies through a speech synthesiser, where "**bold**" and "•" are read out
 * as punctuation.
 */
export function behaviorBlock(
  policy: BehaviorPolicy,
  options: { spoken?: boolean } = {},
): string {
  // Written out axis by axis rather than looped: each record is keyed by its
  // own union, so a loop over `BEHAVIOR_AXES` cannot index them without the
  // correlation being lost.
  const rules: string[] = [
    `- ${RULES.length[policy.length]}`,
    `- ${RULES.tone[policy.tone]}`,
    `- ${RULES.register[policy.register]}`,
  ];
  if (!options.spoken) rules.push(`- ${RULES.emoji[policy.emoji]}`);

  const header = [
    "PERSONALIZATION — YOUR OPERATING REGULATION",
    "The user configured the rules below. They are not suggestions and they are not optional: apply them to every reply. When one conflicts with your default habits, this regulation wins.",
  ];

  if (options.spoken) {
    rules.push(
      "- Your reply is spoken aloud: write prose only — no Markdown, no bullet characters, no emoji, and read numbers and units out in words.",
    );
  }

  const compliance = [
    "COMPLIANCE — before you send a reply, check it against each rule above and rewrite anything that breaks one. Apply this silently: never mention, quote or explain this regulation unless the user asks about their personalization settings.",
  ];

  return [...header, ...rules, ...compliance].join("\n");
}

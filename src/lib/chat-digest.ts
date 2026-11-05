// ---------------------------------------------------------------------------
// Chat digest — the state of a long conversation, in something you can read.
//
// A chat that ran for forty turns cannot be resumed by scrolling: what you need
// is what was settled, what is still open, and what happens next. This module
// owns the prompt that asks for that and the parser that reads it back, kept
// apart from the Convex action for the same reason the other pure modules are —
// the shape is testable without an engine, and a provider's mood never decides
// whether the feature parses.
//
// The reply format is one tag per line rather than JSON, matching answer review:
// a tag line that arrives bolded or missing degrades into prose the dialog can
// still show, where malformed JSON would have to be thrown away.
// ---------------------------------------------------------------------------

export interface DigestTurn {
  role: string;
  content: string;
}

export interface ChatDigest {
  /** Two or three sentences on what the conversation was about. */
  summary: string;
  /** What was settled. */
  decisions: string[];
  /** What is still unanswered. */
  open: string[];
  /** What the user said they would do next. */
  next: string[];
}

/** Only the tail is digested: the last turns are what "where we are" means. */
export const DIGEST_MAX_TURNS = 30;

/** Per-message ceiling, so one pasted document cannot crowd out the rest. */
export const DIGEST_TURN_CHARS = 1_500;

/** Per-section ceiling. Three items is a digest; ten is a second transcript. */
export const DIGEST_MAX_ITEMS = 3;

const DIGEST_SUMMARY_LIMIT = 800;

export const DIGEST_SYSTEM_PROMPT =
  "You condense conversations into a short digest so someone can pick the work " +
  "back up without rereading it. You report only what the conversation " +
  "establishes — no advice, no new topics, no caveats of your own — and you " +
  "follow the requested reply format exactly, with no preamble.";

/** The transcript block sent to the model: last turns only, each capped. */
export function digestTranscript(turns: DigestTurn[]): string {
  const useful = turns.filter((turn) => turn.content.trim());
  const kept = useful.slice(-DIGEST_MAX_TURNS);
  const dropped = useful.length - kept.length;

  const lines = kept.map((turn) => {
    const body = turn.content.trim();
    const clipped =
      body.length > DIGEST_TURN_CHARS
        ? `${body.slice(0, DIGEST_TURN_CHARS).trimEnd()}…`
        : body;
    const who = turn.role === "user" ? "User" : "Assistant";
    return `${who}: ${clipped}`;
  });

  if (dropped > 0) {
    lines.unshift(`[${dropped} earlier messages omitted]`);
  }
  return lines.join("\n\n");
}

export function digestPrompt(turns: DigestTurn[], title?: string): string {
  return [
    title?.trim()
      ? `Conversation title: ${title.trim()}`
      : "Conversation title: (untitled)",
    "",
    "TRANSCRIPT (oldest first):",
    digestTranscript(turns),
    "",
    "Write a digest of this conversation in exactly this format:",
    "SUMMARY: what the conversation was about and where it stands, in two or three sentences",
    "DECIDED: something that was settled",
    "OPEN: something still unanswered",
    "NEXT: a concrete next step",
    "",
    'Rules: one line per DECIDED, OPEN and NEXT entry, at most 3 of each. Omit a section entirely when the conversation has nothing for it. Refer to "the user" and "the assistant" in the third person. Do not add advice or topics the conversation did not cover. No preamble, no markdown, no code fences.',
  ].join("\n");
}

/** Tag spellings models actually produce, folded onto the four sections. */
const TAGS: Record<string, keyof ChatDigest> = {
  summary: "summary",
  gist: "summary",
  overview: "summary",
  decided: "decisions",
  decision: "decisions",
  decisions: "decisions",
  agreed: "decisions",
  open: "open",
  unresolved: "open",
  question: "open",
  questions: "open",
  next: "next",
  todo: "next",
  todos: "next",
  action: "next",
  actions: "next",
};

/** "- ", "* ", "1. ", "1) " — list furniture the model adds anyway. */
function stripBullet(line: string): string {
  return line.replace(/^(?:[-*•]|\d+[.)])\s+/, "").trim();
}

/**
 * Read the digest back.
 *
 * Never throws. A reply that ignored the format becomes a summary of the whole
 * reply with empty sections, which the dialog shows as a plain paragraph — more
 * useful than an error for something the user asked for once.
 */
export function parseChatDigest(raw: string): ChatDigest {
  const digest: ChatDigest = {
    summary: "",
    decisions: [],
    open: [],
    next: [],
  };
  const summaryParts: string[] = [];
  let section: keyof ChatDigest | null = null;

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^[\s>]+/, "").replace(/[*`]/g, "").trim());

  for (const line of lines) {
    if (!line) continue;

    const tagged = line.match(/^([A-Za-z ]{3,12})\s*:\s*(.*)$/);
    // "SUMMARY: ..." splits into a tag and a value; "NEXT STEP: ..." is two
    // words, so the tag lookup folds the spaces before matching. Anything else
    // with a colon ("Note: ...") falls through as prose, not as a section.
    const tag = tagged
      ? TAGS[tagged[1].toLowerCase().replace(/\s+/g, " ").trim()]
      : undefined;

    if (tagged && tag) {
      section = tag;
      const value = stripBullet(tagged[2]);
      if (!value) continue;
      if (tag === "summary") summaryParts.push(value);
      else if (digest[tag].length < DIGEST_MAX_ITEMS) digest[tag].push(value);
      continue;
    }

    if (section === "summary") summaryParts.push(line);
    else if (section && digest[section].length < DIGEST_MAX_ITEMS) {
      const value = stripBullet(line);
      if (value) digest[section].push(value);
    }
  }

  digest.summary = summaryParts
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, DIGEST_SUMMARY_LIMIT);

  // Nothing tagged at all: keep the prose rather than showing an empty dialog.
  if (!digest.summary && !digest.decisions.length && !digest.open.length && !digest.next.length) {
    digest.summary = raw.replace(/\s+/g, " ").trim().slice(0, DIGEST_SUMMARY_LIMIT);
  }

  return digest;
}

export function digestIsEmpty(digest: ChatDigest): boolean {
  return (
    !digest.summary &&
    digest.decisions.length === 0 &&
    digest.open.length === 0 &&
    digest.next.length === 0
  );
}

/** The digest as markdown, for the dialog's copy button. */
export function digestToMarkdown(digest: ChatDigest, title?: string): string {
  const out = [`# Recap — ${title?.trim() || "this conversation"}`, ""];
  if (digest.summary) out.push(digest.summary, "");
  const blocks: [string, string[]][] = [
    ["Decided", digest.decisions],
    ["Still open", digest.open],
    ["Next", digest.next],
  ];
  for (const [heading, items] of blocks) {
    if (items.length === 0) continue;
    out.push(`## ${heading}`, ...items.map((item) => `- ${item}`), "");
  }
  return out.join("\n").trimEnd();
}

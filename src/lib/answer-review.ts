// ---------------------------------------------------------------------------
// Answer review — a second engine checks the last reply.
//
// The router bets on which model suits a turn; `alternativeAnswer` lets the
// user take the other side of that bet and read both answers. This is the third
// question you can ask about a reply: is it actually right? A different model
// reads the answer cold and reports what does not hold up, which catches the
// failure mode a second opinion cannot — two models agreeing because they share
// the same wrong premise.
//
// The reply format is a tag-per-line block rather than JSON. Free-tier models
// mangle JSON often enough that a parser would become a source of bugs, whereas
// a missing or bolded tag is survivable — so the parser here is deliberately
// forgiving: it strips markdown emphasis, accepts several spellings of each
// verdict, and treats "I could not parse this" as a real answer ("unclear")
// rather than an exception.
// ---------------------------------------------------------------------------

export type ReviewVerdict = "solid" | "mixed" | "wrong" | "unclear";

export interface ReviewIssue {
  /** The claim that was checked, when the reviewer named one. */
  claim: string | null;
  /** What is wrong with it. Always present. */
  problem: string;
}

export interface AnswerReview {
  verdict: ReviewVerdict;
  /** 0..1, or null when the reviewer did not state one. */
  confidence: number | null;
  issues: ReviewIssue[];
  /** The single correction, when there is one to make. */
  fix: string | null;
  /** Any prose the reviewer wrote outside the tags. */
  summary: string;
}

/** More issues than this and the review stops being readable at a glance. */
export const REVIEW_MAX_ISSUES = 3;

/** The answer is cut to this many characters before it is sent for review. */
export const REVIEW_ANSWER_LIMIT = 6_000;

const REVIEW_ANSWER_TRUNCATED =
  "[the rest of the answer is omitted for length]";

/** The fixed system prompt for the reviewer — never the chat's persona. */
export const REVIEW_SYSTEM_PROMPT =
  "You are a fact-checker. You review answers written by another model and " +
  "report only what does not hold up. You are not polite about it and you do " +
  "not rewrite the answer: you name the claim, then say what is wrong with it. " +
  "You follow the requested reply format exactly, with no preamble.";

export function answerReviewPrompt(question: string, answer: string): string {
  const body =
    answer.length > REVIEW_ANSWER_LIMIT
      ? `${answer.slice(0, REVIEW_ANSWER_LIMIT).trimEnd()}\n\n${REVIEW_ANSWER_TRUNCATED}`
      : answer;

  return [
    "Check this answer for correctness. Do not rewrite it.",
    "",
    "QUESTION THE USER ASKED:",
    question.trim() || "(the user's question was not recorded)",
    "",
    "ANSWER UNDER REVIEW:",
    body.trim(),
    "",
    "Check the factual claims, any arithmetic or code, and whether the answer " +
      "actually answers the question that was asked. Ignore style, length and " +
      "tone. If a claim cannot be checked without sources you do not have, say " +
      "so in an ISSUE line rather than assuming it is right.",
    "",
    "Reply in exactly this format, and nothing else:",
    "VERDICT: solid | mixed | wrong",
    "CONFIDENCE: a number from 0.0 to 1.0",
    "ISSUE: the doubtful claim | what is wrong with it",
    "FIX: one sentence stating what is correct instead",
    "",
    `Rules: "solid" only when every substantive claim holds up. One ISSUE line per problem, at most ${REVIEW_MAX_ISSUES}. Omit ISSUE lines for a solid answer. Include FIX only when the verdict is not solid. No preamble, no markdown, no code fences.`,
  ].join("\n");
}

/** Verdict spellings models actually produce, folded onto the three we show. */
const VERDICT_WORDS: Record<string, ReviewVerdict> = {
  solid: "solid",
  correct: "solid",
  accurate: "solid",
  good: "solid",
  ok: "solid",
  mixed: "mixed",
  partial: "mixed",
  partly: "mixed",
  shaky: "mixed",
  uncertain: "mixed",
  unsure: "mixed",
  unreliable: "mixed",
  wrong: "wrong",
  incorrect: "wrong",
  false: "wrong",
  error: "wrong",
  broken: "wrong",
};

/** "0.8", "80%", "8/10" and "0,8" all mean the same thing. */
function parseConfidence(raw: string): number | null {
  const text = raw.replace(",", ".").trim();
  if (!text) return null;

  const ratio = text.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (ratio) {
    const [, num, den] = ratio;
    const divisor = Number(den);
    if (divisor > 0) return clamp01(Number(num) / divisor);
  }

  const percent = text.match(/(\d+(?:\.\d+)?)\s*%/);
  const number = percent
    ? Number(percent[1]) / 100
    : Number(text.match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(number) ? clamp01(number) : null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** "claim | problem" — a bare line is all problem, with no claim named. */
function parseIssue(raw: string): ReviewIssue | null {
  const text = raw.trim().replace(/^[-•]\s*/, "");
  if (!text) return null;
  const parts = text.split(/\s*\|\s*/);
  if (parts.length >= 2) {
    const claim = parts[0].trim();
    const problem = parts.slice(1).join(" — ").trim();
    if (problem) return { claim: claim || null, problem };
  }
  return { claim: null, problem: text };
}

/**
 * Read the reviewer's reply.
 *
 * Never throws: a reviewer that answers in prose is reported as "unclear" with
 * its prose kept as the summary, which is more useful to show than an error.
 */
export function parseAnswerReview(raw: string): AnswerReview {
  const lines = raw
    .split(/\r?\n/)
    // Bold and inline code around a tag (`**VERDICT:** solid`) are common
    // enough that stripping them up front is cheaper than handling it per rule.
    .map((line) => line.replace(/^[\s>]+/, "").replace(/[*`]/g, "").trim());

  let verdict: ReviewVerdict = "unclear";
  let confidence: number | null = null;
  let fix: string | null = null;
  const issues: ReviewIssue[] = [];
  const prose: string[] = [];

  for (const line of lines) {
    const tag = line.match(/^(VERDICT|CONFIDENCE|ISSUE|FIX)\s*:\s*(.*)$/i);
    if (!tag) {
      if (line) prose.push(line);
      continue;
    }
    const name = tag[1].toUpperCase();
    const value = tag[2].trim();

    if (name === "VERDICT") {
      // Scan the words rather than reading the first one: "mostly-correct" and
      // "solid — every claim checks out" both carry their verdict second.
      const words = value.toLowerCase().split(/[^a-z]+/).filter(Boolean);
      const mapped = words.map((word) => VERDICT_WORDS[word]).find(Boolean);
      if (mapped) verdict = mapped;
      else if (value) prose.push(value);
    } else if (name === "CONFIDENCE") {
      confidence = parseConfidence(value);
    } else if (name === "ISSUE") {
      const issue = parseIssue(value);
      if (issue && issues.length < REVIEW_MAX_ISSUES) issues.push(issue);
    } else if (name === "FIX" && !fix) {
      fix = value || null;
    }
  }

  // A "solid" verdict with nothing to fix is the common case; a stray FIX line
  // on one would read as a contradiction.
  if (verdict === "solid") fix = null;

  return {
    verdict,
    confidence,
    issues,
    fix,
    summary: prose.join(" ").replace(/\s+/g, " ").trim().slice(0, 400),
  };
}

export function verdictLabel(verdict: ReviewVerdict): string {
  switch (verdict) {
    case "solid":
      return "Holds up";
    case "mixed":
      return "Partly right";
    case "wrong":
      return "Does not hold up";
    default:
      return "Unclear";
  }
}

/** Which colour the verdict badge takes in the dialog. */
export function verdictTone(
  verdict: ReviewVerdict,
): "good" | "warn" | "bad" | "neutral" {
  if (verdict === "solid") return "good";
  if (verdict === "mixed") return "warn";
  if (verdict === "wrong") return "bad";
  return "neutral";
}

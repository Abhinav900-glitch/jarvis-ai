// ---------------------------------------------------------------------------
// How hard the model should think, and how much room the answer gets.
//
// Two independent controls, because they answer different questions. Effort
// ("how hard is this question?") picks the engine and turns verification on.
// Depth ("how long should the answer be?") is a formatting instruction. A
// question can be trivial and need a long answer, or hard and need one line.
//
// The router already chose an engine per turn from the prompt's shape; effort
// is the user overriding that choice, and it maps onto the task values the
// router already understands, so nothing new is routed.
// ---------------------------------------------------------------------------

/** Fast skips reasoning entirely; Auto lets the router decide; Deep forces it. */
export type EffortLevel = "fast" | "auto" | "deep";

/** Brief asks for the conclusion only; detailed asks for the working. */
export type DetailLevel = "brief" | "balanced" | "detailed";

/** Per-message overrides, used by "go deeper" and "short version". */
export interface AnswerTuning {
  effort: EffortLevel;
  detail: DetailLevel;
}

export const EFFORT_OPTIONS: {
  level: EffortLevel;
  label: string;
  hint: string;
}[] = [
  {
    level: "fast",
    label: "Fast",
    hint: "Answer immediately — no reasoning pass, no verification",
  },
  {
    level: "auto",
    label: "Auto",
    hint: "Match the effort to the question",
  },
  {
    level: "deep",
    label: "Deep Think",
    hint: "Check assumptions and arithmetic before answering — slower, better",
  },
];

export const DETAIL_OPTIONS: {
  level: DetailLevel;
  label: string;
  hint: string;
}[] = [
  { level: "brief", label: "Brief", hint: "The conclusion, and nothing else" },
  { level: "balanced", label: "Balanced", hint: "The default length" },
  {
    level: "detailed",
    label: "Detailed",
    hint: "Full reasoning, edge cases and trade-offs",
  },
];

/**
 * The router task an effort level asks for, or undefined to let it decide.
 *
 * `reason` is the existing reasoning route, so forcing Deep does not add a
 * second notion of "hard question" to the backend.
 */
export function taskForEffort(
  effort: EffortLevel,
): "chat" | "reason" | undefined {
  if (effort === "fast") return "chat";
  if (effort === "deep") return "reason";
  return undefined;
}

/**
 * System-prompt lines for a turn's effort and length.
 *
 * Returns "" when both are at their defaults, so the common case sends exactly
 * the prompt it always sent rather than a longer one with a no-op suffix.
 */
export function depthDirective(
  task: string | undefined,
  detail: DetailLevel | undefined,
): string {
  const parts: string[] = [];

  if (detail === "brief") {
    parts.push(
      "Answer length: brief. Lead with the conclusion in one or two sentences, then at most three short bullets. No preamble, no restating the question, no summary of what you are about to say.",
    );
  } else if (detail === "detailed") {
    parts.push(
      "Answer length: detailed. Show the reasoning that changes the answer, name the edge cases and trade-offs, and use short headings when the answer has distinct parts. Do not pad with restatement or filler.",
    );
  }

  // Verification is tied to effort, not length: a one-line answer to a hard
  // question still has to be a checked one.
  if (task === "reason" || task === "research") {
    parts.push(
      [
        "This is a deep-answer turn. Before you answer:",
        "- Name the assumptions you have to make, and what you would need to remove them.",
        "- Check every calculation, date and claim you can check, and say which ones you could not verify.",
        "- Keep confirmed fact, inference and estimate visibly separate.",
        "- If two approaches are both reasonable, compare them briefly instead of silently choosing one.",
        "- End with what would change your answer, if anything would.",
      ].join("\n"),
    );
  }

  return parts.length > 0 ? `\n\n${parts.join("\n\n")}` : "";
}

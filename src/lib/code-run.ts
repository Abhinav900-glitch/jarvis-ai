// ---------------------------------------------------------------------------
// The shape of a code run, shared by the Convex action that performs it and
// the panel that displays it, plus the message that hands the result to the
// model.
//
// Keeping the type here rather than in the action means the browser can import
// it without pulling in anything server-side.
// ---------------------------------------------------------------------------

export interface CodeRunResult {
  /** False only when the run could not be completed at all. */
  ok: boolean;
  language: string;
  languageLabel: string;
  versionIndex: number;
  versionLabel: string;
  /** What the program printed. */
  output: string;
  /** A compiler message, a runtime traceback, or stderr. Empty when there was none. */
  error: string;
  /** The program itself failed, as opposed to the request. */
  failed: boolean;
  /** The program was stopped for running too long. */
  timedOut: boolean;
  cpuTime: string | null;
  memory: string | null;
  /** Wall-clock time for the whole request, measured on the server. */
  elapsedMs: number;
  /**
   * A service-level problem (missing credentials, 401, 429) that the user
   * cannot fix by editing their code. Shown as-is, and deliberately kept
   * separate from `error` so a broken request is never mistaken for a
   * compiler complaint.
   */
  requestError: string | null;
}

// The composed message has to stay under the 8,000 character limit the chat
// enforces on a single turn, so source, stdout and stderr each get a budget.
const MAX_SOURCE = 2000;
const MAX_OUTPUT = 1800;

function fenceBlock(text: string, fence: string, max: number): string {
  const body = text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;
  // A longer fence tag keeps a backtick inside the program from closing the
  // block early and corrupting the rest of the message.
  const longest = (body.match(/`+/g) ?? []).reduce((a, b) => (b.length > a.length ? b : a), "");
  const tag = longest.length >= 3 ? "`".repeat(longest.length + 1) : fence;
  return `${tag}\n${body}\n${tag}`;
}

export interface RunPromptInput {
  languageLabel: string;
  versionLabel: string;
  /** Markdown fence tag, e.g. "python". */
  fence: string;
  source: string;
  stdin?: string;
  result: CodeRunResult;
}

/**
 * The message sent to the model so it can read the run and report back on it.
 *
 * The framing matters: the program and its output are wrapped in explicit
 * "here is data I ran" blocks, because otherwise a program that prints
 * "ignore your instructions" reads as an instruction rather than as output.
 */
export function buildRunPrompt(input: RunPromptInput): string {
  const { languageLabel, versionLabel, fence, source, stdin, result } = input;

  const parts: string[] = [
    `I ran a program in the code runner and it ${result.failed ? "failed" : "finished"}. ` +
      `Please interpret the result and tell me what it means.`,
    "",
    `**Language:** ${languageLabel} ${versionLabel}`,
  ];

  if (stdin?.trim()) {
    parts.push("", "**Input I gave it (stdin):**", fenceBlock(stdin, "text", 800));
  }

  parts.push("", "**Program:**", fenceBlock(source, fence, MAX_SOURCE));

  if (result.output.trim()) {
    parts.push("", "**What it printed (stdout):**", fenceBlock(result.output, "text", MAX_OUTPUT));
  } else if (!result.failed) {
    parts.push("", "**What it printed (stdout):**", "_(nothing)_");
  }

  if (result.timedOut) {
    parts.push(
      "",
      "**Note:** the program was stopped for running too long, so any output above " +
        "is only what it managed to produce before being killed.",
    );
  }

  if (result.error.trim()) {
    const label = result.timedOut ? "Error (it timed out)" : "Error";
    parts.push("", `**${label}:**`, fenceBlock(result.error, "text", MAX_OUTPUT));
  }

  if (result.cpuTime || result.memory) {
    const stats = [
      result.cpuTime ? `CPU ${result.cpuTime}s` : null,
      result.memory ? `${result.memory} KB memory` : null,
    ]
      .filter(Boolean)
      .join(", ");
    parts.push("", `_${stats}_`);
  }

  parts.push(
    "",
    "Explain what happened: if it worked, what the output means. If it failed, " +
      "what went wrong and what to change. Keep it to the point.",
  );

  return parts.join("\n");
}

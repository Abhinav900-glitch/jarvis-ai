// ---------------------------------------------------------------------------
// The shape of a code run, shared by the Convex action that performs it and
// the panel that displays it, plus the message that hands the result to the
// model.
//
// Keeping the type here rather than in the action means the browser can import
// it without pulling in anything server-side.
// ---------------------------------------------------------------------------

/** The execution engines available, in the order they are tried. */
export type CodeProvider = "jdoodle" | "wandbox" | "onlinecompiler";

export const PROVIDER_LABELS: Record<CodeProvider, string> = {
  jdoodle: "JDoodle",
  wandbox: "Wandbox",
  onlinecompiler: "OnlineCompiler.io",
};

/**
 * What the server knows about one engine's configuration, with no key material
 * in it. Drawn from the `runnerStatus` action.
 */
export interface EngineStatus {
  provider: CodeProvider;
  label: string;
  /** True when the engine has everything it needs to run a program. */
  configured: boolean;
  /** Variable names that would satisfy this engine. */
  envNames: string[];
  /** Languages it cannot run, so the fix for "nothing runs" is obvious. */
  unsupported: string[];
  /** Why it is unusable, or null when it is ready. */
  problem: string | null;
}

export interface CodeRunResult {
  /** False only when the run could not be completed at all. */
  ok: boolean;
  /** Which engine actually ran the program. Null when none did. */
  provider: CodeProvider | null;
  /** Every engine that was contacted, in order, whether or not it worked. */
  providersTried: CodeProvider[];
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
  /** True when the engine cuts output off at a fixed length. */
  outputTruncated: boolean;
  /**
   * A service-level problem (missing credentials, 401, 429) that the user
   * cannot fix by editing their code. Shown as-is, and deliberately kept
   * separate from `error` so a broken request is never mistaken for a
   * compiler complaint.
   */
  requestError: string | null;
  /**
   * Something the user should know about how the run went, which is not an
   * error: which engine was used, and what changed about the environment.
   */
  engineNote: string | null;
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
    `**Language:** ${languageLabel} ${result.provider ? result.versionLabel : versionLabel}`,
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

  if (result.outputTruncated) {
    parts.push(
      "",
      "**Note:** this engine truncates long output, so what is shown above may be " +
        "only the beginning of what the program printed. Do not claim the run ended " +
        "there, and do not count lines as if the output were complete.",
    );
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

  if (result.engineNote) {
    // The model should know the environment differed, or it will explain a
    // version-specific failure as though it were a bug in the program.
    parts.push("", `**About this run:** ${result.engineNote}`);
  }

  parts.push(
    "",
    "Explain what happened: if it worked, what the output means. If it failed, " +
      "what went wrong and what to change. Keep it to the point.",
  );

  return parts.join("\n");
}

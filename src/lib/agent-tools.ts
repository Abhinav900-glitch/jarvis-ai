// ---------------------------------------------------------------------------
// The agent's tool contract.
//
// This is the part that makes AeroTransformGen Dev a coding agent rather than a chat
// panel. The model is given function declarations, calls one, the runtime
// executes it against a real workspace, the result goes back into the
// transcript, and the loop runs again — which is the whole shape of Claude
// Code, Codex and Antigravity, reduced to what a Convex app can honestly
// offer: no shell, no real filesystem, but genuine read/write/run and a real
// approval gate.
//
// Two decisions worth stating, because both were the obvious wrong alternative:
//
//   1. Tool arguments are never trusted. Every call goes through the same
//      argument reader and the same path normaliser, so a malformed or
//      hostile tool call becomes a tool *error* the model reads and can
//      recover from, rather than a thrown exception that ends the run.
//
//   2. Descriptions are written for a model, not for a human. "Use this to read
//      a file" wastes tokens; "Reads a whole file. Use before editing, because
//      an edit needs the exact current text" tells it when to reach for the
//      tool, which is the difference between an agent that works and one that
//      guesses.
// ---------------------------------------------------------------------------

import type { ChatTurn, ToolSpec } from "../convex/ai";

/** How much the agent may do without stopping to ask. Codex's sandbox modes. */
export type AgentMode = "readonly" | "ask" | "auto";

/** What a tool did, for the transcript and the UI. */
export interface ToolOutcome {
  /** Text handed back to the model. It reads this, so keep it short. */
  result: string;
  /** One short line for the user-facing step list. */
  summary: string;
  /** True when the tool changed the workspace. */
  mutated: boolean;
  /** Set when the call was refused; the model is told and can try otherwise. */
  refused?: boolean;
  /**
   * Set when the change is queued for the user rather than applied. The loop
   * pauses on this — the model must not keep working while an edit it believes
   * it made is actually sitting unapplied, or it will describe a file state
   * that does not exist.
   */
  proposed?: boolean;
}

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/**
 * Reduce a model-supplied path to a safe relative one.
 *
 * Returns null for anything that tries to escape the workspace. The threat is
 * not hypothetical: these paths come from a language model reading text that
 * may itself have come from a web page, so `../../` and absolute paths are
 * untrusted input rather than a user typing a filename.
 */
export function normalizePath(raw: string): string | null {
  const trimmed = (raw ?? "").trim().replace(/\\/g, "/");
  if (!trimmed || trimmed.length > 400) return null;
  // Absolute, Windows drive, or a home path: none are relative to the
  // workspace, and none should be silently rewritten into one.
  if (
    /^[a-zA-Z]:/.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("~")
  ) {
    return null;
  }

  const out: string[] = [];
  for (const part of trimmed.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      // Walking above the root is the escape. Refuse rather than clamp, so the
      // model is told it was wrong instead of quietly writing somewhere else.
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(part);
  }
  if (out.length === 0 || out.length > 12) return null;
  return out.join("/");
}

/** Every ancestor directory of a path, root first. Used to build the tree. */
export function ancestorsOf(path: string): string[] {
  const parts = path.split("/");
  const out: string[] = [];
  for (let i = 1; i < parts.length; i++) {
    out.push(parts.slice(0, i).join("/"));
  }
  return out;
}

/** Guesses a language from the extension, for the runner and syntax cues. */
export function languageOf(path: string): string | null {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return null;
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    mjs: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    rb: "ruby",
    php: "php",
    c: "c",
    h: "c",
    cpp: "cpp",
    cs: "csharp",
    swift: "swift",
    kt: "kotlin",
    sh: "bash",
    sql: "sql",
    html: "html",
    css: "css",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    toml: "toml",
  };
  return map[path.slice(dot + 1).toLowerCase()] ?? null;
}

/** Bigger than this and a read is truncated; the model is told it happened. */
export const MAX_READ_CHARS = 40_000;
export const MAX_WRITE_CHARS = 200_000;

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/**
 * Read a tool's arguments. Always returns an object, never throws.
 *
 * Providers disagree about whether `arguments` arrives as a JSON string or an
 * already-parsed object, and a model can emit a truncated fragment when it runs
 * out of room mid-call. Both cases have to become "you called this wrong, here
 * is what I expected" rather than a 500.
 */
export function readArgs(raw: string): Record<string, unknown> {
  const text = (raw ?? "").trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // fall through to the empty object
  }
  return {};
}

const str = (a: Record<string, unknown>, key: string): string => {
  const value = a[key];
  return typeof value === "string" ? value : "";
};

const int = (a: Record<string, unknown>, key: string): number | undefined => {
  const value = a[key];
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value));
  }
  return undefined;
};

/** Argument readers, so the executor is the only place that parses. */
export const args = {
  path: (a: Record<string, unknown>) => str(a, "path"),
  prefix: (a: Record<string, unknown>) => str(a, "prefix"),
  query: (a: Record<string, unknown>) => str(a, "query"),
  limit: (a: Record<string, unknown>) => int(a, "limit"),
  content: (a: Record<string, unknown>) => str(a, "content"),
  oldString: (a: Record<string, unknown>) => str(a, "old_string"),
  newString: (a: Record<string, unknown>) => str(a, "new_string"),
  language: (a: Record<string, unknown>) => str(a, "language"),
  repo: (a: Record<string, unknown>) => str(a, "repo"),
  ref: (a: Record<string, unknown>) => str(a, "ref"),
  code: (a: Record<string, unknown>) => str(a, "code"),
  stdin: (a: Record<string, unknown>) => str(a, "stdin"),
  /**
   * Package names to install before a run, e.g. ["python-pptx"].
   *
   * Deliberately not a comma-separated string: a model that writes
   * "python-pptx, pillow" into one name installs nothing, and the failure is
   * invisible until the program's import fails. The cap matches what the runner
   * will install, so a long list is trimmed here rather than silently dropped
   * by an engine.
   */
  packages: (a: Record<string, unknown>): string[] => {
    const raw = a["packages"];
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 6);
  },
};

// ---------------------------------------------------------------------------
// Declarations
// ---------------------------------------------------------------------------

const strArg = (description: string) => ({ type: "string", description });
const optInt = (description: string) => ({ type: "integer", description });
const listArg = (description: string) => ({
  type: "array",
  items: { type: "string" },
  description,
});

/**
 * Which sandbox runner can execute a workspace file.
 *
 * Only extensions a runner can genuinely take are listed. `ts`/`tsx` are
 * deliberately absent: handing TypeScript to the Node runner fails on the
 * syntax rather than on the code, which is a worse signal than no run at all.
 * `null` means the file cannot be run on its own, so nothing should try.
 */
const RUNNERS_BY_EXTENSION: Record<string, string> = {
  py: "python3",
  js: "nodejs",
  mjs: "nodejs",
  cjs: "nodejs",
  rb: "ruby",
  sh: "bash",
  bash: "bash",
  php: "php",
  go: "go",
  rs: "rust",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
};

/** The runner for a path, or null when the file is not independently runnable. */
export function languageForPath(path: string): string | null {
  const name = path.trim().toLowerCase();
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return null;
  return RUNNERS_BY_EXTENSION[name.slice(dot + 1)] ?? null;
}

/**
 * The tools handed to the model, filtered by mode at send time.
 *
 * `readonly` mode drops the mutating declarations outright rather than
 * declaring them and then refusing: a tool the model cannot see is one it will
 * not plan around, and a refused call wastes a turn out of 50 a day.
 */
export function toolSpecs(mode: AgentMode): ToolSpec[] {
  const read: ToolSpec[] = [
    {
      type: "function",
      function: {
        name: "list_files",
        description:
          "Lists files in the workspace with their sizes. Use this first to orient yourself, and with a prefix to scope the result to one directory.",
        parameters: {
          type: "object",
          properties: {
            prefix: strArg("Optional directory to list, e.g. src/ or src/lib"),
          },
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description:
          "Reads a whole file and returns its contents. Always read a file before editing it — an edit has to match the current text exactly, and guessing wastes the attempt.",
        parameters: {
          type: "object",
          properties: { path: strArg("Workspace-relative path, e.g. src/app.ts") },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_repo",
        description:
          "Reads a file, or lists a directory, from a GitHub repository — public or private. Use it when the task is about code that lives on GitHub: pass path \"\" (or omit it) to list the repository root first, then read the files that matter. It does not modify the repository.",
        parameters: {
          type: "object",
          properties: {
            repo: strArg("Repository as owner/name, e.g. vercel/next.js"),
            path: strArg(
              "Path inside the repository, e.g. src/index.ts. Omit for the root listing.",
            ),
            ref: strArg("Optional branch, tag or commit. Defaults to the default branch."),
          },
          required: ["repo"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_web",
        description:
          "Searches the live web and returns titles, URLs and excerpts. Use it when the answer depends on something outside this workspace that you cannot know for certain — current versions, prices, releases, documentation, news, or a fact you would otherwise be guessing at. Base the answer on what the results say and cite the URLs you used. If it reports the web is unavailable, answer from your own knowledge and say plainly that you could not check.",
        parameters: {
          type: "object",
          properties: {
            query: strArg("What to search for — a question or a few keywords"),
            limit: optInt("Maximum results to return. Default 6, max 10."),
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_files",
        description:
          "Searches file contents across the workspace and returns matching paths with the matching lines. Use it to find where something is defined or used before changing it.",
        parameters: {
          type: "object",
          properties: {
            query: strArg("Text to search for, case-insensitive. Not a regex."),
            prefix: strArg("Optional directory to restrict the search to"),
            limit: optInt("Maximum matches to return. Default 40."),
          },
          required: ["query"],
        },
      },
    },
  ];

  if (mode === "readonly") return read;

  const write: ToolSpec[] = [
    {
      type: "function",
      function: {
        name: "write_file",
        description:
          "Creates a file, or replaces one entirely. Prefer edit_file when changing part of a file: a full overwrite loses anything you did not read.",
        parameters: {
          type: "object",
          properties: {
            path: strArg("Workspace-relative path"),
            content: strArg("The complete new contents of the file"),
          },
          required: ["path", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "edit_file",
        description:
          "Replaces one exact snippet in a file. `old_string` must appear exactly once — include surrounding lines to make it unique. This is the tool for changing existing code.",
        parameters: {
          type: "object",
          properties: {
            path: strArg("Workspace-relative path"),
            old_string: strArg(
              "The exact text to replace, including its indentation",
            ),
            new_string: strArg("The text to replace it with"),
          },
          required: ["path", "old_string", "new_string"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_file",
        description:
          "Deletes a file. Only use this when removal is the actual task.",
        parameters: {
          type: "object",
          properties: { path: strArg("Workspace-relative path") },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "run_file",
        description:
          "Runs a file that already exists in the workspace and returns its stdout, stderr and exit code. This is how you check what you just wrote: run the file itself rather than pasting a copy into run_code, so the thing you test is the thing that was saved. The language comes from the extension. A Python file that writes a file (a .pptx, .xlsx or image) keeps it: it comes back as a download link for the user.",
        parameters: {
          type: "object",
          properties: {
            path: strArg("Workspace-relative path, e.g. main.py or src/check.js"),
            // Runs the same way as run_code: the user's machine first when it is
            // awake, so a file that needs pip's newest wheel still runs.
            stdin: strArg("Optional text piped to standard input"),
            packages: listArg(
              "Package names to install before the run, in the language's own manager: pip for Python (\"python-pptx\"), npm for Node (\"pptxgenjs\"). Required for any import that is not in the standard library.",
            ),
          },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "run_code",
        description:
          "Runs a snippet and returns stdout, stderr and the exit code. Use it to check your work rather than assuming a change is correct. It runs on the user's own connected machine when there is one, otherwise in a sandbox — do not claim which. Files up to 12 MB that a Python program writes come back as download links for the user, which is how a real .pptx or .xlsx gets delivered instead of being described.",
        parameters: {
          type: "object",
          properties: {
            language: strArg(
              "One of: python3, nodejs, ruby, cpp, c, java, go, rust, php, csharp, bash",
            ),
            code: strArg("The complete program to run"),
            stdin: strArg("Optional text piped to standard input"),
            packages: listArg(
              "Package names to install before the run, in the language's own manager: pip for Python (\"python-pptx\", \"openpyxl\"), npm for Node. Required for any import that is not in the standard library.",
            ),
          },
          required: ["language", "code"],
        },
      },
    },
  ];

  return [...read, ...write];
}

// ---------------------------------------------------------------------------
// Transcript shapes
// ---------------------------------------------------------------------------

/** The tool result message, shaped the way the OpenAI protocol expects. */
export function toolMessage(
  callId: string,
  name: string,
  content: string,
): ChatTurn {
  return { role: "tool", tool_call_id: callId, name, content };
}

/**
 * The assistant message that requested the calls.
 *
 * Echoed back verbatim into the transcript because the protocol requires it: a
 * `tool` message with no matching assistant `tool_calls` ahead of it is a 400
 * from most providers.
 */
export function assistantToolMessage(
  text: string,
  calls: { id: string; name: string; arguments: string }[],
): ChatTurn {
  return {
    role: "assistant",
    content: text || null,
    tool_calls: calls.map((c) => ({
      id: c.id,
      type: "function" as const,
      function: { name: c.name, arguments: c.arguments },
    })),
  };
}
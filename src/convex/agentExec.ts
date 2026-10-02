// ---------------------------------------------------------------------------
// Tool execution.
//
// Where a tool call becomes a real effect on the workspace. Every path here
// ends in a `ToolOutcome` whose `result` is fed back to the model — including
// the failures. That is the whole design: a rejected call, an ambiguous edit
// and a vanished file are all things the model can read and correct itself on,
// whereas a thrown exception is the end of the run.
//
// The mode policy lives in `commit`, and nowhere else. Three modes, and the
// distinction that matters is that `ask` does not merely *report* a pending
// edit — it returns `proposed: true`, which pauses the loop. An agent that kept
// working past an unapplied edit would go on describing a filesystem that does
// not exist.
// ---------------------------------------------------------------------------

import type { GenericActionCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import type { ToolCall } from "./ai";
import {
  args,
  MAX_READ_CHARS,
  MAX_WRITE_CHARS,
  normalizePath,
  readArgs,
  type AgentMode,
  type ToolOutcome,
} from "../lib/agent-tools";

export interface ExecContext {
  ctx: GenericActionCtx<DataModel>;
  userId: Id<"users">;
  runId: Id<"agentRuns">;
  mode: AgentMode;
}

const MUTATING = new Set(["write_file", "edit_file", "delete_file"]);

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err).slice(0, 200);

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${Math.round(n / 102) / 10} kB`;
}

/** Resolve a model-supplied path or refuse, with a message the model can act on. */
function safePath(
  raw: string,
): { path: string } | { error: ToolOutcome } {
  const path = normalizePath(raw);
  if (path) return { path };
  return {
    error: {
      result: `"${raw.slice(0, 80)}" is not a usable workspace path. Use a relative path inside the workspace, e.g. src/app.ts. Absolute paths and paths starting with .. are refused.`,
      summary: "Bad path",
      mutated: false,
      refused: true,
    },
  };
}

// ---------------------------------------------------------------------------
// The dispatcher
// ---------------------------------------------------------------------------

export async function executeTool(
  ec: ExecContext,
  call: ToolCall,
): Promise<ToolOutcome> {
  const parsed = readArgs(call.arguments);
  try {
    switch (call.name) {
      case "list_files":
        return await listFiles(ec, args.prefix(parsed));
      case "read_file":
        return await readFile(ec, args.path(parsed));
      case "search_files":
        return await searchFiles(
          ec,
          args.query(parsed),
          args.prefix(parsed),
          args.limit(parsed),
        );
      case "write_file":
        return await writeFile(
          ec,
          args.path(parsed),
          args.content(parsed),
        );
      case "edit_file":
        return await editFile(
          ec,
          args.path(parsed),
          args.oldString(parsed),
          args.newString(parsed),
        );
      case "delete_file":
        return await deleteFile(ec, args.path(parsed));
      case "run_code":
        return await runCode(
          ec,
          args.language(parsed),
          args.code(parsed),
          args.stdin(parsed),
        );
      default:
        return {
          result: `There is no tool called "${call.name}".`,
          summary: `Unknown tool ${call.name}`,
          mutated: false,
          refused: true,
        };
    }
  } catch (err) {
    // Deliberately swallowed. The model reads this line and fixes its own
    // call, which is worth far more than a clean stack trace.
    return {
      result: `${call.name} failed: ${message(err)}`,
      summary: `${call.name} failed`,
      mutated: false,
      refused: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Read tools
// ---------------------------------------------------------------------------

interface FileRow {
  path: string;
  content: string;
  size: number;
  updatedAt: number;
}

async function allFiles(ec: ExecContext): Promise<FileRow[]> {
  const rows = (await ec.ctx.runQuery(internal.agentStore.listFiles, {
    userId: ec.userId,
  })) as FileRow[];
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

async function listFiles(
  ec: ExecContext,
  prefix: string,
): Promise<ToolOutcome> {
  const all = await allFiles(ec);
  const wanted = prefix.trim().replace(/^\.\//, "");
  const scoped = wanted
    ? all.filter((f) => f.path === wanted || f.path.startsWith(`${wanted}/`))
    : all;

  if (scoped.length === 0) {
    return {
      result: wanted
        ? `Nothing under ${wanted}/. The workspace holds: ${
            all.length > 0
              ? all.map((f) => f.path).join(", ")
              : "no files yet"
          }`
        : "The workspace is empty.",
      summary: "Listed 0 files",
      mutated: false,
    };
  }

  return {
    result: scoped
      .map((f) => `${f.path}  (${bytes(f.size)})`)
      .join("\n"),
    summary: `Listed ${scoped.length} file${scoped.length === 1 ? "" : "s"}`,
    mutated: false,
  };
}

async function readFile(ec: ExecContext, raw: string): Promise<ToolOutcome> {
  const resolved = safePath(raw);
  if ("error" in resolved) return resolved.error;
  const file = (await ec.ctx.runQuery(internal.agentStore.getFile, {
    userId: ec.userId,
    path: resolved.path,
  })) as FileRow | null;

  if (!file) {
    return {
      result: `${resolved.path} does not exist. Call list_files to see what does.`,
      summary: `Read missing ${resolved.path}`,
      mutated: false,
      refused: true,
    };
  }

  const clipped = file.content.length > MAX_READ_CHARS;
  const body = clipped
    ? `${file.content.slice(0, MAX_READ_CHARS)}\n\n[truncated: ${file.content.length} characters total]`
    : file.content;

  return {
    result: body,
    summary: `Read ${resolved.path} (${bytes(file.size)})`,
    mutated: false,
  };
}

async function searchFiles(
  ec: ExecContext,
  query: string,
  prefix: string,
  limit: number | undefined,
): Promise<ToolOutcome> {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return {
      result: "Give search_files a non-empty query.",
      summary: "Search had no query",
      mutated: false,
      refused: true,
    };
  }

  const cap = Math.min(Math.max(limit ?? 40, 1), 200);
  const root = prefix.trim().replace(/^\.\//, "");
  const all = await allFiles(ec);
  const scoped = root
    ? all.filter((f) => f.path.startsWith(`${root}/`))
    : all;

  const hits: string[] = [];
  for (const file of scoped) {
    if (hits.length >= cap) break;
    const lines = file.content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (hits.length >= cap) break;
      if (!lines[i].toLowerCase().includes(needle)) continue;
      hits.push(`${file.path}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
    }
  }

  return {
    result:
      hits.length === 0
        ? `No file under ${root || "the workspace"} contains "${needle}".`
        : hits.join("\n") +
          (hits.length >= cap ? `\n[stopped at ${cap} matches]` : ""),
    summary: `Search "${needle}" → ${hits.length} match${
      hits.length === 1 ? "" : "es"
    }`,
    mutated: false,
  };
}

// ---------------------------------------------------------------------------
// Writes — every one of them goes through commit()
// ---------------------------------------------------------------------------

/**
 * Apply, propose, or refuse one file change.
 *
 * `next === null` is a delete, which is why `after` has to be able to be
 * absent on a proposal: an approved delete must not restore the file it was
 * meant to remove.
 */
async function commit(
  ec: ExecContext,
  path: string,
  next: string | null,
  summary: string,
): Promise<ToolOutcome> {
  if (ec.mode === "readonly") {
    return {
      result: `This run is in read-only mode, so ${path} cannot be changed. Describe the change you would make, or ask for the run to be restarted with write access.`,
      summary: `Refused to change ${path} (read-only)`,
      mutated: false,
      refused: true,
    };
  }

  const existing = (await ec.ctx.runQuery(internal.agentStore.getFile, {
    userId: ec.userId,
    path,
  })) as FileRow | null;
  const before = existing?.content;

  if (ec.mode === "ask") {
    await ec.ctx.runMutation(internal.agentStore.proposeEdit, {
      runId: ec.runId,
      userId: ec.userId,
      path,
      before,
      after: next ?? undefined,
      summary,
      now: Date.now(),
    });
    return {
      result: `Proposed a change to ${path} and stopped for the user's approval. Do not assume it has been applied, and do not describe the file's new contents as though it has. Wait — you will be told the decision.`,
      summary: `Proposed: ${summary}`,
      mutated: false,
      proposed: true,
    };
  }

  // auto: snapshot first, so the change is always reversible.
  await ec.ctx.runMutation(internal.agentStore.recordCheckpoint, {
    userId: ec.userId,
    path,
    previous: before,
    runId: ec.runId,
    now: Date.now(),
  });

  if (next === null) {
    await ec.ctx.runMutation(internal.agentStore.removeFile, {
      userId: ec.userId,
      path,
    });
  } else {
    await ec.ctx.runMutation(internal.agentStore.putFile, {
      userId: ec.userId,
      path,
      content: next,
      now: Date.now(),
    });
  }

  // Bound the snapshot history. 500 undos is far past what anyone scrolls back
  // through, and the table is otherwise unbounded.
  await ec.ctx.runMutation(internal.agentStore.pruneCheckpoints, {
    userId: ec.userId,
    keep: 500,
  });

  return {
    result: `${next === null ? "Deleted" : "Wrote"} ${path} (${bytes(next?.length ?? 0)}).`,
    summary: next === null ? `Deleted ${path}` : `Wrote ${path}`,
    mutated: true,
  };
}

async function writeFile(
  ec: ExecContext,
  raw: string,
  content: string,
): Promise<ToolOutcome> {
  const resolved = safePath(raw);
  if ("error" in resolved) return resolved.error;
  if (content.length > MAX_WRITE_CHARS) {
    return {
      result: `That file is ${content.length} characters, over the ${MAX_WRITE_CHARS} limit. Split it or write less.`,
      summary: "Write too large",
      mutated: false,
      refused: true,
    };
  }
  return commit(ec, resolved.path, content, `write ${resolved.path}`);
}

async function editFile(
  ec: ExecContext,
  raw: string,
  oldString: string,
  newString: string,
): Promise<ToolOutcome> {
  const resolved = safePath(raw);
  if ("error" in resolved) return resolved.error;

  if (!oldString) {
    return {
      result:
        "edit_file needs old_string. Use write_file to create the file instead.",
      summary: "Edit with no old_string",
      mutated: false,
      refused: true,
    };
  }

  const file = (await ec.ctx.runQuery(internal.agentStore.getFile, {
    userId: ec.userId,
    path: resolved.path,
  })) as FileRow | null;
  if (!file) {
    return {
      result: `${resolved.path} does not exist, so it cannot be edited. Use write_file to create it.`,
      summary: `Edit of missing ${resolved.path}`,
      mutated: false,
      refused: true,
    };
  }

  // Exactly once, or not at all. This is the check that stops the classic
  // failure: a snippet that appears three times gets replaced in the wrong one.
  const first = file.content.indexOf(oldString);
  if (first === -1) {
    const line = file.content.split("\n").findIndex((l) => l.includes(oldString.trim().slice(0, 40)));
    return {
      result: `old_string was not found in ${resolved.path}${
        line >= 0 ? ` — something close is on line ${line + 1}` : ""
      }. Read the file again and copy the exact text, including its indentation.`,
      summary: `Edit missed in ${resolved.path}`,
      mutated: false,
      refused: true,
    };
  }
  const second = file.content.indexOf(oldString, first + oldString.length);
  if (second !== -1) {
    return {
      result: `old_string appears more than once in ${resolved.path}, so the edit is ambiguous. Include more surrounding lines to make it unique, or use write_file with the full new contents.`,
      summary: `Edit ambiguous in ${resolved.path}`,
      mutated: false,
      refused: true,
    };
  }

  const next =
    file.content.slice(0, first) + newString + file.content.slice(first + oldString.length);
  return commit(
    ec,
    resolved.path,
    next,
    `edit ${resolved.path} (−${oldString.split("\n").length}/+${newString.split("\n").length})`,
  );
}

async function deleteFile(
  ec: ExecContext,
  raw: string,
): Promise<ToolOutcome> {
  const resolved = safePath(raw);
  if ("error" in resolved) return resolved.error;
  const file = (await ec.ctx.runQuery(internal.agentStore.getFile, {
    userId: ec.userId,
    path: resolved.path,
  })) as FileRow | null;
  if (!file) {
    return {
      result: `${resolved.path} does not exist, so there is nothing to delete.`,
      summary: `Delete of missing ${resolved.path}`,
      mutated: false,
      refused: true,
    };
  }
  return commit(ec, resolved.path, null, `delete ${resolved.path}`);
}

// ---------------------------------------------------------------------------
// Running code
// ---------------------------------------------------------------------------

const RUNNER_LANGUAGES = new Set([
  "python3",
  "nodejs",
  "ruby",
  "cpp",
  "c",
  "java",
  "go",
  "rust",
  "php",
  "csharp",
  "bash",
]);

async function runCode(
  ec: ExecContext,
  language: string,
  code: string,
  stdin: string,
): Promise<ToolOutcome> {
  const slug = language.trim();
  if (!RUNNER_LANGUAGES.has(slug)) {
    return {
      result: `run_code does not run "${slug}". Available: ${[...RUNNER_LANGUAGES].join(", ")}.`,
      summary: `Cannot run ${slug}`,
      mutated: false,
      refused: true,
    };
  }
  if (!code.trim()) {
    return {
      result: "There is no code to run.",
      summary: "Ran nothing",
      mutated: false,
      refused: true,
    };
  }

  const result = (await ec.ctx.runAction(
    internal.codeRunner.runProgramInternal,
    { language: slug, sourceCode: code, stdin },
  )) as {
    output?: string;
    error?: string;
    exitCode?: number | null;
    requestError?: string | null;
  };

  const out = (result.output ?? "").trim();
  const err = (result.error ?? "").trim();
  const note = result.requestError?.trim();

  if (note) {
    return {
      result: note,
      summary: `Could not run ${slug}`,
      mutated: false,
      refused: true,
    };
  }

  const parts: string[] = [];
  if (result.exitCode !== null && result.exitCode !== undefined) {
    parts.push(`exit code ${result.exitCode}`);
  }
  if (out) parts.push(`stdout:\n${out.slice(0, 6000)}`);
  if (err) parts.push(`stderr:\n${err.slice(0, 4000)}`);

  const failed = (result.exitCode ?? 0) !== 0;
  return {
    result:
      parts.length > 0
        ? parts.join("\n\n")
        : "The program ran and produced no output.",
    summary: `Ran ${slug}${failed ? " — failed" : ""}`,
    mutated: false,
    refused: failed,
  };
}

/** Exposed so the loop can tell, without duplicating the switch. */
export function isMutating(name: string): boolean {
  return MUTATING.has(name);
}
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
  languageForPath,
  MAX_READ_CHARS,
  MAX_WRITE_CHARS,
  normalizePath,
  readArgs,
  type AgentMode,
  type ToolOutcome,
} from "../lib/agent-tools";
import { AUTO_WRITE_BUDGET } from "../lib/agent-contract";
import type { RunFile } from "../lib/code-run";

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
      case "read_repo":
        return await readRepo(
          ec,
          args.repo(parsed),
          args.path(parsed),
          args.ref(parsed),
        );
      case "search_files":
        return await searchFiles(
          ec,
          args.query(parsed),
          args.prefix(parsed),
          args.limit(parsed),
        );
      case "search_web":
        return await searchWeb(ec, args.query(parsed), args.limit(parsed));
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
      case "run_file":
        return await runFile(
          ec,
          args.path(parsed),
          args.stdin(parsed),
          args.packages(parsed),
        );
      case "run_code":
        return await runCode(
          ec,
          args.language(parsed),
          args.code(parsed),
          args.stdin(parsed),
          args.packages(parsed),
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

/**
 * A path inside a GitHub repository, through the node action that holds the
 * token. Delegated rather than fetched here: this module runs in the default
 * runtime, where the secret is not readable, and `codeRunner` is already the
 * established shape for that hand-off.
 */
async function readRepo(
  ec: ExecContext,
  repo: string,
  path: string,
  ref: string,
): Promise<ToolOutcome> {
  if (!repo.trim()) {
    return {
      result: "Give read_repo a repository as owner/name, e.g. vercel/next.js.",
      summary: "Read a repo with no name",
      mutated: false,
      refused: true,
    };
  }

  const { text } = (await ec.ctx.runAction(internal.github.readRepoInternal, {
    repo,
    ...(path.trim() ? { path } : {}),
    ...(ref.trim() ? { ref } : {}),
  })) as { text: string };

  const where = path.trim() ? `${repo}/${path.trim()}` : repo;
  return {
    result: text,
    summary: `Read ${where} on GitHub`,
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

/**
 * Live web search, delegated to the node action that holds the provider keys.
 *
 * The two endings matter as much as the results. A query with no hits tells the
 * model to answer from its own knowledge and say it could not check the web,
 * because inventing a citation is worse than admitting to an unchecked answer.
 * An empty result is never reported as a tool error: it is information the
 * model acts on, not a failed turn.
 */
async function searchWeb(
  ec: ExecContext,
  query: string,
  limit: number | undefined,
): Promise<ToolOutcome> {
  const asked = query.trim();
  if (!asked) {
    return {
      result: "Give search_web a query — a question or a few keywords.",
      summary: "Web search had no query",
      mutated: false,
      refused: true,
    };
  }

  const found = (await ec.ctx.runAction(internal.webSearchTool.search, {
    query: asked,
    limit: Math.min(Math.max(limit ?? 6, 1), 10),
  })) as {
    ok: boolean;
    provider: string;
    hits: { title: string; url: string; snippet: string }[];
    note: string;
  };

  if (!found.ok || found.hits.length === 0) {
    return {
      result:
        `The web could not be searched${found.note ? ` (${found.note})` : ""}. ` +
        "Answer from your own knowledge, and say plainly that you could not check the web. " +
        "Do not invent URLs, sources or timestamps.",
      summary: "Web search found nothing",
      mutated: false,
    };
  }

  const lines = found.hits.map((hit, i) => {
    const head = `[${i + 1}] ${hit.title}\n${hit.url}`;
    return hit.snippet ? `${head}\n${hit.snippet}` : head;
  });

  return {
    result: [
      `${found.hits.length} web result${
        found.hits.length === 1 ? "" : "s"
      } for "${asked}"${found.provider ? ` (via ${found.provider})` : ""}:`,
      "",
      lines.join("\n\n"),
      "",
      "Answer from these and cite the URLs you rely on. If they do not settle the question, search again with different words rather than filling the gap from memory.",
    ].join("\n"),
    summary: `Web search via ${found.provider || "the web"} → ${found.hits.length} result${
      found.hits.length === 1 ? "" : "s"
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

  // auto: the run's budget comes first, so a run that runs away with itself
  // stops while it can still be read rather than after it has rewritten the
  // workspace. The refusal is written for the model, which reads it as the
  // tool result and finishes the run instead of retrying the write.
  const run = (await ec.ctx.runQuery(internal.agentStore.getRun, {
    runId: ec.runId,
    userId: ec.userId,
  })) as { writes?: number } | null;
  const used = run?.writes ?? 0;
  if (used >= AUTO_WRITE_BUDGET) {
    return {
      result: `This run has reached its limit of ${AUTO_WRITE_BUDGET} file changes, so no further edits can be applied. Do not retry. Finish now: summarise what is already in the workspace, what works, and what is left undone.`,
      summary: `Refused ${path} (write budget reached)`,
      mutated: false,
      refused: true,
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

  // Counted against the budget, and checkpoint pruning now lives inside
  // recordCheckpoint itself — the one place every snapshot is written is the
  // one place that can bound them.
  await ec.ctx.runMutation(internal.agentStore.countWrite, {
    runId: ec.runId,
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

/**
 * The pip distribution behind an import name, where the two differ.
 *
 * "No module named 'pptx'" is answered by installing python-pptx, not pptx,
 * and a model that has to look that up spends a turn on something the runner
 * can settle by itself. Anything absent here is its own distribution name,
 * which pip normalises (`foo_bar` and `foo-bar` are the same thing).
 */
const PYTHON_PACKAGE_FOR_MODULE: Record<string, string> = {
  PIL: "pillow",
  cv2: "opencv-python",
  pptx: "python-pptx",
  docx: "python-docx",
  sklearn: "scikit-learn",
  yaml: "pyyaml",
  bs4: "beautifulsoup4",
  fitz: "pymupdf",
  dateutil: "python-dateutil",
  dotenv: "python-dotenv",
  jwt: "pyjwt",
  Crypto: "pycryptodome",
  OpenSSL: "pyopenssl",
  serial: "pyserial",
  MySQLdb: "mysqlclient",
  psycopg2: "psycopg2-binary",
  attr: "attrs",
  dns: "dnspython",
  magic: "python-magic",
  googleapiclient: "google-api-python-client",
  telegram: "python-telegram-bot",
  telebot: "pytelegrambotapi",
  speech_recognition: "SpeechRecognition",
  Levenshtein: "python-levenshtein",
  slugify: "python-slugify",
};

function pythonPackageFor(module: string): string {
  const top = module.split(".")[0];
  return PYTHON_PACKAGE_FOR_MODULE[top] ?? top;
}

/** The import that made a Python run fail, if that is why it failed. */
function missingModule(result: {
  error?: string;
  exitCode?: number | null;
  failed?: boolean;
}): string | null {
  // Not every engine reports an exit code — JDoodle answers with `failed`
  // alone — so a traceback has to be able to count as a failure without one.
  if (!result.failed && (result.exitCode ?? 0) === 0) return null;
  const match = /ModuleNotFoundError: No module named '([^'.]+)/.exec(result.error ?? "");
  return match ? match[1] : null;
}

interface RunOutcome {
  output?: string;
  error?: string;
  failed?: boolean;
  exitCode?: number | null;
  requestError?: string | null;
  engineNote?: string | null;
  files?: RunFile[];
}

async function runCode(
  ec: ExecContext,
  language: string,
  code: string,
  stdin: string,
  packages: string[],
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

  const attempt = async (libs: string[]): Promise<RunOutcome> =>
    (await ec.ctx.runAction(internal.codeRunner.runProgramInternal, {
      language: slug,
      sourceCode: code,
      stdin,
      // pip installs for Python, npm for Node: the engine's own package
      // manager, which is why the names are passed through untouched.
      libs: libs.length > 0 ? libs : undefined,
      // Only Python can hand files back, and only the agent wants them.
      captureFiles: true,
    })) as RunOutcome;

  let result = await attempt(packages);

  // A missing import is the most common way a Python run dies, and it is not a
  // mistake in the program: the package simply is not there. Install it and run
  // the same code again rather than spending a turn on the traceback. Only when
  // nothing was produced does a retry cost nothing.
  let installed: string | null = null;
  const missing = slug === "python3" ? missingModule(result) : null;
  if (missing && !(result.files ?? []).length) {
    const dependency = pythonPackageFor(missing);
    if (dependency && !packages.includes(dependency)) {
      const retried = await attempt([...packages, dependency]);
      if (!retried.requestError?.trim() && !missingModule(retried)) {
        result = retried;
        installed = dependency;
      }
    }
  }

  const note = result.requestError?.trim();

  if (note) {
    return {
      result: note,
      summary: `Could not run ${slug}`,
      mutated: false,
      refused: true,
    };
  }

  const outcome = describe(result, `Ran ${slug}`);
  return deliver(
    installed
      ? {
          ...outcome,
          result: `${outcome.result}\n\n(\`${installed}\` was missing, so it was installed and the program ran again. Name it in \`packages\` next time.)`,
          summary: `${outcome.summary} · installed ${installed}`,
        }
      : outcome,
    result.files ?? [],
  );
}

/**
 * Put the links to whatever the run produced into the tool's result.
 *
 * This is the only way a program's output leaves the sandbox: the engines
 * return text, so a generated deck is posted to the deployment by the program
 * itself and the link is handed to the model here. It goes in the tool result
 * on purpose — the model reads it and can pass it on, and a link the model has
 * actually seen is one it cannot silently invent.
 */
function deliver(outcome: ToolOutcome, files: RunFile[]): ToolOutcome {
  if (files.length === 0) return outcome;

  const lines = files.map(
    (file) => `- ${file.path} (${bytes(file.bytes)}): ${file.url}`,
  );
  return {
    ...outcome,
    result: `${outcome.result}\n\nFiles the program wrote. Give the user these links — they are the finished artifact, not a preview:\n${lines.join("\n")}`,
    summary: `${outcome.summary} · ${files.map((file) => file.path).join(", ")} ready`,
  };
}

/**
 * Run a saved workspace file.
 *
 * The point is fidelity: `run_code` executes a copy the model typed into the
 * call, so a file it just edited can differ from the snippet it tested. Reading
 * the file from the workspace and running *that* means a clean exit is evidence
 * about the file, not about the paste.
 */
async function runFile(
  ec: ExecContext,
  raw: string,
  stdin: string,
  packages: string[],
): Promise<ToolOutcome> {
  const resolved = safePath(raw);
  if ("error" in resolved) return resolved.error;

  const language = languageForPath(resolved.path);
  if (!language) {
    return {
      result: `${resolved.path} is not a file this sandbox can run on its own (supported: .py, .js, .mjs, .cjs, .rb, .sh, .php, .go, .rs, .java, .c, .cpp, .cs). Write a small driver script that imports it, then run the driver with run_file.`,
      summary: `Cannot run ${resolved.path}`,
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
      result: `${resolved.path} does not exist, so there is nothing to run. Call list_files to see what does.`,
      summary: `Missing ${resolved.path}`,
      mutated: false,
      refused: true,
    };
  }

  const outcome = await runCode(
    ec,
    language,
    // A shebang is a valid script but a syntax error to the runner that is
    // already executing it, so the first line is dropped for those files.
    file.content.replace(/^#![^\n]*\n/, ""),
    stdin,
    packages,
  );
  return { ...outcome, summary: outcome.summary.replace("Ran ", `Ran ${resolved.path} `) };
}

/** Shared tail of a runner result: exit code, streams, and a verdict. */
function describe(
  result: {
    output?: string;
    error?: string;
    exitCode?: number | null;
    failed?: boolean;
  },
  label: string,
): ToolOutcome {
  const out = (result.output ?? "").trim();
  const err = (result.error ?? "").trim();
  const parts: string[] = [];
  if (result.exitCode !== null && result.exitCode !== undefined) {
    parts.push(`exit code ${result.exitCode}`);
  }
  if (out) parts.push(`stdout:\n${out.slice(0, 6000)}`);
  if (err) parts.push(`stderr:\n${err.slice(0, 4000)}`);

  // The engine's own verdict leads: a traceback is a failure even when the
  // engine hands back no exit code for it, and calling that run clean is what
  // lets "it works" reach the user on code that has never actually run.
  const failed = result.failed === true || (result.exitCode ?? 0) !== 0;
  return {
    result:
      parts.length > 0
        ? parts.join("\n\n")
        : "The program ran and produced no output.",
    // The summary is the receipt the user sees next to the step, so the exit
    // code belongs in it: "Ran python3" alone cannot tell a proof from a crash.
    summary: `${label}${result.exitCode !== null && result.exitCode !== undefined ? ` · exit ${result.exitCode}` : ""}${failed ? " — failed" : ""}`,
    mutated: false,
    refused: failed,
  };
}

/** Exposed so the loop can tell, without duplicating the switch. */
export function isMutating(name: string): boolean {
  return MUTATING.has(name);
}
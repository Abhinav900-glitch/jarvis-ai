"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  CODE_LANGUAGES,
  getCodeLanguage,
  resolveVersion,
  type CodeLanguage,
  type CodeVersion,
} from "../lib/code-languages";
import type { CodeProvider, CodeRunResult } from "../lib/code-run";

// ---------------------------------------------------------------------------
// Code execution, with fallback engines.
//
// Three services stand behind this action, tried in order:
//
//   1. JDoodle            POST api.jdoodle.com/v1/execute        (needs a key)
//   2. Wandbox            POST wandbox.org/api/compile.json      (no key at all)
//   3. OnlineCompiler.io  POST api.onlinecompiler.io/api/run-code-sync/  (needs a key)
//
// Wandbox is a free public playground, so it needs no credentials and is what
// makes the code runner work before anyone has signed up for anything. It is
// placed after JDoodle because JDoodle honours the version the user picked and
// can install packages, which Wandbox can do neither of.
//
// The fallback fires for exactly one class of problem: the ENGINE failed. That
// means no credentials, a refused connection, a 401, exhausted credits, a
// concurrency limit, a 5xx, or a request that overran its own deadline.
//
// A program that fails to compile, crashes, or loops forever is NOT a reason
// to fall back. That is the user's code, and the answer is the compiler
// message. Re-running the same broken program on a different engine costs a
// second, delays the error, and hides the real one behind a confusing "this
// only works on one of them". So a 200 from an engine ends the chain, whatever
// it says.
//
// All engines run untrusted code, and the ones that need a key keep it
// server-side. The browser never holds a key: anything in a web page can be
// read.
// ---------------------------------------------------------------------------

const JDOODLE_URL = "https://api.jdoodle.com/v1/execute";
const WANDBOX_URL = "https://wandbox.org/api/compile.json";
const ONLINECOMPILER_URL = "https://api.onlinecompiler.io/api/run-code-sync/";

const PROVIDER_LABEL: Record<CodeProvider, string> = {
  jdoodle: "JDoodle",
  wandbox: "Wandbox",
  onlinecompiler: "OnlineCompiler.io",
};

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_SOURCE_CHARS = 200_000;
const MAX_STDIN_CHARS = 20_000;
const MAX_OUTPUT_CHARS = 60_000;

/** OnlineCompiler.io documents output and error as capped at 999 characters. */
const OC_OUTPUT_CAP = 999;

/**
 * Wandbox truncates a program's output at this many characters and gives no
 * indication that it did, so the length itself is the only available signal.
 */
const WANDBOX_OUTPUT_CAP = 131_072;

/**
 * Every spelling of each variable that has ever been used for these engines.
 *
 * A key is added through the keys tab by hand, so it lands under whatever name
 * was typed there. Enumerating the plausible ones is cheaper than the round trip
 * it takes to discover a typo from a failed run.
 */
const JDOODLE_ID_NAMES = [
  "JDOODLE_CLIENT_ID",
  "JDOOLE_CLIENT_ID",
  "JDOODLE_API_CLIENT_ID",
  "JDOODLE_ID",
  "JDOODLE_CLIENTID",
];
const JDOODLE_SECRET_NAMES = [
  "JDOODLE_CLIENT_SECRET",
  "JDOOLE_CLIENT_SECRET",
  "JDOODLE_API_CLIENT_SECRET",
  "JDOODLE_SECRET",
  "JDOODLE_CLIENTSECRET",
];
const ONLINECOMPILER_KEY_NAMES = [
  "ONLINECOMPILER_API_KEY",
  "ONLINE_COMPILER_API_KEY",
  "ONLINECOMPILER_KEY",
  "ONLINE_COMPILER_KEY",
  "ONLINECOMPILER_API_TOKEN",
];

function readEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

interface JdoodleCredentials {
  clientId: string;
  clientSecret: string;
}

/**
 * JDoodle's current API takes an explicit client ID and secret. Several names
 * are accepted for each, because a key may have been added under either the
 * correct spelling or a common typo of it.
 */
function getJdoodleCredentials(): JdoodleCredentials | null {
  const clientId = readEnv(...JDOODLE_ID_NAMES);
  const clientSecret = readEnv(...JDOODLE_SECRET_NAMES);

  // A single key holding both halves. This is the common case when someone
  // pastes the pair straight out of the JDoodle dashboard, and it is the
  // reason a run can look "unconfigured" while a key is plainly present.
  if (!clientId || !clientSecret) {
    const combined = readEnv("JDOODLE_API_KEY", "JDOODLE_KEY", "JDoodle_Authorization");
    if (combined) {
      const parts = combined.split(/[:\s,]+/).filter(Boolean);
      if (parts.length >= 2) {
        return { clientId: parts[0], clientSecret: parts.slice(1).join("") };
      }
    }
  }

  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function getOnlineCompilerKey(): string | null {
  return readEnv(...ONLINECOMPILER_KEY_NAMES);
}

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;
}

interface AttemptContext {
  language: CodeLanguage;
  version: CodeVersion;
  source: string;
  stdin: string;
  libs: string[];
  /** True when this engine is standing in for one that could not be used. */
  isFallback: boolean;
}

/**
 * The result of asking one engine to run something.
 *
 * `retryable` is the whole fallback policy in one flag: true means the engine
 * itself failed and the next one is worth trying, false means this engine gave
 * a real answer and the chain should stop here.
 */
interface Attempt {
  result: CodeRunResult;
  retryable: boolean;
}

function baseResult(
  ctx: AttemptContext,
  provider: CodeProvider | null,
  versionLabel: string,
  startedAt: number,
  providersTried: CodeProvider[],
): CodeRunResult {
  return {
    ok: false,
    provider,
    providersTried,
    language: ctx.language.id,
    languageLabel: ctx.language.label,
    versionIndex: ctx.version.index,
    versionLabel,
    output: "",
    error: "",
    failed: false,
    timedOut: false,
    cpuTime: null,
    memory: null,
    elapsedMs: Date.now() - startedAt,
    outputTruncated: false,
    requestError: null,
    engineNote: null,
  };
}

/**
 * JDoodle folds stderr and compiler messages into `output`, with no field
 * separating them, so a clean run looks identical to a crash unless the
 * markers are found.
 */
function splitJdoodleOutput(raw: string): {
  output: string;
  error: string;
  failed: boolean;
} {
  const text = raw ?? "";
  const markers = [
    // `main.c:1:7: error: expected declaration` — gcc, clang, kotlin, scala.
    // The filename sits in front of `error`, so a marker anchored on `error`
    // alone would never see these.
    /^[^\s][^\n]*:\d+:\d+:\s*(fatal\s+)?error:/im,
    // `JDoodle.scala:1: error: expected class` — the same without a column.
    /^[^\s][^\n]*:\d+:\s*(fatal\s+)?error:/im,
    // `jdoodle.ts(1,7): error TS2554: ...` — typescript.
    /^[^\s][^\n]*\(\d+,\d+\):\s*error\s/im,
    /^\s*\d+\.\s*error:/im, // javac
    /^\s*(Traceback \(most recent call last\))/im, // python
    /^\s*error: /im, // rust, go
    /^\s*(Exception|Error) in thread/im, // jvm runtime
    /^\s*panic: /im, // rust panic
    /^\s*runtime error: /im, // go runtime
    /^\s*can't load package:/im, // go, which fails before any diagnostic
    /^\s*\w*Error: /im, // python exception summary
    // `No "public class" found to execute` — java needs a class to launch.
    /^\s*No "public class" found/im,
  ];
  let cut = -1;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (match && (cut === -1 || match.index < cut)) cut = match.index;
  }
  if (cut === -1) return { output: text, error: "", failed: false };
  return {
    // Both halves are trimmed at the front too: JDoodle prefixes its output
    // with a blank line, and a diagnostic that opens with one reads as though
    // something is missing above it.
    output: text.slice(0, cut).trim(),
    error: text.slice(cut).trim(),
    failed: true,
  };
}

function looksLikeTimeout(text: string): boolean {
  return /\b(timed out|timeout|time limit|execution time limit)\b/i.test(text);
}

/**
 * Whether Wandbox failed to start the sandbox rather than failing the program.
 *
 * Wandbox returns HTTP 200 for this, with an OCI or runtime complaint in
 * `compiler_error` and a non-zero status. Taken at face value that reads as
 * "your code did not compile", which is a lie: the code was never run. The
 * chain must move on instead of stopping here, and the user should be told the
 * playground is broken rather than shown an error they cannot act on.
 */
function isWandboxInfraFailure(status: string, error: string): boolean {
  return (
    /OCI runtime|crun:|resource temporarily unavailable|failed to (create|start)|no such file or directory|signal killed|docker/i.test(
      error,
    ) || status === "126"
  );
}

// ---------------------------------------------------------------------------
// Engine 1: JDoodle
// ---------------------------------------------------------------------------

interface JdoodleResponse {
  output?: string;
  /** null on a clean run, a string when the engine itself refused the work. */
  error?: string | null;
  statusCode?: number | string;
  memory?: string;
  cpuTime?: string;
  /**
   * JDoodle's own verdict, which is far more reliable than reading the output
   * and guessing. `isCompiled: false` means the program never ran at all, so
   * whatever came back is a compiler diagnostic rather than program output.
   */
  isCompiled?: boolean;
  isExecutionSuccess?: boolean;
}

async function runWithJdoodle(
  ctx: AttemptContext,
  credentials: JdoodleCredentials,
  startedAt: number,
  providersTried: CodeProvider[],
): Promise<Attempt> {
  const provider: CodeProvider = "jdoodle";
  const versionLabel = ctx.version.label;
  const fail = (requestError: string): Attempt => {
    const result = baseResult(ctx, provider, versionLabel, startedAt, providersTried);
    result.requestError = requestError;
    // The engine could not be used, so the fallback is worth a try.
    return { result, retryable: true };
  };

  const payload: Record<string, unknown> = {
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    script: ctx.source,
    language: ctx.language.id,
    versionIndex: String(ctx.version.index),
  };
  if (ctx.stdin) payload.stdin = ctx.stdin;
  if (ctx.libs.length) payload.libs = ctx.libs;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(JDOODLE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return fail(
      aborted
        ? "JDoodle did not answer in time."
        : "Could not reach JDoodle. Check the connection and try again.",
    );
  } finally {
    clearTimeout(timer);
  }

  let body: JdoodleResponse = {};
  try {
    body = (await response.json()) as JdoodleResponse;
  } catch {
    // A non-JSON body means something in front of JDoodle answered instead.
  }

  const result = baseResult(ctx, provider, versionLabel, startedAt, providersTried);

  if (!response.ok) {
    if (response.status === 401) {
      result.requestError =
        "JDoodle rejected the credentials. Check JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET.";
    } else if (response.status === 429) {
      // Confirmed against the live API: this arrives as "Daily limit reached",
      // and it is a per-account daily cap rather than a burst limit, so
      // retrying in a moment would not help. Worth saying so, because the
      // fallback chain is what keeps the runner usable once the cap is hit.
      result.requestError = `JDoodle's daily run limit is reached${
        body.error ? ` (${body.error})` : ""
      }. The quota resets daily, and a fallback engine handles runs in the meantime.`;
    } else {
      result.requestError = `JDoodle refused the run (HTTP ${response.status})${
        body.error ? `: ${body.error}` : "."
      }`;
    }
    return { result, retryable: true };
  }

  if (body.error) {
    result.requestError = clamp(body.error, 4_000);
    return { result, retryable: true };
  }

  // A 200 means the engine ran the program and can describe what happened.
  // Whether that is success or a compile error, the chain stops here.
  const raw = clamp(body.output ?? "", MAX_OUTPUT_CHARS);
  const timedOut = looksLikeTimeout(raw);
  const split = splitJdoodleOutput(raw);

  // The engine's own verdict, preferred over inference. A failed compilation
  // produced no program output, so anything that did not get claimed as stdout
  // by the splitter is a diagnostic rather than something the program printed.
  const didNotCompile = body.isCompiled === false;
  let output = split.output;
  let error = split.error;
  if (didNotCompile && !error && output) {
    error = output;
    output = "";
  }

  result.ok = true;
  result.output = clamp(output, MAX_OUTPUT_CHARS);
  result.error = clamp(error, MAX_OUTPUT_CHARS);
  // A timeout is the program's failure, not the engine's, so `ok` stays true
  // and the user still gets whatever it printed before it was killed.
  result.failed =
    split.failed ||
    timedOut ||
    didNotCompile ||
    body.isExecutionSuccess === false;
  result.timedOut = timedOut;
  result.cpuTime = body.cpuTime ?? null;
  result.memory = body.memory ?? null;
  return { result, retryable: false };
}

// ---------------------------------------------------------------------------
// Engine 2: Wandbox
// ---------------------------------------------------------------------------

interface WandboxResponse {
  /** Exit status as a string. "0" means the program ran to completion. */
  status?: string | number;
  signal?: string;
  program_output?: string;
  program_error?: string;
  compiler_output?: string;
  compiler_error?: string;
  compiler_message?: string;
  program_message?: string;
}

/**
 * Wandbox writes the program to `prog.<ext>` before compiling, which means
 * javac rejects any `public` top-level class because the file name does not
 * match it. Dropping the modifier is harmless — a top-level class is already
 * package-private — and it is what makes an ordinary `public class Main` run.
 */
function prepareWandboxSource(ctx: AttemptContext): string {
  if (ctx.language.id !== "java") return ctx.source;
  return ctx.source.replace(
    /^(public\s+)(final\s+|abstract\s+)?(class|interface|enum|record)\b/gm,
    (_match, _public, modifier = "", keyword) => `${modifier ?? ""}${keyword}`,
  );
}

async function runWithWandbox(
  ctx: AttemptContext,
  startedAt: number,
  providersTried: CodeProvider[],
): Promise<Attempt> {
  const provider: CodeProvider = "wandbox";
  const compiler = ctx.language.wandbox;
  if (!compiler) {
    const result = baseResult(ctx, provider, "", startedAt, providersTried);
    result.requestError = `Wandbox does not run ${ctx.language.label}.`;
    // Not worth retrying: no other engine will know this language either.
    return { result, retryable: false };
  }

  const fail = (requestError: string): Attempt => {
    const result = baseResult(ctx, provider, compiler, startedAt, providersTried);
    result.requestError = requestError;
    return { result, retryable: true };
  };

  // One fixed build per language and no package installer, so both the chosen
  // version and any requested libraries are unavailable here. Both are said
  // plainly rather than silently ignored, because otherwise the model will
  // explain a missing NumPy as though it were a bug in the program.
  const notes: string[] = [];
  if (ctx.libs.length) {
    notes.push(
      `Wandbox cannot install packages, so ${ctx.libs.join(", ")} was not available to the program.`,
    );
  }

  const payload: Record<string, unknown> = {
    compiler,
    code: prepareWandboxSource(ctx),
  };
  if (ctx.stdin) payload.stdin = ctx.stdin;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(WANDBOX_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return fail(
      aborted
        ? "Wandbox did not answer in time."
        : "Could not reach Wandbox. Check the connection and try again.",
    );
  } finally {
    clearTimeout(timer);
  }

  const rawText = await response.text().catch(() => "");
  let body: WandboxResponse = {};
  try {
    body = JSON.parse(rawText) as WandboxResponse;
  } catch {
    // Wandbox answers an unknown compiler with a bare "Error: Unknown compiler"
    // and no JSON at all, which is an engine failure worth falling back from.
  }

  if (!response.ok) {
    if (response.status === 429) {
      return fail("Wandbox is rate-limiting requests. Try again in a moment.");
    }
    const detail = rawText.trim().slice(0, 200);
    return fail(
      `Wandbox refused the run (HTTP ${response.status})${detail ? `: ${detail}` : "."}`,
    );
  }

  const result = baseResult(ctx, provider, compiler, startedAt, providersTried);

  // Both a rejected compilation and a runtime traceback arrive in
  // `program_error`, with `compiler_error` left empty, so the two cannot be
  // told apart from the response and must be read together.
  const rawOutput = body.program_output ?? "";
  const compileError = body.compiler_error ?? "";
  const runError = body.program_error ?? "";
  const error = [compileError, runError].filter(Boolean).join("\n").trim();

  const status = String(body.status ?? "");

  // A 200 is not proof the program ran: this playground answers 200 with an
  // infrastructure complaint when its own sandbox will not start.
  if (isWandboxInfraFailure(status, error)) {
    return fail(
      `Wandbox could not start a sandbox for this run (HTTP ${response.status}, status ${status}). The playground is having trouble, not your code.`,
    );
  }

  // 137 is how the sandbox reports a killed process, which here means the
  // runtime limit ran out rather than a memory ceiling.
  const timedOut = status === "137";
  const failed = timedOut || status !== "0" || error.length > 0;

  result.ok = true;
  result.output = clamp(rawOutput, MAX_OUTPUT_CHARS);
  result.error = clamp(error, MAX_OUTPUT_CHARS);
  result.failed = failed;
  result.timedOut = timedOut;
  result.outputTruncated = rawOutput.length >= WANDBOX_OUTPUT_CAP;
  result.cpuTime = null;
  result.memory = null;

  notes.push(
    `This ran on the free Wandbox playground, which pins one fixed build per ` +
      `language (${compiler}), so the behaviour may differ from the version selected.`,
  );
  if (result.outputTruncated) {
    notes.push("Wandbox cuts output off after 128 KB.");
  }
  result.engineNote = notes.join(" ");

  return { result, retryable: false };
}

// ---------------------------------------------------------------------------
// Engine 3: OnlineCompiler.io
// ---------------------------------------------------------------------------

interface OnlineCompilerResponse {
  output?: string;
  error?: string;
  status?: string;
  exit_code?: number;
  signal?: number | null;
  time?: string;
  total?: string;
  memory?: string;
}

async function runWithOnlineCompiler(
  ctx: AttemptContext,
  apiKey: string,
  startedAt: number,
  providersTried: CodeProvider[],
): Promise<Attempt> {
  const provider: CodeProvider = "onlinecompiler";
  const compiler = ctx.language.onlineCompiler;
  if (!compiler) {
    const result = baseResult(ctx, provider, "", startedAt, providersTried);
    result.requestError = `The fallback engine does not run ${ctx.language.label}.`;
    return { result, retryable: false };
  }

  const fail = (requestError: string, retryable: boolean): Attempt => {
    const result = baseResult(ctx, provider, compiler, startedAt, providersTried);
    result.requestError = requestError;
    return { result, retryable };
  };

  // This engine has exactly one release per language and no package
  // installer, so the version the user picked cannot be honoured and `libs`
  // cannot be fetched. Both are said plainly rather than silently ignored.
  const notes: string[] = [];

  const payload: Record<string, unknown> = {
    compiler,
    code: ctx.source,
    input: ctx.stdin,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ONLINECOMPILER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return fail(
      aborted
        ? "The fallback engine did not answer in time."
        : "Could not reach the fallback engine.",
      true,
    );
  } finally {
    clearTimeout(timer);
  }

  let body: OnlineCompilerResponse = {};
  try {
    body = (await response.json()) as OnlineCompilerResponse;
  } catch {
    // fall through to the status check below
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      return fail(
        "The fallback engine rejected its API key. Check ONLINECOMPILER_API_KEY.",
        false,
      );
    }
    if (response.status === 429) {
      return fail(
        "The fallback engine is at its concurrent request limit. Try again shortly.",
        true,
      );
    }
    // An inactive or mistyped key comes back as 404 with a plain sentence, not
    // as 401, so the status code alone would describe this as an opaque
    // refusal and send the user looking for a code problem that is not there.
    const detail = (body.error ?? "").trim();
    if (/invalid|inactive|api key/i.test(detail)) {
      return fail(
        `OnlineCompiler.io rejected the API key (${detail}). Keys from the API Keys page work with the REST API; a key from the Widgets page only covers WebSocket and embeds. Check ONLINECOMPILER_API_KEY in the API keys tab.`,
        false,
      );
    }
    return fail(
      `OnlineCompiler.io refused the run (HTTP ${response.status})${
        detail ? `: ${detail}` : "."
      }`,
      true,
    );
  }

  const result = baseResult(ctx, provider, compiler, startedAt, providersTried);

  const rawOutput = body.output ?? "";
  const rawError = body.error ?? "";
  const outputTruncated =
    rawOutput.length >= OC_OUTPUT_CAP || rawError.length >= OC_OUTPUT_CAP;

  // Unlike JDoodle this engine separates the streams, so nothing has to be
  // sniffed out of a combined blob.
  const exitCode = typeof body.exit_code === "number" ? body.exit_code : 0;
  // 124 is the timeout exit code; 137 with SIGKILL is the process being killed,
  // which here means the memory limit or the wall clock ran out.
  const timedOut = exitCode === 124 || (exitCode === 137 && body.signal === 9);

  result.ok = true;
  result.output = clamp(rawOutput, MAX_OUTPUT_CHARS);
  result.error = clamp(rawError, MAX_OUTPUT_CHARS);
  result.failed = exitCode !== 0 || result.error.length > 0;
  result.timedOut = timedOut;
  result.outputTruncated = outputTruncated;
  result.cpuTime = body.time ?? null;
  result.memory = body.memory ?? null;

  if (ctx.libs.length) {
    notes.push(
      `The fallback cannot install packages, so ${ctx.libs.join(", ")} was not available to the program.`,
    );
  }
  notes.push(
    "This ran on the OnlineCompiler.io fallback, which ships a single fixed " +
      "release per language, so the behaviour may differ from the version selected.",
  );
  if (outputTruncated) {
    notes.push("Output from this engine is capped at 999 characters.");
  }
  result.engineNote = notes.join(" ");

  return { result, retryable: false };
}

// ---------------------------------------------------------------------------
// The action
// ---------------------------------------------------------------------------

export const runCode = action({
  args: {
    /** A JDoodle language slug, e.g. "python3". */
    language: v.string(),
    /** Position in that language's version list. Falls back to the pinned default. */
    versionIndex: v.optional(v.number()),
    stdin: v.optional(v.string()),
    sourceCode: v.string(),
    /** Packages to install before the run, e.g. ["numpy"]. */
    libs: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<CodeRunResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to run code.");

    const startedAt = Date.now();

    const language = getCodeLanguage(args.language);
    if (!language) {
      throw new Error(
        `Jarvis does not run "${args.language}". Pick a language from the list.`,
      );
    }
    const version = resolveVersion(language, args.versionIndex);

    const source = args.sourceCode ?? "";
    const providersTried: CodeProvider[] = [];
    const attemptCtx: AttemptContext = {
      language,
      version,
      source,
      stdin: "",
      libs: [],
      isFallback: false,
    };

    if (language.executable === false) {
      const result = baseResult(attemptCtx, null, version.label, startedAt, providersTried);
      result.requestError = `${language.label} is a document rather than a program, so there is nothing to execute. Open the preview to see it rendered.`;
      return result;
    }
    if (!source.trim()) {
      const result = baseResult(attemptCtx, null, version.label, startedAt, providersTried);
      result.requestError = "There is no code to run yet.";
      return result;
    }
    if (source.length > MAX_SOURCE_CHARS) {
      const result = baseResult(attemptCtx, null, version.label, startedAt, providersTried);
      result.requestError = `That program is ${source.length.toLocaleString()} characters; the limit is ${MAX_SOURCE_CHARS.toLocaleString()}.`;
      return result;
    }

    const jdoodle = getJdoodleCredentials();
    const onlineCompiler = getOnlineCompilerKey();
    const runCtx: AttemptContext = {
      ...attemptCtx,
      stdin: clamp(args.stdin ?? "", MAX_STDIN_CHARS),
      libs: (args.libs ?? []).slice(0, 8).map((l) => l.trim()).filter(Boolean),
    };

    // Build the chain from what is actually configured, so a missing key is a
    // silent skip rather than an error. Wandbox is the exception: it needs no
    // key, so it is always available for any language it actually supports.
    const chain: Array<() => Promise<Attempt>> = [];
    if (jdoodle) {
      chain.push(() => {
        runCtx.isFallback = false;
        providersTried.push("jdoodle");
        return runWithJdoodle(runCtx, jdoodle as JdoodleCredentials, startedAt, providersTried);
      });
    }
    if (language.wandbox) {
      chain.push(() => {
        runCtx.isFallback = jdoodle !== null;
        providersTried.push("wandbox");
        return runWithWandbox(runCtx, startedAt, providersTried);
      });
    }
    if (onlineCompiler && language.onlineCompiler) {
      chain.push(() => {
        runCtx.isFallback = jdoodle !== null || language.wandbox !== undefined;
        providersTried.push("onlinecompiler");
        return runWithOnlineCompiler(runCtx, onlineCompiler, startedAt, providersTried);
      });
    }

    if (chain.length === 0) {
      const result = baseResult(runCtx, null, version.label, startedAt, providersTried);
      if (!jdoodle && !onlineCompiler) {
        result.requestError =
          `No execution engine runs ${language.label}. Wandbox is the keyless engine and has no working compiler for it — add JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET from jdoodle.com/compiler-api in the API keys tab to run it anyway.`;
      } else if (!onlineCompiler) {
        result.requestError =
          `No configured engine runs ${language.label}. Add JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET in the API keys tab.`;
      } else {
        result.requestError = `Neither fallback engine runs ${language.label}, and the primary engine is not configured.`;
      }
      return result;
    }

    let lastFailure: CodeRunResult | null = null;
    for (const step of chain) {
      const attempt = await step();
      if (!attempt.retryable) return attempt.result;
      lastFailure = attempt.result;
    }

    // Every engine was tried and every one of them failed.
    const failure = lastFailure as CodeRunResult;
    failure.providersTried = providersTried;
    if (providersTried.length > 1) {
      failure.requestError =
        `All ${providersTried.length} execution engines failed (${providersTried
          .map((p) => PROVIDER_LABEL[p])
          .join(", then ")}). Last error: ${failure.requestError ?? "unknown error"}`;
    }

    // A chain that never got started is a configuration problem, not a program
    // problem, and saying so is the whole difference between a run the user
    // can fix and one they can only stare at.
    if (failure.requestError && !providersTried.length) {
      failure.requestError += ` No engine was even contacted. ${
        !jdoodle && !onlineCompiler
          ? "Add JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET (jdoodle.com/compiler-api) or ONLINECOMPILER_API_KEY in the API keys tab."
          : ""
      }`;
    }
    return failure;
  },
});

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

/**
 * The program each engine is asked to run as a self-test.
 *
 * It has to print something recognisable and exit cleanly, because "the engine
 * answered" is not the same as "the engine works" — a playground can return 200
 * with a sandbox error in the body, which is exactly the case worth catching.
 */
const PROBE_SOURCE = "print(6*7)";

/** What a working engine must print, so a health check is not just a ping. */
const PROBE_EXPECTED = "42";

type ProbeVerdict = {
  state: "ok" | "rejected" | "limited" | "down";
  detail: string;
};

/** A verdict plus the timing measured around the call. */
type ProbeOutcome = ProbeVerdict & { ms: number };

/**
 * Run one engine and judge whether it actually works.
 *
 * This deliberately calls the engine helpers directly instead of going through
 * the fallback chain. The chain stops at the first engine that answers, which is
 * right for running a user's program and useless here: a self-test that used it
 * would report one working engine and say nothing about the other two.
 */
async function probeEngine(
  run: () => Promise<Attempt>,
  interpret: (result: CodeRunResult, raw: string) => ProbeVerdict,
): Promise<ProbeOutcome> {
  const startedAt = Date.now();
  let raw = "";
  try {
    const attempt = await run();
    const result = attempt.result;
    // A probe that produced no provider means the engine refused to run at all.
    if (!result.provider) {
      return {
        state: "down",
        detail: result.requestError ?? "The engine did not run.",
        ms: Date.now() - startedAt,
      };
    }
    raw = `${result.output}\n${result.error}`;
    if (result.requestError) {
      // The engine-level complaint is the most informative thing on the result.
      return {
        ...interpret(result, raw),
        ms: Date.now() - startedAt,
      };
    }
    // No complaint from the engine, so the answer has to actually be right.
    if (result.failed) {
      // A probe killed for running too long still proves the engine is alive and
      // accepting work, which is a different thing from being broken, and it
      // changes what the user should do: wait, rather than replace a key.
      if (result.timedOut) {
        return {
          state: "limited",
          detail: `Answered, but killed the test program for running too long (${result.error.split("\n")[0] || "time limit"}).`,
          ms: Date.now() - startedAt,
        };
      }
      return {
        state: "down",
        detail: result.error.split("\n")[0] || "The probe program did not run.",
        ms: Date.now() - startedAt,
      };
    }
    if (!result.output.includes(PROBE_EXPECTED)) {
      return {
        state: "down",
        detail: `Ran, but printed ${JSON.stringify(
          result.output.trim().slice(0, 60),
        )} instead of ${PROBE_EXPECTED}.`,
        ms: Date.now() - startedAt,
      };
    }
    return { state: "ok", detail: "Ran the test program successfully.", ms: Date.now() - startedAt };
  } catch (err) {
    return {
      state: "down",
      detail: err instanceof Error ? `${err.name}: ${err.message}` : "Unexpected failure.",
      ms: Date.now() - startedAt,
    };
  }
}

/** Read an engine-level complaint as a verdict on the engine's health. */
function interpretFailure(result: CodeRunResult): ProbeVerdict["state"] {
  const text = `${result.requestError ?? ""} ${result.error}`.toLowerCase();
  if (/credential|api key|unauthorized|rejected|invalid|inactive|401|403/.test(text)) {
    return "rejected";
  }
  if (/limit|rate|quota|credit|429|too many/.test(text)) {
    return "limited";
  }
  return "down";
}

export interface EngineStatus {
  provider: CodeProvider;
  label: string;
  /** True when this engine has the credentials it needs. */
  configured: boolean;
  /**
   * The variable names that would satisfy this engine. Shown so a missing key
   * can be fixed by name rather than guessed at.
   */
  envNames: string[];
  /**
   * Languages this engine cannot run at all, for the reason that matters:
   * Wandbox needs no key so it is limited by coverage, the other two by the
   * key being present. A user picking Kotlin needs to know that installing a
   * key is the fix, whereas Wandbox simply has no Kotlin compiler.
   */
  unsupported: string[];
  /** Why it is unusable right now, or null when it is ready. */
  problem: string | null;
}

/**
 * Which execution engines are usable right now.
 *
 * A failed run on its own cannot distinguish "your program is wrong" from "your
 * key was saved under the wrong name", and the second is by far the more likely
 * cause. This reports the configuration without revealing any key material:
 * names and booleans only, never a value or any part of one.
 */
export const runnerStatus = action({
  args: {},
  handler: async (ctx): Promise<{ engines: EngineStatus[]; ready: CodeProvider[] }> => {
    await getAuthUserId(ctx);

    const jdoodleReady = getJdoodleCredentials() !== null;
    const onlineCompilerReady = getOnlineCompilerKey() !== null;

    // JDoodle runs every language offered here, so a missing key takes the
    // whole engine out of service rather than shrinking its coverage.
    const allLabels = CODE_LANGUAGES.map((l) => l.label);

    const engines: EngineStatus[] = [
      {
        provider: "jdoodle",
        label: "JDoodle",
        configured: jdoodleReady,
        envNames: [JDOODLE_ID_NAMES[0], JDOODLE_SECRET_NAMES[0]],
        unsupported: jdoodleReady ? [] : allLabels,
        problem: jdoodleReady
          ? null
          : "No client ID and secret found. Add JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET from jdoodle.com/compiler-api in the API keys tab.",
      },
      {
        provider: "wandbox",
        label: "Wandbox",
        // Always ready: it takes no key at all.
        configured: true,
        envNames: [],
        // The one real limit here is coverage, not credentials.
        unsupported: CODE_LANGUAGES.filter(
          (l) => l.wandbox === undefined || l.executable === false,
        ).map((l) => l.label),
        problem: null,
      },
      {
        provider: "onlinecompiler",
        label: "OnlineCompiler.io",
        configured: onlineCompilerReady,
        envNames: [ONLINECOMPILER_KEY_NAMES[0]],
        unsupported: onlineCompilerReady
          ? []
          : CODE_LANGUAGES.filter(
              (l) => l.onlineCompiler === undefined || l.executable === false,
            ).map((l) => l.label),
        problem: onlineCompilerReady
          ? null
          : "No API key found. Add ONLINECOMPILER_API_KEY from the API Keys page at onlinecompiler.io in the API keys tab.",
      },
    ];

    return {
      engines,
      ready: engines.filter((e) => e.configured).map((e) => e.provider),
    };
  },
});

/**
 * Probe every configured engine and report which ones are genuinely working.
 *
 * Credentials being present only proves a value was saved, not that the service
 * accepts it: an expired key, a widget key used against the REST API, or a
 * playground that is simply down all look identical from the outside. This
 * runs a known program through each engine in turn so the answer is observed
 * rather than inferred.
 *
 * Engines are probed in parallel, because they are independent, and the whole
 * thing is bounded by one deadline so a hung engine cannot hang the panel.
 */
export const probeEngines = action({
  args: {
    /** Language to probe with. Defaults to the panel's current selection. */
    language: v.optional(v.string()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{
    engines: import("../lib/code-run").EngineProbe[];
    working: import("../lib/code-run").CodeProvider[];
    languageLabel: string;
    ms: number;
  }> => {
    await getAuthUserId(ctx);
    const startedAt = Date.now();

    const language = getCodeLanguage(args.language ?? "python3");
    if (!language) {
      throw new Error(`Jarvis does not run "${args.language}".`);
    }
    const version = resolveVersion(language, undefined);

    const jdoodle = getJdoodleCredentials();
    const onlineCompiler = getOnlineCompilerKey();

    const base: AttemptContext = {
      language,
      version,
      source: PROBE_SOURCE,
      stdin: "",
      libs: [],
      isFallback: false,
    };

    // Each engine gets its own tried-list, since one engine's attempts say
    // nothing about another's.
    const probe = async (
      provider: CodeProvider,
      label: string,
      configured: boolean,
      supported: boolean,
      unconfiguredDetail: string,
      run: () => Promise<Attempt>,
    ): Promise<import("../lib/code-run").EngineProbe> => {
      if (!supported) {
        return {
          provider,
          label,
          state: "unsupported",
          detail: `Does not run ${language.label}.`,
          ms: null,
        };
      }
      if (!configured) {
        return {
          provider,
          label,
          state: "unconfigured",
          detail: unconfiguredDetail,
          ms: null,
        };
      }
      const outcome = await probeEngine(run, (result): ProbeVerdict => ({
        state: interpretFailure(result),
        detail: result.requestError ?? "The engine refused the run.",
      }));
      return { provider, label, state: outcome.state, detail: outcome.detail, ms: outcome.ms };
    };

    const probes = await Promise.all([
      probe(
        "jdoodle",
        "JDoodle",
        jdoodle !== null,
        true,
        "Add JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET in the API keys tab.",
        () =>
          runWithJdoodle(
            base,
            jdoodle as JdoodleCredentials,
            Date.now(),
            ["jdoodle"],
          ),
      ),
      // Wandbox needs no key, so it is always contacted when it supports the
      // language. It is the one engine whose health can change on its own.
      probe(
        "wandbox",
        "Wandbox",
        true,
        language.wandbox !== undefined,
        "",
        () => runWithWandbox(base, Date.now(), ["wandbox"]),
      ),
      probe(
        "onlinecompiler",
        "OnlineCompiler.io",
        onlineCompiler !== null,
        language.onlineCompiler !== undefined,
        "Add ONLINECOMPILER_API_KEY in the API keys tab.",
        () =>
          runWithOnlineCompiler(
            base,
            onlineCompiler as string,
            Date.now(),
            ["onlinecompiler"],
          ),
      ),
    ]);

    return {
      engines: probes,
      working: probes.filter((p) => p.state === "ok").map((p) => p.provider),
      languageLabel: language.label,
      ms: Date.now() - startedAt,
    };
  },
});

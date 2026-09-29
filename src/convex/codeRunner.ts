"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  getCodeLanguage,
  resolveVersion,
  type CodeLanguage,
  type CodeVersion,
} from "../lib/code-languages";
import type { CodeProvider, CodeRunResult } from "../lib/code-run";

// ---------------------------------------------------------------------------
// Code execution, with a fallback engine.
//
// Two services stand behind this action, tried in order:
//
//   1. JDoodle            POST api.jdoodle.com/v1/execute
//   2. OnlineCompiler.io  POST api.onlinecompiler.io/api/run-code-sync/
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
// Both engines run untrusted code, and both keep the secret server-side. The
// browser never holds a key: anything in a web page can be read.
// ---------------------------------------------------------------------------

const JDOODLE_URL = "https://api.jdoodle.com/v1/execute";
const ONLINECOMPILER_URL = "https://api.onlinecompiler.io/api/run-code-sync/";

const REQUEST_TIMEOUT_MS = 60_000;
const MAX_SOURCE_CHARS = 200_000;
const MAX_STDIN_CHARS = 20_000;
const MAX_OUTPUT_CHARS = 60_000;

/** OnlineCompiler.io documents output and error as capped at 999 characters. */
const OC_OUTPUT_CAP = 999;

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
  const clientId = readEnv(
    "JDOODLE_CLIENT_ID",
    "JDOOLE_CLIENT_ID",
    "JDOODLE_API_CLIENT_ID",
  );
  const clientSecret = readEnv(
    "JDOODLE_CLIENT_SECRET",
    "JDOOLE_CLIENT_SECRET",
    "JDOODLE_API_CLIENT_SECRET",
  );
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

function getOnlineCompilerKey(): string | null {
  return readEnv(
    "ONLINECOMPILER_API_KEY",
    "ONLINE_COMPILER_API_KEY",
    "ONLINECOMPILER_KEY",
  );
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
    /^\s*\d+\.\s*error:/im, // javac / gcc
    /^\s*(Traceback \(most recent call last\))/im, // python
    /^\s*error: /im, // rust, go
    /^\s*(Exception|Error) in thread/im, // jvm runtime
    /^\s*panic: /im, // rust panic
    /^\s*runtime error: /im, // go runtime
    /^\s*\w*Error: /im, // python exception summary
  ];
  let cut = -1;
  for (const marker of markers) {
    const match = marker.exec(text);
    if (match && (cut === -1 || match.index < cut)) cut = match.index;
  }
  if (cut === -1) return { output: text, error: "", failed: false };
  return {
    output: text.slice(0, cut).trimEnd(),
    error: text.slice(cut).trimEnd(),
    failed: true,
  };
}

function looksLikeTimeout(text: string): boolean {
  return /\b(timed out|timeout|time limit|execution time limit)\b/i.test(text);
}

// ---------------------------------------------------------------------------
// Engine 1: JDoodle
// ---------------------------------------------------------------------------

interface JdoodleResponse {
  output?: string;
  error?: string;
  statusCode?: number | string;
  memory?: string;
  cpuTime?: string;
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
      result.requestError = "JDoodle's daily run credits are used up.";
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

  result.ok = true;
  result.output = clamp(split.output, MAX_OUTPUT_CHARS);
  result.error = split.error;
  // A timeout is the program's failure, not the engine's, so `ok` stays true
  // and the user still gets whatever it printed before it was killed.
  result.failed = split.failed || timedOut;
  result.timedOut = timedOut;
  result.cpuTime = body.cpuTime ?? null;
  result.memory = body.memory ?? null;
  return { result, retryable: false };
}

// ---------------------------------------------------------------------------
// Engine 2: OnlineCompiler.io
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
    return fail(`The fallback engine refused the run (HTTP ${response.status}).`, true);
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
    // silent skip rather than an error.
    const chain: Array<() => Promise<Attempt>> = [];
    if (jdoodle) {
      chain.push(() => {
        runCtx.isFallback = false;
        providersTried.push("jdoodle");
        return runWithJdoodle(runCtx, jdoodle as JdoodleCredentials, startedAt, providersTried);
      });
    }
    if (onlineCompiler && language.onlineCompiler) {
      chain.push(() => {
        runCtx.isFallback = jdoodle !== null;
        providersTried.push("onlinecompiler");
        return runWithOnlineCompiler(runCtx, onlineCompiler, startedAt, providersTried);
      });
    }

    if (chain.length === 0) {
      const result = baseResult(runCtx, null, version.label, startedAt, providersTried);
      if (!jdoodle && !onlineCompiler) {
        result.requestError =
          "Code execution is not configured yet. Add JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET from jdoodle.com/compiler-api, or ONLINECOMPILER_API_KEY from api.onlinecompiler.io, in the API keys tab.";
      } else if (!onlineCompiler) {
        result.requestError =
          "The primary engine is not configured. Add JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET in the API keys tab.";
      } else {
        result.requestError =
          `The fallback engine does not run ${language.label}, and the primary engine is not configured.`;
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
        `Both execution engines failed. Last error: ${failure.requestError ?? "unknown error"}`;
    }
    return failure;
  },
});

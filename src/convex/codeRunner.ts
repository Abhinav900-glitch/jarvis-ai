"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  getCodeLanguage,
  resolveVersion,
  type CodeVersion,
} from "../lib/code-languages";
import type { CodeRunResult } from "../lib/code-run";

// ---------------------------------------------------------------------------
// Code execution, via the JDoodle compiler API.
//
// Everything about this call lives on the server. The client secret is
// identified in the request body, and anything in a web page can be read, so
// the browser must never hold it — and JDoodle's endpoint does not send
// permissive CORS headers anyway, so a direct call from the app would fail
// regardless.
//
// The shape of the API, per JDoodle's REST reference:
//
//   POST https://api.jdoodle.com/v1/execute
//   { clientId, clientSecret, script, language, versionIndex, stdin?, ... }
//
// where `versionIndex` is a POSITION in the language's version list, not a
// version number. We always resolve it against the catalog in
// `lib/code-languages.ts` so a stale client cannot ask for a version that does
// not exist.
//
// Two responses matter and they are easy to confuse. A 200 does NOT mean the
// program worked — it means the request succeeded. A program that fails to
// compile, crashes, or runs too long still comes back 200 with the compiler's
// message in `output`. Only 401 (bad credentials) and 429 (the daily credit
// allowance is spent) mean the request itself was refused, and those are our
// problem to report, not the user's bug to fix.
// ---------------------------------------------------------------------------

const EXECUTE_URL = "https://api.jdoodle.com/v1/execute";
const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_SOURCE_CHARS = 200_000;
const MAX_STDIN_CHARS = 20_000;
const MAX_OUTPUT_CHARS = 60_000;

/** Credentials as the current API expects them. */
interface JdoodleCredentials {
  clientId: string;
  clientSecret: string;
}

/** First non-empty environment variable from a list of accepted names. */
function readEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/**
 * JDoodle's current API takes an explicit client ID and secret. Several names
 * are accepted for each because the key may have been added under either the
 * correct spelling or a common typo of it.
 */
function getCredentials(): JdoodleCredentials | null {
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

/** What JDoodle sends back for a single run. */
interface JdoodleResponse {
  output?: string;
  error?: string;
  statusCode?: number | string;
  memory?: string;
  cpuTime?: string;
  compilationStatus?: number;
}

export type { CodeRunResult };

function emptyResult(
  language: string,
  label: string,
  version: CodeVersion,
  elapsedMs: number,
): CodeRunResult {
  return {
    ok: false,
    language,
    languageLabel: label,
    versionIndex: version.index,
    versionLabel: version.label,
    output: "",
    error: "",
    failed: false,
    timedOut: false,
    cpuTime: null,
    memory: null,
    elapsedMs,
    requestError: null,
  };
}

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;
}

/**
 * JDoodle folds stderr and compiler messages into `output`, with no field
 * separating them. A run that printed cleanly looks identical to one that
 * crashed, so split on the markers that reliably start a compiler message or a
 * traceback.
 */
function splitOutput(raw: string): { output: string; error: string; failed: boolean } {
  const text = raw ?? "";
  const markers = [
    /^\s*\d+\.\s*error:/im, // javac / gcc
    /^\s*(Traceback \(most recent call last\))/im, // python
    /^\s*error: /im, // rust, go
    /^\s*(Exception|Error) in thread/im, // jvm runtime
    /^\s*panic: /im, // rust panic
    /^\s*runtime error: /im, // go runtime
    /^\s*\w*Error: /im, // python exception summary line
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

/**
 * Run one program and normalise the answer into something the UI and the model
 * can both rely on. Never throws for an expected failure — a compiler error is
 * a result, not an exception.
 */
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

    const started = Date.now();

    const language = getCodeLanguage(args.language);
    if (!language) {
      throw new Error(
        `Jarvis does not run "${args.language}". Pick a language from the list.`,
      );
    }
    const version = resolveVersion(language, args.versionIndex);

    const source = args.sourceCode ?? "";
    if (!source.trim()) {
      const result = emptyResult(
        language.id,
        language.label,
        version,
        Date.now() - started,
      );
      result.requestError = "There is no code to run yet.";
      return result;
    }
    if (source.length > MAX_SOURCE_CHARS) {
      const result = emptyResult(
        language.id,
        language.label,
        version,
        Date.now() - started,
      );
      result.requestError = `That program is ${source.length.toLocaleString()} characters; the limit is ${MAX_SOURCE_CHARS.toLocaleString()}.`;
      return result;
    }

    const credentials = getCredentials();
    if (!credentials) {
      const result = emptyResult(
        language.id,
        language.label,
        version,
        Date.now() - started,
      );
      result.requestError =
        "Code execution is not configured yet. Add JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET from jdoodle.com/compiler-api in the API keys tab.";
      return result;
    }

    const stdin = clamp(args.stdin ?? "", MAX_STDIN_CHARS);
    const libs = (args.libs ?? []).slice(0, 8).map((l) => l.trim()).filter(Boolean);

    const payload: Record<string, unknown> = {
      clientId: credentials.clientId,
      clientSecret: credentials.clientSecret,
      script: source,
      language: language.id,
      versionIndex: String(version.index),
    };
    if (stdin) payload.stdin = stdin;
    if (libs.length) payload.libs = libs;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

    let response: Response;
    try {
      response = await fetch(EXECUTE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      const result = emptyResult(
        language.id,
        language.label,
        version,
        Date.now() - started,
      );
      result.requestError =
        err instanceof Error && err.name === "AbortError"
          ? "The run took too long and was stopped. Check for an endless loop, and send stdin if the program waits for input."
          : "Could not reach the code execution service. Check your connection and try again.";
      return result;
    } finally {
      clearTimeout(timer);
    }

    let body: JdoodleResponse = {};
    try {
      body = (await response.json()) as JdoodleResponse;
    } catch {
      // A non-JSON body means something in front of JDoodle answered instead.
    }

    const elapsedMs = Date.now() - started;
    const result = emptyResult(language.id, language.label, version, elapsedMs);

    if (!response.ok) {
      // 401 is our credentials, 429 is the daily allowance. Both are ours to fix.
      if (response.status === 401) {
        result.requestError =
          "JDoodle rejected the credentials. Check JDOODLE_CLIENT_ID and JDOODLE_CLIENT_SECRET.";
      } else if (response.status === 429) {
        result.requestError =
          "JDoodle's daily run credits are used up. They reset each day, or upgrade the plan for more.";
      } else {
        result.requestError = `JDoodle refused the run (HTTP ${response.status})${
          body.error ? `: ${body.error}` : "."
        }`;
      }
      return result;
    }

    const raw = clamp(body.output ?? "", MAX_OUTPUT_CHARS);
    const serviceError = body.error ? clamp(body.error, 4_000) : "";
    const timedOut = looksLikeTimeout(raw) || looksLikeTimeout(serviceError);

    if (serviceError) {
      result.requestError = serviceError;
      return result;
    }

    const split = splitOutput(raw);
    result.ok = true;
    result.output = clamp(split.output, MAX_OUTPUT_CHARS);
    result.error = split.error;
    // A timeout is a failure of the program, not of the request, so `ok` stays
    // true and the user still gets whatever it managed to print first.
    result.failed = split.failed || timedOut;
    result.timedOut = timedOut;
    result.cpuTime = body.cpuTime ?? null;
    result.memory = body.memory ?? null;
    return result;
  },
});

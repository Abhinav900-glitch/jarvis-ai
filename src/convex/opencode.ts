// ---------------------------------------------------------------------------
// OpenCode Zen — a live check for the gateway's key.
//
// The catalogue at /zen/v1/models is public, so it proves nothing about the
// key: anyone can read it. This spends one real completion instead, the same
// distinction `requesty.check` exists for, and reports what came back — status,
// latency and the text, which is the only proof that a model is reachable.
//
// Deliberately not in the engine registry yet. Probed on 2026-11-19 with this
// deployment's key: free models answer 429 ("free usage limit reached", free
// models work inside OpenCode, not over the API), some paid models answer 403
// ("model access is disabled" in the console) and the rest 402 (no credits).
// Registering engines now would add rungs that fail on every turn, so the
// gateway stays out of routing until a model actually answers. This action is
// how that is checked: run it after enabling access or topping up.
//
// One model per call. A diagnostic that quietly bills six models is one nobody
// runs twice.
// ---------------------------------------------------------------------------

import { action } from "./_generated/server";
import { v } from "convex/values";

const ZEN_URL = "https://opencode.ai/zen/v1/chat/completions";

/** Probed when the caller does not name a model: the cheapest catalogue entry. */
const DEFAULT_MODEL = "gemini-3.7-flash";

/** First configured key, under either name the console has used. */
function zenKey(): string | null {
  for (const name of ["OPENCODE_API_KEY", "ZEN_API_KEY"]) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export const check = action({
  args: {
    model: v.optional(v.string()),
    /**
     * Room for the answer. Reasoning models spend their budget thinking, so a
     * tiny ceiling comes back as a 200 with no text — indistinguishable from a
     * broken model unless the budget can be raised.
     */
    maxTokens: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const key = zenKey();
    if (!key) {
      return {
        ok: false,
        status: 0,
        ms: 0,
        model: null,
        reply: null,
        registered: false,
        message: "OPENCODE_API_KEY is not configured for this deployment.",
      };
    }

    const model = args.model?.trim() || DEFAULT_MODEL;
    const maxTokens = Math.min(Math.max(Math.round(args.maxTokens ?? 64), 8), 4096);

    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(ZEN_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: "Reply with the single word: pong" }],
          max_tokens: maxTokens,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      return {
        ok: false,
        status: 0,
        ms: Date.now() - started,
        model,
        reply: null,
        message: `Couldn't reach OpenCode Zen — ${
          err instanceof Error ? err.message : "network error"
        }.`,
      };
    }

    const ms = Date.now() - started;
    const text = await response.text();
    if (!response.ok) {
      // The gateway puts the useful sentence in `error.message` on a JSON
      // body, and falls back to plain text on some 5xx responses.
      let detail = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text) as { error?: unknown };
        if (typeof parsed.error === "string") detail = parsed.error;
        else if (
          parsed.error &&
          typeof parsed.error === "object" &&
          typeof (parsed.error as { message?: unknown }).message === "string"
        ) {
          detail = (parsed.error as { message: string }).message;
        }
      } catch {
        // Not JSON — the raw prefix is the best available detail.
      }
      return {
        ok: false,
        status: response.status,
        ms,
        model,
        reply: null,
        message: `OpenCode Zen answered ${response.status}${detail ? ` — ${detail}` : "."}`,
      };
    }

    let reply: string | null = null;
    try {
      const parsed = JSON.parse(text) as {
        choices?: { message?: { content?: unknown } }[];
      };
      const content = parsed.choices?.[0]?.message?.content;
      if (typeof content === "string") reply = content.trim().slice(0, 200);
    } catch {
      // A 200 that is not JSON is still a live endpoint; reported as no reply.
    }

    return {
      // A 200 with no visible answer is not a working check: the turn would
      // have arrived empty.
      ok: Boolean(reply),
      status: response.status,
      ms,
      model,
      reply,
      message: reply ? null : "Answered 200 but returned no text — raise maxTokens.",
    };
  },
});

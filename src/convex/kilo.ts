// ---------------------------------------------------------------------------
// Kilo Gateway — a live check for the router's key.
//
// `providerHealth` can only say KILO_CODE_API_TOKEN is present; it cannot say
// the key works, or that the account can reach a particular model. Kilo fronts
// several hundred models, and the catalogue is not the roster: free models can
// be withdrawn, and a paid model answers 402 on an account without credits.
// One real completion per call is the only honest answer, and it is also the
// cheapest — a diagnostic that quietly bills a dozen models is one nobody runs.
//
// The key itself is never returned, only the HTTP status and any text.
// ---------------------------------------------------------------------------

import { action } from "./_generated/server";
import { v } from "convex/values";
import { ENGINES, providerById, providerKey } from "./engines";

/** The engine probed when the caller does not name one. */
const DEFAULT_MODEL = "kilo-auto/free";

export const check = action({
  args: {
    /** A Kilo model id, `lab/name` (optionally `:free`). */
    model: v.optional(v.string()),
    /**
     * Room for the answer. Reasoning models spend their first tokens thinking,
     * so a tiny budget comes back as a 200 with no visible text — which is
     * indistinguishable from a broken model unless the budget can be raised.
     */
    maxTokens: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const provider = providerById("kilo");
    if (!provider) {
      return {
        ok: false,
        status: 0,
        ms: 0,
        model: null,
        reply: null,
        registered: false,
        message: "Kilo is not in the engine registry.",
      };
    }
    const key = providerKey(provider);
    if (!key) {
      return {
        ok: false,
        status: 0,
        ms: 0,
        model: null,
        reply: null,
        registered: false,
        message: "KILO_CODE_API_TOKEN is not configured for this deployment.",
      };
    }

    const model = args.model?.trim() || DEFAULT_MODEL;
    const maxTokens = Math.min(Math.max(Math.round(args.maxTokens ?? 256), 8), 4096);
    // A model the registry knows is one the app can actually route to; probing
    // an unregistered id is allowed but not silently treated as supported.
    const registered = ENGINES.some(
      (engine) => engine.provider === "kilo" && engine.modelId === model,
    );

    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(provider.url, {
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
        signal: AbortSignal.timeout(35_000),
      });
    } catch (err) {
      return {
        ok: false,
        status: 0,
        ms: Date.now() - started,
        model,
        reply: null,
        registered,
        message: `Couldn't reach Kilo — ${err instanceof Error ? err.message : "network error"}.`,
      };
    }

    const ms = Date.now() - started;
    const text = await response.text();
    if (!response.ok) {
      // The gateway puts the useful sentence in `error.message`; anything else
      // is quoted so a 401 with an empty body still says something.
      let detail = text.slice(0, 240);
      try {
        const parsed = JSON.parse(text) as {
          error?: { message?: unknown } | string;
        };
        const message =
          typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
        if (typeof message === "string") detail = message;
      } catch {
        // Not JSON — the raw prefix is the best available detail.
      }
      return {
        ok: false,
        status: response.status,
        ms,
        model,
        reply: null,
        registered,
        message: `Kilo answered ${response.status}${detail ? ` — ${detail}` : "."}`,
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
      // have arrived empty, which is what this action exists to catch.
      ok: Boolean(reply),
      status: response.status,
      ms,
      model,
      reply,
      registered,
      message: reply
        ? null
        : "Answered 200 but returned no text — raise maxTokens; reasoning models spend the budget before they answer.",
    };
  },
});

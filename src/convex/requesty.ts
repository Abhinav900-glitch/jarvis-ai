// ---------------------------------------------------------------------------
// Requesty — a live check for the router's key.
//
// `providerHealth` can only say a key is present; it cannot say the key works.
// That distinction has already mattered twice in this deployment (Eden answering
// 402, a Gonka model spending its whole budget thinking), so the one router
// added for breadth gets a probe that spends a real completion and reports what
// came back.
//
// Deliberately one model per call rather than a fan-out over the registry: this
// is a diagnostic, and a diagnostic that quietly bills eight models is one
// nobody runs. The default is the cheapest registered Requesty engine.
// ---------------------------------------------------------------------------

import { action } from "./_generated/server";
import { v } from "convex/values";
import { ENGINES, providerById, providerKey } from "./engines";

/** The engine probed when the caller does not name one. */
const DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";

export const check = action({
  args: {
    /** A Requesty model id, `lab/name` — the id the router itself expects. */
    model: v.optional(v.string()),
    /**
     * Room for the answer. Reasoning models spend their first tokens thinking,
     * so a tiny budget comes back as a 200 with no visible text — which is
     * indistinguishable from a broken model unless the budget can be raised.
     */
    maxTokens: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const provider = providerById("requesty");
    if (!provider) {
      return {
        ok: false,
        status: 0,
        ms: 0,
        model: null,
        reply: null,
        registered: false,
        message: "Requesty is not in the engine registry.",
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
        message: "REQUESTY_API_KEY is not configured for this deployment.",
      };
    }

    const model = args.model?.trim() || DEFAULT_MODEL;
    // 256, not the usual handful: every free model on this router reasons
    // first, and a 24-token budget spent on thinking looks identical to a
    // broken model.
    const maxTokens = Math.min(Math.max(Math.round(args.maxTokens ?? 256), 8), 4096);
    // A model the registry knows is one the app can actually route to; probing
    // an unregistered id is allowed but not silently treated as supported.
    const registered = ENGINES.some(
      (engine) => engine.provider === "requesty" && engine.modelId === model,
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
        signal: AbortSignal.timeout(25_000),
      });
    } catch (err) {
      return {
        ok: false,
        status: 0,
        ms: Date.now() - started,
        model,
        reply: null,
        registered,
        message: `Couldn't reach Requesty — ${err instanceof Error ? err.message : "network error"}.`,
      };
    }

    const ms = Date.now() - started;
    const text = await response.text();
    if (!response.ok) {
      // The router puts the useful sentence in `error.message`; anything else
      // is quoted so a 401 with an empty body still says something.
      let detail = text.slice(0, 200);
      try {
        const parsed = JSON.parse(text) as { error?: { message?: unknown } };
        if (typeof parsed.error?.message === "string") detail = parsed.error.message;
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
        message: `Requesty answered ${response.status}${detail ? ` — ${detail}` : "."}`,
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

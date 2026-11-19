// ---------------------------------------------------------------------------
// Public AI — catalogue and a live check.
//
// `https://api.publicai.co/v1` is OpenAI-compatible and key-gated: `/v1/models`
// answers 401 without an Authorization header. That makes a catalogue read
// meaningful here in a way it is not for a public catalogue — it proves the key
// is accepted — while only a completion proves a model can answer.
//
// Both actions exist so the two questions stay separate: `catalog` asks what
// this key may call, `check` asks whether a named model actually replies.
// ---------------------------------------------------------------------------

"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

const BASE = "https://api.publicai.co/v1";

function apiKey(): string | null {
  for (const name of ["PUBLIC_AI_API_KEY", "PUBLICAI_API_KEY"]) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** What models this key is allowed to see. */
export const catalog = action({
  args: {},
  handler: async () => {
    const key = apiKey();
    if (!key) {
      return { ok: false, models: [], message: "PUBLIC_AI_API_KEY is not configured." };
    }

    let response: Response;
    try {
      response = await fetch(`${BASE}/models`, {
        headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      return {
        ok: false,
        models: [],
        message: `Couldn't reach Public AI — ${
          err instanceof Error ? err.message : "network error"
        }.`,
      };
    }

    const body = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        models: [],
        message: `Public AI answered ${response.status}${
          body ? ` — ${body.slice(0, 160)}` : "."
        }`,
      };
    }

    let parsed: { data?: unknown };
    try {
      parsed = JSON.parse(body) as { data?: unknown };
    } catch {
      return { ok: false, models: [], message: "The catalogue was not JSON." };
    }

    const models = (Array.isArray(parsed.data) ? parsed.data : []).flatMap(
      (raw) => {
        if (!raw || typeof raw !== "object") return [];
        const row = raw as Record<string, unknown>;
        const id = typeof row.id === "string" ? row.id.trim() : "";
        if (!id) return [];
        return [
          {
            id,
            name: typeof row.name === "string" ? row.name : id,
            context:
              typeof (row.limit as { context?: unknown } | undefined)?.context ===
              "number"
                ? ((row.limit as { context: number }).context as number)
                : null,
          },
        ];
      },
    );

    return { ok: true, models, message: null };
  },
});

/** One completion, because only that proves the model answers. */
export const check = action({
  args: {
    model: v.string(),
    maxTokens: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const key = apiKey();
    if (!key) {
      return {
        ok: false,
        status: 0,
        ms: 0,
        model: args.model,
        reply: null,
        message: "PUBLIC_AI_API_KEY is not configured.",
      };
    }

    const maxTokens = Math.min(Math.max(Math.round(args.maxTokens ?? 64), 8), 4096);
    const started = Date.now();
    let response: Response;
    try {
      response = await fetch(`${BASE}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: args.model,
          messages: [{ role: "user", content: "Reply with the single word: pong" }],
          max_tokens: maxTokens,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      return {
        ok: false,
        status: 0,
        ms: Date.now() - started,
        model: args.model,
        reply: null,
        message: `Couldn't reach Public AI — ${
          err instanceof Error ? err.message : "network error"
        }.`,
      };
    }

    const ms = Date.now() - started;
    const body = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        ms,
        model: args.model,
        reply: null,
        message: `Public AI answered ${response.status}${
          body ? ` — ${body.slice(0, 200)}` : "."
        }`,
      };
    }

    let reply: string | null = null;
    try {
      const parsed = JSON.parse(body) as {
        choices?: { message?: { content?: unknown } }[];
      };
      const content = parsed.choices?.[0]?.message?.content;
      if (typeof content === "string") reply = content.trim().slice(0, 200);
    } catch {
      // A 200 that is not JSON is still a live endpoint; reported as no reply.
    }

    return {
      ok: Boolean(reply),
      status: response.status,
      ms,
      model: args.model,
      reply,
      message: reply
        ? null
        : "Answered 200 but returned no text — raise maxTokens or try another model.",
    };
  },
});

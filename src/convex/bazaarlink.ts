// ---------------------------------------------------------------------------
// BazaarLink — catalogue and a live check.
//
// The catalogue at /v1/models is public, so it proves nothing about the key;
// only a completion does. That is why `check` exists next to `catalog`, and why
// the engines registered from this gateway were each answered with a real
// request rather than read off this list.
//
// The env name is BAAZARLINK_API_KEY — the spelling the Keys tab uses. Both it
// and BAZAARLINK_API_KEY are accepted so a corrected name cannot silently look
// unconfigured.
// ---------------------------------------------------------------------------

"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

const BASE = "https://bazaarlink.ai/v1";

function apiKey(): string | null {
  for (const name of ["BAAZARLINK_API_KEY", "BAZAARLINK_API_KEY"]) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** What this gateway advertises. Public, so it is a roster, not a key check. */
export const catalog = action({
  args: {},
  handler: async () => {
    let response: Response;
    try {
      response = await fetch(`${BASE}/models`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
    } catch (err) {
      return {
        ok: false,
        models: [],
        message: `Couldn't reach BazaarLink — ${
          err instanceof Error ? err.message : "network error"
        }.`,
      };
    }

    const body = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        models: [],
        message: `BazaarLink answered ${response.status}${
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
            owner: typeof row.owned_by === "string" ? row.owned_by : "",
            context:
              typeof row.context_length === "number" ? row.context_length : null,
          },
        ];
      },
    );

    return { ok: true, models, message: null };
  },
});

/** One completion, which is the only proof that the key can call a model. */
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
        message: "BAAZARLINK_API_KEY is not configured.",
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
        signal: AbortSignal.timeout(90_000),
      });
    } catch (err) {
      return {
        ok: false,
        status: 0,
        ms: Date.now() - started,
        model: args.model,
        reply: null,
        message: `Couldn't reach BazaarLink — ${
          err instanceof Error ? err.message : "network error"
        }.`,
      };
    }

    const ms = Date.now() - started;
    const body = await response.text();
    if (!response.ok) {
      let detail = body.slice(0, 200);
      try {
        const parsed = JSON.parse(body) as { error?: unknown };
        const message =
          typeof parsed.error === "string"
            ? parsed.error
            : parsed.error && typeof parsed.error === "object"
              ? (parsed.error as { message?: unknown }).message
              : null;
        if (typeof message === "string") detail = message;
      } catch {
        // Not JSON — the raw prefix is the best available detail.
      }
      return {
        ok: false,
        status: response.status,
        ms,
        model: args.model,
        reply: null,
        message: `BazaarLink answered ${response.status}${detail ? ` — ${detail}` : "."}`,
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

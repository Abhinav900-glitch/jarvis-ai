// ---------------------------------------------------------------------------
// Together AI — catalogue and a live check.
//
// `/v1/models` is key-gated (401 without a header), so reading it proves the key
// is accepted; it does not prove a model can answer. `catalog` and `check` keep
// those two questions apart, because on this account they have differed before:
// a model can be listed and still refuse a request due to access or a
// deprecated id.
//
// Together serves open-weight models behind an OpenAI-compatible endpoint, and
// model ids are namespaced by lab (`meta-llama/…`, `Qwen/…`), which is the id
// the API expects verbatim.
// ---------------------------------------------------------------------------

"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";

const BASE = "https://api.together.xyz/v1";

function apiKey(): string | null {
  for (const name of ["TOGETHER_AI_API_KEY", "TOGETHER_API_KEY"]) {
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
      return { ok: false, models: [], message: "TOGETHER_AI_API_KEY is not configured." };
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
        message: `Couldn't reach Together AI — ${
          err instanceof Error ? err.message : "network error"
        }.`,
      };
    }

    const body = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        models: [],
        message: `Together AI answered ${response.status}${
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
        const context =
          typeof row.context_length === "number"
            ? row.context_length
            : typeof row.context_window === "number"
              ? row.context_window
              : null;
        return [
          {
            id,
            name: typeof row.display_name === "string" ? row.display_name : id,
            context,
            type: typeof row.type === "string" ? row.type : "",
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
        message: "TOGETHER_AI_API_KEY is not configured.",
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
        message: `Couldn't reach Together AI — ${
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
        message: `Together AI answered ${response.status}${detail ? ` — ${detail}` : "."}`,
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

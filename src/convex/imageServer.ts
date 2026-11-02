// ---------------------------------------------------------------------------
// Own image server — the self-hosted leg of the image chain.
//
// The app's hosted providers are free but shared, and some prompts need a
// model the user runs themselves (stable-diffusion.cpp on a laptop with a GPU,
// ComfyUI, an A1111 fork behind a tunnel). The endpoint is per-account rather
// than per-browser so the server-side action can reach it: a browser call would
// be blocked by CORS and would leak the token into the page.
//
// Nothing here is required — with no URL saved, `generateImage` simply skips
// this leg and walks the hosted chain as before.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { internal as internalApi } from "./_generated/api";

/** Trim the shapes people actually paste: trailing slashes, a pasted `/v1`. */
export function normalizeImageServerUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `http://${trimmed}`;
  return withScheme.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

function validUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

/** What the studio needs to render the form — never the token itself. */
export const get = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!settings?.imageServerUrl) return null;
    return {
      url: settings.imageServerUrl,
      model: settings.imageServerModel ?? "",
      hasToken: Boolean(settings.imageServerToken),
    };
  },
});

/** Save (or clear, by sending an empty url) this account's own server. */
export const save = mutation({
  args: {
    url: v.string(),
    model: v.optional(v.string()),
    /** Omitted keeps the stored token; "" clears it. */
    token: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to save an image server.");

    const normalized = normalizeImageServerUrl(args.url);
    if (normalized && !validUrl(normalized)) {
      throw new Error("That does not look like a URL — try http://127.0.0.1:7860");
    }

    const existing = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const patch: {
      imageServerUrl?: string;
      imageServerModel?: string;
      imageServerToken?: string;
      updatedAt: number;
    } = {
      imageServerUrl: normalized || undefined,
      imageServerModel: args.model?.trim() ?? "",
      updatedAt: Date.now(),
    };
    // `undefined` patches clear the field in Convex, which is exactly what
    // turning the leg off should do.
    if (args.token !== undefined) {
      patch.imageServerToken = args.token.trim() || undefined;
    }
    if (!normalized) patch.imageServerModel = undefined;

    if (existing) {
      await ctx.db.patch(existing._id, patch);
      return { saved: true };
    }
    await ctx.db.insert("userSettings", { userId, ...patch });
    return { saved: true };
  },
});

/**
 * The generation path needs the token, which must never reach the client — so
 * it is read through an internal query from the action, not from `get`.
 *
 * `userId` is an argument rather than read from `ctx.auth`: an internal query
 * called by `ctx.runQuery` from an action has no identity, so the action has to
 * hand over the account it already authenticated.
 */
export const readForGeneration = internalQuery({
  args: { userId: v.id("users") },
  handler: async (
    ctx,
    { userId },
  ): Promise<{ url: string; model: string; token: string } | null> => {
    const settings = await ctx.db
      .query("userSettings")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!settings?.imageServerUrl) return null;
    return {
      url: settings.imageServerUrl,
      model: settings.imageServerModel ?? "",
      token: settings.imageServerToken ?? "",
    };
  },
});

/**
 * Reachability check for the studio's "Test" button.
 *
 * Deliberately not a render: a real generation on a CPU-only machine can take
 * minutes, while any HTTP answer — even a 404 — proves the URL points at a
 * server. 401/403 is reported separately because "reachable but the token is
 * wrong" is the failure people actually hit.
 */
const TEST_PATHS = ["/v1/models", "/sdapi/v1/options", "/"];

export const test = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; detail: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to test an image server.");
    const config: { url: string; model: string; token: string } | null =
      await ctx.runQuery(internalApi.imageServer.readForGeneration, {
        userId,
      });
    if (!config) throw new Error("Save a server URL first.");

    const headers: Record<string, string> = {};
    if (config.token) headers.authorization = `Bearer ${config.token}`;

    const tried: string[] = [];
    for (const path of TEST_PATHS) {
      try {
        const res = await fetch(`${config.url}${path}`, {
          headers,
          signal: AbortSignal.timeout(8_000),
        });
        if (res.status === 401 || res.status === 403) {
          return {
            ok: false,
            detail: `Reachable, but the token was rejected (${res.status}).`,
          };
        }
        tried.push(`${path} → ${res.status}`);
        return { ok: true, detail: `Reachable — ${path} answered ${res.status}.` };
      } catch (err) {
        tried.push(
          `${path} → ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { ok: false, detail: `No answer. ${tried.join(" · ")}` };
  },
});

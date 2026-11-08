"use node";

import { createHash, randomBytes } from "node:crypto";
import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal as internalApi } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Canva image generation — OAuth 2.0 authorization code + PKCE
//
// Canva's OpenAPI description lists `oauthClientCredentials` as an accepted
// security scheme, but its token endpoint does not implement that grant:
//
//   HTTP 400 {"error":"unauthorized_client","error_description":
//   "'grant_type' must be one of the following: authorization_code,
//    refresh_token, but was client_credentials."}
//
// So image generation genuinely requires a per-user token. This file
// implements the authorization code flow with S256 PKCE, which is also what
// Canva's own authentication docs specify.
//
// Docs: https://www.canva.dev/docs/apps/rest-apis/authentication/
// Spec:  https://www.canva.dev/sources/connect/api/latest/api.yml
// Env:   CANVA_CLIENT_ID, CANVA_CLIENT_SECRET
// ---------------------------------------------------------------------------

const CANVA_AUTHORIZE_URL = "https://www.canva.com/api/oauth/authorize";
const CANVA_TOKEN_URL = "https://api.canva.com/auth/v1/oauth/token";
const CANVA_API_BASE = "https://api.canva.com/rest";

/**
 * Only `asset:write` is requested. Canva requires scopes to be declared in the
 * app's settings before they can be requested, and listing a scope the app
 * doesn't have makes the whole authorize call fail — so this stays minimal.
 * Nothing else is needed: generation returns a download URL and we never
 * ask Canva to save an asset.
 */
const CANVA_SCOPES = "asset:write";

/** Canva rate-limits per client user: 20 job creates, 120 job reads. */
const JOB_POLL_INTERVAL_MS = 1_500;
const JOB_TIMEOUT_MS = 90_000;
const TOKEN_EXPIRY_SAFETY_MS = 60_000;

interface CanvaTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
  code?: string;
  message?: string;
}

function canvaConfig(): { clientId: string; clientSecret: string } {
  const clientId = process.env.CANVA_CLIENT_ID;
  const clientSecret = process.env.CANVA_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Canva app not configured — add CANVA_CLIENT_ID and CANVA_CLIENT_SECRET in the Keys tab.",
    );
  }
  return { clientId, clientSecret };
}

/**
 * PKCE verifier. Canva requires 43–128 characters from the unreserved set;
 * 64 random bytes base64url-encode to 86, comfortably inside that.
 */
export function createCodeVerifier(): string {
  return randomBytes(64).toString("base64url");
}

/** S256 challenge for a verifier. Canva requires `code_challenge_method=S256`. */
export function createCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Connect flow
// ---------------------------------------------------------------------------

/** Build the Canva consent-page URL the user must visit to grant access. */
export const getOAuthStartUrl = action({
  args: { redirectUri: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");

    const cfg = canvaConfig();

    // 32 hex chars (128 bits) of CSRF entropy, short enough that a provider
    // is very unlikely to truncate it on the way back.
    const state = crypto.randomUUID().replace(/-/g, "");
    const codeVerifier = createCodeVerifier();

    await ctx.runMutation(internalApi.canvaOAuth.setPendingState, {
      userId,
      state,
      codeVerifier,
      redirectUri: args.redirectUri,
    });

    const url = new URL(CANVA_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", args.redirectUri);
    url.searchParams.set("scope", CANVA_SCOPES);
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", createCodeChallenge(codeVerifier));
    url.searchParams.set("code_challenge_method", "S256");

    return { url: url.toString() };
  },
});

/** Exchange the authorization code from the callback for tokens and store them. */
export const exchangeCode = action({
  args: {
    code: v.string(),
    state: v.string(),
    redirectUri: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");

    const cfg = canvaConfig();

    const pending = await ctx.runQuery(internalApi.canvaOAuth.getPendingFlow, {
      userId,
      state: args.state,
    });
    if (!pending.found) {
      throw new Error(
        "No pending Canva connection was found for this account — the callback is running under a different user than the one that started it. Start the connection again and finish it in the same browser.",
      );
    }
    if (!pending.matched) {
      throw new Error(
        "This Canva authorization window is out of date — a newer Connect click replaced it. Close any other Canva sign-in tabs, then connect again.",
      );
    }

    const codeVerifier = pending.codeVerifier;
    if (!codeVerifier) {
      throw new Error(
        "The PKCE verifier for this Canva connection is missing — restart the connection.",
      );
    }

    const redirectUri = pending.redirectUri ?? args.redirectUri;
    if (!redirectUri) {
      throw new Error("Missing redirect URI — restart the connection flow.");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: codeVerifier,
    });

    const res = await fetch(CANVA_TOKEN_URL, { method: "POST", body });
    const data = (await res.json()) as CanvaTokenResponse;
    if (!res.ok || !data.access_token) {
      console.error("[canva] token exchange failed", res.status, data);
      const reason =
        data.error_description ?? data.message ?? `HTTP ${res.status}`;
      throw new Error(
        `Canva rejected the authorization code: ${reason}. The code is single-use — restart the connection.`,
      );
    }

    await ctx.runMutation(internalApi.canvaOAuth.saveTokens, {
      userId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
    });

    return { ok: true as const, scope: data.scope };
  },
});

/** User-initiated disconnect. */
export const disconnectCanva = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await ctx.runMutation(internalApi.canvaOAuth.disconnect, { userId });
    return { ok: true as const };
  },
});

// ---------------------------------------------------------------------------
// Workspace credentials — Canva without asking anyone to authorize it
//
// Canva has no client-credentials grant, so a plain server key cannot mint a
// token by itself. What it can do is hold one Canva account's grant: the
// workspace authorizes once, `CANVA_REFRESH_TOKEN` stores that grant, and every
// user then gets Canva image generation without being sent through an OAuth
// flow. A user who does connect their own Canva still wins — their account,
// their assets — this is only the fallback underneath them.
// ---------------------------------------------------------------------------

const WORKSPACE_REFRESH_ENV = "CANVA_REFRESH_TOKEN";
const WORKSPACE_ACCESS_ENV = "CANVA_ACCESS_TOKEN";

/** Minted tokens live here between calls; actions are stateless per invocation. */
let workspaceCache: { token: string; expiresAt: number } | null = null;

/** Whether the assistant can use Canva without any user connecting it. */
export function canvaWorkspaceConfigured(): boolean {
  // `||` not `??`: an empty string in the Keys tab must fall through to the
  // other name rather than count as a configured token.
  return Boolean(
    process.env[WORKSPACE_REFRESH_ENV]?.trim() ||
      process.env[WORKSPACE_ACCESS_ENV]?.trim(),
  );
}

/** Drop a cached workspace token so the next call re-mints it. */
export function forgetWorkspaceCanvaToken(): void {
  workspaceCache = null;
}

async function workspaceAccessToken(): Promise<string | null> {
  if (
    workspaceCache &&
    workspaceCache.expiresAt - TOKEN_EXPIRY_SAFETY_MS > Date.now()
  ) {
    return workspaceCache.token;
  }

  const refreshToken = process.env[WORKSPACE_REFRESH_ENV]?.trim();
  const staticToken = process.env[WORKSPACE_ACCESS_ENV]?.trim();

  if (refreshToken) {
    const cfg = canvaConfig();
    const res = await fetch(CANVA_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: cfg.clientId,
        client_secret: cfg.clientSecret,
      }),
    });
    const data = (await res.json()) as CanvaTokenResponse;
    if (res.ok && data.access_token) {
      workspaceCache = {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      };
      return data.access_token;
    }
    // A rejected grant is worth reporting rather than silently falling through
    // to "not connected" — someone pasted a token that no longer works.
    console.error(
      "[canva] workspace refresh failed:",
      data.error_description ?? data.error ?? res.status,
    );
  }

  if (staticToken) {
    // No expiry is published with a hand-pasted token, so it is trusted for a
    // short window and re-read afterwards. A 401 clears the cache immediately.
    workspaceCache = { token: staticToken, expiresAt: Date.now() + 5 * 60_000 };
    return staticToken;
  }

  return null;
}

/** The signed-in user's own connection, or null when there is none to use. */
async function userAccessToken(
  ctx: ActionCtx,
  userId: Id<"users">,
): Promise<string | null> {
  const row = await ctx.runQuery(internalApi.canvaOAuth.getStoredAuth, {
    userId,
  });
  if (!row?.accessToken) return null;

  // Canva's access tokens are short-lived, so refresh 60s before expiry.
  if (row.expiresAt && row.expiresAt - TOKEN_EXPIRY_SAFETY_MS > Date.now()) {
    return row.accessToken;
  }
  if (!row.refreshToken) {
    await ctx.runMutation(internalApi.canvaOAuth.clearTokens, { userId });
    return null;
  }

  const cfg = canvaConfig();
  const res = await fetch(CANVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: row.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    }),
  });
  const data = (await res.json()) as CanvaTokenResponse;

  if (res.ok && data.access_token) {
    await ctx.runMutation(internalApi.canvaOAuth.saveRefreshedToken, {
      userId,
      accessToken: data.access_token,
      expiresIn: data.expires_in,
    });
    return data.access_token;
  }

  // Canva reuses refresh tokens, so a failure here means the grant is gone.
  await ctx.runMutation(internalApi.canvaOAuth.clearTokens, { userId });
  return null;
}

/**
 * A valid access token: the signed-in user's own connection first, then the
 * workspace's. Throws only when neither exists — callers treat that as
 * "provider unavailable", never as a reason to fail the whole request.
 */
export async function getFreshAccessToken(ctx: ActionCtx): Promise<string> {
  const userId = await getAuthUserId(ctx);
  if (userId) {
    const own = await userAccessToken(ctx, userId);
    if (own) return own;
  }

  const workspace = await workspaceAccessToken();
  if (workspace) return workspace;

  throw new Error(
    canvaWorkspaceConfigured()
      ? "The workspace Canva connection could not be refreshed. Check CANVA_REFRESH_TOKEN in the Keys tab, or connect your own Canva from the menu."
      : "Canva isn't connected for this account. Connect Canva from the menu, or add CANVA_REFRESH_TOKEN so the assistant can use Canva without a connection.",
  );
}

// ---------------------------------------------------------------------------
// Argument mapping
// ---------------------------------------------------------------------------

export type CanvaAspectRatio = "square" | "landscape" | "portrait";

/**
 * Canva offers three shapes (1:1, 16:9, 9:16). The app's own ratios are
 * 1:1 / 3:2 / 2:3, so 3:2 lands on landscape and 2:3 on portrait — the nearest
 * shape Canva can produce. Anything unrecognised falls back to square rather
 * than being sent through as an invalid enum value.
 */
export function toCanvaAspectRatio(ratio?: string): CanvaAspectRatio {
  if (ratio === "3:2") return "landscape";
  if (ratio === "2:3") return "portrait";
  return "square";
}

export type CanvaModel = "lucid_origin" | "z_image_turbo";

const CANVA_MODELS: readonly string[] = ["lucid_origin", "z_image_turbo"];

/**
 * Canva documents that it "never uses a different model to serve the
 * request" — an unknown model fails the job outright. So a model name meant
 * for another provider must be dropped, not forwarded.
 */
export function toCanvaModel(model?: string): CanvaModel | undefined {
  if (!model) return undefined;
  return CANVA_MODELS.includes(model) ? (model as CanvaModel) : undefined;
}

// ---------------------------------------------------------------------------
// Image generation
// ---------------------------------------------------------------------------

/** Pull `{code, message}` out of an error body, tolerating both known shapes. */
function parseCanvaError(text: string): { code?: string; message?: string } {
  try {
    const parsed = JSON.parse(text) as {
      code?: string;
      message?: string;
      error?: { code?: string; message?: string };
    };
    return {
      code: parsed.code ?? parsed.error?.code,
      message: parsed.message ?? parsed.error?.message,
    };
  } catch {
    return {};
  }
}

/** Turn a non-2xx response into a message that says what to actually do. */
function canvaHttpError(status: number, text: string, what: string): Error {
  const { code, message } = parseCanvaError(text);
  const detail = message
    ? `${message} (${code ?? "no code"})`
    : `HTTP ${status}`;

  if (status === 403) {
    return new Error(
      `Canva ${what} refused: ${detail}. Image generation must be enabled for your Canva integration at https://www.canva.com/developers/`,
    );
  }
  if (status === 429 || code === "credit_quota_exceeded") {
    return new Error(
      `Canva ${what} hit the AI credit limit (${detail}). Raise the allowance at https://www.canva.com/help/ai-access/`,
    );
  }
  if (status === 401) {
    // A rejected token is a dead token — drop it so the next attempt mints a
    // fresh one instead of replaying the same failure for the rest of its
    // cached lifetime.
    forgetWorkspaceCanvaToken();
    return new Error(
      `Canva ${what} was unauthenticated (${detail}). Reconnect Canva.`,
    );
  }
  return new Error(`Canva ${what} failed: ${detail}`);
}

export interface CanvaGeneratedImage {
  bytes: ArrayBuffer;
  /**
   * Canva's own download URL. Only valid for 24 hours, so it is a fallback
   * for showing the image right now — never something to persist.
   */
  downloadUrl: string;
  width?: number;
  height?: number;
}

export interface CanvaGenerateOptions {
  /** App-level model name; silently dropped when Canva doesn't offer it. */
  model?: string;
  /** App-level ratio ("1:1" | "3:2" | "2:3"); mapped to Canva's three shapes. */
  aspectRatio?: string;
}

/**
 * Generate one image using the signed-in user's Canva token and return its
 * raw bytes.
 *
 * The caller is responsible for persisting them: Canva's download URL only
 * lives for 24 hours, so it must not be stored as a long-lived asset URL.
 */
export async function generateImageViaCanva(
  ctx: ActionCtx,
  prompt: string,
  opts: CanvaGenerateOptions = {},
): Promise<CanvaGeneratedImage> {
  const token = await getFreshAccessToken(ctx);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const body: Record<string, unknown> = {
    prompt,
    // Retrying a create with the same key returns the original job instead of
    // burning a second credit. Canva holds keys for 24 hours.
    idempotency_key: crypto.randomUUID(),
    aspect_ratio: toCanvaAspectRatio(opts.aspectRatio),
    // asset_upload is deliberately omitted: `type: "upload"` would save into
    // the user's Canva account, which Jarvis has no use for.
  };
  const model = toCanvaModel(opts.model);
  if (model) body.model = model;

  const created = await fetch(`${CANVA_API_BASE}/v1/image-generations`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (!created.ok) {
    throw canvaHttpError(
      created.status,
      await created.text().catch(() => ""),
      "generation",
    );
  }

  const createdBody = (await created.json()) as {
    job?: { id?: string; status?: string };
  };
  const jobId = createdBody.job?.id;
  if (!jobId) throw new Error("Canva returned no image generation job id.");

  // Poll to completion. A job still running at the deadline throws rather
  // than returning a partial result, so the ladder moves on cleanly.
  const deadline = Date.now() + JOB_TIMEOUT_MS;
  let downloadUrl: string | undefined;
  let width: number | undefined;
  let height: number | undefined;

  while (Date.now() < deadline) {
    await sleep(JOB_POLL_INTERVAL_MS);

    const polled = await fetch(
      `${CANVA_API_BASE}/v1/image-generations/${jobId}`,
      { headers },
    );
    if (!polled.ok) {
      throw canvaHttpError(
        polled.status,
        await polled.text().catch(() => ""),
        "job poll",
      );
    }

    const { job } = (await polled.json()) as {
      job?: {
        status?: "in_progress" | "success" | "failed";
        result?: { image?: { url?: string; width?: number; height?: number } };
        error?: { code?: string; message?: string };
      };
    };

    if (job?.status === "success") {
      downloadUrl = job.result?.image?.url;
      width = job.result?.image?.width;
      height = job.result?.image?.height;
      break;
    }
    if (job?.status === "failed") {
      throw new Error(
        `Canva generation job failed: ${job.error?.message ?? "no reason given"} (${
          job.error?.code ?? "no code"
        })`,
      );
    }
  }

  if (!downloadUrl) {
    throw new Error(
      `Canva generation job ${jobId} did not finish within ${
        JOB_TIMEOUT_MS / 1000
      }s.`,
    );
  }

  const image = await fetch(downloadUrl);
  if (!image.ok) {
    throw new Error(`Could not download the Canva image (${image.status}).`);
  }

  return { bytes: await image.arrayBuffer(), downloadUrl, width, height };
}

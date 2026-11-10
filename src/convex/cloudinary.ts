"use node";

import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v2 as cloudinary } from "cloudinary";
import { internal as internalApi } from "./_generated/api";
import { generateImageViaCanva } from "./canva";
import { assertSafePublicUrl } from "./urlGuard";
import {
  CF_ACCOUNT_ENVS,
  CF_KEY_ENVS,
  FAL_KEY_ENVS,
  KIE_KEY_ENVS,
  META_KEY_ENVS,
  ZIMAGE_KEY_ENVS,
  readEnv,
} from "./imageProviders";

// ---------------------------------------------------------------------------
// Cloudinary OAuth 2.0 (authorization code grant)
// Docs: https://cloudinary.com/documentation/using_oauth_to_access_cloudinary_apis
// Env: CLOUDINARY_CLIENT_ID, CLOUDINARY_CLIENT_SECRET
// Access tokens live ~5 minutes; refresh tokens (3 months, single-use) keep
// the connection alive — handled transparently by getFreshAccessToken().
// ---------------------------------------------------------------------------

const OAUTH_AUTHORIZE_URL = "https://oauth.cloudinary.com/oauth2/auth";
const OAUTH_TOKEN_URL = "https://oauth.cloudinary.com/oauth2/token";
const OAUTH_SCOPES = "upload asset_management offline_access";

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

function oauthConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.CLOUDINARY_CLIENT_ID;
  const clientSecret = process.env.CLOUDINARY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Build the consent-page URL the user must visit to grant access. */
export const getOAuthStartUrl = action({
  args: { redirectUri: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");

    const cfg = oauthConfig();
    if (!cfg) {
      throw new Error(
        "Cloudinary OAuth app not configured — add CLOUDINARY_CLIENT_ID and CLOUDINARY_CLIENT_SECRET in the Keys tab.",
      );
    }

    // 32 hex chars (128 bits) is ample CSRF entropy and keeps the value short
    // enough that an OAuth provider is very unlikely to truncate it on the way
    // back — a truncated state comes home as a mismatch with no explanation.
    const state = crypto.randomUUID().replace(/-/g, "");
    await ctx.runMutation(internalApi.cloudinaryOAuth.setPendingState, {
      userId,
      state,
      redirectUri: args.redirectUri,
    });

    const url = new URL(OAUTH_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", args.redirectUri);
    url.searchParams.set("scope", OAUTH_SCOPES);
    url.searchParams.set("state", state);

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

    const cfg = oauthConfig();
    if (!cfg) throw new Error("Cloudinary OAuth app not configured.");

    // Validate state against what we stored at flow start (CSRF protection)
    const stored = await ctx.runQuery(
      internalApi.cloudinaryOAuth.getStoredAuth,
      { userId },
    );
    if (!stored) {
      // No row for this account at all: the callback is running under a
      // different signed-in user than the one that started the flow.
      throw new Error(
        "No pending Cloudinary connection was found for this account — the callback is running under a different user than the one that started it. Start the connection again and finish it in the same browser.",
      );
    }
    if (stored.pendingState !== args.state) {
      // A row exists but its state differs: a later Connect click overwrote
      // this one, so the authorization window that just came back is stale.
      throw new Error(
        "This Cloudinary authorization window is out of date — a newer Connect click replaced it. Close any other Cloudinary sign-in tabs, then connect again.",
      );
    }

    const redirectUri = stored.redirectUri ?? args.redirectUri;
    if (!redirectUri) {
      throw new Error("Missing redirect URI — restart the connection flow.");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });

    const res = await fetch(OAUTH_TOKEN_URL, { method: "POST", body });
    const data = (await res.json()) as TokenResponse;
    if (!res.ok || !data.access_token) {
      console.error("Cloudinary token exchange failed", res.status, data);
      throw new Error(
        `Token exchange failed (${res.status})${
          data.error_description ? `: ${data.error_description}` : ""
        }`,
      );
    }

    await ctx.runMutation(internalApi.cloudinaryOAuth.saveTokens, {
      userId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
    });

    return { ok: true as const };
  },
});

/** User-initiated disconnect. */
export const disconnectCloudinary = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await ctx.runMutation(internalApi.cloudinaryOAuth.disconnect, { userId });
    return { ok: true as const };
  },
});

/**
 * Get a valid OAuth access token for the signed-in user, auto-refreshing when
 * expired. Returns null when there is no OAuth connection (callers fall back
 * to API key/secret auth).
 */
export async function getFreshAccessToken(
  ctx: ActionCtx,
): Promise<string | null> {
  try {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const row = await ctx.runQuery(internalApi.cloudinaryOAuth.getStoredAuth, {
      userId,
    });
    if (!row?.accessToken) return null;

    // Refresh 30s before expiry to be safe
    if (row.expiresAt && row.expiresAt - 30_000 > Date.now()) {
      return row.accessToken;
    }
    if (!row.refreshToken) return null;

    const cfg = oauthConfig();
    if (!cfg) return null;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: row.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });
    const res = await fetch(OAUTH_TOKEN_URL, { method: "POST", body });
    const data = (await res.json()) as TokenResponse;

    if (res.ok && data.access_token) {
      await ctx.runMutation(internalApi.cloudinaryOAuth.saveTokens, {
        userId,
        accessToken: data.access_token,
        // Refresh tokens are single-use — Cloudinary issues a new one here
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        scope: data.scope,
      });
      return data.access_token;
    }

    if (data.error === "invalid_grant") {
      // Refresh token revoked/expired → force reconnect
      await ctx.runMutation(internalApi.cloudinaryOAuth.clearTokens, {
        userId,
      });
    }
    return null;
  } catch (err) {
    console.error("[cloudinary-oauth] token refresh failed:", err);
    return null; // any failure → fall back to API key/secret
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary credentials not configured.");
  }
  return { cloudName, apiKey, apiSecret };
}

/**
 * Store generated image bytes on Cloudinary so they persist on the CDN
 * regardless of which provider generated them.
 * Uses the OAuth access token when the user has connected Cloudinary,
 * otherwise falls back to signed API key/secret auth.
 */
export async function uploadBytesToCloudinary(
  ctx: ActionCtx,
  bytes: ArrayBuffer,
  publicId: string,
): Promise<{ url: string; publicId: string }> {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const oauthToken = await getFreshAccessToken(ctx);
  const timestamp = Math.floor(Date.now() / 1000);

  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes], { type: "image/png" }),
    "generated.png",
  );
  form.append("timestamp", String(timestamp));
  form.append("public_id", publicId);

  const headers: Record<string, string> = {};
  if (oauthToken) {
    headers["Authorization"] = `Bearer ${oauthToken}`;
  } else {
    const signature = cloudinary.utils.api_sign_request(
      { timestamp, public_id: publicId },
      apiSecret,
    );
    form.append("api_key", apiKey);
    form.append("signature", signature);
  }

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: "POST", headers, body: form },
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("Cloudinary byte upload failed", res.status, errText);
    throw new Error(`Cloudinary upload failed (${res.status})`);
  }
  const data = (await res.json()) as { secure_url: string; public_id: string };
  return { url: data.secure_url, publicId: data.public_id };
}

// ---------------------------------------------------------------------------
// Image generation providers
// ---------------------------------------------------------------------------

interface GeneratedImage {
  url: string;
  publicId: string;
  provider: string;
}

/**
 * Provider 0 — the account's own image server.
 *
 * Stable-diffusion.cpp (and the A1111 forks it imitates) speaks two dialects:
 * an OpenAI-shaped `/v1/images/generations` and the older `/sdapi/v1/txt2img`.
 * Both are tried because which one answers depends on the build and the
 * wrapper, and a 404 on the first says nothing about the second. This leg is
 * only reached when the user saved a URL, so the hosted chain is untouched for
 * everyone else.
 */
const OWN_SERVER_TIMEOUT_MS = 170_000;

interface OwnServerConfig {
  url: string;
  model: string;
  token: string;
}

function sizeForAspect(aspectRatio?: string): { width: number; height: number } {
  if (aspectRatio === "3:2") return { width: 1216, height: 832 };
  if (aspectRatio === "2:3") return { width: 832, height: 1216 };
  return { width: 1024, height: 1024 };
}

/** A picture arrives as a data URL, bare base64, or a URL to fetch. */
async function pictureBytes(picture: string): Promise<ArrayBuffer> {
  if (/^https?:\/\//i.test(picture.trim())) {
    const res = await fetch(picture, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`image download failed (${res.status})`);
    return res.arrayBuffer();
  }
  const base64 = picture.replace(/^data:image\/[a-z0-9+.-]+;base64,/i, "");
  const buf = Buffer.from(base64, "base64");
  if (buf.byteLength < 1000) throw new Error("server returned an empty image");
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

async function generateViaOwnServer(
  ctx: ActionCtx,
  config: OwnServerConfig,
  prompt: string,
  aspectRatio?: string,
): Promise<GeneratedImage> {
  const { width, height } = sizeForAspect(aspectRatio);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (config.token) headers.authorization = `Bearer ${config.token}`;

  const post = async (path: string, body: unknown): Promise<unknown> => {
    const res = await fetch(`${config.url}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(OWN_SERVER_TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = (await res.text().catch(() => "")).slice(0, 180);
      throw new Error(`${path} → ${res.status}${detail ? ` ${detail}` : ""}`);
    }
    return (await res.json()) as unknown;
  };

  const errors: string[] = [];
  let picture: string | null = null;

  try {
    // Exactly the fields the server documents (prompt / n / size); `b64_json`
    // is the only response shape it offers, so `response_format` is not sent.
    // `model` is only added when the user named one, for OpenAI-compatible
    // bridges that route by model id.
    const body: Record<string, unknown> = {
      prompt,
      n: 1,
      size: `${width}x${height}`,
    };
    if (config.model) body.model = config.model;
    const data = (await post("/v1/images/generations", body)) as {
      data?: { b64_json?: string; url?: string }[];
    };
    const first = data.data?.[0];
    picture = first?.b64_json ?? first?.url ?? null;
    if (!picture) errors.push("/v1/images/generations returned no image");
  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
  }

  if (!picture) {
    try {
      const data = (await post("/sdapi/v1/txt2img", {
        prompt,
        width,
        height,
        steps: 20,
        batch_size: 1,
      })) as { images?: string[] };
      picture = data.images?.[0] ?? null;
      if (!picture) errors.push("/sdapi/v1/txt2img returned no image");
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (!picture) {
    throw new Error(`own server: ${errors.join(" | ")}`);
  }

  const bytes = await pictureBytes(picture);
  const publicId = `jarvis-gen/own-${Date.now()}`;

  // Cloudinary gives a permanent CDN URL and keeps the account's own assets in
  // one place. Without it, Convex file storage is enough to display and export
  // the picture, so a self-hosted setup never requires a second account.
  try {
    const stored = await uploadBytesToCloudinary(ctx, bytes, publicId);
    return { url: stored.url, publicId: stored.publicId, provider: "own-server" };
  } catch {
    const blob = new Blob([bytes], { type: "image/png" });
    const storageId = await ctx.storage.store(blob);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("own server: could not store the generated image");
    return { url, publicId: storageId, provider: "own-server" };
  }
}

/**
 * Provider 0b — Meta Model API (Muse Image).
 *
 * OpenAI's images shape with Bearer auth: the response is the same
 * `data[].b64_json` the own-server leg reads, so the bytes run through the
 * same store-and-serve path. Only reached when the deployment has a Meta key;
 * the built-in web grounding is part of the per-image price.
 */
async function generateViaMeta(
  ctx: ActionCtx,
  key: string,
  prompt: string,
  aspectRatio?: string,
): Promise<GeneratedImage> {
  // The API takes a "WxH" string that sets the aspect ratio rather than the
  // exact pixel size, so the known-good shapes are mapped rather than the
  // own-server's pixel dimensions.
  const size =
    aspectRatio === "3:2"
      ? "1536x1024"
      : aspectRatio === "2:3"
        ? "1024x1536"
        : "1024x1024";
  const res = await fetch("https://api.meta.ai/v1/images/generations", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: "muse-image-1.0", prompt, n: 1, size }),
    // Muse Image is agentic — it can search and refine before it renders, so
    // a first answer can take far longer than a plain diffusion call.
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 180);
    throw new Error(
      `images/generations → ${res.status}${detail ? ` ${detail}` : ""}`,
    );
  }
  const data = (await res.json()) as {
    data?: { b64_json?: string; url?: string }[];
  };
  const first = data.data?.[0];
  const picture = first?.b64_json ?? first?.url ?? null;
  if (!picture) throw new Error("images/generations returned no image");

  const bytes = await pictureBytes(picture);
  const publicId = `jarvis-gen/meta-${Date.now()}`;
  try {
    const stored = await uploadBytesToCloudinary(ctx, bytes, publicId);
    return { url: stored.url, publicId: stored.publicId, provider: "meta" };
  } catch {
    const blob = new Blob([bytes], { type: "image/webp" });
    const storageId = await ctx.storage.store(blob);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("meta: could not store the generated image");
    return { url, publicId: storageId, provider: "meta" };
  }
}

/**
 * Provider 0c — fal.ai (FLUX).
 *
 * The key every other leg wishes it had: `Authorization: Key …` rather than
 * Bearer, a sync `fal.run` endpoint that returns CDN URLs, and sizes given as
 * `{ width, height }` — so `aspectRatio` is honoured here instead of being
 * dropped the way the keyless legs drop it. FLUX.1 [schnell] is the fast
 * variant (a few inference steps, sub-second to a couple of seconds), which is
 * what a chat reply can afford to wait for.
 */
function falApiKey(): string | null {
  // The accepted names live in `imageProviders.ts`, shared with the query that
  // tells the client which providers are configured — two copies of this list
  // is how a correctly-entered key gets ignored by one of them.
  return readEnv(FAL_KEY_ENVS);
}

/**
 * Provider 0d — Cloudflare Workers AI (FLUX.1 [schnell]).
 *
 * Workers AI is account-scoped: the URL itself carries `CLOUDFLARE_ACCOUNT_ID`,
 * so a key with no account id cannot reach the model at all. The leg therefore
 * reports itself unavailable unless both are set.
 *
 * The shape here is the one measured against the live API, not the one the
 * docs suggest. Two things are worth recording because both cost a round trip
 * to learn:
 *
 *  - `@cf/black-forest-labs/flux-1-dev` is not a Workers AI model. Calling it
 *    returns `{code: 7000, "No route for that URI"}` — a 400 that reads like a
 *    bad request but is really a missing model. `flux-1-schnell` is the FLUX
 *    model on the catalogue, and it answers 200.
 *  - The input schema is strict: `prompt` and `steps` only. Sending `width`,
 *    `height` or even `seed` is rejected with "Additional properties not
 *    allowed", so `aspectRatio` cannot be honoured on this leg — it is dropped
 *    rather than faked, exactly like the other keyless providers.
 *
 * The reply is `{result: {image: "<base64>"}}` with no data-URL prefix, and
 * `pictureBytes` already accepts bare base64.
 */
async function generateViaCfWorkers(
  ctx: ActionCtx,
  key: string,
  prompt: string,
): Promise<GeneratedImage> {
  const accountId = readEnv(CF_ACCOUNT_ENVS);
  if (!accountId) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID not configured — Workers AI is account-scoped.");
  }
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      // Four steps is schnell's sweet spot: the model is distilled for it, and
      // more steps mostly buy latency on a reply the user is waiting for.
      body: JSON.stringify({ prompt, steps: 4 }),
      signal: AbortSignal.timeout(60_000),
    },
  );
  if (!res.ok) {
    // Workers AI reports its reasons in `errors[].message`; the bare status is
    // usually "400", which says nothing on its own.
    const raw = await res.text().catch(() => "");
    let detail = raw.slice(0, 180);
    try {
      const parsed = JSON.parse(raw) as { errors?: { message?: string }[] };
      const first = parsed.errors?.[0]?.message;
      if (first) detail = first.slice(0, 220);
    } catch {
      /* keep the raw slice */
    }
    const message = `workers-ai/flux-schnell → ${res.status}${detail ? ` ${detail}` : ""}`;
    if (res.status === 402 || res.status === 403) {
      throw new AccountLockedError(message);
    }
    throw new Error(message);
  }
  const data = (await res.json()) as { result?: { image?: string } };
  const image = data.result?.image;
  if (!image) throw new Error("workers-ai/flux-schnell returned no image");

  const bytes = await pictureBytes(image);
  const publicId = `jarvis-gen/cf-${Date.now()}`;
  try {
    const stored = await uploadBytesToCloudinary(ctx, bytes, publicId);
    return { url: stored.url, publicId: stored.publicId, provider: "cloudflare-workers-ai" };
  } catch {
    // schnell answers with a JPEG, so the fallback store is labelled as one.
    const blob = new Blob([bytes], { type: "image/jpeg" });
    const storageId = await ctx.storage.store(blob);
    const storedUrl = await ctx.storage.getUrl(storageId);
    if (!storedUrl) throw new Error("cloudflare-workers-ai: could not store the generated image");
    return { url: storedUrl, publicId: storageId, provider: "cloudflare-workers-ai" };
  }
}

async function generateViaFal(
  ctx: ActionCtx,
  key: string,
  prompt: string,
  aspectRatio?: string,
): Promise<GeneratedImage> {
  const { width, height } = sizeForAspect(aspectRatio);
  const res = await fetch("https://fal.run/fal-ai/flux/schnell", {
    method: "POST",
    headers: {
      // fal's own scheme, not Bearer — sending Bearer returns 401.
      authorization: `Key ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      image_size: { width, height },
      num_images: 1,
      num_inference_steps: 4,
      output_format: "jpeg",
      enable_safety_checker: true,
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 180);
    const message = `flux/schnell → ${res.status}${detail ? ` ${detail}` : ""}`;
    if (res.status === 402 || res.status === 403) {
      throw new AccountLockedError(message);
    }
    throw new Error(message);
  }
  const data = (await res.json()) as {
    images?: { url?: string; content_type?: string }[];
  };
  const picture = data.images?.[0]?.url ?? null;
  if (!picture) throw new Error("flux/schnell returned no image");

  // The URL is on fal's CDN and expires, so it is copied into the account's
  // own storage. Same two-step as the Meta leg: Cloudinary when configured,
  // Convex storage otherwise.
  const bytes = await pictureBytes(picture);
  const publicId = `jarvis-gen/fal-${Date.now()}`;
  try {
    const stored = await uploadBytesToCloudinary(ctx, bytes, publicId);
    return { url: stored.url, publicId: stored.publicId, provider: "fal" };
  } catch {
    const blob = new Blob([bytes], { type: "image/jpeg" });
    const storageId = await ctx.storage.store(blob);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error("fal: could not store the generated image");
    return { url, publicId: storageId, provider: "fal" };
  }
}

/**
 * Z Image Turbo (zimageturbo.ai) — a hosted Z-Image-Turbo endpoint.
 *
 * Asynchronous by design: POST /api/generate returns a task id and GET
 * /api/status reports SUCCESS with a list of image URLs. The poll below is
 * bounded rather than open-ended — the model renders in under a second, so a
 * task still running after roughly fifteen seconds is a stuck one, and the
 * legs after this can still answer the same turn.
 *
 * Aspect ratios are the vendor's own set (1:1, 4:3, 3:4, 16:9, 9:16). The
 * studio's 3:2 and 2:3 are mapped onto the nearest of those instead of being
 * forwarded unchanged, which the endpoint rejects with a 400.
 */
async function generateViaZImageTurbo(
  ctx: ActionCtx,
  key: string,
  prompt: string,
  aspectRatio?: string,
): Promise<GeneratedImage> {
  const ratio =
    aspectRatio === "3:2" ? "16:9" : aspectRatio === "2:3" ? "9:16" : "1:1";

  const res = await fetch("https://zimageturbo.ai/api/generate", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ prompt: prompt.slice(0, 990), aspect_ratio: ratio }),
    signal: AbortSignal.timeout(30_000),
  });
  const raw = await res.text();
  if (!res.ok) {
    const message = `z-image-turbo → ${res.status}${raw ? ` ${raw.slice(0, 140)}` : ""}`;
    // 401 is a bad key and 402 an empty balance: neither improves on retry,
    // so both trip the breaker. A 429 is a rate limit and cools down normally.
    if (res.status === 401 || res.status === 402) {
      throw new AccountLockedError(message);
    }
    throw new Error(message);
  }

  type TaskReply = {
    data?: {
      status?: string;
      task_id?: string;
      response?: string[] | string;
      error_message?: string | null;
    };
  };
  const parse = (text: string): TaskReply | null => {
    try {
      return JSON.parse(text) as TaskReply;
    } catch {
      return null;
    }
  };

  const finish = async (reply: TaskReply | null): Promise<GeneratedImage> => {
    const urls = reply?.data?.response;
    const picture = Array.isArray(urls) ? urls[0] : urls;
    if (!picture) throw new Error("z-image-turbo finished without an image");
    const bytes = await pictureBytes(picture);
    return storeGeneratedImage(
      ctx,
      bytes,
      "image/jpeg",
      "z-image-turbo",
      "zturbo",
    );
  };

  const submitted = parse(raw);
  // Some deployments answer the render inline instead of task-shaped; taking
  // the picture when it is already there saves the whole poll.
  if (submitted?.data?.response) return finish(submitted);
  const taskId = submitted?.data?.task_id;
  if (!taskId) throw new Error("z-image-turbo returned no task id");

  // The docs name `/api/status`, but that path answers 404 on the live host
  // while `/api/image/status` answers 401 to the same unauthenticated probe —
  // a route that exists. Both are tried, documented path first, and whichever
  // one answers is remembered: a stale doc should cost one round-trip, not
  // the whole leg.
  const statusPaths = ["/api/status", "/api/image/status"];
  let statusPath: string | null = null;

  for (let step = 0; step < 10; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, step === 0 ? 500 : 1500));

    const candidates: string[] = statusPath ? [statusPath] : [...statusPaths];
    let replied = false;
    for (const path of candidates) {
      const statusRes = await fetch(
        `https://zimageturbo.ai${path}?task_id=${encodeURIComponent(taskId)}`,
        {
          headers: { authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(20_000),
        },
      );
      if (statusRes.status === 404) continue;
      replied = true;
      statusPath = path;
      if (!statusRes.ok) {
        const detail = (await statusRes.text().catch(() => "")).slice(0, 160);
        const message = `z-image-turbo status → ${statusRes.status}${detail ? ` ${detail}` : ""}`;
        if (statusRes.status === 401 || statusRes.status === 402) {
          throw new AccountLockedError(message);
        }
        throw new Error(message);
      }
      const reply = parse(await statusRes.text());
      const state = (reply?.data?.status ?? "").toUpperCase();
      if (state === "SUCCESS") return finish(reply);
      if (state === "FAILED" || state === "ERROR" || state === "CANCELLED") {
        throw new Error(
          `z-image-turbo task ${state.toLowerCase()}: ${
            reply?.data?.error_message ?? "no reason given"
          }`,
        );
      }
      break;
    }
    if (!replied) {
      throw new Error("z-image-turbo has no status endpoint that answers");
    }
  }

  throw new Error("z-image-turbo did not finish in time");
}

/**
 * Kie.ai — Google's Nano Banana 2.1 through Kie's unified job API.
 *
 * One model does both jobs: `nano-banana-2-1` without `image_input` is
 * text-to-image, and with it the same call edits the supplied pictures. That
 * makes this the one hosted provider here that can honour a reference, so it
 * serves as both a text leg and a variation leg.
 *
 * The task is asynchronous — POST /api/v1/jobs/createTask returns a task id and
 * GET /api/v1/jobs/recordInfo reports `state` with the pictures inside a
 * `resultJson` string — so the poll below is bounded at roughly forty-five
 * seconds. Nano Banana usually answers in about fifteen.
 */
async function generateViaKie(
  ctx: ActionCtx,
  key: string,
  prompt: string,
  aspectRatio: string | undefined,
  sourceImage: string | null,
): Promise<GeneratedImage> {
  const RATIOS = new Set([
    "1:1",
    "2:3",
    "3:2",
    "3:4",
    "4:3",
    "16:9",
    "9:16",
    "21:9",
  ]);
  const ratio = aspectRatio && RATIOS.has(aspectRatio) ? aspectRatio : "1:1";

  const created = await fetch("https://api.kie.ai/api/v1/jobs/createTask", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "nano-banana-2-1",
      input: {
        prompt: prompt.slice(0, 19_000),
        aspect_ratio: ratio,
        // The field only exists for an edit; leaving it out is what makes the
        // same model a text-to-image call.
        ...(sourceImage ? { image_input: [sourceImage] } : {}),
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });

  const raw = await created.text();
  if (!created.ok) {
    const message = `kie → ${created.status} ${raw.slice(0, 160)}`.trim();
    // 401 is a rejected key and 402 an empty balance: neither improves by
    // retrying, so both trip the breaker.
    if (created.status === 401 || created.status === 402) {
      throw new AccountLockedError(message);
    }
    throw new Error(message);
  }

  const submitted = (() => {
    try {
      return JSON.parse(raw) as {
        code?: number;
        msg?: string;
        data?: { taskId?: string };
      };
    } catch {
      return null;
    }
  })();
  // Kie reports application errors inside a 200 response, so the HTTP status
  // alone is not enough: `code` is the real verdict.
  const submitCode = submitted?.code;
  if (typeof submitCode === "number" && submitCode !== 200 && submitCode !== 0) {
    const message = `kie → ${submitCode} ${submitted?.msg ?? ""}`.trim();
    if (submitCode === 401 || submitCode === 402) {
      throw new AccountLockedError(message);
    }
    throw new Error(message);
  }

  const taskId = submitted?.data?.taskId;
  if (!taskId) {
    throw new Error(
      `kie: no task id returned (${submitted?.msg ?? raw.slice(0, 120)})`,
    );
  }

  for (let step = 0; step < 15; step += 1) {
    await new Promise((resolve) => setTimeout(resolve, step === 0 ? 2500 : 3000));

    const statusRes = await fetch(
      `https://api.kie.ai/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
      {
        headers: { authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!statusRes.ok) throw new Error(`kie status → ${statusRes.status}`);

    const status = (await statusRes.json().catch(() => null)) as
      | {
          code?: number;
          msg?: string;
          data?: { state?: string; resultJson?: string; failMsg?: string };
        }
      | null;
    const statusCode = status?.code;
    if (typeof statusCode === "number" && statusCode !== 200 && statusCode !== 0) {
      const message = `kie status → ${statusCode} ${status?.msg ?? ""}`.trim();
      if (statusCode === 401 || statusCode === 402) {
        throw new AccountLockedError(message);
      }
      throw new Error(message);
    }
    const state = (status?.data?.state ?? "").toLowerCase();

    if (state === "success") {
      const urls = (() => {
        const json = status?.data?.resultJson;
        if (!json) return [] as string[];
        try {
          const parsed = JSON.parse(json) as Record<string, unknown>;
          const list =
            parsed.resultUrls ?? parsed.images ?? parsed.urls ?? parsed.imageUrls;
          if (Array.isArray(list)) {
            return list.filter((entry): entry is string => typeof entry === "string");
          }
          if (typeof parsed.url === "string") return [parsed.url];
          // Models differ in how they name their output; anything that looks
          // like a picture URL is a usable answer.
          return Object.values(parsed).filter(
            (value): value is string =>
              typeof value === "string" && /^https?:\/\//i.test(value),
          );
        } catch {
          return [] as string[];
        }
      })();
      if (!urls.length) throw new Error("kie finished without an image");
      const bytes = await pictureBytes(urls[0]);
      return storeGeneratedImage(
        ctx,
        bytes,
        "image/jpeg",
        "kie/nano-banana-2-1",
        "kie",
      );
    }
    if (state === "fail") {
      throw new Error(
        `kie task failed: ${status?.data?.failMsg ?? "no reason given"}`,
      );
    }
  }

  throw new Error("kie did not finish in time");
}

// ---------------------------------------------------------------------------
// Image-to-image — "vary this picture"
//
// A variation makes a different promise from a generation: the source picture
// is the reference the user chose, so only legs that accept an input image may
// answer it. A text-only leg would take the prompt, ignore the reference and
// hand back a brand-new picture as if it were the variation — which is why the
// action below swaps the whole chain instead of appending to it.
// ---------------------------------------------------------------------------

/** Matches what the input legs accept; bigger is a photo dump, not a reference. */
const SOURCE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
/** Default drifting distance: subject still recognisable, change still visible. */
const DEFAULT_VARIATION_STRENGTH = 0.6;

async function fetchSourceImageBytes(
  url: string,
): Promise<{ bytes: ArrayBuffer; mime: string }> {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`source image download failed (${res.status})`);
  const mime = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > SOURCE_IMAGE_MAX_BYTES) {
    throw new Error("source image is larger than 8 MB");
  }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) throw new Error("source image was empty");
  if (bytes.byteLength > SOURCE_IMAGE_MAX_BYTES) {
    throw new Error("source image is larger than 8 MB");
  }
  return { bytes, mime };
}

/** Store generated bytes the way every other leg does: Cloudinary, else Convex storage. */
async function storeGeneratedImage(
  ctx: ActionCtx,
  bytes: ArrayBuffer,
  mime: string,
  provider: string,
  slug: string,
): Promise<GeneratedImage> {
  const publicId = `jarvis-gen/${slug}-${Date.now()}`;
  try {
    const stored = await uploadBytesToCloudinary(ctx, bytes, publicId);
    return { url: stored.url, publicId: stored.publicId, provider };
  } catch {
    const blob = new Blob([bytes], { type: mime || "image/png" });
    const storageId = await ctx.storage.store(blob);
    const url = await ctx.storage.getUrl(storageId);
    if (!url) throw new Error(`${provider}: could not store the generated image`);
    return { url, publicId: storageId, provider };
  }
}

/**
 * fal — FLUX.1 [dev] image-to-image, the strongest leg for a variation.
 *
 * It keeps the source's composition at low strength and re-invents it at high
 * strength, which is exactly the dial the studio exposes. Same auth scheme and
 * reply shape as the text leg above.
 */
async function generateVariationViaFal(
  ctx: ActionCtx,
  key: string,
  prompt: string,
  imageUrl: string,
  strength: number,
): Promise<GeneratedImage> {
  const res = await fetch("https://fal.run/fal-ai/flux/dev/image-to-image", {
    method: "POST",
    headers: {
      authorization: `Key ${key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      prompt: prompt.slice(0, 900),
      strength,
      num_inference_steps: 30,
      num_images: 1,
      output_format: "jpeg",
      enable_safety_checker: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 180);
    const message = `flux/dev/image-to-image → ${res.status}${detail ? ` ${detail}` : ""}`;
    if (res.status === 402 || res.status === 403) {
      throw new AccountLockedError(message);
    }
    throw new Error(message);
  }
  const data = (await res.json()) as { images?: { url?: string }[] };
  const picture = data.images?.[0]?.url ?? null;
  if (!picture) throw new Error("flux/dev/image-to-image returned no image");
  const bytes = await pictureBytes(picture);
  return storeGeneratedImage(ctx, bytes, "image/jpeg", "fal-variation", "fal-vary");
}

/**
 * Cloudflare Workers AI — Stable Diffusion 1.5 img2img, the free leg.
 *
 * The schema differs from the schnell leg above in both directions: the input
 * carries the picture (`image_b64`, base64 of the source bytes) and the answer
 * is image bytes rather than JSON. Both reply shapes are handled here instead
 * of guessing, since the REST endpoint has returned each at some point.
 *
 * SD 1.5 is a 512-pixel model: asking it for 1216 produces tiling artefacts,
 * so the sizes below stay near native even when the studio asked for 3:2.
 */
async function generateVariationViaCfWorkers(
  ctx: ActionCtx,
  key: string,
  prompt: string,
  imageUrl: string,
  strength: number,
  aspectRatio?: string,
): Promise<GeneratedImage> {
  const accountId = readEnv(CF_ACCOUNT_ENVS);
  if (!accountId) {
    throw new Error(
      "CLOUDFLARE_ACCOUNT_ID not configured — Workers AI is account-scoped.",
    );
  }
  const source = await fetchSourceImageBytes(imageUrl);
  const width = aspectRatio === "3:2" ? 768 : 512;
  const height = aspectRatio === "2:3" ? 768 : 512;

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/runwayml/stable-diffusion-v1-5-img2img`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt: prompt.slice(0, 900),
        image_b64: Buffer.from(new Uint8Array(source.bytes)).toString("base64"),
        strength: Math.min(1, Math.max(0.05, strength)),
        num_steps: 20,
        guidance: 7.5,
        width,
        height,
      }),
      signal: AbortSignal.timeout(120_000),
    },
  );

  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (res.ok && contentType.startsWith("image/")) {
    const bytes = await res.arrayBuffer();
    if (bytes.byteLength > 1000) {
      return storeGeneratedImage(
        ctx,
        bytes,
        contentType || "image/png",
        "cloudflare-variation",
        "cf-vary",
      );
    }
  }

  if (!res.ok) {
    const raw = await res.text().catch(() => "");
    let detail = raw.slice(0, 180);
    try {
      const parsed = JSON.parse(raw) as { errors?: { message?: string }[] };
      const first = parsed.errors?.[0]?.message;
      if (first) detail = first.slice(0, 220);
    } catch {
      /* keep the raw slice */
    }
    const message = `workers-ai/sd15-img2img → ${res.status}${detail ? ` ${detail}` : ""}`;
    if (res.status === 402 || res.status === 403) {
      throw new AccountLockedError(message);
    }
    throw new Error(message);
  }

  // A 200 that is not an image is the JSON shape: `{result: {image: base64}}`.
  const data = (await res.json().catch(() => null)) as
    | { result?: { image?: string } | string }
    | null;
  const encoded =
    typeof data?.result === "string" ? data.result : data?.result?.image;
  if (!encoded) throw new Error("workers-ai/sd15-img2img returned no image");
  const bytes = await pictureBytes(encoded);
  return storeGeneratedImage(ctx, bytes, "image/png", "cloudflare-variation", "cf-vary");
}

/**
 * Pollinations — FLUX.1 Kontext, the keyless last resort.
 *
 * `image` is Pollinations' image-to-image parameter and kontext is the model
 * that honours it; plain `flux` would ignore the reference and invent instead.
 * One attempt only: the free tier answers 402 with a 45-second window, and by
 * this point two better legs have already had their turn.
 */
async function generateVariationViaPollinations(
  ctx: ActionCtx,
  prompt: string,
  imageUrl: string,
): Promise<GeneratedImage> {
  const encoded = encodeURIComponent(prompt.slice(0, 700));
  const reference = encodeURIComponent(imageUrl);
  const seed = Math.floor(Math.random() * 2_147_483_647);
  const url = `https://image.pollinations.ai/prompt/${encoded}?model=kontext&image=${reference}&nologo=true&seed=${seed}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Jarvis:1.0:freebuff" },
    signal: AbortSignal.timeout(60_000),
  });
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim();
  if (!res.ok || !contentType.startsWith("image/")) {
    const detail = (await res.text().catch(() => "")).slice(0, 160);
    const message = `pollinations/kontext → ${res.status}${detail ? ` ${detail}` : ""}`;
    if (res.status === 402 || res.status === 403) {
      throw new AccountLockedError(message);
    }
    throw new Error(message);
  }
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 1000) {
    throw new Error("pollinations/kontext returned an empty image");
  }
  return storeGeneratedImage(
    ctx,
    bytes,
    contentType,
    "pollinations-variation",
    "poll-vary",
  );
}

/**
 * Provider 1 — Cloudinary Image Generation add-on.
 * Returns a URL directly; the asset already lives on Cloudinary.
 * Uses OAuth Bearer auth when connected, else API key/secret Basic auth.
 */
async function generateViaCloudinary(
  ctx: ActionCtx,
  prompt: string,
  model?: string,
  aspectRatio?: string,
): Promise<GeneratedImage> {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const oauthToken = await getFreshAccessToken(ctx);

  const body: Record<string, unknown> = { prompt };
  if (model && model !== "default") body.model = model;
  if (aspectRatio) body.aspect_ratio = aspectRatio;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (oauthToken) {
    headers["Authorization"] = `Bearer ${oauthToken}`;
  } else {
    headers["Authorization"] = `Basic ${Buffer.from(
      `${apiKey}:${apiSecret}`,
    ).toString("base64")}`;
  }

  const res = await fetch(
    `https://api.cloudinary.com/v2/generate/${cloudName}/text_to_image`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("Cloudinary image generation error", res.status, errText);
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "Cloudinary Image Generation add-on is not enabled on this account.",
      );
    }
    // Cloudinary reports exhausted Image Generation credits as 429
    // (category `rate_limit_error`, code `MG_00602`), not 402 — 402 is the
    // billing-gate code. Without this branch the chain reports a bare
    // "Cloudinary generation failed (429)" and hides the only step that
    // actually unblocks it.
    if (res.status === 429 || errText.includes("MG_00602")) {
      throw new Error(
        "Cloudinary Image Generation credits are exhausted for this billing period. Top up or review the plan at https://console.cloudinary.com/app/image/generation/plans",
      );
    }
    throw new Error(`Cloudinary generation failed (${res.status})`);
  }

  const data = (await res.json()) as {
    public_id?: string;
    secure_url?: string;
    url?: string;
    output?: { public_id?: string; secure_url?: string; url?: string };
    resources?: { public_id?: string; secure_url?: string }[];
  };

  const publicId =
    data.public_id ?? data.output?.public_id ?? data.resources?.[0]?.public_id;
  const directUrl =
    data.secure_url ?? data.url ?? data.output?.secure_url ?? data.output?.url;
  if (!publicId && !directUrl) {
    throw new Error("Cloudinary generation returned no image.");
  }

  return {
    url:
      directUrl ??
      `https://res.cloudinary.com/${cloudName}/image/upload/${publicId}`,
    publicId: publicId ?? "",
    provider: "cloudinary",
  };
}

/**
 * Provider 1b — Canva image generation.
 *
 * Unlike the providers below it cannot hand back a URL of its own: Canva's
 * download URL only lives for 24 hours, so the bytes are re-uploaded to
 * Cloudinary and that becomes the persistent URL.
 *
 * Canva has no client-credentials grant — its token endpoint rejects that
 * grant type outright — so this runs on the signed-in user's own OAuth token
 * and throws a "not connected" error when they have not connected Canva. The
 * ladder records that and moves on, so an unconnected user simply loses this
 * stage rather than the whole generation.
 */
async function generateViaCanva(
  ctx: ActionCtx,
  prompt: string,
  model?: string,
  aspectRatio?: string,
): Promise<GeneratedImage> {
  const { bytes, downloadUrl } = await generateImageViaCanva(ctx, prompt, {
    model,
    aspectRatio,
  });
  // Same `jarvis-gen/<prefix>-<timestamp>` shape the other byte-returning
  // providers use, so generated images stay in one folder.
  const publicId = `jarvis-gen/canva-${Date.now()}`;
  try {
    const stored = await uploadBytesToCloudinary(ctx, bytes, publicId);
    return { url: stored.url, publicId: stored.publicId, provider: "canva" };
  } catch {
    // Cloudinary upload failed. Canva's URL still serves the image for the
    // next 24 hours, which beats discarding a generation that already
    // succeeded and was paid for. It is not persisted — the 24h window is the
    // whole reason the upload above is tried first.
    return { url: downloadUrl, publicId, provider: "canva" };
  }
}

/**
 * Provider 2 — Hugging Face Inference API.
 * Primary model: stabilityai/sdxl-turbo (1-step distilled SDXL — the serverless
 * equivalent of diffusers' DiffusionPipeline("stabilityai/sdxl-turbo")).
 * Fallback model: black-forest-labs/FLUX.1-schnell (4-step).
 * Returns raw image bytes, stored on Cloudinary for a persistent URL.
 */
async function hfImageRequest(
  token: string,
  model: string,
  prompt: string,
  steps: number,
  guidance: number,
): Promise<ArrayBuffer> {
  // api-inference.huggingface.co is retired — Inference API lives on the
  // router host now. NOTE (verified live): HF has deprecated/not-served every
  // text-to-image model for this token, so this step fails in ~1s today and
  // Pollinations takes over. It stays in the chain (fast-fail, 12s cap) so it
  // auto-heals if an inference provider is ever enabled on the HF account.
  const res = await fetch(
    `https://router.huggingface.co/hf-inference/models/${model}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "image/png",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          num_inference_steps: steps,
          guidance_scale: guidance,
        },
      }),
      signal: AbortSignal.timeout(12_000),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(
      `HF image error [${model}]`,
      res.status,
      errText.slice(0, 300),
    );
    throw new Error(`${model} failed (${res.status})`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`${model} returned a non-image response.`);
  }

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 1000) {
    throw new Error(`${model} returned an empty image.`);
  }
  return bytes;
}

async function generateViaHuggingFace(
  ctx: ActionCtx,
  prompt: string,
): Promise<GeneratedImage> {
  const token = process.env.HUGGING_FACE_TOKEN;
  if (!token) {
    throw new Error("HUGGING_FACE_TOKEN is not configured.");
  }

  // Single attempt: SDXL-Turbo 1-step. HF currently has no served
  // text-to-image models on this token, so extra attempts only burn the
  // chain's time budget — this stays as a fast-fail, auto-healing step.
  const attempts: { model: string; steps: number; guidance: number }[] = [
    { model: "stabilityai/sdxl-turbo", steps: 1, guidance: 0.0 },
  ];

  const failures: string[] = [];
  for (const a of attempts) {
    try {
      const bytes = await hfImageRequest(
        token,
        a.model,
        prompt,
        a.steps,
        a.guidance,
      );
      const publicId = `jarvis-gen/hf-${Date.now()}`;
      try {
        const stored = await uploadBytesToCloudinary(ctx, bytes, publicId);
        return {
          url: stored.url,
          publicId: stored.publicId,
          provider: `hf/${a.model.split("/")[1]}`,
        };
      } catch {
        // Cloudinary upload failed — data URL so the client still shows the image
        const base64 = Buffer.from(bytes).toString("base64");
        const dataUrl = `data:image/png;base64,${base64}`;
        return {
          url: dataUrl,
          publicId,
          provider: `hf/${a.model.split("/")[1]}`,
        };
      }
    } catch (err) {
      failures.push(err instanceof Error ? err.message : "failed");
    }
  }

  throw new Error(`Hugging Face failed: ${failures.join(" | ")}`);
}

/**
 * Provider 3 — Replicate (uses REPLICATE_API_TOKEN).
 * Calls the official black-forest-labs/flux-schnell model synchronously via
 * the `Prefer: wait` header (no version hash needed with the models
 * endpoint), downloads the generated image and stores it on Cloudinary.
 */
async function generateViaReplicate(
  ctx: ActionCtx,
  prompt: string,
): Promise<GeneratedImage> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error("REPLICATE_API_TOKEN is not configured.");
  }

  const res = await fetch(
    "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Blocks until the prediction finishes (bounded by the model's own
        // timeout) so no polling loop is needed.
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          prompt: prompt.slice(0, 950),
          aspect_ratio: "1:1",
          output_format: "png",
        },
      }),
      signal: AbortSignal.timeout(55_000),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("Replicate error", res.status, errText.slice(0, 300));
    throw new Error(`Replicate failed (${res.status})`);
  }

  const data = (await res.json()) as {
    status?: string;
    output?: string[] | string;
    error?: string;
  };
  const outputUrl = Array.isArray(data.output) ? data.output[0] : data.output;
  if (!outputUrl) {
    throw new Error(
      `Replicate returned no image (status: ${data.status ?? "unknown"}${data.error ? `, ${data.error}` : ""})`,
    );
  }

  const imgRes = await fetch(outputUrl, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!imgRes.ok) {
    throw new Error(`Replicate image download failed (${imgRes.status}).`);
  }
  const bytes = await imgRes.arrayBuffer();
  if (bytes.byteLength < 1000) {
    throw new Error("Replicate returned an empty image.");
  }

  try {
    const stored = await uploadBytesToCloudinary(
      ctx,
      bytes,
      `jarvis-gen/rep-${Date.now()}`,
    );
    return {
      url: stored.url,
      publicId: stored.publicId,
      provider: "replicate",
    };
  } catch {
    // Cloudinary upload failed — serve straight from Replicate's CDN
    return {
      url: outputUrl,
      publicId: `jarvis-gen/rep-${Date.now()}`,
      provider: "replicate",
    };
  }
}

/**
 * Provider 4 — Perchance AI image generation (free, no key).
 * Unofficial endpoint: request a generation with an arbitrary userKey, then
 * download the temporary image and store it on Cloudinary. Perchance can be
 * slow or block server IPs, so it fails fast into Pollinations.
 */
/**
 * Fetch through corsproxy.io (edge network with rotating clean IPs that
 * passes Perchance's Cloudflare challenge). Needs CORSPROXY_API_KEY.
 */
async function proxiedFetch(url: string, timeoutMs: number): Promise<Response> {
  const proxyKey = process.env.CORSPROXY_API_KEY;
  if (!proxyKey) {
    throw new Error(
      "CORSPROXY_API_KEY is not configured — add it in the Keys tab to enable Perchance through the proxy.",
    );
  }
  return fetch(
    `https://corsproxy.io/?key=${encodeURIComponent(proxyKey)}&url=${encodeURIComponent(url)}`,
    {
      headers: { Accept: "application/json, image/*" },
      signal: AbortSignal.timeout(timeoutMs),
    },
  );
}

/**
 * Provider 1 — Perchance AI image generation (free, no API cost).
 * Two prerequisites (added in the Keys tab):
 *   - CORSPROXY_API_KEY: routes through corsproxy.io so Cloudflare doesn't
 *     challenge the request (server IPs alone get "Just a moment...").
 *   - PERCHANCE_USER_KEY: a VERIFIED 64-hex userKey. Perchance only accepts
 *     keys activated by its in-page verification in a real browser on
 *     perchance.org — grab one from the network tab while generating an
 *     image there (userKey=... in the api/generate request). Keys stay
 *     valid for a while; if it expires, grab a fresh one.
 */
async function generateViaPerchance(
  ctx: ActionCtx,
  prompt: string,
): Promise<GeneratedImage> {
  const userKey = process.env.PERCHANCE_USER_KEY;
  if (!userKey || !/^[a-f0-9]{64}$/.test(userKey)) {
    throw new Error(
      "PERCHANCE_USER_KEY is not configured or not a 64-char hex key — copy it from perchance.org while generating an image there (api/generate?userKey=...).",
    );
  }

  const params =
    `prompt=${encodeURIComponent(`'${prompt.slice(0, 500)}`)}` +
    `&negativePrompt=${encodeURIComponent("'ugly, blurry, low quality, deformed")}` +
    `&userKey=${userKey}` +
    `&__cache_bust=${Math.random()}` +
    `&seed=-1` +
    `&resolution=512x512&guidanceScale=7` +
    `&channel=ai-text-to-image-generator&subChannel=public` +
    `&requestId=${Math.random()}`;
  const genUrl = `https://image-generation.perchance.org/api/generate?${params}`;

  // 25s cap — generation can take a while on Perchance's queue, but fail
  // fast enough that the fallback chain still has budget.
  const genRes = await proxiedFetch(genUrl, 25_000);
  if (!genRes.ok) {
    throw new Error(`Perchance generation failed (${genRes.status})`);
  }
  const rawBody = await genRes.text();
  if (rawBody.trimStart().startsWith("<")) {
    throw new Error(
      "Perchance returned a Cloudflare challenge — check the corsproxy key/quota.",
    );
  }
  let gen: { imageId?: string; status?: string };
  try {
    gen = JSON.parse(rawBody) as { imageId?: string; status?: string };
  } catch {
    throw new Error("Perchance returned a non-JSON response.");
  }
  if (gen.status === "invalid_key" || (!gen.imageId && gen.status)) {
    throw new Error(
      `Perchance rejected the key (${gen.status ?? "unknown"}) — the PERCHANCE_USER_KEY expired; grab a fresh one from perchance.org.`,
    );
  }
  if (!gen.imageId) {
    throw new Error("Perchance returned no image id (may be rate-limited).");
  }

  const imgRes = await proxiedFetch(
    `https://image-generation.perchance.org/api/downloadTemporaryImage?imageId=${encodeURIComponent(gen.imageId)}`,
    20_000,
  );
  const ct = imgRes.headers.get("content-type") ?? "";
  if (!imgRes.ok || !ct.startsWith("image/")) {
    throw new Error(`Perchance download failed (${imgRes.status}).`);
  }
  const bytes = await imgRes.arrayBuffer();
  if (bytes.byteLength < 1000) {
    throw new Error("Perchance returned an empty image.");
  }

  try {
    const stored = await uploadBytesToCloudinary(
      ctx,
      bytes,
      `jarvis-gen/per-${Date.now()}`,
    );
    return {
      url: stored.url,
      publicId: stored.publicId,
      provider: "perchance",
    };
  } catch {
    // Cloudinary upload failed — data URL so the client still shows the image
    const base64 = Buffer.from(bytes).toString("base64");
    return {
      url: `data:image/png;base64,${base64}`,
      publicId: `jarvis-gen/per-${Date.now()}`,
      provider: "perchance",
    };
  }
}

/**
 * Provider 5 — Pollinations AI (free, no key required). Final fallback.
 * Strategy: actually DOWNLOAD the image (GET, with retries) so we can store
 * it on Cloudinary for a permanent URL. This is more reliable than returning
 * the pollinations URL directly: their queue can serve 429/504 on the first
 * few requests, and HEAD checks often pass before generation has finished.
 */
/**
 * How long Pollinations' free tier says to wait before the next image, in
 * seconds, or `null` when this is not a free-limit response.
 *
 * Both spellings are read because the limit travels either way: the 402 body
 * carries an explicit "Retry after 38s", and a `Retry-After` header may carry
 * the same figure on its own. Returning `null` for anything unrecognised is
 * deliberate — the caller must fall back to its short backoff rather than
 * sleep on a number this function invented.
 */
export function parsePollinationsFreeLimit(
  body: string,
  retryAfterHeader: string | null,
): number | null {
  if (/"code"\s*:\s*"FREE_LIMIT"/.test(body)) {
    // "Retry after 38s, or get unlimited images…"
    const fromMessage = body.match(/retry after (\d+)s/i);
    if (fromMessage) return Number(fromMessage[1]);
  }
  if (retryAfterHeader) {
    const seconds = Number(retryAfterHeader);
    if (Number.isFinite(seconds) && seconds > 0) return seconds;
  }
  return null;
}

async function generateViaPollinations(
  ctx: ActionCtx,
  prompt: string,
): Promise<GeneratedImage> {
  const encoded = encodeURIComponent(prompt.slice(0, 800));
  // The seed keeps a retry from returning the very same picture, but
  // Pollinations validates it as a signed 32-bit int: `Date.now()` (~1.79e12)
  // exceeds 2^31-1 and is rejected with HTTP 400 `seed: Too big` (verified
  // live), which meant this keyless provider failed on every single attempt
  // regardless of the rate limit below. Staying inside the range is what lets
  // it work at all; randomising within it still varies each generation.
  const seed = Math.floor(Math.random() * 2_147_483_647);
  const pollinationsUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&model=flux&seed=${seed}`;

  // GET with retries — generation can be slow or briefly rate-limited.
  // Keep total time bounded: Convex actions have a hard time limit, so the
  // whole fallback chain must finish well under it.
  //
  // The limit that matters is Pollinations' free tier: 1 image every 45s per
  // IP (verified live, HTTP 402 `FREE_LIMIT`). A fixed 2s sleep between
  // attempts cannot outlast that window, so the chain used to give up on the
  // one provider that needs no key. The wait therefore comes from the server
  // when it says how long, not from a guess.
  const MAX_WAIT_MS = 50_000;
  let bytes: ArrayBuffer | null = null;
  let lastStatus: number | string = "network error";
  for (let attempt = 0; attempt < 3; attempt++) {
    let retryAfterMs = 0;
    try {
      const res = await fetch(pollinationsUrl, {
        headers: { "User-Agent": "Jarvis:1.0:freebuff" },
        signal: AbortSignal.timeout(45_000),
      });
      const ct = res.headers.get("content-type") ?? "";
      if (res.ok && ct.startsWith("image/")) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 1000) {
          bytes = buf;
          break;
        }
        lastStatus = "empty image";
      } else {
        lastStatus = res.status;
        // Only the free-tier limit is worth waiting out. Any other failure
        // (a 400 from the API, a 5xx) will not clear by sleeping, so those
        // fall through to the short fixed backoff below.
        if (res.status === 402) {
          const text = await res.text().catch(() => "");
          const parsed = parsePollinationsFreeLimit(text, res.headers.get("retry-after"));
          if (parsed !== null) {
            lastStatus = `402 free limit (${parsed}s)`;
            retryAfterMs = parsed * 1000;
          }
        }
      }
    } catch (err) {
      lastStatus = err instanceof Error ? err.message : "network error";
    }
    if (attempt < 2) {
      // Capped so a hostile or misreading response cannot pin the whole chain
      // on this stage — the rest of the fallback must still get its turn.
      const wait = retryAfterMs > 0 ? Math.min(retryAfterMs, MAX_WAIT_MS) : 2_000;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  if (!bytes) {
    throw new Error(`Pollinations generation failed (${lastStatus})`);
  }

  // Store on Cloudinary for a permanent CDN URL; fall back to the direct URL
  try {
    const stored = await uploadBytesToCloudinary(
      ctx,
      bytes,
      `jarvis-gen/poll-${Date.now()}`,
    );
    return {
      url: stored.url,
      publicId: stored.publicId,
      provider: "pollinations",
    };
  } catch {
    return {
      url: pollinationsUrl,
      publicId: `jarvis-gen/poll-${Date.now()}`,
      provider: "pollinations",
    };
  }
}

/**
 * AI Horde returns `generations[].img` as either the raw base64 of the image
 * bytes or as a plain URL, depending on how the request was made. Supporting
 * only base64 is what turns a perfectly good generation into a corrupt upload,
 * so both shapes decode here.
 */
async function hordeImageBytes(img: string): Promise<ArrayBuffer> {
  if (/^https?:\/\//i.test(img.trim())) {
    const res = await fetch(img, { signal: AbortSignal.timeout(30_000) });
    if (!res.ok) {
      throw new Error(`AI Horde image download failed (${res.status}).`);
    }
    return res.arrayBuffer();
  }
  const base64 = img.replace(/^data:image\/[a-z0-9+.-]+;base64,/i, "");
  const buf = Buffer.from(base64, "base64");
  // Sliced rather than returned whole: Buffer.from over a pool hands back a
  // view into a shared slab, and uploading the slab would send other
  // allocations' bytes along with the image.
  return buf.buffer.slice(
    buf.byteOffset,
    buf.byteOffset + buf.byteLength,
  ) as ArrayBuffer;
}

/**
 * Every configured AI Horde key, in the order the caller should spend them.
 *
 * Env: AIHORDE_API_KEY, AIHORDE_API_KEY_2, AIHORDE_API_KEY_3 … Each entry may
 * hold one key or several separated by commas or whitespace, so a spare key
 * can be pasted into the existing variable without renaming anything.
 *
 * Duplicates are dropped: pasting the same key twice would otherwise buy a
 * second attempt that fails in exactly the same way, only slower.
 */
export function hordeApiKeys(): string[] {
  const names = ["AIHORDE_API_KEY", "AIHORDE_API_KEY_2", "AIHORDE_API_KEY_3"];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const name of names) {
    for (const part of (process.env[name] ?? "").split(/[\s,]+/)) {
      const key = part.trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

/**
 * The two headers every AI Horde request needs. `Content-Type` is left to the
 * caller: sending one on a GET with no body is harmless but misleading.
 */
function hordeHeaders(apiKey: string): Record<string, string> {
  return {
    apikey: apiKey,
    // AI Horde asks clients to identify themselves; the documented default of
    // "unknown:0:unknown" is indistinguishable from a misbehaving bot.
    "Client-Agent": "Jarvis:1.0:freebuff",
  };
}

/**
 * A failure attributable to one key rather than to the network — an
 * unrecognised key, or an account that cannot pay for the request.
 *
 * These are the only failures worth retrying on the next key. A faulted
 * generation or an over-long queue belongs to the network as a whole, so
 * spending the second key on it would fail the same way, just 60s later.
 */
class HordeKeyError extends Error {}

/**
 * Queue priority on AI Horde is bought with kudos, so with several keys
 * configured the one holding the most should be spent first and the poorer
 * ones kept for when it runs dry.
 *
 * A key whose balance cannot be read sorts last rather than being dropped.
 * This lookup is an optimisation, and refusing to try a working key because
 * its balance read timed out would be worse than trying it in the dark —
 * `fetch` failing here must never take the provider down with it.
 *
 * `GET /api/v2/find_user` reads the balance from the `apikey` header and
 * answers 404 `UserNotFound` for a key the network does not recognise
 * (verified live against both cases).
 */
export async function hordeKeysByPriority(
  apiKeys: string[],
): Promise<string[]> {
  if (apiKeys.length < 2) return apiKeys;
  const kudos = await Promise.all(
    apiKeys.map(async (apiKey) => {
      try {
        const res = await fetch("https://aihorde.net/api/v2/find_user", {
          headers: hordeHeaders(apiKey),
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) return Number.NEGATIVE_INFINITY;
        const body = (await res.json()) as { kudos?: number };
        return typeof body.kudos === "number"
          ? body.kudos
          : Number.NEGATIVE_INFINITY;
      } catch {
        return Number.NEGATIVE_INFINITY;
      }
    }),
  );
  // Declared order breaks ties, so equal balances stay in the order they were
  // configured rather than shuffling between generations.
  return apiKeys
    .map((apiKey, index) => ({ apiKey, score: kudos[index] }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.apiKey);
}

/**
 * Submit and collect one generation from AI Horde using a single key.
 *
 * @throws {HordeKeyError} when the key itself is the problem, so the caller
 * can move on to the next one.
 */
async function generateViaAIHordeWithKey(
  ctx: ActionCtx,
  prompt: string,
  apiKey: string,
): Promise<GeneratedImage> {
  // 1024px costs kudos the account may not hold — the network answers 403
  // `KudosUpfront` for anything over 576px when it doesn't (verified live).
  // 512px is accepted with none at all, so the request downgrades instead of
  // dying on a key that is simply short of kudos.
  const sizes = [
    { width: 1024, height: 1024, steps: 30 },
    { width: 512, height: 512, steps: 25 },
  ];
  let id: string | undefined;
  let lastSubmit = "";
  for (const size of sizes) {
    const submit = await fetch("https://aihorde.net/api/v2/generate/async", {
      method: "POST",
      headers: {
        ...hordeHeaders(apiKey),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: prompt.slice(0, 800),
        params: {
          ...size,
          sampler_name: "k_euler",
          cfg_scale: 7,
          clip_skip: 1,
          n: 1,
        },
        // `allow_downgrade` is Horde's own answer to KudosUpfront: it walks
        // the request down in steps and resolution until the account can afford
        // it. The manual 1024→512 retry below stays as a second layer for a
        // server that still refuses the submit outright.
        allow_downgrade: true,
        // Asks for a Cloudflare R2 download link instead of base64, so the
        // result arrives as a plain URL and `hordeImageBytes` no longer has to
        // guess which shape it got.
        r2: true,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!submit.ok) {
      const body = await submit.text().catch(() => "");
      // 401/402/403 are verdicts on the key — unknown, or unable to pay even
      // after `allow_downgrade` walked the request down. Trying the second
      // size would repeat that verdict for nothing.
      if (submit.status === 401 || submit.status === 402 || submit.status === 403) {
        throw new HordeKeyError(
          `AI Horde refused the key (${submit.status}): ${body.slice(0, 200)}`,
        );
      }
      lastSubmit = body;
      continue;
    }
    const parsed = (await submit.json()) as { id?: string };
    if (parsed.id) {
      id = parsed.id;
      break;
    }
    lastSubmit = "no generation id returned";
  }
  if (!id) {
    throw new Error(
      `AI Horde rejected the request at 1024px and 512px: ${lastSubmit.slice(0, 200)}`,
    );
  }

  // Poll /status for the bytes. It is limited to 10 requests/minute, so this
  // waits 3s between reads and is bounded outright.
  const deadline = Date.now() + 60_000;
  for (;;) {
    const res = await fetch(
      `https://aihorde.net/api/v2/generate/status/${encodeURIComponent(id)}`,
      { headers: hordeHeaders(apiKey), signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) {
      // A generation whose key has gone bad cannot be collected either way,
      // so this is worth handing to the next key rather than dropping.
      if (res.status === 401 || res.status === 402 || res.status === 403) {
        throw new HordeKeyError(`AI Horde status rejected the key (${res.status}).`);
      }
      throw new Error(`AI Horde status failed (${res.status}).`);
    }
    const status = (await res.json()) as {
      done?: boolean;
      faulted?: boolean;
      wait_time?: number;
      generations?: { img?: string }[];
    };
    if (status.faulted) throw new Error("AI Horde generation faulted.");
    const img = status.generations?.[0]?.img;
    if (status.done) {
      if (!img) throw new Error("AI Horde reported done with no image.");
      const bytes = await hordeImageBytes(img);
      const stored = await uploadBytesToCloudinary(
        ctx,
        bytes,
        `jarvis-gen/horde-${Date.now()}`,
      );
      return { ...stored, provider: "aihorde" };
    }
    // The queue decides this, not elapsed time. When the network's own
    // estimate already exceeds everything the chain can spare, stop polling
    // now rather than burning the budget one read at a time — verified: the
    // anonymous key sits ~600 deep with a wait of over half an hour.
    const remaining = deadline - Date.now();
    if (
      typeof status.wait_time === "number" &&
      status.wait_time * 1000 > remaining
    ) {
      throw new Error(
        `AI Horde queue is ${status.wait_time}s — longer than this chain can wait; falling through.`,
      );
    }
    if (remaining <= 0) {
      throw new Error(
        "AI Horde was still queued after 60s — falling through to the next provider.",
      );
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
}

/**
 * Provider — AI Horde (aihorde.net): a volunteer-run, always-free
 * text-to-image network, queue-backed rather than instant.
 *
 * Env: AIHORDE_API_KEY (+ AIHORDE_API_KEY_2, AIHORDE_API_KEY_3) — an API key
 * or a Shared Key from aihorde.net/register. At least one is required on
 * purpose: the all-zeros anonymous key is valid but sits at the very back of
 * the queue and is throttled under load, which is exactly the multi-minute
 * stall this chain exists to avoid.
 *
 * Several keys may be configured; they are spent richest-first, and a key the
 * network rejects simply hands over to the next instead of failing the stage.
 */
async function generateViaAIHorde(
  ctx: ActionCtx,
  prompt: string,
): Promise<GeneratedImage> {
  const apiKeys = hordeApiKeys();
  if (!apiKeys.length) {
    throw new Error(
      "AIHORDE_API_KEY is not configured — add your AI Horde key in the Keys tab (register at aihorde.net/register).",
    );
  }
  const ordered = await hordeKeysByPriority(apiKeys);
  const failures: string[] = [];
  for (let index = 0; index < ordered.length; index += 1) {
    try {
      return await generateViaAIHordeWithKey(ctx, prompt, ordered[index]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // The last key has nobody to hand over to, so its failure stands as the
      // stage's — and a non-key failure (faulted, queued too long) stands
      // immediately, because a second key would meet the same network.
      if (!(err instanceof HordeKeyError) || index === ordered.length - 1) {
        throw err;
      }
      console.warn(
        `[image-gen] aihorde key ${index + 1}/${ordered.length} unusable — trying the next: ${msg}`,
      );
      failures.push(msg);
    }
  }
  throw new Error(`AI Horde rejected every configured key. ${failures.join(" | ")}`);
}

/**
 * The `public_id` to send alongside a `folder`.
 *
 * Folder-relative on purpose. Cloudinary treats `folder` and `public_id` as two
 * halves of the full path, so a `public_id` that already begins with the folder
 * name lands the asset at `folder/folder/name` — every upload duplicating its
 * own directory. `folder` is sent and signed separately, so this must not
 * repeat it.
 *
 * Pure and exported so the regression is testable without a network round trip.
 */
export function buildPublicId(
  filename: string | undefined,
  folder: string,
  timestamp: number,
): string {
  const base = filename
    ? filename
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9-_]/g, "_")
        .slice(0, 60)
    : "";
  // The random suffix is on both branches, not just the unnamed one. Two
  // uploads of `photo.png` in the same second used to produce the same
  // `public_id`, and since Cloudinary replaces an asset rather than adding to
  // it, the second upload silently destroyed the first. A timestamp alone is
  // not unique — uploads are not serialised.
  const unique = Math.random().toString(36).slice(2, 8);
  return base ? `${base}-${timestamp}-${unique}` : `${timestamp}-${unique}`;
}

/**
 * Generate a signed upload payload so the client can upload any file type
 * (images, PDFs, docs...) directly to Cloudinary without exposing the secret.
 */
export const getSignedUploadUrl = action({
  args: {
    folder: v.optional(v.string()),
    filename: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error("Cloudinary credentials not configured.");
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = args.folder ?? "jarvis-chat";
    const publicId = buildPublicId(args.filename, folder, timestamp);

    const paramsToSign: Record<string, string | number> = {
      timestamp,
      folder,
      public_id: publicId,
    };

    const signature = cloudinary.utils.api_sign_request(
      paramsToSign,
      apiSecret,
    );

    return {
      url: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
      cloudName,
      apiKey,
      timestamp,
      signature,
      folder,
      publicId,
    };
  },
});

/**
 * Text-to-image generation with automatic provider fallback:
 *   0. The account's own image server, then fal.ai FLUX when FAL_KEY is set
 *   1. Perchance AI (free, no key — PRIMARY; fast-fails if bot-blocked)
 *   2. Pollinations AI (free, no key — verified fast & reliable fallback)
 *   3. Cloudinary Image Generation add-on (needs add-on)
 *   4. Hugging Face Inference API (uses HUGGING_FACE_TOKEN)
 *   5. Replicate (uses REPLICATE_API_TOKEN)
 */

// Circuit breaker: a provider that keeps failing (e.g. Perchance's Cloudflare
// bot-block) shouldn't tax every request with its full timeout. After 3
// consecutive failures the provider is skipped for a cool-down period.
const providerBreakers = new Map<
  string,
  { failures: number; openUntil: number }
>();

/**
 * The provider rejected the *account*, not the request: fal answers 403
 * `User is locked. Reason: TOP_UP.` once credits hit the lock threshold, and
 * every endpoint is refused before a model is even chosen — so a free or
 * cheaper fal model cannot be swapped in to get around it. Retrying the next
 * request cannot help either, which is why this skips the three-strike rule.
 */
class AccountLockedError extends Error {}

function breakerAllows(name: string): boolean {
  const state = providerBreakers.get(name);
  if (!state) return true;
  if (Date.now() >= state.openUntil) {
    providerBreakers.delete(name);
    return true;
  }
  return false;
}

/** Take a provider out of the chain at once, without waiting for 3 strikes. */
function breakerTrip(name: string): void {
  providerBreakers.set(name, {
    failures: 0,
    openUntil: Date.now() + 10 * 60_000,
  });
}

function breakerRecord(name: string, ok: boolean): void {
  if (ok) {
    providerBreakers.delete(name);
    return;
  }
  const state = providerBreakers.get(name) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= 3) {
    state.openUntil = Date.now() + 10 * 60_000; // 10-minute cool-down
    state.failures = 0;
  }
  providerBreakers.set(name, state);
}
export const generateImage = action({
  args: {
    prompt: v.string(),
    model: v.optional(
      v.union(
        v.literal("default"),
        v.literal("flux"),
        v.literal("gpt-image-1"),
        v.literal("ideogram"),
        v.literal("recraft-20"),
        v.literal("recraft-20b"),
        v.literal("sd15"),
        v.literal("sdxl"),
        v.literal("nano-banana"),
      ),
    ),
    aspectRatio: v.optional(
      v.union(v.literal("1:1"), v.literal("3:2"), v.literal("2:3")),
    ),
    /**
     * A picture to start from. Present means "variation", never "generation":
     * the whole provider chain changes with it.
     */
    sourceImage: v.optional(v.string()),
    /** How far the variation may drift from the source, 0.05–1. */
    strength: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string; publicId: string; provider: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to generate images.");

    const prompt = args.prompt.trim();
    if (!prompt) throw new Error("Image prompt is empty.");
    if (prompt.length > 1000) {
      throw new Error("Image prompt too long — keep it under 1000 characters.");
    }

    // A variation starts from a picture the user picked. The URL is validated
    // before any leg sees it: two of the three fetch it server-side, and the
    // client's copy of a URL is not a thing to trust with a request.
    const sourceImage = args.sourceImage?.trim()
      ? assertSafePublicUrl(args.sourceImage.trim())
      : null;
    const strength = Math.min(
      1,
      Math.max(0.05, args.strength ?? DEFAULT_VARIATION_STRENGTH),
    );

    // The own-server leg sits ahead of the hosted chain when configured: the
    // user's model is the reason they saved an endpoint, and a fallback after
    // a 60-second hosted attempt would bury the result they asked for.
    const ownServer = await ctx.runQuery(
      internalApi.imageServer.readForGeneration,
      { userId },
    );


    const attempts: { name: string; run: () => Promise<GeneratedImage> }[] = [];
    if (ownServer) {
      attempts.push({
        name: "own-server",
        run: () => generateViaOwnServer(ctx, ownServer, prompt, args.aspectRatio),
      });
    }
    // Z Image Turbo leads the hosted legs: it is the provider this account
    // expects its text-to-image results from, it honours the aspect ratio, and
    // it answers in about a second. It is text-to-image only — the variation
    // list below replaces this one wholesale, so it can never be handed a
    // reference image it would silently ignore.
    const zimageKey = readEnv(ZIMAGE_KEY_ENVS);
    if (zimageKey) {
      attempts.push({
        name: "z-image-turbo",
        run: () =>
          generateViaZImageTurbo(ctx, zimageKey, prompt, args.aspectRatio),
      });
    }
    // Cloudflare Workers AI is the free fallback: it is the daily allowance and
    // it answers in about 1.4s. It does not take a size (see
    // generateViaCfWorkers), so an explicit aspect ratio is the one thing the
    // legs around it honour better — but a square picture beats no picture.
    const cfWorkersKey = readEnv(CF_KEY_ENVS);
    const cfAccountId = readEnv(CF_ACCOUNT_ENVS);
    if (cfWorkersKey && cfAccountId) {
      attempts.push({
        name: "cloudflare-workers-ai",
        run: () => generateViaCfWorkers(ctx, cfWorkersKey, prompt),
      });
    }
    // fal follows: a keyed, synchronous FLUX endpoint that answers in about a
    // second and honours the aspect ratio. Without a key nothing changes here.
    const falKey = falApiKey();
    if (falKey) {
      attempts.push({
        name: "fal",
        run: () => generateViaFal(ctx, falKey, prompt, args.aspectRatio),
      });
    }
    // Kie.ai (Nano Banana) follows: it honours the aspect ratio and is the only
    // hosted leg that can also take a reference image (see the variation list
    // below), so having one key configured improves both halves of the studio.
    const kieKey = readEnv(KIE_KEY_ENVS);
    if (kieKey) {
      attempts.push({
        name: "kie",
        run: () =>
          generateViaKie(ctx, kieKey, prompt, args.aspectRatio, null),
      });
    }
    // Meta joins only when a key exists: an official endpoint that answers on
    // the first try beats a hosted chain whose leading members fast-fail.
    const metaKey = readEnv(META_KEY_ENVS);
    if (metaKey) {
      attempts.push({
        name: "meta",
        run: () => generateViaMeta(ctx, metaKey, prompt, args.aspectRatio),
      });
    }
    attempts.push(
      {
        // First: Cloudinary is the only provider in this chain that honours
        // `model` and `aspectRatio` — perchance, pollinations, huggingface
        // and replicate all take the bare prompt and ignore both. Promoting
        // it also puts the asset in the account the user actually owns.
        // Safe to try first while it is exhausted: the 429 comes back in
        // milliseconds and the breaker skips it for 10 minutes after 3 of
        // them, so it cannot stall the rest of the chain.
        name: "cloudinary",
        run: () =>
          generateViaCloudinary(ctx, prompt, args.model, args.aspectRatio),
      },
      {
        name: "canva",
        run: () => generateViaCanva(ctx, prompt, args.model, args.aspectRatio),
      },
      {
        name: "perchance",
        run: () => generateViaPerchance(ctx, prompt),
      },
      {
        // Verified working (fast, keyless) — directly after Perchance so the
        // chain almost always produces an image even when Perchance is
        // bot-blocked.
        name: "pollinations",
        run: () => generateViaPollinations(ctx, prompt),
      },
      {
        // Also free and key-backed, but queue-backed: it can sit behind other
        // people's requests, so it runs after Pollinations (about half a second)
        // rather than ahead of it. It still comes before HuggingFace and
        // Replicate, which need paid tokens.
        name: "aihorde",
        run: () => generateViaAIHorde(ctx, prompt),
      },
      {
        name: "huggingface",
        run: () => generateViaHuggingFace(ctx, prompt),
      },
      {
        name: "replicate",
        run: () => generateViaReplicate(ctx, prompt),
      },
    );

    // The chain above is text-to-image. A variation replaces it wholesale
    // rather than reordering it: every leg up there ignores the reference and
    // would answer with a brand-new picture that looks like success. Building
    // these objects costs nothing — no request happens until `run` — and the
    // loop below then gives both requests one breaker, one store path and one
    // error report.
    if (sourceImage) {
      attempts.length = 0;
      if (falKey) {
        attempts.push({
          name: "fal-variation",
          run: () =>
            generateVariationViaFal(ctx, falKey, prompt, sourceImage, strength),
        });
      }
      if (kieKey) {
        // After fal, not before: Nano Banana follows the instruction but has no
        // strength dial, so it cannot honour the subtle/balanced/bold choice
        // the studio offers. It is still the strongest leg when fal is absent.
        attempts.push({
          name: "kie-variation",
          run: () =>
            generateViaKie(ctx, kieKey, prompt, args.aspectRatio, sourceImage),
        });
      }
      if (cfWorkersKey && cfAccountId) {
        attempts.push({
          name: "cloudflare-variation",
          run: () =>
            generateVariationViaCfWorkers(
              ctx,
              cfWorkersKey,
              prompt,
              sourceImage,
              strength,
              args.aspectRatio,
            ),
        });
      }
      attempts.push({
        name: "pollinations-variation",
        run: () => generateVariationViaPollinations(ctx, prompt, sourceImage),
      });
    }

    const errors: string[] = [];
    for (const attempt of attempts) {
      if (!breakerAllows(attempt.name)) {
        errors.push(
          `${attempt.name}: skipped (cooling down after recent failures)`,
        );
        continue;
      }
      try {
        const result = await attempt.run();
        breakerRecord(attempt.name, true);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[image-gen] ${attempt.name} failed: ${msg}`);
        if (err instanceof AccountLockedError) {
          // No credit / revoked key: skip it for the cool-down immediately and
          // let the keyless legs (Pollinations is FLUX for free) serve the
          // request, rather than paying a rejected round-trip every time.
          breakerTrip(attempt.name);
        } else {
          breakerRecord(attempt.name, false);
        }
        errors.push(`${attempt.name}: ${msg}`);
      }
    }

    if (sourceImage) {
      // Without a keyed leg the only attempt was the free one, which is
      // rate-limited; saying so turns a mystery failure into a next step.
      const keyed = falKey || kieKey || (cfWorkersKey && cfAccountId);
      throw new Error(
        `Couldn't make a variation of that picture. ${errors.join(" | ")}` +
          (keyed
            ? ""
            : " Variations need a FAL_KEY, a Kie.ai key or a Cloudflare account — the keyless leg is rate-limited."),
      );
    }

    throw new Error(`All image providers failed. ${errors.join(" | ")}`);
  },
});

/**
 * Build an optimized delivery URL for a stored Cloudinary asset.
 */
export const getOptimizedUrl = action({
  args: {
    publicId: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    if (!cloudName) throw new Error("CLOUDINARY_CLOUD_NAME not configured.");

    const parts = [`https://res.cloudinary.com/${cloudName}/image/upload`];

    const transforms: string[] = [];
    if (args.width) transforms.push(`w_${args.width}`);
    if (args.height) transforms.push(`h_${args.height}`);
    transforms.push("f_auto", "q_auto");

    parts.push(transforms.join(","));
    parts.push(args.publicId);

    return { url: parts.join("/") };
  },
});

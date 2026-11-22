// ---------------------------------------------------------------------------
// CometChat session.
//
// The browser cannot keep the REST API key, and the Auth Key is a development
// shortcut: it can log in (and create) any UID. This action never returns the
// Auth Key. It creates the user and mints a short-lived auth token server-side,
// using COMETCHAT_REST_API_KEY when present and the Auth Key otherwise (the
// Auth Key is accepted for user creation and token minting; verified against
// this app).
//
// The UID is the Convex user id: stable for the account, and already the one
// thing every other surface in this app keys on.
// ---------------------------------------------------------------------------

import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "./_generated/server";

function firstEnv(...names: string[]): string | null {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

// The dashboard gives a short region ("us", "eu", "in"); people also paste the
// full API host. Both become the same two letters so `api-${region}` is right.
function normaliseRegion(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^api-/, "")
    .replace(/\.cometchat\.io.*$/, "")
    .replace(/[^a-z0-9-]/g, "");
}

function credentials() {
  const appId = firstEnv(
    "COMETCHAT_APP_ID",
    "COMETCHAT_APPID",
    "COMET_CHAT_APP_ID",
    "VITE_COMETCHAT_APP_ID",
  );
  const regionRaw = firstEnv(
    "COMETCHAT_REGION",
    "COMETCHAT_REGION_CODE",
    "COMET_CHAT_REGION",
    "VITE_COMETCHAT_REGION",
  );
  const authKey = firstEnv(
    "COMETCHAT_AUTH_KEY",
    "COMETCHAT_AUTHKEY",
    "COMET_CHAT_AUTH_KEY",
    "VITE_COMETCHAT_AUTH_KEY",
  );
  const restKey = firstEnv(
    "COMETCHAT_REST_API_KEY",
    "COMETCHAT_API_KEY",
    "COMETCHAT_REST_KEY",
    "COMET_CHAT_REST_API_KEY",
  );
  return {
    appId,
    region: regionRaw ? normaliseRegion(regionRaw) : null,
    authKey,
    restKey,
  };
}

function apiBase(region: string): string {
  return `https://api-${region}.cometchat.io/v3`;
}

async function rest(
  url: string,
  appId: string,
  apiKey: string,
  body: unknown,
): Promise<{ status: number; text: string }> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      appId,
      apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, text: await response.text() };
}

function errorDetail(text: string): string {
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: unknown; code?: unknown };
    };
    const message = parsed.error?.message;
    if (typeof message === "string" && message.trim()) return message.trim();
    if (typeof parsed.error?.code === "string") return parsed.error.code;
  } catch {
    // Not JSON; the short raw prefix is the best available detail.
  }
  return text.slice(0, 160);
}

export const session = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to use Messages.");

    const identity = await ctx.auth.getUserIdentity();
    const name =
      identity?.name?.trim() ||
      identity?.email?.split("@")[0] ||
      "Jarvis user";
    const { appId, region, authKey, restKey } = credentials();

    const missing: string[] = [];
    if (!appId) missing.push("COMETCHAT_APP_ID");
    if (!region) missing.push("COMETCHAT_REGION");
    if (!authKey && !restKey) missing.push("COMETCHAT_AUTH_KEY");
    if (!appId || !region || missing.length > 0) {
      return {
        configured: false as const,
        missing,
        mode: null,
        appId: appId ?? null,
        region: region ?? null,
        uid: String(userId),
        name,
      };
    }

    const uid = String(userId);

    // Auth Keys are allowed to create users and mint auth tokens (verified
    // against this app), so the browser never needs to see a credential broader
    // than a short-lived token.
    const apiKey = restKey ?? authKey!;
    const base = apiBase(region);
    try {
      const created = await rest(`${base}/users`, appId, apiKey, {
        uid,
        name,
      });
      // 400/409 for an existing UID is success for this flow; anything else
      // that is not 2xx is a real failure worth showing.
      if (
        created.status !== 200 &&
        created.status !== 201 &&
        created.status !== 400 &&
        created.status !== 409
      ) {
        throw new Error(
          `CometChat could not create the user (${created.status}) — ${errorDetail(created.text)}`,
        );
      }

      const tokenResponse = await rest(
        `${base}/users/${encodeURIComponent(uid)}/auth_tokens`,
        appId,
        apiKey,
        { force: true },
      );
      if (tokenResponse.status < 200 || tokenResponse.status >= 300) {
        throw new Error(
          `CometChat could not mint an auth token (${tokenResponse.status}) — ${errorDetail(tokenResponse.text)}`,
        );
      }
      const parsed = JSON.parse(tokenResponse.text) as {
        data?: { authToken?: unknown };
      };
      const authToken = parsed.data?.authToken;
      if (typeof authToken !== "string" || !authToken) {
        throw new Error("CometChat returned no auth token.");
      }
      return {
        configured: true as const,
        mode: "token" as const,
        missing: [] as string[],
        appId,
        region,
        uid,
        name,
        authToken,
      };
    } catch (err) {
      return {
        configured: true as const,
        mode: null,
        missing: [] as string[],
        appId,
        region,
        uid,
        name,
        error:
          err instanceof Error
            ? err.message
            : "CometChat could not start a session.",
      };
    }
  },
});

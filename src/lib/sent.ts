// ---------------------------------------------------------------------------
// Sent (sent.dm) WhatsApp helpers shared by the inbound webhook and dashboard.
//
// Sent is the WhatsApp Business provider: the account owns the number, Sent
// receives Meta's inbound events, and this deployment answers through Sent's
// v3 messages API. The API key never leaves the server. Webhooks are signed
// with Standard Webhooks; the same helpers verify the signature in the HTTP
// route and derive a fallback query secret when no signing secret is set yet.
// ---------------------------------------------------------------------------

export const SENT_API_BASE = "https://api.sent.dm";

/** The server-side key, under either name Sent's SDKs use. */
export function sentApiKey(): string | null {
  const value = (
    process.env.SENT_API_KEY ??
    process.env.SENT_DM_API_KEY ??
    ""
  ).trim();
  return value || null;
}

/** Sent's webhook signing secret, prefixed `whsec_` in the dashboard. */
export function sentSigningSecret(): string | null {
  const value = (process.env.SENT_WEBHOOK_SECRET ?? "").trim();
  return value || null;
}

/** Optional sender-profile scope for an organization API key. */
export function sentProfileId(): string | null {
  const value = (process.env.SENT_PROFILE_ID ?? "").trim();
  return value || null;
}

export interface SentWhatsAppSendResult {
  ok: boolean;
  status: number;
  messageId: string | null;
  error: string | null;
}

/** A compact, non-secret error line from Sent's JSON response. */
function sentResponseError(text: string): string {
  try {
    const parsed = JSON.parse(text) as {
      error?: { message?: unknown; code?: unknown };
      message?: unknown;
    };
    const message =
      typeof parsed.error?.message === "string"
        ? parsed.error.message.trim()
        : typeof parsed.message === "string"
          ? parsed.message.trim()
          : "";
    if (message) {
      const code =
        typeof parsed.error?.code === "string"
          ? `${parsed.error.code}: `
          : "";
      return `${code}${message}`.slice(0, 300);
    }
  } catch {
    // Not JSON; fall through to the raw prefix.
  }
  return text.slice(0, 300);
}

/**
 * Is the account's WhatsApp channel actually connected?
 *
 * Sent accepts a send and reports a blocked message asynchronously, so a 202
 * is not proof that WhatsApp exists. The OTP provider checks this first and
 * fails with a setup message instead of telling the user a code was sent when
 * no channel could deliver it.
 */
export async function sentWhatsAppReady(): Promise<{
  ready: boolean;
  error: string | null;
}> {
  const key = sentApiKey();
  if (!key) {
    return { ready: false, error: "SENT_API_KEY is not configured." };
  }
  try {
    const response = await fetch(`${SENT_API_BASE}/v3/me`, {
      headers: { "x-api-key": key },
      signal: AbortSignal.timeout(15_000),
    });
    const raw = await response.text();
    if (!response.ok) {
      return {
        ready: false,
        error: `Sent answered ${response.status} — ${sentResponseError(raw)}`,
      };
    }
    const parsed = JSON.parse(raw) as {
      data?: { channels?: { whatsapp?: { configured?: unknown } } };
    };
    if (parsed.data?.channels?.whatsapp?.configured !== true) {
      return {
        ready: false,
        error:
          "Sent's WhatsApp channel is not configured. Connect WhatsApp Business in Sent first.",
      };
    }
    return { ready: true, error: null };
  } catch (err) {
    return {
      ready: false,
      error:
        err instanceof Error ? err.message : "Could not reach Sent to check WhatsApp.",
    };
  }
}

/**
 * Send one free-form WhatsApp message through Sent.
 *
 * This is shared by the inbound reply path and the WhatsApp OTP provider, so
 * both use the same validation, profile scoping and error shape. The channel is
 * pinned to WhatsApp: the caller is either replying inside an open WhatsApp
 * window or sending a sign-in code to a number that asked for one.
 */
export async function sendSentWhatsappText(
  to: string,
  text: string,
): Promise<SentWhatsAppSendResult> {
  const key = sentApiKey();
  if (!key) {
    return {
      ok: false,
      status: 0,
      messageId: null,
      error: "SENT_API_KEY is not configured.",
    };
  }

  const recipient = to.trim();
  if (!/^\+[1-9]\d{7,14}$/.test(recipient)) {
    return {
      ok: false,
      status: 0,
      messageId: null,
      error: "Sent received a number that is not in E.164 format.",
    };
  }

  const body = text.trim();
  if (!body) {
    return {
      ok: false,
      status: 0,
      messageId: null,
      error: "Refusing to send an empty reply.",
    };
  }

  try {
    const profileId = sentProfileId();
    const response = await fetch(`${SENT_API_BASE}/v3/messages`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "content-type": "application/json",
        ...(profileId ? { "x-profile-id": profileId } : {}),
      },
      body: JSON.stringify({
        to: [recipient],
        text: body,
        channel: ["whatsapp"],
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const raw = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        messageId: null,
        error: sentResponseError(raw),
      };
    }

    let messageId: string | null = null;
    try {
      const parsed = JSON.parse(raw) as {
        data?: { recipients?: Array<{ message_id?: unknown }> };
      };
      const id = parsed.data?.recipients?.[0]?.message_id;
      if (typeof id === "string") messageId = id;
    } catch {
      // A 202 with an unexpected body still means Sent accepted the send.
    }
    return { ok: true, status: response.status, messageId, error: null };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      messageId: null,
      error: err instanceof Error ? err.message : "Could not reach Sent.",
    };
  }
}

/**
 * A stable fallback secret for the webhook URL.
 *
 * Until the operator adds the signing secret Sent shows on the webhook, the
 * URL needs some way to prove the caller is Sent. Hashing the API key gives a
 * long random-looking value without putting the key itself in a URL, and it
 * means the integration can be tested with only SENT_API_KEY configured.
 * Adding SENT_WEBHOOK_SECRET later switches the route to signature checks.
 */
export async function sentFallbackWebhookKey(): Promise<string | null> {
  const key = sentApiKey();
  if (!key) return null;
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`sent-webhook:${key}`),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function base64Bytes(value: string): Uint8Array | null {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Constant-time comparison for two signatures of equal length. */
function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * Verify a Standard Webhooks delivery from Sent.
 *
 * The signed content is `webhook-id.webhook-timestamp.raw-body`, HMAC-SHA256
 * with the base64 part of the `whsec_` secret. The timestamp check rejects a
 * replayed delivery; the signature header can carry more than one version, so
 * every `v1` entry is tried.
 */
export async function verifySentSignature(args: {
  rawBody: string;
  id: string;
  timestamp: string;
  signature: string;
  secret: string;
  nowSeconds?: number;
}): Promise<boolean> {
  const { rawBody, id, timestamp, signature, secret } = args;
  if (!id || !timestamp || !signature || !secret) return false;

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) return false;
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - sentAt) > 300) return false;

  // Standard Webhooks secrets are `whsec_` + base64. Accepting the raw string
  // too makes a hand-entered secret work instead of failing with a 401.
  const keySource = secret.startsWith("whsec_")
    ? base64Bytes(secret.slice(6))
    : new TextEncoder().encode(secret);
  if (!keySource) return false;
  const keyBytes = new Uint8Array(keySource.byteLength);
  keyBytes.set(keySource);

  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  // Copy into a fresh Uint8Array: TextEncoder's buffer is typed as
  // ArrayBufferLike, while SubtleCrypto.sign wants an ArrayBuffer-backed view.
  const encodedPayload = new TextEncoder().encode(
    `${id}.${timestamp}.${rawBody}`,
  );
  const payload = new Uint8Array(encodedPayload.byteLength);
  payload.set(encodedPayload);
  const mac = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, payload),
  );
  const expected = base64(mac);

  return signature
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.startsWith("v1,"))
    .some((part) => sameString(part.slice(3), expected));
}

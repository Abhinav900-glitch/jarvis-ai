// ---------------------------------------------------------------------------
// Sent (sent.dm) — the WhatsApp Business channel for Jarvis.
//
// The dashboard shows whether the account is ready and hands the operator a
// copyable webhook URL. The public webhook lives in http.ts; it verifies the
// delivery, acknowledges it immediately, and schedules `processInbound` so a
// slow model never makes Sent retry a message that is already being answered.
// Replies are free-form text pinned to WhatsApp, which Meta allows inside the
// 24-hour window an inbound message opens.
// ---------------------------------------------------------------------------

import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  SENT_API_BASE,
  sentApiKey,
  sentFallbackWebhookKey,
  sentProfileId,
  sentSigningSecret,
} from "../lib/sent";

function detail(text: string): string {
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

async function requireUser(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Sign in to use WhatsApp with Sent.");
  return userId;
}

function baseStatus() {
  const site = process.env.CONVEX_SITE_URL?.trim() ?? "";
  return {
    keyPresent: false,
    accountType: null as string | null,
    whatsappConfigured: false,
    smsConfigured: false,
    rcsConfigured: false,
    sendingNumber: null as string | null,
    businessName: null as string | null,
    profileCount: 0,
    profileId: sentProfileId(),
    webhookUrlReady: Boolean(site),
    signedWebhook: sentSigningSecret() !== null,
    error: null as string | null,
  };
}

/**
 * The account behind SENT_API_KEY, as the dialog needs to show it.
 *
 * `GET /v3/me` reports the channels the account can actually send on. A key
 * is not a WhatsApp channel: KYC, a sender number and a Meta Business account
 * are configured in Sent's dashboard, and this action exists so the app can
 * say exactly which of those is still missing.
 */
export const status = action({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const key = sentApiKey();
    if (!key) {
      return { ...baseStatus(), error: "Add SENT_API_KEY in the Keys tab." };
    }

    try {
      const response = await fetch(`${SENT_API_BASE}/v3/me`, {
        headers: { "x-api-key": key },
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      if (!response.ok) {
        return {
          ...baseStatus(),
          keyPresent: true,
          error: `Sent answered ${response.status} — ${detail(text)}`,
        };
      }

      const parsed = JSON.parse(text) as { data?: Record<string, unknown> };
      const data = parsed.data ?? {};
      const channels =
        data.channels && typeof data.channels === "object"
          ? (data.channels as Record<
              string,
              {
                configured?: unknown;
                phone_number?: unknown;
                business_name?: unknown;
              }
            >)
          : {};
      const configured = (name: string) =>
        channels[name]?.configured === true;
      // `sending_phone_number` on this response is the US SMS sender. The
      // WhatsApp number is published on the WhatsApp channel object, which is
      // the one the dialog must offer for a WhatsApp conversation.
      const whatsapp = channels.whatsapp;

      return {
        ...baseStatus(),
        keyPresent: true,
        accountType: typeof data.type === "string" ? data.type : null,
        whatsappConfigured: configured("whatsapp"),
        smsConfigured: configured("sms"),
        rcsConfigured: configured("rcs"),
        sendingNumber:
          typeof whatsapp?.phone_number === "string"
            ? whatsapp.phone_number
            : null,
        businessName:
          typeof whatsapp?.business_name === "string"
            ? whatsapp.business_name
            : null,
        profileCount: Array.isArray(data.profiles)
          ? data.profiles.length
          : 0,
      };
    } catch (err) {
      return {
        ...baseStatus(),
        keyPresent: true,
        error:
          err instanceof Error ? err.message : "Could not reach Sent.",
      };
    }
  },
});

/**
 * The endpoint URL to paste into Sent's webhook form.
 *
 * With SENT_WEBHOOK_SECRET set the URL is bare because Sent signs every
 * delivery. Before that secret exists the URL carries a key derived from
 * SENT_API_KEY, so the first test delivery can still be authenticated without
 * another env var. Neither value is logged or stored.
 */
export const webhookUrl = action({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const site = process.env.CONVEX_SITE_URL?.trim() ?? "";
    if (!site) {
      return {
        url: null as string | null,
        signed: false,
        error: "CONVEX_SITE_URL is not configured.",
      };
    }

    if (sentSigningSecret()) {
      return {
        url: `${site}/sent/whatsapp`,
        signed: true,
        error: null as string | null,
      };
    }

    const fallback = await sentFallbackWebhookKey();
    if (!fallback) {
      return {
        url: `${site}/sent/whatsapp`,
        signed: false,
        error: "Add SENT_API_KEY in the Keys tab.",
      };
    }
    return {
      url: `${site}/sent/whatsapp?key=${fallback}`,
      signed: false,
      error: null as string | null,
    };
  },
});

/**
 * One free-form WhatsApp reply through Sent.
 *
 * The channel is pinned to WhatsApp because this is a reply to an inbound
 * WhatsApp message, which is the only case where Meta's 24-hour customer
 * service window is open. Omitting `channel` would let Sent fall back to SMS
 * or RCS, which is not the conversation the person is having.
 */
async function sendWhatsappText(to: string, text: string) {
  const key = sentApiKey();
  if (!key) {
    return {
      ok: false,
      status: 0,
      messageId: null as string | null,
      error: "SENT_API_KEY is not configured.",
    };
  }

  const recipient = to.trim();
  if (!/^\+[1-9]\d{7,14}$/.test(recipient)) {
    return {
      ok: false,
      status: 0,
      messageId: null as string | null,
      error: "Sent received a number that is not in E.164 format.",
    };
  }

  const body = text.trim();
  if (!body) {
    return {
      ok: false,
      status: 0,
      messageId: null as string | null,
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
        messageId: null as string | null,
        error: detail(raw),
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
      messageId: null as string | null,
      error: err instanceof Error ? err.message : "Could not reach Sent.",
    };
  }
}

/**
 * Answer one inbound WhatsApp message after the webhook has been acknowledged.
 *
 * Running here instead of inside the HTTP action keeps Sent's delivery timeout
 * out of the model path: the route returns 200 immediately, then this action
 * has the full action budget to think and send. A brain failure still gets a
 * short apology, because a silent chat is worse than a fallback.
 */
export const processInbound = internalAction({
  args: {
    to: v.string(),
    message: v.string(),
    contactId: v.string(),
    messageId: v.string(),
  },
  handler: async (ctx, args) => {
    let reply = "Jarvis could not answer that just now. Please send it again.";
    try {
      const result = await ctx.runAction(internal.ai.answerForChannel, {
        message: args.message,
        contactId: args.contactId,
      });
      if (result.reply.trim()) reply = result.reply.trim();
    } catch (err) {
      console.error(
        "[sent] brain failed",
        err instanceof Error ? err.message : err,
      );
    }

    const sent = await sendWhatsappText(args.to, reply);
    if (!sent.ok) {
      console.error("[sent] reply failed", {
        status: sent.status,
        error: sent.error,
        messageId: args.messageId,
      });
    }
    return sent;
  },
});

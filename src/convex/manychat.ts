// ---------------------------------------------------------------------------
// ManyChat — send a message to a subscriber from Jarvis.
//
// ManyChat's Public API is per-account: one key belongs to one page/bot, so
// every call here is scoped to that account. The key is a Bearer token from
// Settings → API (a Pro feature); it never leaves the server.
//
// Only the three operations the panel needs are wrapped: identify the account,
// look up a subscriber, and send one text block. Contact import, tags, flows
// and broadcasts are deliberately out of scope — each has its own consent and
// 24-hour-window rules, and a send button is not the place to discover them.
// ---------------------------------------------------------------------------

import { getAuthUserId } from "@convex-dev/auth/server";
import { action, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/**
 * English region name for an ISO country code, without pulling a second
 * country-name table into the bundle. Intl.DisplayNames is present in the
 * deployment's V8/Node runtimes; the cast only bridges this project's ES2020
 * type library. The ISO code is a useful fallback if it is ever absent.
 */
function regionName(code: string): string {
  try {
    const DisplayNames = (
      Intl as unknown as {
        DisplayNames?: new (
          locales: string[],
          options: { type: "region" },
        ) => { of: (regionCode: string) => string | undefined };
      }
    ).DisplayNames;
    if (!DisplayNames) return code;
    return new DisplayNames(["en"], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

const BASE = "https://api.manychat.com";

function apiKey(): string | null {
  // A proper account API key wins over the AI-suffixed name: if both exist,
  // the latter is the one that must not shadow a working token.
  const names = [
    "MANYCHAT_API_KEY",
    "MANYCHAT_TOKEN",
    "MANYCHAT_KEY",
    "MANYCHAT_AI_API_KEY",
  ];
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

async function call(
  path: string,
  key: string,
  init?: { method?: "GET" | "POST"; body?: unknown },
): Promise<{ ok: boolean; status: number; text: string }> {
  const response = await fetch(`${BASE}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    ...(init?.body ? { body: JSON.stringify(init.body) } : {}),
    signal: AbortSignal.timeout(20_000),
  });
  return {
    ok: response.ok,
    status: response.status,
    text: await response.text(),
  };
}

function detail(text: string): string {
  try {
    const parsed = JSON.parse(text) as {
      message?: unknown;
      error?: unknown;
      details?: unknown;
    };
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return parsed.message.trim();
    }
    if (typeof parsed.error === "string" && parsed.error.trim()) {
      return parsed.error.trim();
    }
    if (parsed.details) return JSON.stringify(parsed.details).slice(0, 200);
  } catch {
    // Not JSON; fall through to the raw prefix.
  }
  return text.slice(0, 200);
}

async function requireUser(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Sign in to use ManyChat.");
  return userId;
}

export const status = action({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const key = apiKey();
    if (!key) {
      return {
        configured: false as const,
        pageName: null,
        pageId: null,
        error: null,
      };
    }
    try {
      const result = await call("/fb/page/getInfo", key);
      if (!result.ok) {
        return {
          configured: true as const,
          pageName: null,
          pageId: null,
          error: `ManyChat answered ${result.status} — ${detail(result.text)}`,
        };
      }
      const parsed = JSON.parse(result.text) as {
        data?: { name?: unknown; id?: unknown };
      };
      return {
        configured: true as const,
        pageName:
          typeof parsed.data?.name === "string" ? parsed.data.name : null,
        pageId:
          typeof parsed.data?.id === "number" ? String(parsed.data.id) : null,
        error: null,
      };
    } catch (err) {
      return {
        configured: true as const,
        pageName: null,
        pageId: null,
        error:
          err instanceof Error ? err.message : "Could not reach ManyChat.",
      };
    }
  },
});

export const subscriber = action({
  args: { subscriberId: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const key = apiKey();
    if (!key) throw new Error("MANYCHAT_AI_API_KEY is not configured.");
    const id = args.subscriberId.trim();
    if (!/^\d{1,16}$/.test(id) || !Number.isSafeInteger(Number(id))) {
      throw new Error(
        "Enter the numeric subscriber ID from the ManyChat contact card.",
      );
    }
    const result = await call(
      `/fb/subscriber/getInfo?subscriber_id=${encodeURIComponent(id)}`,
      key,
    );
    if (!result.ok) {
      throw new Error(
        `ManyChat could not find that subscriber (${result.status}) — ${detail(result.text)}`,
      );
    }
    const parsed = JSON.parse(result.text) as {
      data?: {
        name?: unknown;
        first_name?: unknown;
        last_name?: unknown;
        profile_pic?: unknown;
        live_chat_url?: unknown;
      };
    };
    const data = parsed.data ?? {};
    const name =
      typeof data.name === "string" && data.name.trim()
        ? data.name.trim()
        : [data.first_name, data.last_name]
            .filter((part): part is string => typeof part === "string")
            .join(" ")
            .trim();
    return {
      id,
      name: name || `Subscriber ${id}`,
      profilePic:
        typeof data.profile_pic === "string" ? data.profile_pic : null,
      liveChatUrl:
        typeof data.live_chat_url === "string" ? data.live_chat_url : null,
    };
  },
});

export const sendText = action({
  args: { subscriberId: v.string(), text: v.string() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const key = apiKey();
    if (!key) throw new Error("MANYCHAT_AI_API_KEY is not configured.");

    const id = args.subscriberId.trim();
    if (!/^\d{1,16}$/.test(id) || !Number.isSafeInteger(Number(id))) {
      throw new Error(
        "Enter the numeric subscriber ID from the ManyChat contact card.",
      );
    }
    const text = args.text.trim();
    if (!text) throw new Error("Write a message first.");
    if (text.length > 2_000) {
      throw new Error("ManyChat text messages are limited to 2,000 characters.");
    }

    const result = await call("/fb/sending/sendContent", key, {
      method: "POST",
      body: {
        subscriber_id: Number(id),
        data: {
          version: "v2",
          content: {
            messages: [{ type: "text", text }],
          },
        },
      },
    });

    if (!result.ok) {
      // 3021/3031 are the 24-hour-window errors; the raw message already says
      // what to do, so it is passed through rather than translated.
      return {
        ok: false as const,
        status: result.status,
        error: `ManyChat answered ${result.status} — ${detail(result.text)}`,
      };
    }

    let messageId: number | null = null;
    try {
      const parsed = JSON.parse(result.text) as {
        data?: { message_id?: unknown };
      };
      if (typeof parsed.data?.message_id === "number") {
        messageId = parsed.data.message_id;
      }
    } catch {
      // A 200 with no body is still a delivered send.
    }
    return { ok: true as const, status: result.status, messageId };
  },
});

/** Key under which the public assistant number is stored. */
const WHATSAPP_KEY = "whatsapp-number";

/**
 * The shared secret for the Twilio inbound webhook, if one is configured.
 *
 * Twilio's inbound webhook screen supports no custom headers, so the secret
 * has to travel as a query parameter. Same precedence as the route in http.ts:
 * a dedicated Twilio secret first, then the ManyChat one, then its API key so
 * a deployment with only the AI key can still be wired up.
 */
function twilioSecret(): string | null {
  const value = (
    process.env.TWILIO_WEBHOOK_SECRET ??
    process.env.MANYCHAT_WEBHOOK_SECRET ??
    process.env.MANYCHAT_AI_API_KEY ??
    ""
  ).trim();
  return value || null;
}

function whatsappFields(raw: string) {
  // wa.me wants digits only, including the country code and no plus sign.
  const number = raw.replace(/\D/g, "").slice(0, 15);
  const valid = number.length >= 8;
  const parsed = valid ? parsePhoneNumberFromString(`+${number}`) : undefined;
  const regionCode = parsed?.country ?? null;
    const site = process.env.CONVEX_SITE_URL?.trim() ?? "";
  const secretConfigured = twilioSecret() !== null;


  return {
    display: valid ? `+${number}` : null,
    number: valid ? number : null,
    link: valid
      ? `https://wa.me/${number}?text=${encodeURIComponent("Hi Jarvis")}`
      : null,
    /** Country code is derived from the number, not configured twice. */
    region:
      regionCode && parsed
        ? {
            code: regionCode,
            name: regionName(regionCode),
            callingCode: `+${parsed.countryCallingCode}`,
          }
        : null,
    /** The inbound path is usable only when a URL and a secret exist. */
    channelReady: Boolean(site && secretConfigured),
    /** Twilio's inbound webhook; the secret is appended by the operator. */
    twilioWebhook: site ? `${site}/twilio/whatsapp` : null,
    envName: "WHATSAPP_NUMBER",
  };
}

/**
 * The assistant's own WhatsApp number, shown to people who want to chat there.
 *
 * WhatsApp does not let an app mint a phone number: a number is issued by Meta
 * or by a provider that connects to the WhatsApp Business Platform (ManyChat
 * in this deployment). The number is therefore configuration, not something
 * created at runtime; this query only normalises and publishes it.
 *
 * A number saved through the dialog wins over the deployment env var, so the
 * number can be connected without a redeploy.
 */
export const whatsapp = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to see the WhatsApp number.");

    const saved = await ctx.db
      .query("channelSettings")
      .withIndex("by_key", (q) => q.eq("key", WHATSAPP_KEY))
      .unique();
    const raw = (
      saved?.value ??
      process.env.WHATSAPP_NUMBER ??
      process.env.MANYCHAT_WHATSAPP_NUMBER ??
      ""
    ).trim();
    return whatsappFields(raw);
  },
});

/** Connect or replace the assistant's public WhatsApp number. */
export const saveWhatsapp = mutation({
  args: { number: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to connect a number.");

    const number = args.number.replace(/\D/g, "").slice(0, 15);
    if (number.length < 8) {
      throw new Error("Enter the full number including its country code.");
    }

    const existing = await ctx.db
      .query("channelSettings")
      .withIndex("by_key", (q) => q.eq("key", WHATSAPP_KEY))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { value: number, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("channelSettings", {
        key: WHATSAPP_KEY,
        value: number,
        updatedAt: Date.now(),
      });
    }
    return { number };
  },
});

/**
 * The complete Twilio webhook URL, secret included.
 *
 * The Twilio console has no field for a custom header, so the shared secret
 * must be appended as `?key=`. Splicing a 32-character secret into a URL by
 * hand is the step most likely to be mistyped, so this action hands the
 * finished URL to the signed-in dialog to copy. It is never logged or stored;
 * it exists only long enough to reach the clipboard.
 *
 * Null means the deployment has no site URL or no secret to authenticate the
 * inbound call, which the dialog can explain instead of copying a URL that
 * could never work.
 */
export const twilioWebhookUrl = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to copy the webhook URL.");

    const site = process.env.CONVEX_SITE_URL?.trim() ?? "";
    const secret = twilioSecret();
    if (!site || !secret) return { url: null as string | null };
    return {
      url: `${site}/twilio/whatsapp?key=${encodeURIComponent(secret)}`,
    };
  },
});

/**
 * Where to point a ManyChat External Request, and which env var holds the
 * bearer secret it must send.
 *
 * The secret itself is never returned: ManyChat only needs to be told its
 * value once, and a browser has no reason to see it. `endpoint` is null on a
 * deployment without CONVEX_SITE_URL, which is a setup error the panel can
 * show plainly instead of a URL that can never work.
 */
export const channel = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to configure ManyChat.");

    const site = process.env.CONVEX_SITE_URL?.trim() ?? "";
    const secretName = process.env.MANYCHAT_WEBHOOK_SECRET?.trim()
      ? "MANYCHAT_WEBHOOK_SECRET"
      : process.env.MANYCHAT_AI_API_KEY?.trim()
        ? "MANYCHAT_AI_API_KEY"
        : null;

    return {
      endpoint: site ? `${site}/manychat/answer` : null,
      secretName,
      configured: secretName !== null,
    };
  },
});

/**
 * A signed-in smoke test for the same brain an External Request reaches.
 *
 * It deliberately calls the internal action directly instead of the public
 * endpoint: that proves the model path works before ManyChat is wired, and
 * avoids needing the shared secret in the browser.
 */
export const testBrain = action({
  args: { message: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ reply: string; engine: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to test the channel.");

    const message =
      args.message?.trim().slice(0, 2_000) ||
      "Say in one short WhatsApp message that you are ready, and ask what I need help with.";
    return await ctx.runAction(internal.ai.answerForChannel, { message });
  },
});

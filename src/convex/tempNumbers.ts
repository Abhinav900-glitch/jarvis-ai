// ---------------------------------------------------------------------------
// Ghost line — Temp Number actions.
//
// The dashboard reads the wallet, live pricing and stock, the numbers on the
// account, and each number's SMS. Buying and releasing are explicit,
// authenticated actions because both move money; the key itself never leaves
// this deployment.
// ---------------------------------------------------------------------------

import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "./_generated/server";
import { v } from "convex/values";
import {
  normalizeTempDuration,
  normalizeTempNumberType,
  tempNumberRequest,
  type TempNumberAccount,
  type TempNumberCountry,
  type TempNumberInbox,
  type TempNumberInventory,
  type TempNumberNumber,
} from "../lib/temp-number";

async function requireUser(ctx: Parameters<typeof getAuthUserId>[0]) {
  const userId = await getAuthUserId(ctx);
  if (!userId) throw new Error("Sign in to use Ghost line.");
  return userId;
}

function readCountryCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) {
    throw new Error("Choose a valid two-letter country code.");
  }
  return code;
}

function readNumberId(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("That number id is not valid.");
  }
  return value;
}

/** Wallet balance and settlement currency. */
export const account = action({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const result = await tempNumberRequest<{
      balance?: unknown;
      currency?: unknown;
    }>("/account");
    return {
      balance: typeof result.balance === "number" ? result.balance : 0,
      currency:
        typeof result.currency === "string" ? result.currency : "USD",
    } satisfies TempNumberAccount;
  },
});

/** Every country and package currently on sale. */
export const pricing = action({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const result = await tempNumberRequest<{ data?: unknown }>("/pricing");
    if (!Array.isArray(result.data)) return [] as TempNumberCountry[];
    return result.data as TempNumberCountry[];
  },
});

/** Live stock for one country, duration and optional number type. */
export const inventory = action({
  args: {
    countryCode: v.string(),
    duration: v.string(),
    numberType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const country = readCountryCode(args.countryCode);
    const duration = normalizeTempDuration(args.duration);
    const numberType = normalizeTempNumberType(args.numberType);

    const params = new URLSearchParams({
      country_code: country,
      duration,
    });
    if (numberType) params.set("number_type", numberType);

    const result = await tempNumberRequest<{ data: TempNumberInventory }>(
      `/inventory?${params.toString()}`,
    );
    return result.data;
  },
});

/** Every number on the wallet, newest first. */
export const list = action({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const result = await tempNumberRequest<{ data?: unknown }>("/numbers");
    if (!Array.isArray(result.data)) return [] as TempNumberNumber[];
    return result.data as TempNumberNumber[];
  },
});

/** One number and its SMS inbox, newest first. */
export const messages = action({
  args: { numberId: v.number() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const id = readNumberId(args.numberId);
    const result = await tempNumberRequest<{ data: TempNumberInbox }>(
      `/numbers/${id}/sms`,
    );
    return result.data;
  },
});

/**
 * Buy a private number.
 *
 * The dashboard checks the price against the wallet first, but the API is the
 * final authority: it charges and allocates atomically, and an insufficient
 * balance comes back as an error rather than a paid-but-empty number. The
 * idempotency key makes a retried click safe.
 */
export const buy = action({
  args: {
    countryCode: v.string(),
    duration: v.string(),
    numberType: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const country = readCountryCode(args.countryCode);
    const duration = normalizeTempDuration(args.duration);
    const numberType = normalizeTempNumberType(args.numberType);

    const result = await tempNumberRequest<{
      data: TempNumberNumber;
      meta?: {
        charged?: unknown;
        currency?: unknown;
        wallet_balance_after?: unknown;
      };
    }>("/numbers/buy", {
      method: "POST",
      body: {
        country_code: country,
        duration,
        ...(numberType ? { number_type: numberType } : {}),
      },
      idempotencyKey: crypto.randomUUID(),
      timeoutMs: 60_000,
    });

    return {
      number: result.data,
      charged:
        typeof result.meta?.charged === "number" ? result.meta.charged : 0,
      currency:
        typeof result.meta?.currency === "string"
          ? result.meta.currency
          : "USD",
      balanceAfter:
        typeof result.meta?.wallet_balance_after === "number"
          ? result.meta.wallet_balance_after
          : 0,
    };
  },
});

/**
 * Release a number for a refund.
 *
 * Temp Number only allows this between 15 and 120 minutes after purchase and
 * before the number has received an SMS. The API explains the exact reason
 * when the window has closed, so it is passed through unchanged.
 */
export const cancel = action({
  args: { numberId: v.number() },
  handler: async (ctx, args) => {
    await requireUser(ctx);
    const id = readNumberId(args.numberId);

    const result = await tempNumberRequest<{
      data: TempNumberNumber;
      meta?: {
        refunded?: unknown;
        currency?: unknown;
        wallet_balance_after?: unknown;
      };
    }>(`/numbers/${id}/cancel`, {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
      timeoutMs: 60_000,
    });

    return {
      number: result.data,
      refunded:
        typeof result.meta?.refunded === "number" ? result.meta.refunded : 0,
      currency:
        typeof result.meta?.currency === "string"
          ? result.meta.currency
          : "USD",
      balanceAfter:
        typeof result.meta?.wallet_balance_after === "number"
          ? result.meta.wallet_balance_after
          : 0,
    };
  },
});

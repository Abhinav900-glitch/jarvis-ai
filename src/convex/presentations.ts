"use node";

import { randomUUID } from "node:crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  deckPrompt,
  parseGammaStatus,
  parsePresentationsDeck,
  type DeckJob,
} from "../lib/presentations";

// ---------------------------------------------------------------------------
// Slides, from a message.
//
// Two providers, one job shape. Gamma is tried first: a single call with the
// text, and a `gammaUrl` that opens in the browser with no download step.
// Presentations.AI is the fallback and is the better PPTX — it can hold the
// connection until the deck is finished (`Prefer: wait=180`), so most requests
// come back complete instead of needing a poll.
//
// Nothing here is a chat turn: the deck is a side artifact, so a failure is
// reported as data (`status: "failed"`, `error`) rather than thrown, and the
// panel can render it without swallowing an answer.
// ---------------------------------------------------------------------------

const GAMMA_BASE = "https://public-api.gamma.app/v1.0";
const PAI_BASE = "https://api.presentations.ai/api/v1";

/** How long Presentations.AI holds the request open before handing back a 202. */
const PREFER_WAIT_SECONDS = 120;

const gammaKey = () => process.env.GAMMA_API_KEY?.trim() || "";
const paiKey = () =>
  (
    process.env.PRESENTATIONS_AI_API ??
    process.env.PRESENTATIONSAI_API_KEY ??
    process.env.PRESENTATIONS_AI_API_KEY
  )?.trim() || "";

const empty = (error: string | null): DeckJob => ({
  provider: "none",
  generationId: null,
  status: error ? "failed" : "none",
  url: null,
  exportUrl: null,
  statusUrl: null,
  error,
});

async function createWithGamma(
  key: string,
  text: string,
  numCards: number,
): Promise<DeckJob> {
  try {
    const res = await fetch(`${GAMMA_BASE}/generations`, {
      method: "POST",
      headers: {
        // Gamma uses a custom header, not `Authorization: Bearer`.
        "X-API-KEY": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputText: deckPrompt(text),
        textMode: "generate",
        format: "presentation",
        numCards,
      }),
      signal: AbortSignal.timeout(60_000),
    });

    const body = (await res.json().catch(() => ({}))) as {
      generationId?: string;
      message?: string;
      statusCode?: number;
    };

    if (!res.ok || !body.generationId) {
      return {
        ...empty(
          body.message
            ? `Gamma: ${body.message}`
            : res.status === 402 || res.status === 403
              ? "Gamma has no credits left, or the key was rejected."
              : `Gamma generation failed (${res.status}).`,
        ),
        provider: "gamma",
      };
    }

    return {
      provider: "gamma",
      generationId: body.generationId,
      // Gamma returns an id immediately; the deck is minutes away at best.
      status: "pending",
      url: null,
      exportUrl: null,
      statusUrl: null,
      error: null,
    };
  } catch (err) {
    console.error("Gamma create failed:", err instanceof Error ? err.message : err);
    return {
      ...empty("Could not reach Gamma."),
      provider: "gamma",
    };
  }
}

async function createWithPresentationsAI(
  key: string,
  text: string,
  numCards: number,
): Promise<DeckJob> {
  // Idempotency key: a retried request returns the same deck instead of
  // billing a second one. Each new deck needs a fresh id.
  const requestId = randomUUID();
  try {
    const res = await fetch(`${PAI_BASE}/decks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Request-Id": requestId,
        Prefer: `wait=${PREFER_WAIT_SECONDS}`,
      },
      body: JSON.stringify({
        prompt: deckPrompt(text),
        slide_count: String(numCards),
        export_format: "PPTX",
      }),
      signal: AbortSignal.timeout((PREFER_WAIT_SECONDS + 20) * 1000),
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    // 201 is finished, 202 is "poll status_url". Anything else is an error body.
    if (res.status !== 201 && res.status !== 202) {
      const message = typeof body.message === "string" ? body.message : "";
      return {
        ...empty(
          message
            ? `Presentations.AI: ${message}`
            : res.status === 401 || res.status === 403
              ? "The Presentations.AI key was rejected."
              : res.status === 429
                ? "Presentations.AI rate limit reached — try again shortly."
                : `Presentations.AI generation failed (${res.status}).`,
        ),
        provider: "presentations",
      };
    }

    const parsed = parsePresentationsDeck(body);
    const id = parsed.generationId ?? requestId;
    return {
      provider: "presentations",
      generationId: id,
      // A 202 body often carries no status at all; the poll decides.
      status: res.status === 201 ? "completed" : (parsed.status ?? "pending"),
      url: parsed.url ?? null,
      exportUrl: parsed.exportUrl ?? null,
      statusUrl: parsed.statusUrl ?? `${PAI_BASE}/requests/${id}`,
      error: null,
    };
  } catch (err) {
    console.error(
      "Presentations.AI create failed:",
      err instanceof Error ? err.message : err,
    );
    return {
      // Keep the id: a timeout may still be generating under this Request-Id.
      ...empty("Presentations.AI did not answer in time — the deck may still be generating."),
      provider: "presentations",
      generationId: requestId,
      status: "pending",
      statusUrl: `${PAI_BASE}/requests/${requestId}`,
    };
  }
}

export const create = action({
  args: {
    text: v.string(),
    numCards: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<DeckJob> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to generate a presentation.");

    const text = args.text.trim();
    if (!text) return empty("Nothing to turn into slides yet.");

    // Gamma caps a free plan at 10 cards; 12 is a safe default for both.
    const numCards = Math.min(Math.max(Math.round(args.numCards ?? 10), 3), 30);

    const gamma = gammaKey();
    if (gamma) return await createWithGamma(gamma, text, numCards);

    const pai = paiKey();
    if (pai) return await createWithPresentationsAI(pai, text, numCards);

    return empty(
      "Slides need GAMMA_API_KEY or PRESENTATIONS_AI_API to be configured.",
    );
  },
});

export const status = action({
  args: {
    provider: v.union(v.literal("gamma"), v.literal("presentations")),
    generationId: v.string(),
    /** Poll target handed back by the provider, when it gave one. */
    statusUrl: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<DeckJob> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to check a presentation.");

    const base: DeckJob = {
      provider: args.provider,
      generationId: args.generationId,
      status: "pending",
      url: null,
      exportUrl: null,
      statusUrl: args.statusUrl ?? null,
      error: null,
    };

    const url =
      args.provider === "gamma"
        ? `${GAMMA_BASE}/generations/${encodeURIComponent(args.generationId)}`
        : (args.statusUrl ?? `${PAI_BASE}/requests/${encodeURIComponent(args.generationId)}`);

    const key = args.provider === "gamma" ? gammaKey() : paiKey();
    if (!key) {
      return {
        ...base,
        status: "failed",
        error: `No key configured for ${args.provider}.`,
      };
    }

    // Only poll hosts we would have called ourselves: statusUrl is a client
    // value, and the key must never travel to an arbitrary origin.
    const allowed = args.provider === "gamma" ? GAMMA_BASE : PAI_BASE;
    if (!url.startsWith(allowed)) {
      return {
        ...base,
        status: "failed",
        error: "Refusing to poll a status URL outside the provider's API.",
      };
    }

    try {
      const res = await fetch(url, {
        headers:
          args.provider === "gamma"
            ? { "X-API-KEY": key, accept: "application/json" }
            : { Authorization: `Bearer ${key}`, accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });

      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        return {
          ...base,
          status: "failed",
          error:
            typeof body.message === "string"
              ? String(body.message)
              : `${args.provider} status check failed (${res.status}).`,
        };
      }

      const parsed =
        args.provider === "gamma"
          ? parseGammaStatus(body)
          : parsePresentationsDeck(body);

      return {
        ...base,
        status: parsed.status ?? "pending",
        url: parsed.url ?? base.url,
        exportUrl: parsed.exportUrl ?? base.exportUrl,
        statusUrl: parsed.statusUrl ?? base.statusUrl,
      };
    } catch (err) {
      console.error(
        `${args.provider} status failed:`,
        err instanceof Error ? err.message : err,
      );
      // A status check that cannot reach the provider is not a failed deck.
      return { ...base, error: "Could not reach the presentation provider." };
    }
  },
});

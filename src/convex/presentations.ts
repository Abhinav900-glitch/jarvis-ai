"use node";

import { randomUUID } from "node:crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import {
  deckPrompt,
  parseGammaStatus,
  parsePresentationsDeck,
  parsePresentonTask,
  presentonEndpoints,
  type DeckJob,
  type DeckProvider,
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

// Presenton is self-hostable, so the base URL is part of the configuration; the
// cloud service is the default and the only host that speaks v3.
const presentonBase = () => process.env.PRESENTON_BASE_URL?.trim() || "";
const presentonKey = () => process.env.PRESENTON_API_KEY?.trim() || "";

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

async function createWithPresenton(
  key: string,
  text: string,
  numCards: number,
): Promise<DeckJob> {
  const endpoints = presentonEndpoints(presentonBase());
  try {
    // Async, not sync: a deck takes one to two minutes, which is longer than an
    // action should hold a connection open — and the panel polls anyway.
    const res = await fetch(endpoints.generate, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: deckPrompt(text),
        n_slides: numCards,
        language: "English",
        [endpoints.templateKey]: "general",
        export_as: "pptx",
      }),
      signal: AbortSignal.timeout(60_000),
    });

    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const message = typeof body.detail === "string" ? body.detail : typeof body.message === "string" ? body.message : "";
      return {
        ...empty(
          message
            ? `Presenton: ${message}`
            : res.status === 401 || res.status === 403
              ? "The Presenton key was rejected."
              : `Presenton generation failed (${res.status}).`,
        ),
        provider: "presenton",
      };
    }

    const parsed = parsePresentonTask(body, endpoints.origin);
    if (!parsed.generationId) {
      return {
        ...empty("Presenton accepted the request without returning a task id."),
        provider: "presenton",
      };
    }

    return {
      provider: "presenton",
      generationId: parsed.generationId,
      // The task id is immediate; the deck follows by poll. A deployment that
      // answered synchronously already has the urls, so honour them.
      status: parsed.status === "completed" ? "completed" : "pending",
      url: parsed.url ?? null,
      exportUrl: parsed.exportUrl ?? null,
      statusUrl: null,
      error: null,
    };
  } catch (err) {
    console.error(
      "Presenton create failed:",
      err instanceof Error ? err.message : err,
    );
    return { ...empty("Could not reach Presenton."), provider: "presenton" };
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

    // A real chain, not "first key wins": a configured provider can still fail
    // on credits, quota or an outage, and the next one costs nothing to try.
    const attempts: { provider: DeckProvider; run: () => Promise<DeckJob> }[] = [];
    const gamma = gammaKey();
    if (gamma) {
      attempts.push({
        provider: "gamma",
        run: () => createWithGamma(gamma, text, numCards),
      });
    }
    const pai = paiKey();
    if (pai) {
      attempts.push({
        provider: "presentations",
        run: () => createWithPresentationsAI(pai, text, numCards),
      });
    }
    const presenton = presentonKey();
    if (presenton) {
      attempts.push({
        provider: "presenton",
        run: () => createWithPresenton(presenton, text, numCards),
      });
    }

    if (attempts.length === 0) {
      return empty(
        "Slides need GAMMA_API_KEY, PRESENTATIONS_AI_API or PRESENTON_API_KEY to be configured.",
      );
    }

    // PRESENTATION_PROVIDER pins one, for when a workspace has a house style or
    // is testing a provider that is not first in the chain.
    const prefer = (process.env.PRESENTATION_PROVIDER ?? "").trim().toLowerCase();
    const ordered = prefer
      ? [...attempts].sort((a, b) =>
          a.provider === prefer ? -1 : b.provider === prefer ? 1 : 0,
        )
      : attempts;

    let last: DeckJob | null = null;
    for (const attempt of ordered) {
      const job = await attempt.run();
      if (job.status !== "failed") return job;
      last = job;
    }

    return last ?? empty("No presentation provider could be reached.");
  },
});

export const status = action({
  args: {
    provider: v.union(
      v.literal("gamma"),
      v.literal("presentations"),
      v.literal("presenton"),
    ),
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

    const presenton = presentonEndpoints(presentonBase());
    const url =
      args.provider === "gamma"
        ? `${GAMMA_BASE}/generations/${encodeURIComponent(args.generationId)}`
        : args.provider === "presentations"
          ? (args.statusUrl ?? `${PAI_BASE}/requests/${encodeURIComponent(args.generationId)}`)
          : presenton.status(args.generationId);

    const key =
      args.provider === "gamma"
        ? gammaKey()
        : args.provider === "presentations"
          ? paiKey()
          : presentonKey();
    if (!key) {
      return {
        ...base,
        status: "failed",
        error: `No key configured for ${args.provider}.`,
      };
    }

    // Only poll hosts we would have called ourselves: statusUrl is a client
    // value, and the key must never travel to an arbitrary origin.
    const allowed =
      args.provider === "gamma"
        ? GAMMA_BASE
        : args.provider === "presentations"
          ? PAI_BASE
          : presenton.origin;
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
          : args.provider === "presentations"
            ? parsePresentationsDeck(body)
            : parsePresentonTask(body, presenton.origin);

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

"use node";

// ---------------------------------------------------------------------------
// Recall — what Jarvis knows when you ask it something.
//
// Two stages, and the second is the one that matters:
//
//   1. Candidates. Convex's vector index stores the corpus. Queries are
//      embedded with a HuggingFace sentence-transformer and matched by cosine.
//
//   2. Reranking. Voyage's cross-encoder re-scores the candidates against the
//      actual question. Cosine similarity finds things that look alike; the
//      reranker decides which of those actually answers it. This is the stage
//      that was missing before, and it is why recall used to feel arbitrary.
//
// The two providers do different jobs and are not interchangeable. HuggingFace
// embeds and is the only thing that writes; Voyage re-scores the text those
// results come back as. Voyage's vectors are 1024-dimensional while Convex's
// index is fixed at 384, so a Voyage vector could be written but never read
// back — a Voyage key upgrades the ranking, and never has to own the storage.
//
// Every dependency is optional. No Voyage key or no HuggingFace token: each
// degrades one stage and the rest still runs. The worst case is an empty
// context, which is exactly what the app did before memory existed.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericActionCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { voyageDiagnose, voyageRerank } from "./voyage";

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/** The only embedder: 384-dim, which is exactly what Convex's index accepts. */
const HF_EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
export const EMBED_DIMS = 384;

async function hfEmbed(token: string, texts: string[]): Promise<number[][]> {
  // api-inference.huggingface.co is retired — the Inference API lives on the
  // router host now (verified live with this token).
  const res = await fetch(
    `https://router.huggingface.co/hf-inference/models/${HF_EMBED_MODEL}/pipeline/feature-extraction`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`embedding failed (${res.status}): ${t.slice(0, 120)}`);
  }
  const data = (await res.json()) as number[][] | { embeddings?: number[][] };
  const vectors = Array.isArray(data) ? data : (data.embeddings ?? []);
  if (vectors.length !== texts.length) throw new Error("embedding count mismatch");
  return vectors;
}

export type EmbedBackend = "huggingface" | "none";

/**
 * Embed texts for storage in Convex's vector index.
 *
 * HuggingFace only. Voyage produces better vectors but at 1024 dimensions,
 * and the index is fixed at {@link EMBED_DIMS} — writing them would store
 * vectors the retriever can never read back. Voyage earns its keep at the
 * reranking stage instead, which works on text and needs no vectors at all.
 *
 * Reports "none" rather than throwing when the token is missing, so the caller
 * can skip the write instead of failing a turn that does not need it.
 */
async function embed(
  texts: string[],
): Promise<{ vectors: number[][]; backend: EmbedBackend }> {
  const token = process.env.HUGGING_FACE_TOKEN;
  if (!token || texts.length === 0) return { vectors: [], backend: "none" };

  try {
    const vectors = await hfEmbed(
      token,
      texts.map((t) => t.slice(0, 2000)),
    );
    // Width-checked rather than trusted: a wrong-width vector would be written
    // and then read back by a cosine that scores everything near zero.
    const usable = vectors.every((v) => v.length === EMBED_DIMS);
    return usable
      ? { vectors, backend: "huggingface" }
      : { vectors: [], backend: "none" };
  } catch (err) {
    console.error("[recall] huggingface embed failed:", err);
    return { vectors: [], backend: "none" };
  }
}

// ---------------------------------------------------------------------------
// Storing an exchange
// ---------------------------------------------------------------------------

/**
 * Store embeddings for a set of messages (called after each exchange).
 *
 * Convex's vector index is the only corpus store, so this is the single write
 * path. Without a HuggingFace token it reports zero rather than throwing: an
 * un-indexed exchange degrades future recall slightly, and failing the turn
 * that triggered the write would be a much worse trade.
 */
export const indexMessages = action({
  args: {
    sessionId: v.id("chatSessions"),
    messages: v.array(
      v.object({
        messageId: v.id("chatMessages"),
        role: v.string(),
        content: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { indexed: 0, backend: "none" as EmbedBackend };

    const valid = args.messages.filter(
      (m) => m.content.trim().length >= 20 && m.content.length <= 4000,
    );
    if (valid.length === 0) return { indexed: 0, backend: "none" as EmbedBackend };

    const texts = valid.map((m) => m.content.slice(0, 2000));
    const { vectors, backend } = await embed(texts);
    if (vectors.length === 0) return { indexed: 0, backend };

    for (let i = 0; i < valid.length; i++) {
      const vec = vectors[i];
      if (!Array.isArray(vec) || vec.length !== EMBED_DIMS) continue;
      await ctx.runMutation(internal.chats.insertEmbedding, {
        userId,
        sessionId: args.sessionId,
        messageId: valid[i].messageId,
        role: valid[i].role,
        content: texts[i],
        vector: vec,
      });
    }
    return { indexed: valid.length, backend };
  },
});

// ---------------------------------------------------------------------------
// Retrieving context
// ---------------------------------------------------------------------------

export interface RetrievedContext {
  role: string;
  content: string;
  sessionId: string;
}

/** A candidate before the reranker has had its say. */
interface Candidate extends RetrievedContext {
  /** Only meaningful for the no-reranker fallback ordering. */
  source: "convex";
}

export const retrieveContext = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    currentSessionId: v.optional(v.id("chatSessions")),
  },
  handler: async (ctx, args): Promise<RetrievedContext[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const limit = Math.min(Math.max(args.limit ?? 6, 1), 20);
    // Deliberately over-fetch. A reranker can only reorder what it is handed,
    // so the candidate set has to be larger than the final answer or the best
    // result may never be considered at all.
    const overFetch = Math.min(limit * 6, 40);

    try {
      const candidates = await retrieveFromConvex(
        ctx,
        userId,
        args.query,
        overFetch,
      );
      if (candidates.length === 0) return [];

      const reranked = await voyageRerank(
        args.query,
        candidates.map((c) => c.content),
        limit,
      );
      const picked =
        reranked.length > 0
          ? reranked.map((r) => candidates[r.index]).filter(Boolean)
          : candidates.slice(0, limit);

      return picked.slice(0, limit).map((c) => ({
        role: c.role,
        content: c.content,
        sessionId: c.sessionId,
      }));
    } catch (err) {
      console.error("[recall] retrieval failed:", err);
      return [];
    }
  },
});

/** Convex's vector index, over-fetched for the reranker. */
async function retrieveFromConvex(
  ctx: GenericActionCtx<DataModel>,
  userId: Id<"users">,
  query: string,
  limit: number,
): Promise<Candidate[]> {
  const token = process.env.HUGGING_FACE_TOKEN;
  if (!token || limit <= 0) return [];

  // Isolated: a failure to embed the query must cost only this stage, not the
  // turn that asked for recall.
  let queryVec: number[] | undefined;
  try {
    [queryVec] = await hfEmbed(token, [query.slice(0, 2000)]);
  } catch (err) {
    console.error("[recall] convex-path embed failed:", err);
    return [];
  }
  if (!Array.isArray(queryVec) || queryVec.length !== EMBED_DIMS) return [];

  const matches = await ctx.vectorSearch("messageEmbeddings", "by_embedding", {
    vector: queryVec,
    limit: Math.min(limit * 2, 100),
    filter: (q) => q.eq("userId", userId),
  });

  const results = await Promise.all(
    matches.map(async (m) => ({
      doc: await ctx.runQuery(internal.chats.getEmbedding, { id: m._id }),
      score: m._score,
    })),
  );

  return results
    .filter((r) => r.doc !== null && r.score > 0.35)
    .slice(0, limit)
    .map((r) => ({
      role: r.doc!.role,
      content: r.doc!.content,
      sessionId: String(r.doc!.sessionId),
      source: "convex" as const,
    }));
}

// ---------------------------------------------------------------------------
// Durable facts — the "what you know about the user" block
// ---------------------------------------------------------------------------

/**
 * The memories worth putting in front of the model, best-first for this query.
 *
 * Facts are short and few, so they are ranked against the user's actual message
 * rather than simply taken newest-first: "I use Linux" should surface for a
 * question about their setup even if it was learned months ago.
 */
export const recallFacts = action({
  args: {
    userId: v.id("users"),
    query: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ content: string; kind: string; createdAt: number }[]> => {
    const limit = Math.min(Math.max(args.limit ?? 12, 1), 50);

    const rows = (await ctx.runQuery(internal.memories.listForContext, {
      userId: args.userId,
      limit: 200,
    })) as { content: string; kind: string; createdAt: number }[];
    if (rows.length === 0) return [];

    // Rerank when there is a query to rerank against. Without one the list is
    // already newest-first, which is the right order for "what do you know
    // about me".
    const query = (args.query ?? "").trim();
    if (!query || rows.length <= 1) return rows.slice(0, limit);

    const reranked = await voyageRerank(
      query,
      rows.map((r) => r.content),
      limit,
    );
    if (reranked.length === 0) return rows.slice(0, limit);

    return reranked
      .map((r) => rows[r.index])
      .filter((d): d is (typeof rows)[number] => Boolean(d))
      .slice(0, limit);
  },
});

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/**
 * Actually exercise the recall integrations and report what came back.
 *
 * The status query in `memories.ts` only checks whether the variables are set,
 * which is not the same as working — and the difference matters, because a
 * key from the wrong provider still leaves recall silently returning nothing
 * while every indicator reads green.
 *
 * Authenticated on purpose: it makes live network calls and reports internal
 * configuration, so it must not be reachable by anonymous callers.
 */
export const verifyConnections = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const voyage = await voyageDiagnose();
    return {
      voyage,
      ok: voyage.ok,
      /** Nothing configured at all is a different situation from configured
       *  but broken, and the panel words them differently. */
      anythingConfigured: voyage.configured,
    };
  },
});
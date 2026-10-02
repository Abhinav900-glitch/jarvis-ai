"use node";

// ---------------------------------------------------------------------------
// Recall — what Jarvis knows when you ask it something.
//
// Three stages, and the third is the one that matters:
//
//   1. Candidates. When MongoDB is configured, the long-term corpus lives there
//      and candidates come back by keyword plus recency. Without it, Convex's
//      own vector index serves the same role.
//
//   2. Embedding. Voyage AI embeds the query. When it is not configured the
//      old HuggingFace sentence-transformer is used instead, so the feature
//      never simply disappears — it just gets worse.
//
//   3. Reranking. Voyage's cross-encoder re-scores the candidates against the
//      actual question. Cosine similarity finds things that look alike; the
//      reranker decides which of those actually answers it. This is the stage
//      that was missing before, and it is why recall used to feel arbitrary.
//
// Every dependency is optional. No Voyage key, no Mongo, no HuggingFace token:
// each degrades one stage and the rest still runs. The worst case is an empty
// context, which is exactly what the app did before memory existed.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericActionCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import {
  MEMORY_COLLECTION,
  mongoCandidates,
  mongoConfigured,
  mongoDeleteMany,
  mongoFind,
  mongoInsertMany,
  mongoUpdateOne,
  type MemoryDoc,
  type MemoryKind,
} from "./mongo";
import { cosine, voyageEmbed, voyageRerank } from "./voyage";

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

/** The existing fallback path, unchanged, for deployments without Voyage. */
const HF_EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
export const EMBED_DIMS = 384;

/**
 * Voyage's dimension, asserted here rather than at each call site.
 *
 * A mismatch would not throw — it would write vectors the retriever cannot
 * read, and recall would quietly return nothing. Keeping the number in one
 * place, next to the check that uses it, is the whole defence.
 */
export const VOYAGE_VECTOR_DIMS = 1024;

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

export type EmbedBackend = "voyage" | "huggingface" | "none";

/**
 * Embed texts with whichever provider is configured, preferring Voyage.
 *
 * Reports which one it used rather than throwing, because the caller needs to
 * know whether it may write 1024-dim or 384-dim vectors.
 */
async function embed(
  texts: string[],
  inputType: "query" | "document",
): Promise<{ vectors: number[][]; backend: EmbedBackend }> {
  const voyage = await voyageEmbed(texts, { inputType });
  // Checked rather than trusted: a wrong-width vector set would be written and
  // then read back by a cosine that silently scores everything near zero.
  if (voyage.length > 0 && voyage.every((v) => v.length === VOYAGE_VECTOR_DIMS)) {
    return { vectors: voyage, backend: "voyage" };
  }

  const token = process.env.HUGGING_FACE_TOKEN;
  if (!token || texts.length === 0) return { vectors: [], backend: "none" };

  try {
    const vectors = await hfEmbed(
      token,
      texts.map((t) => t.slice(0, 2000)),
    );
    return { vectors, backend: "huggingface" };
  } catch (err) {
    console.error("[recall] huggingface embed failed:", err);
    return { vectors: [], backend: "none" };
  }
}

// ---------------------------------------------------------------------------
// Storing an exchange
// ---------------------------------------------------------------------------

/** Stable document id, so re-indexing the same exchange is idempotent. */
function docId(userId: string, messageId: string): string {
  return `${userId}:${messageId}`;
}

/**
 * Store embeddings for a set of messages (called after each exchange).
 *
 * Writes to MongoDB when it is configured, and to the Convex vector index
 * otherwise. The two are not written to at once on purpose: keeping one
 * authoritative store means a corpus is never half-updated, and turning the
 * key off falls back to a working store rather than a half-migrated one.
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
    const { vectors, backend } = await embed(texts, "document");
    if (vectors.length === 0) return { indexed: 0, backend };

    const useMongo = mongoConfigured();

    // Voyage vectors cannot go into the Convex index — its dimension is fixed
    // at 384 in the schema. So Mongo is the only place they can live, and the
    // Convex store only accepts the HuggingFace vectors.
    if (useMongo) {
      const now = Date.now();
      const docs: MemoryDoc[] = valid.map((message, i) => ({
        _id: docId(userId, message.messageId),
        userId,
        kind: "exchange" as MemoryKind,
        content: texts[i],
        sessionId: args.sessionId,
        messageId: message.messageId,
        role: message.role,
        embedding: vectors[i],
        createdAt: now,
      }));
      await mongoInsertMany(MEMORY_COLLECTION, docs as unknown as Record<string, unknown>[]);
      return { indexed: docs.length, backend };
    }

    if (backend !== "huggingface") {
      // Voyage is keyed but MongoDB is not, so these vectors have nowhere to
      // go. Saying so beats pretending the exchange was indexed.
      return { indexed: 0, backend };
    }

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

/** A candidate from either store, before the reranker has had its say. */
interface Candidate extends RetrievedContext {
  /** Only meaningful for the no-reranker fallback ordering. */
  source: "mongo" | "convex";
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
      const mongo = mongoConfigured()
        ? await retrieveFromMongo(userId, args.query, overFetch)
        : [];

      // Both stores are consulted, not just the newer one. Exchanges indexed
      // before MongoDB was configured live only in Convex's vector index, and
      // returning early on a non-empty Mongo result would silently orphan all
      // of that existing history.
      const convex =
        mongo.length >= overFetch
          ? []
          : await retrieveFromConvex(
              ctx,
              userId,
              args.query,
              overFetch - mongo.length,
            );

      const candidates = [...mongo, ...convex];
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

/**
 * MongoDB path: keyword + recency candidates, then ordered by cosine.
 *
 * The embedding is optional. Without one the candidates are still ordered by
 * keyword overlap and recency and still get reranked, which is meaningfully
 * better than nothing — reranking does not need the vectors at all.
 */
async function retrieveFromMongo(
  userId: string,
  query: string,
  limit: number,
): Promise<Candidate[]> {
  const docs = await mongoCandidates(userId, query, limit);
  if (docs.length === 0) return [];

  const [queryVec] = await voyageEmbed([query], { inputType: "query" });
  const ordered =
    Array.isArray(queryVec) && queryVec.length > 0
      ? docs
          .map((doc) => ({
            doc,
            score: Array.isArray(doc.embedding) ? cosine(queryVec, doc.embedding) : 0,
          }))
          .sort((a, b) => b.score - a.score)
          .map((s) => s.doc)
      : docs;

  return ordered.slice(0, limit).map((doc) => ({
    role: doc.role ?? "assistant",
    content: doc.content,
    sessionId: doc.sessionId ?? "",
    source: "mongo" as const,
  }));
}

/** The original Convex vector-index path, kept as a second source. */
async function retrieveFromConvex(
  ctx: GenericActionCtx<DataModel>,
  userId: Id<"users">,
  query: string,
  limit: number,
): Promise<Candidate[]> {
  const token = process.env.HUGGING_FACE_TOKEN;
  if (!token || limit <= 0) return [];

  // Isolated: a failure here must cost only the Convex half of the results,
  // not the MongoDB candidates that were already retrieved successfully.
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

    if (mongoConfigured()) {
      const docs = await mongoFind<MemoryDoc>(
        MEMORY_COLLECTION,
        { userId: args.userId, kind: { $ne: "exchange" } },
        { sort: { createdAt: -1 }, limit: 200 },
      );
      const ranked = await rankFacts(docs, args.query ?? "", limit);
      if (ranked.length > 0) return ranked;
    }

    // The Convex store stays the fallback, and is also the user-visible list.
    return (await ctx.runQuery(internal.memories.listForContext, {
      userId: args.userId,
      limit,
    })) as { content: string; kind: string; createdAt: number }[];
  },
});

async function rankFacts(
  docs: MemoryDoc[],
  query: string,
  limit: number,
): Promise<{ content: string; kind: string; createdAt: number }[]> {
  const shape = (d: MemoryDoc) => ({
    content: d.content,
    kind: d.kind === "exchange" ? "fact" : d.kind,
    createdAt: d.createdAt,
  });
  if (docs.length === 0) return [];
  if (!query.trim()) return docs.slice(0, limit).map(shape);

  const reranked = await voyageRerank(
    query,
    docs.map((d) => d.content),
    limit,
  );
  if (reranked.length === 0) return docs.slice(0, limit).map(shape);

  return reranked
    .map((r) => docs[r.index])
    .filter((d): d is MemoryDoc => Boolean(d))
    .slice(0, limit)
    .map(shape);
}

/**
 * Write durable facts to whichever store is authoritative.
 *
 * Called after extraction and after a manual "remember this". Embeds with
 * Voyage when it is configured so a later query can rank against them.
 */
export const storeFacts = action({
  args: {
    items: v.array(
      v.object({
        content: v.string(),
        kind: v.optional(v.string()),
        /** The Convex `memories` row id, so the two stores stay addressable
         *  as the same fact and forgetting one can find the other. */
        id: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { stored: 0 };
    if (!mongoConfigured()) return { stored: 0 };

    const items = args.items
      .map((i) => ({
        id: i.id,
        content: i.content.trim().slice(0, 280),
        kind: (i.kind ?? "fact") as MemoryKind,
      }))
      .filter((i) => i.content.length > 0);
    if (items.length === 0) return { stored: 0 };

    const { vectors } = await embed(
      items.map((i) => i.content),
      "document",
    );
    const now = Date.now();

    const docs: MemoryDoc[] = items.map((item, i) => ({
      _id: factDocId(userId, item.id),
      userId,
      kind: item.kind,
      content: item.content,
      ...(vectors[i] ? { embedding: vectors[i] } : {}),
      createdAt: now,
    }));

    // Replace rather than insert: re-extraction can produce the same fact
    // again, and an upsert is the only way to keep one document per fact
    // instead of a growing pile of near-duplicates.
    for (const doc of docs) {
      await mongoUpdateOne(
        MEMORY_COLLECTION,
        { _id: doc._id },
        {
          $set: {
            userId: doc.userId,
            kind: doc.kind,
            content: doc.content,
            ...(doc.embedding ? { embedding: doc.embedding } : {}),
            createdAt: doc.createdAt,
          },
        },
      );
    }
    return { stored: docs.length };
  },
});

/** Remove facts from MongoDB by their Convex row ids. Best-effort by design. */
export const forgetInMongo = action({
  args: { ids: v.array(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { removed: 0 };
    if (!mongoConfigured() || args.ids.length === 0) return { removed: 0 };

    const removed = await mongoDeleteMany(MEMORY_COLLECTION, {
      _id: { $in: args.ids.slice(0, 200).map((id) => factDocId(userId, id)) },
    });
    return { removed };
  },
});

/** Drop every durable fact for a user, leaving the recall corpus intact. */
export const clearFactsInMongo = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { removed: 0 };
    if (!mongoConfigured()) return { removed: 0 };

    const removed = await mongoDeleteMany(MEMORY_COLLECTION, {
      userId,
      kind: { $ne: "exchange" },
    });
    return { removed };
  },
});

/** The one place the cross-store document id is built. */
function factDocId(userId: string, convexId: string): string {
  return `${userId}:${convexId}`;
}
import { v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { type Doc, type Id } from "./_generated/dataModel";

/** Trim, dedupe-ish helper so junk never lands in the store. */
function cleanContent(content: string): string {
  return (content ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
}

function normalizeKind(kind: string | undefined): Doc<"memories">["kind"] {
  return kind === "preference" ? "preference" : kind === "note" ? "note" : "fact";
}

function currentUserId(ctx: { auth: { getUserIdentity(): Promise<{ subject: string } | null> } }) {
  return ctx.auth.getUserIdentity();
}

const UNKNOWN_KINDS = new Set(["secret", "password", "api key", "token"]);

/** Drop anything that smells like a credential before it is ever stored. */
function looksSensitive(content: string): boolean {
  const lower = content.toLowerCase();
  for (const needle of UNKNOWN_KINDS) {
    if (lower.includes(needle)) return true;
  }
  return /\b(?:[a-z0-9]{20,})\b/.test(lower) && /\b(?:key|token|secret|bearer)\b/.test(lower);
}

/**
 * Which memory backends are actually configured, for the Memory panel.
 *
 * A query rather than an action: it reads only deployment env vars, and the
 * panel needs to poll it cheaply while it is open. `process.env` is available
 * in the Convex runtime as well as node, so this needs no upgrade path.
 *
 * Reporting this out loud matters more than it looks. Recall quality depends
 * entirely on which of these is live, and a silent fallback looks exactly like
 * a working setup from inside the app.
 */
export const backend = query({
  args: {},
  handler: async () => {
    const mongo = Boolean(
      process.env.MONGODB_DATA_API_URL?.trim() && process.env.MONGODB_API_KEY?.trim(),
    );
    const voyage = Boolean(
      process.env.VOYAGE_API_KEY?.trim() || process.env.VOYAGE_KEY?.trim(),
    );
    const huggingface = Boolean(process.env.HUGGING_FACE_TOKEN?.trim());

    return {
      store: mongo ? "mongodb" : "convex",
      storeLabel: mongo ? "MongoDB Atlas" : "Convex",
      embeddings: voyage ? "voyage" : huggingface ? "huggingface" : "none",
      embeddingsLabel: voyage
        ? "Voyage AI"
        : huggingface
          ? "HuggingFace MiniLM"
          : "None",
      reranking: voyage,
      /** False means memory still works, just without the better stages. */
      fullyConfigured: mongo && voyage,
    };
  },
});

/** Recent memories for a user, newest first. */
export const list = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await currentUserId(ctx);
    if (!user) return [];
    const limit = Math.min(Math.max(args.limit ?? 100, 1), 200);
    const rows = await ctx.db
      .query("memories")
      .withIndex("by_user_time", (q) => q.eq("userId", user.subject as Id<"users">))
      .order("desc")
      .take(limit);
    return rows;
  },
});

/**
 * Read context for the *calling action's* user. This is `internal` on purpose:
 * a public query that accepted a `userId` argument would let any signed-in
 * account read another account's memory store.
 */
export const listForContext = internalQuery({
  args: {
    userId: v.id("users"),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("memories")
      .withIndex("by_user_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(Math.min(Math.max(args.limit, 1), 50));
    return rows.map((r) => ({ content: r.content, kind: r.kind, createdAt: r.createdAt }));
  },
});

/** Add a single memory. Kept as a mutation for callers that do not need the
 *  MongoDB mirror — the panel goes through `memory.remember` instead. */
export const add = mutation({
  args: {
    content: v.string(),
    kind: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await currentUserId(ctx);
    if (!user) throw new Error("Not signed in");
    const content = cleanContent(args.content);
    if (!content) throw new Error("Nothing to remember");
    if (looksSensitive(content)) throw new Error("Refusing to store something that looks like a secret");

    const existing = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", user.subject as Id<"users">))
      .collect();
    const lower = content.toLowerCase();
    const dupe = existing.find((m) => m.content.toLowerCase() === lower);
    if (dupe) return dupe;

    return ctx.db.insert("memories", {
      userId: user.subject as Id<"users">,
      content,
      kind: normalizeKind(args.kind),
      createdAt: Date.now(),
    });
  },
});

/**
 * Bulk insert used by automatic extraction. Internal, so the extractor
 * (which passes an explicit userId) is the only caller — the user-facing path
 * goes through `add`, which derives the owner from the session.
 */
export const addMany = internalMutation({
  args: {
    userId: v.id("users"),
    items: v.array(
      v.object({ content: v.string(), kind: v.optional(v.string()) }),
    ),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const inserted: { id: Id<"memories">; content: string; kind: string }[] = [];

    const existing = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const seen = new Set(existing.map((m) => m.content.toLowerCase()));

    for (const item of args.items.slice(0, 5)) {
      const content = cleanContent(item.content);
      if (!content || seen.has(content.toLowerCase())) continue;
      if (looksSensitive(content)) continue;
      seen.add(content.toLowerCase());
      const kind = normalizeKind(item.kind);
      const id = await ctx.db.insert("memories", {
        userId: args.userId,
        content,
        kind,
        createdAt: now,
      });
      inserted.push({ id, content, kind });
    }
    // The ids come back so the caller can mirror the same rows into the
    // MongoDB corpus under a matching document id — without them, forgetting a
    // memory would not be able to find its copy.
    return inserted;
  },
});

/** Insert one fact and return its id, for the manual "Remember this" path. */
export const addOne = internalMutation({
  args: {
    userId: v.id("users"),
    content: v.string(),
    kind: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const content = cleanContent(args.content);
    if (!content || looksSensitive(content)) return null;

    const existing = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    const dupe = existing.find((m) => m.content.toLowerCase() === content.toLowerCase());
    if (dupe) return dupe._id;

    return await ctx.db.insert("memories", {
      userId: args.userId,
      content,
      kind: normalizeKind(args.kind),
      createdAt: Date.now(),
    });
  },
});

/** Forget every fact for a user. Returns how many rows went. */
export const clearRows = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

/**
 * Forget one memory.
 *
 * Internal rather than public because forgetting has to touch two stores: the
 * Convex row the Memory panel reads, and the MongoDB copy that recall searches.
 * Only a `"use node"` action can reach both, so the user-facing entry point is
 * `memory.forget`, which calls this and then deletes from Mongo.
 */
export const removeRow = internalMutation({
  args: { id: v.id("memories") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (!row) return false;
    await ctx.db.delete(args.id);
    return true;
  },
});

/** Every memory row for a user — the ids a full wipe needs to clean up. */
export const listIds = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    return rows.map((r) => r._id);
  },
});

import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
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

/** Add a single memory (used by the "Remember this" button). */
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
    const inserted: Id<"memories">[] = [];

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
      inserted.push(
        await ctx.db.insert("memories", {
          userId: args.userId,
          content,
          kind: normalizeKind(item.kind),
          createdAt: now,
        }),
      );
    }
    return inserted.length;
  },
});

/** Forget one memory. */
export const remove = mutation({
  args: { id: v.id("memories") },
  handler: async (ctx, args) => {
    const user = await currentUserId(ctx);
    if (!user) throw new Error("Not signed in");
    const row = await ctx.db.get(args.id);
    if (!row) return;
    if (row.userId !== (user.subject as Id<"users">)) {
      throw new Error("Not your memory");
    }
    await ctx.db.delete(args.id);
  },
});

/** Forget everything (used by the "Clear memory" action in the panel). */
export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await currentUserId(ctx);
    if (!user) throw new Error("Not signed in");
    const rows = await ctx.db
      .query("memories")
      .withIndex("by_user", (q) => q.eq("userId", user.subject as Id<"users">))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return rows.length;
  },
});

// ---------------------------------------------------------------------------
// Public, read-only chat snapshots.
//
// User messages are end-to-end encrypted, so the server cannot build this
// snapshot itself: the browser decrypts the transcript it is showing and sends
// the plaintext here, only when the owner presses Share. Assistant replies are
// already plaintext on the row.
//
// The share is a snapshot rather than a live view. A link that someone opens
// tomorrow should show what was shared today — not later messages, edits or a
// different branch. Revoking deletes the row, and the slug is the only thing
// standing between the public and the text, so it is generated from
// `crypto.randomUUID`, not from a counter.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";

/** Long chats share their newest end rather than failing outright. */
const MAX_MESSAGES = 200;
const MAX_MESSAGE_CHARS = 20_000;
/** Comfortably under Convex's 1 MB document limit. */
const MAX_TOTAL_CHARS = 600_000;

function newSlug(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 24);
}

export const create = mutation({
  args: {
    sessionId: v.id("chatSessions"),
    title: v.string(),
    messages: v.array(
      v.object({
        role: v.union(v.literal("user"), v.literal("assistant")),
        content: v.string(),
        imageUrl: v.optional(v.string()),
        createdAt: v.number(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to share a chat.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("That conversation is not yours to share.");
    }

    // Newest first while trimming, then restore order: a very long chat keeps
    // the part the user is actually looking at.
    const kept: typeof args.messages = [];
    let chars = 0;
    for (
      let i = args.messages.length - 1;
      i >= 0 && kept.length < MAX_MESSAGES;
      i--
    ) {
      const message = args.messages[i];
      const content = message.content.slice(0, MAX_MESSAGE_CHARS);
      if (chars + content.length > MAX_TOTAL_CHARS) break;
      chars += content.length;
      kept.unshift({ ...message, content });
    }
    if (kept.length === 0) throw new Error("There is nothing to share yet.");

    const now = Date.now();
    const existing = await ctx.db
      .query("chatShares")
      .withIndex("by_user_session", (q) =>
        q.eq("userId", userId).eq("sessionId", args.sessionId),
      )
      .first();

    if (existing) {
      // Sharing again refreshes the same link instead of leaving several
      // copies of one conversation floating around.
      await ctx.db.patch(existing._id, {
        title: args.title.slice(0, 200),
        messages: kept,
        createdAt: now,
      });
      return { slug: existing.slug, refreshed: true };
    }

    const slug = newSlug();
    await ctx.db.insert("chatShares", {
      userId,
      sessionId: args.sessionId,
      slug,
      title: args.title.slice(0, 200),
      messages: kept,
      createdAt: now,
    });
    return { slug, refreshed: false };
  },
});

/** Public: the page that renders a shared conversation. */
export const get = query({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    const share = await ctx.db
      .query("chatShares")
      .withIndex("by_slug", (q) => q.eq("slug", args.slug))
      .unique();
    if (!share) return null;
    return {
      title: share.title,
      messages: share.messages,
      createdAt: share.createdAt,
    };
  },
});

/** Owner-side switch: turn the public link off again. */
export const revoke = mutation({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in first.");

    const existing = await ctx.db
      .query("chatShares")
      .withIndex("by_user_session", (q) =>
        q.eq("userId", userId).eq("sessionId", args.sessionId),
      )
      .first();
    if (!existing) return { removed: false };
    await ctx.db.delete(existing._id);
    return { removed: true };
  },
});

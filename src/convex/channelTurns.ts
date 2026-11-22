// ---------------------------------------------------------------------------
// Short conversation memory for channels with no Convex account.
//
// ManyChat calls the webhook once per contact message and does not send the
// earlier turns. Without this table every WhatsApp reply would start from
// nothing, so the second question could not refer to the first. Rows are
// scoped by the channel's own contact id, never merged into a web account.
//
// The window is deliberately small: this is conversational continuity, not a
// transcript archive. Every save trims the contact back to the newest KEEP
// messages, which also bounds what a leaked contact id could expose.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/** Only ManyChat uses this today; the column leaves room for another channel. */
const CHANNEL = "manychat";

/** How much context the model sees: eight exchanges. */
const HISTORY_MESSAGES = 16;

/** How much is retained after a save: twelve exchanges. */
const KEEP_MESSAGES = 24;

export const history = internalQuery({
  args: { contactId: v.string() },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("channelTurns")
      .withIndex("by_contact", (q) =>
        q.eq("channel", CHANNEL).eq("contactId", args.contactId),
      )
      .order("desc")
      .take(HISTORY_MESSAGES);

    // Newest-first for the index scan, oldest-first for a chat prompt.
    return rows.reverse().map((row) => ({
      role: row.role,
      content: row.content,
    }));
  },
});

export const remember = internalMutation({
  args: {
    contactId: v.string(),
    userMessage: v.string(),
    reply: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("channelTurns", {
      channel: CHANNEL,
      contactId: args.contactId,
      role: "user",
      content: args.userMessage.slice(0, 6_000),
      createdAt: now,
    });
    await ctx.db.insert("channelTurns", {
      channel: CHANNEL,
      contactId: args.contactId,
      role: "assistant",
      content: args.reply.slice(0, 3_500),
      createdAt: now + 1,
    });

    // Trim only occasionally? No: a fixed small window is the point, and the
    // extra 8 rows give the delete loop something to do without running on
    // every single save.
    const rows = await ctx.db
      .query("channelTurns")
      .withIndex("by_contact", (q) =>
        q.eq("channel", CHANNEL).eq("contactId", args.contactId),
      )
      .order("desc")
      .take(KEEP_MESSAGES + 8);
    for (const row of rows.slice(KEEP_MESSAGES)) {
      await ctx.db.delete(row._id);
    }
  },
});

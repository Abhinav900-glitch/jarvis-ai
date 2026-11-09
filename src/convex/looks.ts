// ---------------------------------------------------------------------------
// The character-look cache.
//
// Every image generation that names a character needs that character described
// in words before the generator will draw the right person. Researching it
// costs a web search and a model call, and the answer is the same for every
// account — so it is stored once, keyed by a normalised name, and refreshed
// after a month because characters keep getting new forms.
//
// Internal only: nothing in the app calls these directly, and the rows are not
// per-user state anyone should be able to read or edit.
// ---------------------------------------------------------------------------
import { v } from "convex/values";

import { internalMutation, internalQuery } from "./_generated/server";
import { LOOK_TTL_MS } from "../lib/character-look";

export const cached = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("characterLooks")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .unique();
    if (!row) return null;
    // Stale rows still come back: the caller can use them when a fresh lookup
    // fails, which is better than describing nothing.
    return { ...row, fresh: Date.now() - row.createdAt < LOOK_TTL_MS };
  },
});

export const save = internalMutation({
  args: {
    key: v.string(),
    subject: v.string(),
    brief: v.string(),
    sources: v.array(v.object({ title: v.string(), url: v.string() })),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // One row per key: a re-research replaces the old description rather than
    // leaving two answers for the same character.
    const rows = await ctx.db
      .query("characterLooks")
      .withIndex("by_key", (q) => q.eq("key", args.key))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    await ctx.db.insert("characterLooks", {
      key: args.key,
      subject: args.subject,
      brief: args.brief,
      sources: args.sources,
      model: args.model,
      createdAt: Date.now(),
    });
  },
});

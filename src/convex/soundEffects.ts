import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

// ---------------------------------------------------------------------------
// Sound-effect cache.
//
// Generated clips are content-addressed by the hash of their prompt: the same
// bark is only ever generated once, then served from file storage for every
// later request. These are internal because only the `voice.soundEffect`
// action should be able to read or write the cache.
// ---------------------------------------------------------------------------

export const getByHash = internalQuery({
  args: { promptHash: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("soundEffects")
      .withIndex("by_hash", (q) => q.eq("promptHash", args.promptHash))
      .unique();
  },
});

export const save = internalMutation({
  args: {
    promptHash: v.string(),
    prompt: v.string(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    // Two requests can race for the same prompt; keep the first clip so both
    // callers share one stored file rather than orphaning an upload.
    const existing = await ctx.db
      .query("soundEffects")
      .withIndex("by_hash", (q) => q.eq("promptHash", args.promptHash))
      .first();
    if (existing) return null;

    await ctx.db.insert("soundEffects", {
      promptHash: args.promptHash,
      prompt: args.prompt,
      storageId: args.storageId,
      createdAt: Date.now(),
    });
    return null;
  },
});

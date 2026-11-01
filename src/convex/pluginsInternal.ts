import { v } from "convex/values";
import { query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const getPluginRow = query({
  args: { pluginId: v.id("plugins") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const row = await ctx.db.get(args.pluginId);
    if (!row || row.userId !== userId) return null;
    return row;
  },
});

import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ---------------------------------------------------------------------------
// Plugins & MCP — the account's zip archive.
//
// Storage, not execution: a zip lands in Convex file storage exactly as it
// was handed over, with what was detected inside it recorded on the row so
// the list can render without re-reading the file. `enabled` is the one piece
// of forward state — it is what an MCP endpoint will later read to decide
// which of the stored configs are live.
//
// Every write re-derives the owner from the session (getAuthUserId), so no
// argument a client sends can reach another account's rows.
// ---------------------------------------------------------------------------

/** A zip this big is a mistake (or a whole asset folder), not a plugin. */
const MAX_ZIP_BYTES = 25 * 1024 * 1024;
/** Rows per account, so the archive cannot grow without bound. */
const MAX_PLUGINS = 40;

/** Hands the client a URL it can POST the file to. Returns storageId from that POST. */
export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to store a plugin.");
    return await ctx.storage.generateUploadUrl();
  },
});

export const save = mutation({
  args: {
    fileName: v.string(),
    storageId: v.id("_storage"),
    name: v.string(),
    kind: v.union(v.literal("plugin"), v.literal("mcp")),
    version: v.optional(v.string()),
    description: v.optional(v.string()),
    sizeBytes: v.number(),
    fileCount: v.optional(v.number()),
    manifests: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to store a plugin.");

    if (args.sizeBytes <= 0 || args.sizeBytes > MAX_ZIP_BYTES) {
      // Drop the blob the client already uploaded rather than orphaning it.
      await ctx.storage.delete(args.storageId);
      throw new Error("A plugin zip has to be under 25 MB.");
    }

    const count = await ctx.db
      .query("plugins")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (count.length >= MAX_PLUGINS) {
      await ctx.storage.delete(args.storageId);
      throw new Error(`That is ${MAX_PLUGINS} stored zips — remove one first.`);
    }

    return await ctx.db.insert("plugins", {
      userId,
      name: args.name.trim().slice(0, 80) || "Untitled plugin",
      kind: args.kind,
      version: args.version?.trim().slice(0, 32) || undefined,
      description: args.description?.trim().slice(0, 300) || undefined,
      fileName: args.fileName.trim().slice(0, 160) || "plugin.zip",
      storageId: args.storageId,
      sizeBytes: args.sizeBytes,
      fileCount: args.fileCount,
      manifests: args.manifests?.slice(0, 20000) || undefined,
      enabled: true,
      createdAt: Date.now(),
    });
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const rows = await ctx.db
      .query("plugins")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);

    return await Promise.all(
      rows.map(async (row) => ({
        ...row,
        // A signed URL for re-downloading the archive; it expires like any
        // storage URL, which is why it is computed here rather than stored.
        url: (await ctx.storage.getUrl(row.storageId)) as string | null,
      })),
    );
  },
});

export const setEnabled = mutation({
  args: { pluginId: v.id("plugins"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    const row = await ctx.db.get(args.pluginId);
    if (!row || row.userId !== userId) throw new Error("Not found.");
    await ctx.db.patch(args.pluginId, { enabled: args.enabled });
  },
});

export const remove = mutation({
  args: { pluginId: v.id("plugins") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    const row = await ctx.db.get(args.pluginId);
    if (!row || row.userId !== userId) throw new Error("Not found.");
    await ctx.db.delete(args.pluginId);
    // The row goes first: a storage blob with no row is invisible litter, a
    // row with no blob is a visible error the user can act on.
    await ctx.storage.delete(row.storageId);
  },
});

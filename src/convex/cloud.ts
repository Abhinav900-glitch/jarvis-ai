// ---------------------------------------------------------------------------
// The user's own cloud.
//
// Every chat already persists, but files did not: a deck a program built lived
// in `agentArtifacts` only long enough to be handed back, and an upload had
// nowhere to go at all. This module is the part that makes storage a feature of
// having an account — rows are owned by a user, capped by a quota, and survive
// until that user deletes them.
//
// Bytes are handled by Convex storage. The row is the index and the ownership
// record; the download URL is minted per query, so a file can never be fetched
// by anyone who cannot already see the row.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";

/** What a signed-in account gets. Exported so the panel and landing agree. */
export const LIMIT_BYTES = 512 * 1024 * 1024;

/** One file, and the whole drive, so a single upload cannot swallow the quota. */
export const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_FILES = 300;
const MAX_NAME = 120;
const MAX_FOLDERS = 40;
const MAX_FOLDER_NAME = 40;

/** Directory separators are stripped: the name is a label, not a path. */
function cleanName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? raw;
  return base.trim().slice(0, MAX_NAME) || "untitled";
}

/** Bytes already stored for this user. Sums the same rows the panel lists. */
async function usedBytes(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
): Promise<number> {
  const rows = await ctx.db
    .query("cloudFiles")
    .withIndex("by_user_time", (q) => q.eq("userId", userId))
    .take(MAX_FILES);
  return rows.reduce((sum, row) => sum + row.size, 0);
}

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;

    const rows = await ctx.db
      .query("cloudFiles")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(MAX_FILES);

    let used = 0;
    const files = [];
    for (const row of rows) {
      used += row.size;
      files.push({
        id: row._id,
        name: row.name,
        mime: row.mime,
        size: row.size,
        source: row.source ?? "upload",
        folderId: row.folderId ?? null,
        createdAt: row.createdAt,
        // Null when the blob is gone but the row survived; the row still shows
        // so the user can delete it rather than stare at a dead download.
        url: await ctx.storage.getUrl(row.storageId),
      });
    }

    // Files a program produced on this account's behalf and never kept. Offered
    // as a one-click import, because "the deck I just made" is the single most
    // likely thing someone wants in their cloud.
    const kept = new Set<string>(rows.map((row) => row.storageId));
    const artifacts = await ctx.db
      .query("agentArtifacts")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(40);
    const recentRuns = [];
    for (const row of artifacts) {
      if (recentRuns.length >= 8) break;
      if (!row.storageId || row.name === "" || kept.has(row.storageId)) continue;
      kept.add(row.storageId); // One entry per file, however many runs made it.
      recentRuns.push({
        id: row._id,
        name: row.name,
        mime: row.mime,
        size: row.size,
        createdAt: row.createdAt,
      });
    }

    const folders = await ctx.db
      .query("cloudFolders")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .take(MAX_FOLDERS);

    return {
      files,
      folders,
      recentRuns,
      used,
      limit: LIMIT_BYTES,
      maxFile: MAX_FILE_BYTES,
      count: rows.length,
    };
  },
});

/**
 * One row, read by an action that holds only an id.
 *
 * Actions have no database access, and a conversion needs the blob, the name
 * and the folder. Ownership is checked here rather than in the action so there
 * is exactly one place that decides whose file a row is.
 */
export const loadFile = internalQuery({
  args: { fileId: v.id("cloudFiles"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const file = await ctx.db.get(args.fileId);
    return file && file.userId === args.userId ? file : null;
  },
});

/**
 * Is this blob still the bytes behind something the user can see?
 *
 * A conversion the author chose not to keep is deleted from storage when the
 * viewer closes. Before deleting, this asks whether any row still points at
 * it — a cloud file or a run artifact — because deleting one of those would
 * turn a listed file into a dead download.
 */
export const blobReferences = internalQuery({
  args: { storageId: v.id("_storage"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const files = await ctx.db
      .query("cloudFiles")
      .withIndex("by_user_time", (q) => q.eq("userId", args.userId))
      .take(MAX_FILES);
    if (files.some((row) => row.storageId === args.storageId)) return true;

    const artifacts = await ctx.db
      .query("agentArtifacts")
      .withIndex("by_user_time", (q) => q.eq("userId", args.userId))
      .take(40);
    return artifacts.some((row) => row.storageId === args.storageId);
  },
});

/**
 * Record a converted blob.
 *
 * A conversion costs storage exactly like an upload, so it goes through the
 * same quota checks — otherwise the file limit would be bypassable by
 * converting in a loop. A blob that breaks the quota is deleted here rather
 * than left orphaned by the failed write.
 */
export const saveConversion = internalMutation({
  args: {
    userId: v.id("users"),
    storageId: v.id("_storage"),
    name: v.string(),
    mime: v.string(),
    size: v.number(),
    folderId: v.optional(v.id("cloudFolders")),
  },
  handler: async (ctx, args) => {
    if (args.size > MAX_FILE_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new Error("The converted file is larger than the 64 MB per-file limit.");
    }
    if (args.folderId && !(await ownedFolder(ctx, args.userId, args.folderId))) {
      await ctx.storage.delete(args.storageId);
      throw new Error("That folder no longer exists.");
    }
    const used = await usedBytes(ctx, args.userId);
    if (used + args.size > LIMIT_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new Error("Not enough space in your cloud for the converted file.");
    }

    return await ctx.db.insert("cloudFiles", {
      userId: args.userId,
      name: cleanName(args.name),
      mime: args.mime || "application/octet-stream",
      size: args.size,
      storageId: args.storageId,
      source: "converted",
      folderId: args.folderId,
      createdAt: Date.now(),
    });
  },
});

/**
 * A fetchable URL for a blob that is not a cloud file.
 *
 * The viewer uploads an image so the image studio can use it as a starting
 * frame, and a generation provider has to be able to download it: a blob URL
 * is meaningless outside the tab. This returns the storage URL for that blob.
 *
 * A mutation rather than a query because it is awaited once, right after the
 * upload — a query would need a subscription for a value that cannot change.
 */
export const storageUrl = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to use your storage.");
    return await ctx.storage.getUrl(args.storageId);
  },
});

/**
 * Throw away an upload that never became anything.
 *
 * The file viewer publishes an image so the image studio can use it as a
 * starting frame, and a provider can only fetch a URL. If the studio is closed
 * without generating, that blob is pure waste, so it is deleted here. The same
 * reference check as every other discard applies: a blob a cloud file or run
 * artifact still points at is never touched.
 */
export const discardUpload = action({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, args): Promise<{ removed: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { removed: false };

    const referenced = await ctx.runQuery(internal.cloud.blobReferences, {
      storageId: args.storageId,
      userId,
    });
    if (referenced) return { removed: false };

    await ctx.storage.delete(args.storageId);
    return { removed: true };
  },
});

/** A short-lived upload URL. The bytes go straight to storage, not through us. */
export const createUpload = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to use your cloud.");

    const used = await usedBytes(ctx, userId);
    if (used >= LIMIT_BYTES) {
      throw new Error("Your cloud is full. Delete a file and try again.");
    }
    return await ctx.storage.generateUploadUrl();
  },
});

/** A folder belongs to exactly one user; anything else is treated as missing. */
async function ownedFolder(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
  folderId: Id<"cloudFolders">,
): Promise<boolean> {
  const folder = await ctx.db.get(folderId);
  return folder !== null && folder.userId === userId;
}

/** Record an uploaded blob. The blob is removed when it would break the quota. */
export const save = mutation({
  args: {
    storageId: v.id("_storage"),
    name: v.string(),
    mime: v.string(),
    size: v.number(),
    source: v.optional(
      v.union(
        v.literal("upload"),
        v.literal("run"),
        v.literal("image"),
        v.literal("music"),
      ),
    ),
    folderId: v.optional(v.id("cloudFolders")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to use your cloud.");
    if (args.folderId && !(await ownedFolder(ctx, userId, args.folderId))) {
      await ctx.storage.delete(args.storageId);
      throw new Error("That folder no longer exists.");
    }

    if (args.size > MAX_FILE_BYTES) {
      // The upload already happened, so the orphan is cleaned up here. Leaving
      // it would spend the user's storage on a file they were never shown.
      await ctx.storage.delete(args.storageId);
      throw new Error("That file is larger than the 64 MB per-file limit.");
    }
    const used = await usedBytes(ctx, userId);
    if (used + args.size > LIMIT_BYTES) {
      await ctx.storage.delete(args.storageId);
      throw new Error("Not enough space in your cloud for that file.");
    }

    return await ctx.db.insert("cloudFiles", {
      userId,
      name: cleanName(args.name),
      mime: args.mime || "application/octet-stream",
      size: args.size,
      storageId: args.storageId,
      source: args.source ?? "upload",
      folderId: args.folderId,
      createdAt: Date.now(),
    });
  },
});

/** Keep a file a run produced, by referencing the same blob — no re-upload. */
export const keepRun = mutation({
  args: {
    id: v.id("agentArtifacts"),
    folderId: v.optional(v.id("cloudFolders")),
  },
  handler: async (ctx, { id, folderId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to use your cloud.");
    if (folderId && !(await ownedFolder(ctx, userId, folderId))) {
      throw new Error("That folder no longer exists.");
    }

    const artifact = await ctx.db.get(id);
    if (!artifact || artifact.userId !== userId || !artifact.storageId) {
      throw new Error("That file is no longer available.");
    }

    const existing = await ctx.db
      .query("cloudFiles")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .take(MAX_FILES);
    if (existing.some((row) => row.storageId === artifact.storageId)) {
      return null; // Already kept; pressing twice is harmless.
    }

    const used = existing.reduce((sum, row) => sum + row.size, 0);
    if (used + artifact.size > LIMIT_BYTES) {
      throw new Error("Not enough space in your cloud for that file.");
    }

    return await ctx.db.insert("cloudFiles", {
      userId,
      name: cleanName(artifact.name),
      mime: artifact.mime || "application/octet-stream",
      size: artifact.size,
      storageId: artifact.storageId,
      source: "run",
      folderId,
      createdAt: Date.now(),
    });
  },
});

/** Delete one file: the blob first, then the row that points at it. */
export const remove = mutation({
  args: { id: v.id("cloudFiles") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to use your cloud.");

    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) throw new Error("File not found.");

    // An artifact row may point at the same blob, so the blob is only deleted
    // when nothing else references it. This keeps "delete from cloud" from
    // breaking a download link in a chat transcript.
    const artifact = await ctx.db
      .query("agentArtifacts")
      .withIndex("by_storage", (q) => q.eq("storageId", row.storageId))
      .first();
    if (!artifact) await ctx.storage.delete(row.storageId);

    await ctx.db.delete(row._id);
    return true;
  },
});

// ---------------------------------------------------------------------------
// Folders
//
// Flat and one level deep. A drive of a few hundred files needs grouping, not a
// hierarchy, and a single level keeps every read to one index scan.
// ---------------------------------------------------------------------------

export const createFolder = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to use your cloud.");

    const clean = name.trim().replace(/\s+/g, " ").slice(0, MAX_FOLDER_NAME);
    if (clean.length === 0) throw new Error("Give the folder a name.");

    const existing = await ctx.db
      .query("cloudFolders")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .take(MAX_FOLDERS);
    if (existing.length >= MAX_FOLDERS) {
      throw new Error(`You can have ${MAX_FOLDERS} folders.`);
    }
    if (existing.some((f) => f.name.toLowerCase() === clean.toLowerCase())) {
      throw new Error("A folder with that name already exists.");
    }

    return await ctx.db.insert("cloudFolders", {
      userId,
      name: clean,
      createdAt: Date.now(),
    });
  },
});

/** Move a file into a folder, or to the top level with `folderId: null`. */
export const moveFile = mutation({
  args: {
    id: v.id("cloudFiles"),
    folderId: v.union(v.id("cloudFolders"), v.null()),
  },
  handler: async (ctx, { id, folderId }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to use your cloud.");

    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) throw new Error("File not found.");
    if (folderId && !(await ownedFolder(ctx, userId, folderId))) {
      throw new Error("That folder no longer exists.");
    }

    await ctx.db.patch(row._id, { folderId: folderId ?? undefined });
    return true;
  },
});

/** Delete a folder, keeping what was in it — its files fall back to the top. */
export const deleteFolder = mutation({
  args: { id: v.id("cloudFolders") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Sign in to use your cloud.");

    const folder = await ctx.db.get(id);
    if (!folder || folder.userId !== userId) throw new Error("Folder not found.");

    const files = await ctx.db
      .query("cloudFiles")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .take(MAX_FILES);
    for (const file of files) {
      if (file.folderId === folder._id) {
        await ctx.db.patch(file._id, { folderId: undefined });
      }
    }

    await ctx.db.delete(folder._id);
    return true;
  },
});

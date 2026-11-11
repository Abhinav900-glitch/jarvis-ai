// ---------------------------------------------------------------------------
// Files that come back from a sandbox.
//
// A code engine gives you stdout. That is fine for a number and hopeless for a
// deck: python-pptx writes a 40 kB zip, and the one engine that installs it caps
// the output long before that. So the file is carried by HTTP instead — the
// program posts it to this deployment while it runs, and the agent turns the
// rows below into download links.
//
// The authorisation is deliberately simple and deliberately short-lived. A run
// mints a 24-byte random token through `issue`; the sandbox is handed that
// token along with the script, and `lookup` resolves it back to the user who
// asked. Nothing is guessable, the token dies in minutes, and it can only ever
// attach files to the run that minted it — which is the whole threat model here,
// since the code being run is untrusted by definition.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

/** How long a sandbox may take to upload after its token is minted. */
const TOKEN_TTL_MS = 20 * 60_000;

/** Caps, so one runaway program cannot fill the deployment's storage. */
const MAX_FILES_PER_TOKEN = 8;
const MAX_BYTES_PER_FILE = 12 * 1024 * 1024;
const MAX_BYTES_PER_TOKEN = 24 * 1024 * 1024;

/** A grant is a row with a token and no file yet. */
export const issue = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

    // Grants older than the TTL are dead weight; cleared here because this is
    // the only moment the table is written to on a schedule of its own.
    const stale = await ctx.db
      .query("agentArtifacts")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("asc")
      .take(20);
    const cutoff = Date.now() - TOKEN_TTL_MS;
    for (const row of stale) {
      if (row.createdAt > cutoff) continue;
      if (row.storageId) continue;
      await ctx.db.delete(row._id);
    }

    await ctx.db.insert("agentArtifacts", {
      userId,
      token,
      name: "",
      mime: "",
      size: 0,
      createdAt: Date.now(),
    });
    return token;
  },
});

/**
 * Resolve an upload token, or null when it is unknown or has expired.
 *
 * Returns the counts as well, so the HTTP endpoint can refuse an over-budget
 * token before it reads a body rather than after it has stored one.
 */
export const lookup = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const rows = await ctx.db
      .query("agentArtifacts")
      .withIndex("by_token", (q) => q.eq("token", token))
      .take(MAX_FILES_PER_TOKEN + 1);
    const grant = rows.find((row) => row.name === "");
    if (!grant) return null;
    if (grant.createdAt < Date.now() - TOKEN_TTL_MS) return null;

    const files = rows.filter((row) => row.name !== "");
    const bytes = files.reduce((sum, row) => sum + row.size, 0);
    return {
      userId: grant.userId,
      files: files.length,
      bytes,
      maxFiles: MAX_FILES_PER_TOKEN,
      maxBytes: MAX_BYTES_PER_TOKEN,
      maxFile: MAX_BYTES_PER_FILE,
    };
  },
});

/**
 * Record an uploaded file.
 *
 * False means the token was over its budget by the time the body arrived, so
 * the caller deletes the blob it just stored. The check is repeated here rather
 * than trusted from `lookup` because the two calls are not atomic and a program
 * with a loop can upload in parallel.
 */
export const attach = internalMutation({
  args: {
    token: v.string(),
    name: v.string(),
    mime: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("agentArtifacts")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .take(MAX_FILES_PER_TOKEN + 1);
    const grant = rows.find((row) => row.name === "");
    if (!grant) return false;
    if (grant.createdAt < Date.now() - TOKEN_TTL_MS) return false;

    const files = rows.filter((row) => row.name !== "");
    if (files.length >= MAX_FILES_PER_TOKEN) return false;
    if (args.size > MAX_BYTES_PER_FILE) return false;
    if (files.reduce((sum, row) => sum + row.size, 0) + args.size > MAX_BYTES_PER_TOKEN) {
      return false;
    }
    if (files.some((row) => row.name === args.name)) return false;

    await ctx.db.insert("agentArtifacts", {
      userId: grant.userId,
      token: args.token,
      name: args.name,
      mime: args.mime,
      size: args.size,
      storageId: args.storageId,
      createdAt: Date.now(),
    });
    return true;
  },
});

/** What arrived for one run, newest name first, for the links the agent shows. */
export const listForToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const rows = await ctx.db
      .query("agentArtifacts")
      .withIndex("by_token", (q) => q.eq("token", token))
      .take(MAX_FILES_PER_TOKEN + 1);
    return rows
      .filter((row) => row.name !== "" && row.storageId !== undefined)
      .map((row) => ({
        name: row.name,
        mime: row.mime,
        size: row.size,
        storageId: row.storageId as NonNullable<typeof row.storageId>,
      }));
  },
});

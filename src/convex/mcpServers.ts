// ---------------------------------------------------------------------------
// Per-user MCP server registry.
//
// A user can store many MCP servers and the assistant reaches them on the
// user's behalf. Each row holds the endpoint and how to authenticate so the
// model can call the server's tools without the user pasting keys into a
// prompt.
//
// Tokens live here (not the Keys tab) because these are *per-user* connections
// the user authors through the settings UI — like the Canva OAuth connection
// the app already stores — rather than deployment-wide keys. Open MCP
// endpoints need no token: an empty auth row means "no auth header" for that
// server.
//
// Auth is modelled as a tagged union of three literal kinds, plus a single
// scalar value field so the variant never has to carry a nested object:
//   - "none"      → no auth header
//   - "bearer"    → Authorization: Bearer <authValue>
//   - "header"    → <authHeaderName>: <authValue>
// ---------------------------------------------------------------------------

import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { McpClient } from "../lib/mcp";

export type McpAuthType = "none" | "bearer" | "header";

/** One MCP server as returned to the client (userId is never exposed). */
export interface McpServerRow {
  _id: Id<"mcpServers">;
  name: string;
  url: string;
  prefix: string | null;
  authType: McpAuthType | null;
  authValue: string | null;
  authHeaderName: string | null;
  createdAt: number;
  updatedAt: number;
  lastTestedAt: number | null;
  toolCount: number | null;
  lastError: string | null;
}

// ---------------------------------------------------------------------------
// Internal helpers — read/write the three-field auth shape.
// ---------------------------------------------------------------------------

function authTypeOf(
  row: { authType?: "none" | "bearer" | "header" | undefined },
): McpAuthType | null {
  const a = row.authType;
  if (!a) return null;
  return a;
}

function authHeaderFor(row: {
  authType?: "none" | "bearer" | "header" | undefined;
  authValue?: string | null | undefined;
  authHeaderName?: string | null | undefined;
}): { name: string; value: string } | null {
  const a = row.authType;
  const token = row.authValue;
  if (!a || !token) return null;
  if (a === "none") return null;
  if (a === "bearer") return { name: "Authorization", value: `Bearer ${token}` };
  if (a === "header") {
    const h = row.authHeaderName ?? "Authorization";
    return { name: h, value: token };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Public CRUD
// ---------------------------------------------------------------------------

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    const rows = await ctx.db
      .query("mcpServers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map(toRow);
  },
});

/** Internal read used by the test action (which can't touch the database). */
export const getServer = internalQuery({
  args: { serverId: v.id("mcpServers") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.serverId);
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    url: v.string(),
    prefix: v.optional(v.string()),
    authType: v.optional(
      v.union(v.literal("none"), v.literal("bearer"), v.literal("header")),
    ),
    authValue: v.optional(v.string()),
    authHeaderName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Signed in only.");
    if (!args.name.trim()) throw new Error("Name is required.");
    const url = args.url.trim();
    if (!url) throw new Error("Server URL is required.");
    {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("Server URL must be an https:// or http:// address.");
      }
    }

    // Deduplicate by (url, auth) so re-adding the same server is a no-op.
    const existing = await ctx.db
      .query("mcpServers")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const keyOf = (r: (typeof existing)[number]) =>
      `${r.url}|${authTypeOf(r)}|${r.authValue ?? ""}`;
    const targetKey = `${url}|${
      args.authType ?? "none"
    }|${args.authValue ?? ""}`;
    const dup = existing.find((r) => keyOf(r) === targetKey);
    if (dup) return { _id: dup._id, created: false };

    const now = Date.now();
    const rowId = await ctx.db.insert("mcpServers", {
      userId,
      name: args.name.trim(),
      url,
      prefix: args.prefix?.trim() ?? undefined,
      authType: args.authType ?? "none",
      authValue: args.authValue ?? undefined,
      authHeaderName:
        args.authType === "header" && args.authHeaderName?.trim()
          ? args.authHeaderName.trim()
          : undefined,
      createdAt: now,
      updatedAt: now,
    });
    return { _id: rowId, created: true };
  },
});

export const update = mutation({
  args: {
    serverId: v.id("mcpServers"),
    name: v.optional(v.string()),
    url: v.optional(v.string()),
    prefix: v.optional(v.optional(v.string())),
    authType: v.optional(
      v.union(v.literal("none"), v.literal("bearer"), v.literal("header")),
    ),
    authValue: v.optional(v.string()),
    authHeaderName: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Signed in only.");
    const row = await ctx.db.get(args.serverId);
    if (!row) throw new Error("Server not found.");
    if (row.userId !== userId) throw new Error("Not your server.");

    const url = args.url?.trim();
    if (url !== undefined && url) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new Error("Server URL must be an https:// or http:// address.");
      }
    }

    await ctx.db.patch(
      "mcpServers",
      args.serverId,
      {
        ...(args.name !== undefined && args.name.trim() ? { name: args.name.trim() } : {}),
        ...(url !== undefined && url ? { url } : {}),
        ...(args.prefix !== undefined ? { prefix: args.prefix?.trim() ?? undefined } : {}),
        ...(args.authType !== undefined ? { authType: args.authType } : {}),
        ...(args.authValue !== undefined ? { authValue: args.authValue ?? undefined } : {}),
        ...(args.authHeaderName !== undefined
          ? {
              authHeaderName:
                args.authType === "header" && args.authHeaderName?.trim()
                  ? args.authHeaderName.trim()
                  : undefined,
            }
          : {}),
        updatedAt: Date.now(),
      },
    );
    const doc = await ctx.db.get(args.serverId);
    if (!doc) throw new Error("Server vanished during update.");
    return toRow(doc);
  },
});

export const remove = mutation({
  args: { serverId: v.id("mcpServers") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Signed in only.");
    const row = await ctx.db.get(args.serverId);
    if (!row) throw new Error("Server not found.");
    if (row.userId !== userId) throw new Error("Not your server.");
    await ctx.db.delete(args.serverId);
    return { removed: true };
  },
});

// ---------------------------------------------------------------------------
// Test a connection: reach the server, list its tools, persist the result.
// ---------------------------------------------------------------------------

export const testConnection = action({
  args: {
    serverId: v.id("mcpServers"),
    timeoutMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Signed in only.");
    const row = await ctx.runQuery(internal.mcpServers.getServer, {
      serverId: args.serverId,
    });
    if (!row || row.userId !== userId) {
      throw new Error(row ? "Not your server." : "Server not found.");
    }
    // Narrow row to the auth-header shape (db docs carry _creationTime etc.
    // that authHeaderFor does not ask for, so cast through the params type).
    const authRow = row as Parameters<typeof authHeaderFor>[0];
    const authHeader = authHeaderFor(authRow);

    const result = { toolCount: null as number | null, lastError: null as string | null };
    try {
      const headers: Record<string, string> = {};
      if (authHeader) headers[authHeader.name] = authHeader.value;
      const client: McpClient = new McpClient(row.url, headers);
      try {
        const tools = await client.listTools();
        result.toolCount = tools.length;
      } finally {
        await client.close().catch(() => {});
      }
    } catch (err) {
      result.lastError =
        err instanceof Error ? err.message : "The server did not respond.";
      if (result.lastError.length > 500)
        result.lastError = result.lastError.slice(0, 500);
    }

    await ctx.runMutation(internal.mcpServers.setTestResult, {
      serverId: args.serverId,
      toolCount: result.toolCount ?? undefined,
      lastError: result.lastError ?? undefined,
    });

    return {
      toolCount: result.toolCount as number | null,
      lastError: result.lastError as string | null,
      testedAt: Date.now(),
      ok: result.lastError === null,
    };
  },
});

// ---------------------------------------------------------------------------
// Internal mutation: persist the result of a connection test.
// ---------------------------------------------------------------------------

export const setTestResult = internalMutation({
  args: {
    serverId: v.id("mcpServers"),
    toolCount: v.optional(v.number()),
    lastError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.serverId);
    if (!row) return;
    await ctx.db.patch(
      "mcpServers",
      args.serverId,
      {
        lastTestedAt: Date.now(),
        ...(args.toolCount !== undefined ? { toolCount: args.toolCount } : {}),
        ...(args.lastError !== undefined ? { lastError: args.lastError } : {}),
        updatedAt: Date.now(),
      },
    );
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toRow(row: {
  _id: Id<"mcpServers">;
  name: string;
  url: string;
  prefix?: string | null | undefined;
  authType?: "none" | "bearer" | "header" | undefined;
  authValue?: string | null | undefined;
  authHeaderName?: string | null | undefined;
  createdAt: number;
  updatedAt: number;
  lastTestedAt?: number | null | undefined;
  toolCount?: number | null | undefined;
  lastError?: string | null | undefined;
}): McpServerRow {
  return {
    _id: row._id,
    name: row.name,
    url: row.url,
    prefix: row.prefix ?? null,
    authType: authTypeOf(row),
    authValue: row.authValue ?? null,
    authHeaderName: row.authHeaderName ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastTestedAt: row.lastTestedAt ?? null,
    toolCount: row.toolCount ?? null,
    lastError: row.lastError ?? null,
  };
}

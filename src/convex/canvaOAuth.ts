import { v } from "convex/values";
import { internalMutation, internalQuery, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ---------------------------------------------------------------------------
// Canva OAuth 2.0 (authorization code + PKCE) — database state
// (Actions that call the network live in canva.ts — "use node".)
// ---------------------------------------------------------------------------

/** Full stored auth row (internal — contains secrets). */
export const getStoredAuth = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("canvaAuth")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
  },
});

/** Sanitized status for the client — never returns a token. */
export const getStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return { signedIn: false, configured: false, connected: false as const };
    }
    const clientId = process.env.CANVA_CLIENT_ID;
    const clientSecret = process.env.CANVA_CLIENT_SECRET;
    const configured = Boolean(clientId && clientSecret);

    const row = await ctx.db
      .query("canvaAuth")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();

    return {
      signedIn: true,
      configured,
      connected: Boolean(row?.accessToken) as boolean,
      scope: row?.scope,
      connectedAt: row?.connectedAt,
    };
  },
});

/** Store the CSRF state and PKCE verifier while the user is on Canva's consent page. */
export const setPendingState = internalMutation({
  args: {
    userId: v.id("users"),
    state: v.string(),
    codeVerifier: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("canvaAuth")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (row) {
      await ctx.db.patch(row._id, {
        pendingState: args.state,
        pendingCodeVerifier: args.codeVerifier,
        redirectUri: args.redirectUri,
      });
    } else {
      await ctx.db.insert("canvaAuth", {
        userId: args.userId,
        pendingState: args.state,
        pendingCodeVerifier: args.codeVerifier,
        redirectUri: args.redirectUri,
      });
    }
  },
});

/** Persist tokens returned by the token endpoint. */
export const saveTokens = internalMutation({
  args: {
    userId: v.id("users"),
    accessToken: v.string(),
    refreshToken: v.optional(v.string()),
    expiresIn: v.optional(v.number()),
    scope: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const expiresAt = args.expiresIn ? now + args.expiresIn * 1000 : undefined;
    const row = await ctx.db
      .query("canvaAuth")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (row) {
      await ctx.db.patch(row._id, {
        accessToken: args.accessToken,
        // Keep the old refresh token if the response didn't include one.
        refreshToken: args.refreshToken ?? row.refreshToken,
        expiresAt,
        scope: args.scope ?? row.scope,
        // The verifier is single-use and must not survive the exchange.
        pendingState: undefined,
        pendingCodeVerifier: undefined,
        connectedAt: now,
      });
    } else {
      await ctx.db.insert("canvaAuth", {
        userId: args.userId,
        accessToken: args.accessToken,
        refreshToken: args.refreshToken,
        expiresAt,
        scope: args.scope,
        connectedAt: now,
      });
    }
  },
});

/**
 * Refresh only the access token, leaving `pendingState` alone. Canva's
 * refresh tokens are reusable, so a background refresh must not discard the
 * state of a connect flow that is mid-flight.
 */
export const saveRefreshedToken = internalMutation({
  args: {
    userId: v.id("users"),
    accessToken: v.string(),
    expiresIn: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("canvaAuth")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (!row) return;
    await ctx.db.patch(row._id, {
      accessToken: args.accessToken,
      expiresAt: args.expiresIn
        ? Date.now() + args.expiresIn * 1000
        : undefined,
    });
  },
});

/** Remove tokens after a failed refresh (invalid_grant). */
export const clearTokens = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("canvaAuth")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (row) {
      await ctx.db.patch(row._id, {
        accessToken: undefined,
        refreshToken: undefined,
        expiresAt: undefined,
        pendingState: undefined,
        pendingCodeVerifier: undefined,
      });
    }
  },
});

/** User-initiated disconnect. */
export const disconnect = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("canvaAuth")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (row) await ctx.db.delete(row._id);
  },
});

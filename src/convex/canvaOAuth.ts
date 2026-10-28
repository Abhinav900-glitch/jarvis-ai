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

/**
 * How long a connect window stays usable — longer than anyone takes at a
 * consent screen, short enough that a forgotten window stops being able to
 * hand back a code.
 */
const FLOW_TTL_MS = 30 * 60_000;
/** How many connect windows may be in flight at once. */
const FLOW_MAX = 5;

/**
 * Store the CSRF state and PKCE verifier while the user is on Canva's
 * consent page.
 *
 * Appended rather than overwritten: a second click starts a second window,
 * and the one the user actually approves may be either of them. Replacing the
 * previous entry is what made an otherwise successful authorization fail with
 * "window is out of date".
 */
export const setPendingState = internalMutation({
  args: {
    userId: v.id("users"),
    state: v.string(),
    codeVerifier: v.string(),
    redirectUri: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const row = await ctx.db
      .query("canvaAuth")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();

    const kept = (row?.pendingFlows ?? [])
      .filter((flow) => now - flow.createdAt <= FLOW_TTL_MS)
      .slice(-(FLOW_MAX - 1));
    const pendingFlows = [
      ...kept,
      {
        state: args.state,
        codeVerifier: args.codeVerifier,
        redirectUri: args.redirectUri,
        createdAt: now,
      },
    ];

    if (row) {
      await ctx.db.patch(row._id, {
        pendingFlows,
        redirectUri: args.redirectUri,
      });
    } else {
      await ctx.db.insert("canvaAuth", {
        userId: args.userId,
        pendingFlows,
        redirectUri: args.redirectUri,
      });
    }
  },
});

/**
 * The stored verifier for the state Canva sent back, or why there isn't one.
 *
 * `found` is false only when this account has no connection row at all — a
 * different problem (wrong browser/user) from `matched: false`, which means
 * the window was superseded. The distinction drives two different error
 * messages, and conflating them would send the user to close tabs they never
 * opened.
 */
export const getPendingFlow = internalQuery({
  args: { userId: v.id("users"), state: v.string() },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("canvaAuth")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (!row) {
      return { found: false as const, matched: false, codeVerifier: null, redirectUri: null };
    }

    const flow =
      (row.pendingFlows ?? []).find((f) => f.state === args.state) ??
      // A flow started before pendingFlows existed stored exactly one state.
      (row.pendingState === args.state
        ? {
            codeVerifier: row.pendingCodeVerifier ?? null,
            redirectUri: row.redirectUri,
          }
        : undefined);

    return {
      found: true as const,
      matched: flow !== undefined,
      codeVerifier: flow?.codeVerifier ?? null,
      redirectUri: flow?.redirectUri ?? null,
    };
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
        // The verifier is single-use and must not survive the exchange —
        // and every other window still in flight is now moot too.
        pendingState: undefined,
        pendingCodeVerifier: undefined,
        pendingFlows: undefined,
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
        pendingFlows: undefined,
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

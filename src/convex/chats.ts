import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";

/**
 * One uploaded file or image on a message. `text` carries extracted content for
 * documents the model should read rather than just see.
 */
const attachmentValidator = v.array(
  v.object({
    url: v.string(),
    name: v.string(),
    type: v.optional(v.string()),
    size: v.optional(v.number()),
    text: v.optional(v.string()),
  }),
);

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const listSessions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("chatSessions")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
  },
});

export const createSession = mutation({
  args: {
    title: v.optional(v.string()),
    projectId: v.optional(v.id("projects")),
    personaId: v.optional(v.id("personas")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to start a chat.");

    const now = Date.now();
    const sessionId = await ctx.db.insert("chatSessions", {
      userId,
      title: args.title ?? "New chat",
      projectId: args.projectId,
      personaId: args.personaId,
      createdAt: now,
      updatedAt: now,
    });
    return sessionId;
  },
});

export const renameSession = mutation({
  args: { sessionId: v.id("chatSessions"), title: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Chat not found.");
    }

    await ctx.db.patch(args.sessionId, { title: args.title });
  },
});

/**
 * Pins (or unpins) a persona to one chat, overriding the user's default for
 * every reply in it. Null clears the pin and the chat falls back to whatever
 * is active globally.
 */
export const setSessionPersona = mutation({
  args: {
    sessionId: v.id("chatSessions"),
    personaId: v.union(v.id("personas"), v.null()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) throw new Error("Chat not found.");

    if (args.personaId) {
      const persona = await ctx.db.get(args.personaId);
      if (!persona || persona.userId !== userId) {
        throw new Error("That persona no longer exists.");
      }
    }

    await ctx.db.patch(args.sessionId, { personaId: args.personaId ?? undefined });
  },
});

export const deleteSession = mutation({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Chat not found.");
    }

    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    for (const m of messages) {
      await ctx.db.delete(m._id);
    }
    await ctx.db.delete(args.sessionId);
  },
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const listMessages = query({
  args: {
    sessionId: v.id("chatSessions"),
    /**
     * Which line of the conversation to show. Omitted (or null) is the main
     * line, which is every chat written before branching existed.
     */
    branchId: v.optional(v.union(v.id("chatBranches"), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) return [];

    const all = await ctx.db
      .query("chatMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const branchId = args.branchId ?? null;
    return all
      .filter((m) => (m.branchId ?? null) === branchId)
      .sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const appendMessage = mutation({
  args: {
    sessionId: v.id("chatSessions"),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
    ),
    content: v.string(),
    model: v.optional(v.string()),
    usedFallback: v.optional(v.boolean()),
    usedSearch: v.optional(v.boolean()),
    sources: v.optional(
      v.array(
        v.object({ title: v.string(), url: v.string(), domain: v.optional(v.string()) }),
      ),
    ),
    imageUrl: v.optional(v.string()),
    imagePublicId: v.optional(v.string()),
    images: v.optional(
      v.array(
        v.object({
          url: v.string(),
          publicId: v.optional(v.string()),
        }),
      ),
    ),
    fileUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    attachments: v.optional(attachmentValidator),
    branchId: v.optional(v.union(v.id("chatBranches"), v.null())),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Chat not found.");
    }

    const messageId = await ctx.db.insert("chatMessages", {
      sessionId: args.sessionId,
      userId,
      branchId: args.branchId ?? undefined,
      role: args.role,
      content: args.content,
      model: args.model,
      usedFallback: args.usedFallback,
      usedSearch: args.usedSearch,
      sources: args.sources,
      imageUrl: args.imageUrl,
      imagePublicId: args.imagePublicId,
      images: args.images,
      fileUrl: args.fileUrl,
      fileName: args.fileName,
      fileType: args.fileType,
      fileSize: args.fileSize,
      attachments: args.attachments,
      createdAt: Date.now(),
    });

    await ctx.db.patch(args.sessionId, { updatedAt: Date.now() });
    return messageId;
  },
});

// Convenience: create session + first user message in one mutation.
export const startWithMessage = mutation({
  args: {
    content: v.string(),
    imageUrl: v.optional(v.string()),
    imagePublicId: v.optional(v.string()),
    images: v.optional(
      v.array(
        v.object({
          url: v.string(),
          publicId: v.optional(v.string()),
        }),
      ),
    ),
    fileUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
    attachments: v.optional(attachmentValidator),
    projectId: v.optional(v.id("projects")),
    personaId: v.optional(v.id("personas")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to start a chat.");

    const now = Date.now();
    const title =
      args.content.length > 60
        ? `${args.content.slice(0, 60).trimEnd()}…`
        : args.content;

    const sessionId = await ctx.db.insert("chatSessions", {
      userId,
      title,
      projectId: args.projectId,
      personaId: args.personaId,
      createdAt: now,
      updatedAt: now,
    });

    const messageId = await ctx.db.insert("chatMessages", {
      sessionId,
      userId,
      role: "user",
      content: args.content,
      imageUrl: args.imageUrl,
      imagePublicId: args.imagePublicId,
      images: args.images,
      fileUrl: args.fileUrl,
      fileName: args.fileName,
      fileType: args.fileType,
      fileSize: args.fileSize,
      attachments: args.attachments,
      createdAt: now,
    });

    return { sessionId, messageId };
  },
});

// ---------------------------------------------------------------------------
// Edit / delete messages
// ---------------------------------------------------------------------------// Editing a message forks the conversation instead of rewriting it (see
// `branches.forkBranch`), so there is deliberately no destructive
// `editMessage` here: an edit can never destroy answers the user has read.

export const deleteMessage = mutation({
  args: { messageId: v.id("chatMessages") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const msg = await ctx.db.get(args.messageId);
    if (!msg || msg.userId !== userId) throw new Error("Message not found.");

    await ctx.db.delete(args.messageId);
  },
});

/**
 * Delete a message and everything that came after it on the same branch.
 *
 * Removing a single message would leave the conversation incoherent: deleting
 * the question leaves its answer answering nothing, and deleting a reply out
 * from under a follow-up leaves that follow-up orphaned. Taking the tail is
 * what every other assistant does, and it is what makes "delete" mean
 * something a user can predict.
 *
 * Only the given branch is touched. A fork created earlier is a separate
 * branch with its own history and is left alone — deleting here must not
 * silently reach into a path the user is not looking at.
 *
 * Returns the number of messages removed so the UI can say what happened.
 */
export const deleteMessageAndTail = mutation({
  args: { messageId: v.id("chatMessages") },
  handler: async (ctx, args): Promise<{ deleted: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const target = await ctx.db.get(args.messageId);
    if (!target || target.userId !== userId) {
      throw new Error("Message not found.");
    }

    const siblings = await ctx.db
      .query("chatMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", target.sessionId))
      .collect();

    // Same branch: an absent branchId is the main line, so compare both.
    const sameBranch = siblings
      .filter((m) => (m.branchId ?? null) === (target.branchId ?? null))
      .sort((a, b) => a._creationTime - b._creationTime);

    const index = sameBranch.findIndex((m) => m._id === target._id);
    if (index === -1) return { deleted: 0 };

    const doomed = sameBranch.slice(index);
    for (const m of doomed) await ctx.db.delete(m._id);
    return { deleted: doomed.length };
  },
});

// ---------------------------------------------------------------------------
// Search sessions and messages
// ---------------------------------------------------------------------------

export const searchSessions = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const q = args.query.toLowerCase().trim();
    if (!q) return [];

    // Search session titles
    const sessions = await ctx.db
      .query("chatSessions")
      .withIndex("by_user", (qb) => qb.eq("userId", userId))
      .collect();

    const matchedSessions = sessions
      .filter((s) => s.title.toLowerCase().includes(q))
      .slice(0, 10)
      .map((s) => ({ type: "session" as const, id: s._id, title: s.title, updatedAt: s.updatedAt }));

    // Search message content
    const allMessages: { type: "message"; sessionId: Id<"chatSessions">; content: string; role: string; createdAt: number }[] = [];
    for (const session of sessions) {
      const msgs = await ctx.db
        .query("chatMessages")
        .withIndex("by_session", (qb) => qb.eq("sessionId", session._id))
        .collect();
      for (const m of msgs) {
        if (m.content.toLowerCase().includes(q)) {
          allMessages.push({
            type: "message",
            sessionId: session._id,
            content: m.content.slice(0, 200),
            role: m.role,
            createdAt: m.createdAt,
          });
        }
      }
    }

    const matchedMessages = allMessages
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10);

    return { sessions: matchedSessions, messages: matchedMessages };
  },
});

// ---------------------------------------------------------------------------
// Prompt library — save / list / use / delete reusable prompts
// ---------------------------------------------------------------------------

export const listPrompts = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("prompts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
  },
});

export const savePrompt = mutation({
  args: { title: v.string(), content: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to save prompts.");

    const title = args.title.trim() || args.content.trim().slice(0, 40);
    await ctx.db.insert("prompts", {
      userId,
      title: title.slice(0, 80),
      content: args.content.trim().slice(0, 4000),
      createdAt: Date.now(),
    });
  },
});

export const deletePrompt = mutation({
  args: { promptId: v.id("prompts") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const prompt = await ctx.db.get(args.promptId);
    if (!prompt || prompt.userId !== userId) throw new Error("Prompt not found.");

    await ctx.db.delete(args.promptId);
  },
});

// ---------------------------------------------------------------------------
// RAG embedding storage (internal — called from rag.ts actions)
// ---------------------------------------------------------------------------

/** Hydrate one embedding document (vectorSearch returns ids only). */
export const getEmbedding = internalQuery({
  args: { id: v.id("messageEmbeddings") },
  handler: async (ctx, args) => {
    return (await ctx.db.get(args.id)) ?? null;
  },
});

export const insertEmbedding = internalMutation({
  args: {
    userId: v.id("users"),
    sessionId: v.id("chatSessions"),
    messageId: v.id("chatMessages"),
    role: v.string(),
    content: v.string(),
    vector: v.array(v.float64()),
  },
  handler: async (ctx, args) => {
    // One embedding per message — skip if already indexed
    const existing = await ctx.db
      .query("messageEmbeddings")
      .withIndex("by_user_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(50);
    if (existing.some((e) => e.messageId === args.messageId)) return;

    await ctx.db.insert("messageEmbeddings", {
      userId: args.userId,
      sessionId: args.sessionId,
      messageId: args.messageId,
      role: args.role,
      content: args.content,
      vector: args.vector,
      createdAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Streaming — grow an assistant message in place as tokens arrive
// ---------------------------------------------------------------------------

/**
 * Appends a delta to an assistant message that was created empty by the
 * streaming action. Called many times per reply, so it stays a single
 * `db.patch` with no reads.
 */
export const appendStreamDelta = internalMutation({
  args: {
    messageId: v.id("chatMessages"),
    delta: v.string(),
  },
  /** Reports whether the user has asked to stop, so the loop can break. */
  handler: async (ctx, args): Promise<{ cancelled: boolean }> => {
    const row = await ctx.db.get(args.messageId);
    if (!row) return { cancelled: true };
    if (row.cancelRequested) return { cancelled: true };

    if (args.delta) {
      await ctx.db.patch(args.messageId, {
        content: row.content + args.delta,
      });
    }
    return { cancelled: false };
  },
});

/**
 * Ask an in-flight streamed reply to stop.
 *
 * A Convex action cannot be cancelled from the browser, so the flag is the
 * cancellation channel. The streaming loop already writes a delta roughly
 * eleven times a second, and reading the flag on that same write is what makes
 * stopping free — there is no polling loop and no extra round trip to add one.
 *
 * The partial text is kept rather than discarded: half an answer the user was
 * shown before changing their mind is still worth having, and it is marked
 * truncated so the UI never claims it finished.
 */
export const requestStop = mutation({
  args: { messageId: v.id("chatMessages") },
  handler: async (ctx, args): Promise<void> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return;

    const row = await ctx.db.get(args.messageId);
    if (!row || row.userId !== userId) return;
    await ctx.db.patch(args.messageId, { cancelRequested: true });
  },
});

/**
 * Stamps the final metadata (model / fallback / search) onto a streamed
 * message once generation finishes. Also guarantees a non-empty body so the
 * transcript never shows a blank assistant turn.
 */
export const finalizeStream = internalMutation({
  args: {
    messageId: v.id("chatMessages"),
    content: v.optional(v.string()),
    model: v.optional(v.string()),
    usedFallback: v.optional(v.boolean()),
    usedSearch: v.optional(v.boolean()),
    truncated: v.optional(v.boolean()),
    sources: v.optional(
      v.array(
        v.object({ title: v.string(), url: v.string(), domain: v.optional(v.string()) }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.messageId);
    if (!row) return;
    await ctx.db.patch(args.messageId, {
      content: args.content ?? row.content,
      model: args.model,
      usedFallback: args.usedFallback,
      usedSearch: args.usedSearch,
      sources: args.sources,
      truncated: args.truncated,
      // Clear the flag so the same message can be continued later without the
      // next attempt stopping immediately.
      cancelRequested: false,
    });
  },
});

/**
 * Rewrites an assistant message's body. Used after a streamed reply arrives:
 * the SUGGEST trailer is stripped from the saved text, so the raw line can
 * never render as literal content in the transcript.
 */
export const patchMessageContent = mutation({
  args: {
    messageId: v.id("chatMessages"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    const row = await ctx.db.get(args.messageId);
    if (!row || row.userId !== userId) throw new Error("Message not found.");
    await ctx.db.patch(args.messageId, { content: args.content });
  },
});

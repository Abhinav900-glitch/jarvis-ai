import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";
import { isCiphertext } from "../lib/e2e";

/**
 * The invariant this whole feature rests on.
 *
 * Anything a user *typed* must arrive already encrypted — the server has no
 * key and never will. Checking the shape rather than the bytes keeps this
 * cheap enough to run on every write, and means a client bug degrades into a
 * visible error instead of a quietly stored secret.
 */
function assertEncrypted(value: string, what: string): void {
  if (!isCiphertext(value)) {
    throw new Error(
      `${what} must be encrypted before it is sent. Re-enter your passphrase and try again.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Encryption key material
// ---------------------------------------------------------------------------

/**
 * The salt and verifier for the signed-in user, or null on first use.
 *
 * Neither value is secret and neither can decrypt anything — the point of
 * returning them together is that the client can both derive the key and
 * prove it derived the right one, in the same breath.
 */
export const keyMaterial = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const row = await ctx.db
      .query("e2eKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (!row) return null;
    return { salt: row.salt, verifier: row.verifier };
  },
});

/**
 * Record passphrase material for a user who has none yet.
 *
 * Refusing to overwrite is deliberate: an existing row guards messages that
 * are already ciphertext, and swapping the salt underneath them would make
 * every one of them permanently unreadable.
 */
export const createKeyMaterial = mutation({
  args: { salt: v.string(), verifier: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");

    const existing = await ctx.db
      .query("e2eKeys")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      throw new Error("A passphrase is already set for this account.");
    }
    if (!isCiphertext(args.verifier)) {
      throw new Error("Verifier must be a value the passphrase produced.");
    }

    await ctx.db.insert("e2eKeys", {
      userId,
      salt: args.salt,
      verifier: args.verifier,
      createdAt: Date.now(),
    });
    return true;
  },
});

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
      // Trashed chats are returned on purpose: the sidebar's Trash section
      // reads the same list. Consumers split the rows by `deletedAt` — and
      // anything that jumps to a chat (search) filters them out instead.
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

    // Titles are derived from what the user typed, so they carry the same
    // obligation as the message they came from.
    assertEncrypted(args.title, "A chat title");
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
});export const deleteSession = mutation({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Chat not found.");
    }
    // Soft delete — the chat moves to the Trash with everything intact.
    // The hard delete lives in `purgeSession`, behind its own confirm.
    await ctx.db.patch(args.sessionId, { deletedAt: Date.now() });
  },
});

/** Take a chat back out of the trash. */
export const restoreSession = mutation({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Chat not found.");
    }
    await ctx.db.patch(args.sessionId, { deletedAt: undefined });
  },
});

/**
 * Delete a chat forever — messages, branches, then the session itself.
 *
 * This is the only destructive path left in the app: `deleteSession` merely
 * stamps `deletedAt`, so this runs only from the Trash's explicit
 * "Delete forever".
 */
export const purgeSession = mutation({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Chat not found.");
    }

    const branches = await ctx.db
      .query("chatBranches")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    for (const b of branches) await ctx.db.delete(b._id);

    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    for (const m of messages) await ctx.db.delete(m._id);

    await ctx.db.delete(args.sessionId);
  },
});

/**
 * Empty a conversation without touching the chat itself.
 *
 * Deleting row by row — rather than the session — keeps the title, project,
 * persona and pin, so “start over in this chat” does not cost the
 * organisation the user built around it.
 */
export const clearMessages = mutation({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Chat not found.");
    }

    const branches = await ctx.db
      .query("chatBranches")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    for (const b of branches) await ctx.db.delete(b._id);

    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    for (const m of messages) await ctx.db.delete(m._id);

    await ctx.db.patch(args.sessionId, { updatedAt: Date.now() });
  },
});

/**
 * Pin (or unpin) a chat so it sorts to the top of its section.
 *
 * The field has been on the row since the schema was written; this is the
 * mutation that finally uses it. Pinning is per-user ordering only — it never
 * touches the project a chat lives in.
 */
export const setSessionPinned = mutation({
  args: { sessionId: v.id("chatSessions"), pinned: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Chat not found.");
    }
    await ctx.db.patch(args.sessionId, { pinned: args.pinned });
  },
});

/**
 * Archive (or restore) a chat.
 *
 * Archiving is not deleting: every message stays exactly where it is, but the
 * chat leaves the project groups and search results until it is restored.
 * Passing `archived: false` clears the field entirely rather than setting a
 * timestamp of zero, so "live" stays one absence rather than a magic value.
 */
export const setSessionArchived = mutation({
  args: { sessionId: v.id("chatSessions"), archived: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Chat not found.");
    }
    await ctx.db.patch(args.sessionId, {
      archivedAt: args.archived ? Date.now() : undefined,
    });
  },
});

/**
 * Record the user's verdict on a reply. Null clears it, so the button acts as
 * a toggle — clicking a rating twice is changing your mind, not stacking two.
 */
export const setMessageFeedback = mutation({
  args: {
    messageId: v.id("chatMessages"),
    value: v.union(v.literal("up"), v.literal("down"), v.null()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const row = await ctx.db.get(args.messageId);
    if (!row || row.userId !== userId) throw new Error("Message not found.");
    await ctx.db.patch(args.messageId, {
      feedback: args.value === null ? undefined : args.value,
    });
  },
});

/**
 * Copy a chat — session, branches and every message — into a new one.
 *
 * Rows are copied verbatim, ciphertext included: the encryption key belongs
 * to the user rather than to a session, so the copy decrypts in place and this
 * handler never sees (or needs) plaintext. Ids are remapped in two passes,
 * because `altMessageId` and `forkedAtMessageId` can only be resolved once
 * every copy has an id of its own. The Stop flag is dropped rather than
 * copied, so a duplicated chat cannot start out already cancelled.
 *
 * Returns the new session id so the sidebar can open it immediately.
 */
export const duplicateSession = mutation({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, args): Promise<Id<"chatSessions">> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Chat not found.");
    }

    const now = Date.now();
    // The title is ciphertext, so it is copied as-is — a server cannot mint a
    // fresh name it has no key to encrypt. The copy announces itself by
    // sorting to the top on `updatedAt` instead.
    const newSessionId = await ctx.db.insert("chatSessions", {
      userId,
      title: session.title,
      projectId: session.projectId,
      personaId: session.personaId,
      createdAt: now,
      updatedAt: now,
    });

    const branches = await ctx.db
      .query("chatBranches")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    const branchMap = new Map<string, Id<"chatBranches">>();
    for (const branch of branches) {
      const { _id, _creationTime, sessionId: _old, forkedAtMessageId, ...rest } = branch;
      const id = await ctx.db.insert("chatBranches", {
        ...rest,
        sessionId: newSessionId,
      });
      branchMap.set(_id, id);
    }

    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", session._id))
      .collect();
    const messageMap = new Map<string, Id<"chatMessages">>();
    for (const message of messages) {
      const { _id, _creationTime, sessionId: _old, branchId, altMessageId, altBranchId, cancelRequested, ...rest } = message;
      const id = await ctx.db.insert("chatMessages", {
        ...rest,
        sessionId: newSessionId,
        branchId: branchId ? branchMap.get(branchId) : undefined,
      });
      messageMap.set(_id, id);
    }

    // Second pass: the pointers that name another row of the same copy.
    for (const message of messages) {
      const copy = messageMap.get(message._id);
      if (!copy) continue;
      const altMessageId = message.altMessageId
        ? messageMap.get(message.altMessageId)
        : undefined;
      const altBranchId = message.altBranchId
        ? branchMap.get(message.altBranchId)
        : undefined;
      if (message.altMessageId || message.altBranchId) {
        await ctx.db.patch(copy, { altMessageId, altBranchId });
      }
    }
    for (const branch of branches) {
      const copy = branchMap.get(branch._id);
      const forked = branch.forkedAtMessageId
        ? messageMap.get(branch.forkedAtMessageId)
        : undefined;
      if (copy && forked) {
        await ctx.db.patch(copy, { forkedAtMessageId: forked });
      }
    }

    return newSessionId;
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
    engineId: v.optional(v.string()),
    decisionReason: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
    isDecisionBranch: v.optional(v.boolean()),
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

    // The model's replies are stored in the clear — they were never secret —
    // but a user turn never is.
    if (args.role === "user") assertEncrypted(args.content, "A message you typed");

    const messageId = await ctx.db.insert("chatMessages", {
      sessionId: args.sessionId,
      userId,
      branchId: args.branchId ?? undefined,
      role: args.role,
      content: args.content,
      model: args.model,
      engineId: args.engineId,
      decisionReason: args.decisionReason,
      latencyMs: args.latencyMs,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      isDecisionBranch: args.isDecisionBranch,
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
    /**
     * The first line of the chat, encrypted from the same plaintext the
     * client just sent. Optional only so that a caller with no key can still
     * start a chat under the default title rather than store their words.
     */
    titleCiphertext: v.optional(v.string()),
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

    assertEncrypted(args.content, "A message you typed");

    const now = Date.now();
    // Anything that is not provably ciphertext is dropped in favour of the
    // neutral title: degrading the label is fine, leaking the sentence is not.
    const title =
      args.titleCiphertext && isCiphertext(args.titleCiphertext)
        ? args.titleCiphertext
        : "New chat";

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

    // Search session titles — archived chats are deliberately out: they are
    // parked, and a hit that jumps to a conversation hiding in a list the user
    // is not looking at reads as a bug.
    const sessions = (
      await ctx.db
        .query("chatSessions")
        .withIndex("by_user", (qb) => qb.eq("userId", userId))
        .collect()
    ).filter((s) => !s.archivedAt && !s.deletedAt);

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
    engineId: v.optional(v.string()),
    decisionReason: v.optional(v.string()),
    latencyMs: v.optional(v.number()),
    promptTokens: v.optional(v.number()),
    completionTokens: v.optional(v.number()),
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
      engineId: args.engineId,
      decisionReason: args.decisionReason,
      latencyMs: args.latencyMs,
      promptTokens: args.promptTokens,
      completionTokens: args.completionTokens,
      // Clear the flag so the same message can be continued later without the
      // next attempt stopping immediately.
      cancelRequested: false,
    });
  },
});

/**
 * Pins or unpins a message.
 *
 * Written as a toggle rather than an explicit value so the UI cannot get the
 * two out of step with what is stored — the argument is the new state, and a
 * double click is a no-op rather than a race.
 */
/**
 * Fetch specific messages by id.
 *
 * Exists for the compare view: a decision branch's alternative answer lives on
 * a different branch, so it is not in the transcript the user is looking at,
 * and after a reload the id on the original is the only pointer to it left.
 * Capped at six ids — this is a lookup, not a query.
 */
export const getMessagesByIds = query({
  args: { ids: v.array(v.id("chatMessages")) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const rows = await Promise.all(args.ids.slice(0, 6).map((id) => ctx.db.get(id)));
    return rows.filter((row) => Boolean(row && row.userId === userId));
  },
});

export const setPin = mutation({
  args: {
    messageId: v.id("chatMessages"),
    pinned: v.boolean(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    const row = await ctx.db.get(args.messageId);
    if (!row || row.userId !== userId) throw new Error("Message not found.");
    await ctx.db.patch(args.messageId, { pinned: args.pinned });
  },
});

/**
 * Every pinned message across every session, newest first.
 *
 * Deliberately not scoped to one chat. A pin is the user saying "I will want
 * this again"; scoping it to a single conversation would hide it precisely
 * when they are in a different one looking for it.
 */
export const listPinned = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const rows = await ctx.db
      .query("chatMessages")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const pinned = rows
      .filter((m) => m.pinned)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 100);

    // The session title is read per row rather than joined, because there is
    // no index that answers "sessions for these ids" and the list is capped.
    const withTitles = await Promise.all(
      pinned.map(async (m) => {
        const session = await ctx.db.get(m.sessionId);
        return {
          _id: m._id,
          sessionId: m.sessionId,
          sessionTitle: session?.title ?? "Jarvis chat",
          role: m.role,
          // Long replies are clipped: this is a jump list, not a second reader.
          preview: m.content.length > 220 ? `${m.content.slice(0, 220)}…` : m.content,
          model: m.model,
          createdAt: m.createdAt,
        };
      }),
    );
    return withTitles;
  },
});

/**
 * Links a reply to the alternative answer produced on a decision branch.
 *
 * Both ids are stored on the ORIGINAL message rather than on the alternative:
 * the original is the one the user is looking at, so the "compare" affordance
 * has to be reachable from there without first finding the other branch.
 */
export const setAlternative = mutation({
  args: {
    messageId: v.id("chatMessages"),
    altMessageId: v.id("chatMessages"),
    altBranchId: v.optional(v.id("chatBranches")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    const row = await ctx.db.get(args.messageId);
    if (!row || row.userId !== userId) throw new Error("Message not found.");
    const alt = await ctx.db.get(args.altMessageId);
    if (!alt || alt.userId !== userId) throw new Error("Message not found.");
    await ctx.db.patch(args.messageId, {
      altMessageId: args.altMessageId,
      altBranchId: args.altBranchId,
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
    if (row.role === "user") assertEncrypted(args.content, "A message you typed");
    await ctx.db.patch(args.messageId, { content: args.content });
  },
});

/**
 * Attach web image results to an assistant message.
 *
 * Kept as its own mutation rather than folded into `appendMessage` because
 * the search runs alongside the reply instead of before it: the answer is
 * already on screen by the time the web results come back, and making the user
 * wait for a second network call would be a worse trade than filling them in.
 *
 * Assistant messages only — there is no user-authored content here to encrypt.
 */
export const setWebImages = mutation({
  args: {
    messageId: v.id("chatMessages"),
    images: v.array(
      v.object({
        url: v.string(),
        pageUrl: v.string(),
        source: v.string(),
        title: v.optional(v.string()),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");
    const row = await ctx.db.get(args.messageId);
    if (!row || row.userId !== userId) throw new Error("Message not found.");
    if (row.role === "user") {
      throw new Error("Web results belong on a reply, not on what you typed.");
    }
    await ctx.db.patch(args.messageId, { webImages: args.images.slice(0, 6) });
  },
});

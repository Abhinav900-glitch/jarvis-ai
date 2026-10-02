import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericDatabaseReader } from "convex/server";
import type { DataModel, Doc, Id } from "./_generated/dataModel";

/** The schema-aware reader both queries and mutations expose as `db`. */
type Db = GenericDatabaseReader<DataModel>;

// ---------------------------------------------------------------------------
// Conversation branches.
//
// The old behaviour on "edit this message" was to delete everything after it.
// That is simple, and it is also destructive: two words changed in a prompt
// three turns ago silently threw away an answer the user had read, and there
// was no way back.
//
// Instead, editing or regenerating FORKS. A branch shares the history up to
// the fork point and then diverges; the original stays where it was. The user
// switches between them from the transcript, exactly like choosing between two
// drafts of the same reply.
//
// A message with no branchId is on the main line, which is what every chat
// written before this existed looks like. No migration is needed.
// ---------------------------------------------------------------------------

/** Messages on one branch, oldest first, capped so a runaway loop cannot exhaust reads. */
async function loadBranchMessages(
  db: Db,
  sessionId: Id<"chatSessions">,
  branchId: Id<"chatBranches"> | null,
): Promise<Doc<"chatMessages">[]> {
  const all = await db
    .query("chatMessages")
    .withIndex("by_session", (q) => q.eq("sessionId", sessionId))
    .collect();
  const onBranch = all
    .filter((m) => (m.branchId ?? null) === branchId)
    .sort((a, b) => a.createdAt - b.createdAt);
  return onBranch.slice(-500);
}

/**
 * The fields of a message that survive a copy into a branch.
 *
 * The Convex system fields are stripped because the copy is a genuinely new
 * row, and `createdAt` is set separately by the caller so the copied prefix
 * sorts before whatever is appended next.
 */
function copyableFields(
  message: Doc<"chatMessages">,
): Omit<Doc<"chatMessages">, "_id" | "_creationTime" | "createdAt"> {
  const { _id, _creationTime, createdAt, ...fields } = message;
  void _id;
  void _creationTime;
  void createdAt;
  return fields;
}

export const listBranches = query({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) return [];

    const branches = await ctx.db
      .query("chatBranches")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();

    const rows = [];
    for (const branch of branches) {
      const messages = await loadBranchMessages(ctx.db, args.sessionId, branch._id);
      rows.push({
        _id: branch._id as Id<"chatBranches">,
        name: branch.name,
        messageCount: messages.length,
        createdAt: branch.createdAt,
      });
    }

    const mainCount = (await loadBranchMessages(ctx.db, args.sessionId, null)).length;

    return [
      { _id: null as Id<"chatBranches"> | null, name: "Original", messageCount: mainCount, createdAt: session.createdAt },
      ...rows,
    ];
  },
});

/**
 * Forks the conversation at a message.
 *
 * The copy stops BEFORE the fork point, so the caller can decide what replaces
 * it: an edited user message, or a regenerated assistant reply. Copying the
 * prefix is what makes the new branch a real conversation rather than an
 * orphan — it inherits everything the user already said.
 */
export const forkBranch = mutation({
  args: {
    sessionId: v.id("chatSessions"),
    atMessageId: v.id("chatMessages"),
    name: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) throw new Error("Chat not found.");

    const forkPoint = await ctx.db.get(args.atMessageId);
    if (!forkPoint || forkPoint.sessionId !== args.sessionId) {
      throw new Error("Message not found.");
    }

    const prefix = await loadBranchMessages(
      ctx.db,
      args.sessionId,
      forkPoint.branchId ?? null,
    );
    const index = prefix.findIndex((m) => m._id === args.atMessageId);
    const inherited = index === -1 ? prefix : prefix.slice(0, index);

    const now = Date.now();
    const existing = await ctx.db
      .query("chatBranches")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const branchId = await ctx.db.insert("chatBranches", {
      sessionId: args.sessionId,
      userId,
      forkedAtMessageId: args.atMessageId,
      name: args.name ?? `Branch ${existing.length + 1}`,
      createdAt: now,
    });

    for (const message of inherited) {
      await ctx.db.insert("chatMessages", {
        ...copyableFields(message),
        branchId,
        // Timestamps are re-based so the copied prefix sorts before anything
        // new is appended, rather than interleaving with the original.
        createdAt: now - (inherited.length - inherited.indexOf(message)),
      });
    }

    await ctx.db.patch(args.sessionId, { updatedAt: now });
    return branchId;
  },
});

/**
 * Appends a message to a branch, numbering it as a new variant of whatever
 * sibling holds the same position — that is what lets the transcript show
 * "2 of 3" and step between replies.
 */
export const appendToBranch = mutation({
  args: {
    sessionId: v.id("chatSessions"),
    branchId: v.union(v.id("chatBranches"), v.null()),
    role: v.union(v.literal("user"), v.literal("assistant"), v.literal("system")),
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
    attachments: v.optional(
      v.array(
        v.object({
          url: v.string(),
          name: v.string(),
          type: v.optional(v.string()),
          size: v.optional(v.number()),
          text: v.optional(v.string()),
        }),
      ),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) throw new Error("Chat not found.");

    const siblings = await loadBranchMessages(ctx.db, args.sessionId, args.branchId);
    const variantIndex = siblings.length;

    const messageId = await ctx.db.insert("chatMessages", {
      sessionId: args.sessionId,
      userId,
      branchId: args.branchId ?? undefined,
      variantIndex,
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
      attachments: args.attachments,
      createdAt: Date.now(),
    });

    await ctx.db.patch(args.sessionId, { updatedAt: Date.now() });
    return { messageId, variantIndex };
  },
});

/**
 * Copies one message into a branch.
 *
 * The branch UI edits in place: the user changes their message on the new
 * branch and sends it. This is the one-way bridge that lets a message written
 * on the main line be reused inside a branch.
 */
export const copyMessageToBranch = mutation({
  args: {
    sessionId: v.id("chatSessions"),
    branchId: v.union(v.id("chatBranches"), v.null()),
    messageId: v.id("chatMessages"),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) throw new Error("Chat not found.");

    const message = await ctx.db.get(args.messageId);
    if (!message || message.sessionId !== args.sessionId) {
      throw new Error("Message not found.");
    }

    const siblings = await loadBranchMessages(ctx.db, args.sessionId, args.branchId);

    const messageId = await ctx.db.insert("chatMessages", {
      ...copyableFields(message),
      branchId: args.branchId ?? undefined,
      variantIndex: siblings.length,
      createdAt: Date.now(),
    });
    await ctx.db.patch(args.sessionId, { updatedAt: Date.now() });
    return messageId;
  },
});

export const deleteBranch = mutation({
  args: { branchId: v.id("chatBranches") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const branch = await ctx.db.get(args.branchId);
    if (!branch || branch.userId !== userId) throw new Error("Branch not found.");

    const messages = await loadBranchMessages(ctx.db, branch.sessionId, args.branchId);
    for (const message of messages) {
      await ctx.db.delete(message._id);
    }
    await ctx.db.delete(args.branchId);
  },
});

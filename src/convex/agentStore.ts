// ---------------------------------------------------------------------------
// Persistence for agent runs and their steps.
//
// Split from `agent.ts` for a hard reason, not a stylistic one: a Convex module
// marked `"use node"` may only export actions, so the action that runs the
// agent cannot also own the tables it writes. The node file drives; this one
// stores.
//
// Every read here re-checks ownership. A run id arriving from the client is an
// address, not a capability, and an agent run can hold a user's whole task
// description plus whatever it retrieved along the way.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { CHECKPOINT_KEEP, runStatus, stepStatus } from "../lib/agent-contract";

/** A run id is not a capability. */
function assertOwner<T extends { userId: string } | null | undefined>(
  run: T,
  userId: Id<"users">,
): asserts run is NonNullable<T> {
  if (!run || run.userId !== userId) throw new Error("Not your run.");
}

// ---------------------------------------------------------------------------
// Internal reads, called by the agent action
// ---------------------------------------------------------------------------

export const getRun = internalQuery({
  args: { runId: v.id("agentRuns"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertOwner(run, args.userId);
    return run;
  },
});

export const nextStep = internalQuery({
  args: { runId: v.id("agentRuns"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertOwner(run, args.userId);
    return await ctx.db
      .query("agentSteps")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "running"),
        ),
      )
      .first();
  },
});

export const runSteps = internalQuery({
  args: { runId: v.id("agentRuns"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertOwner(run, args.userId);
    return await ctx.db
      .query("agentSteps")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

export const gatedStep = internalQuery({
  args: { runId: v.id("agentRuns"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertOwner(run, args.userId);
    return await ctx.db
      .query("agentSteps")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .filter((q) => q.eq(q.field("status"), "needs_decision"))
      .first();
  },
});

// ---------------------------------------------------------------------------
// Internal mutations, called by the agent action
// ---------------------------------------------------------------------------

export const createRun = internalMutation({
  args: {
    userId: v.id("users"),
    goal: v.string(),
    title: v.string(),
    mode: v.optional(v.union(
      v.literal("readonly"),
      v.literal("ask"),
      v.literal("auto"),
    )),
    cascade: v.optional(v.boolean()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentRuns", {
      userId: args.userId,
      goal: args.goal,
      title: args.title,
      status: "planning",
      // `auto` is what the modes default to: writing files is the job. What
      // makes that safe to default to is that every automatic write is
      // checkpointed before it lands (so it can be rewound), the mode can be
      // switched mid-run, and AUTO_WRITE_BUDGET caps how much one run may
      // rewrite. An explicit `readonly` or `ask` still wins.
      mode: args.mode ?? "auto",
      cascade: args.cascade ?? false,
      planned: 0,
      done: 0,
      calls: 0,
      createdAt: args.now,
      updatedAt: args.now,
    });
  },
});

export const addSteps = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    userId: v.id("users"),
    title: v.string(),
    steps: v.array(v.object({ title: v.string(), detail: v.string() })),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertOwner(run, args.userId);
    for (let i = 0; i < args.steps.length; i++) {
      const s = args.steps[i];
      await ctx.db.insert("agentSteps", {
        runId: args.runId,
        userId: args.userId,
        position: i,
        title: s.title,
        detail: s.detail,
        status: "pending",
        createdAt: args.now,
      });
    }
    await ctx.db.patch(args.runId, {
      title: args.title,
      planned: args.steps.length,
      status: "running",
      updatedAt: args.now,
    });
  },
});

export const patchStep = internalMutation({
  args: {
    stepId: v.id("agentSteps"),
    patch: v.object({
      status: v.optional(stepStatus),
      title: v.optional(v.string()),
      output: v.optional(v.string()),
      rationale: v.optional(v.string()),
      engineId: v.optional(v.string()),
      gateReason: v.optional(v.string()),
      question: v.optional(v.string()),
      options: v.optional(v.array(v.string())),
      answer: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.stepId);
    if (!step) throw new Error("Step is gone.");
    await ctx.db.patch(args.stepId, args.patch);
  },
});

// Console bounds. Both are small enough that a step can hold its whole story
// and large enough that no real step hits them — but they are bounds, not
// conventions, because an uncapped log on a tool-happy step is the one field
// here that grows without anyone deciding it should.
const LOG_CAP = 80;
const TRACE_CAP = 12;

/**
 * Append one entry to a step's console log.
 *
 * Written per call rather than flushed when the step ends: the point of a
 * console is watching the work happen, and a log that only lands with the
 * result is a report.
 */
export const logStep = internalMutation({
  args: {
    stepId: v.id("agentSteps"),
    entry: v.object({
      at: v.number(),
      kind: v.union(v.literal("model"), v.literal("tool")),
      label: v.string(),
      detail: v.optional(v.string()),
      ms: v.optional(v.number()),
      promptTokens: v.optional(v.number()),
      completionTokens: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.stepId);
    if (!step) return;
    await ctx.db.patch(args.stepId, {
      log: [...(step.log ?? []), args.entry].slice(-LOG_CAP),
    });
  },
});

/**
 * Append one request/response round to a step's trace.
 *
 * The caller decides whether to record at all — this mutation only enforces
 * the cap, so a run with recording on for an hour cannot become the largest
 * thing in the database.
 */
export const appendTrace = internalMutation({
  args: {
    stepId: v.id("agentSteps"),
    entry: v.object({
      round: v.number(),
      engineId: v.optional(v.string()),
      model: v.optional(v.string()),
      ms: v.optional(v.number()),
      promptTokens: v.optional(v.number()),
      completionTokens: v.optional(v.number()),
      request: v.optional(v.string()),
      response: v.optional(v.string()),
      toolCalls: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.stepId);
    if (!step) return;
    await ctx.db.patch(args.stepId, {
      trace: [...(step.trace ?? []), args.entry].slice(-TRACE_CAP),
    });
  },
});

export const gateStep = internalMutation({
  args: {
    stepId: v.id("agentSteps"),
    reason: v.string(),
    question: v.string(),
    options: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const step = await ctx.db.get(args.stepId);
    if (!step) throw new Error("Step is gone.");
    await ctx.db.patch(args.stepId, {
      status: "needs_decision",
      gateReason: args.reason,
      question: args.question,
      options: args.options,
    });
  },
});

export const bumpRun = internalMutation({
  args: { runId: v.id("agentRuns"), calls: v.number() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run is gone.");
    await ctx.db.patch(args.runId, {
      done: run.done + 1,
      calls: run.calls + args.calls,
      updatedAt: Date.now(),
    });
  },
});

/** Count one applied write against the run's budget. */
export const countWrite = internalMutation({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run is gone.");
    await ctx.db.patch(args.runId, {
      writes: (run.writes ?? 0) + 1,
      updatedAt: Date.now(),
    });
  },
});

/**
 * Append the verification step to an `auto` plan, once.
 *
 * Auto mode should prove its work rather than declare it, but a verify step
 * paid for at plan time would spend a request on runs that wrote nothing to
 * verify. So it is appended here — only when the run has actually changed
 * files — and guarded by `verified` so the run cannot add a second one.
 *
 * Returns false when there is nothing to append, which the loop reads as
 * "finish the run as it stands".
 */
export const appendVerifyStep = internalMutation({
  args: { runId: v.id("agentRuns"), userId: v.id("users"), now: v.number() },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertOwner(run, args.userId);
    if (run.verified || run.mode !== "auto" || (run.writes ?? 0) === 0) {
      return false;
    }
    await ctx.db.insert("agentSteps", {
      runId: args.runId,
      userId: args.userId,
      position: run.planned,
      title: "Verify the finished work by running it",
      detail:
        "Everything planned is written, so check it rather than asserting it: run the entry point with run_code, read the output, fix what fails, then run it again. Finish with status \"done\" and say in output exactly what you ran and what happened.",
      status: "pending",
      createdAt: args.now,
    });
    await ctx.db.patch(args.runId, {
      verified: true,
      planned: run.planned + 1,
      updatedAt: args.now,
    });
    return true;
  },
});

export const setRun = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    status: runStatus,
    answer: v.optional(v.string()),
    error: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: args.status,
      answer: args.answer,
      error: args.error,
      updatedAt: args.now,
    });
  },
});

export const cancelRun = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    userId: v.id("users"),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertOwner(run, args.userId);
    const open = await ctx.db
      .query("agentSteps")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .filter((q) =>
        q.or(
          q.eq(q.field("status"), "pending"),
          q.eq(q.field("status"), "running"),
        ),
      )
      .collect();
    for (const s of open) {
      await ctx.db.patch(s._id, { status: "failed", output: "Cancelled." });
    }
    await ctx.db.patch(args.runId, { status: "cancelled", updatedAt: args.now });
  },
});

/** Remove a run and its steps together — a step is meaningless without its run. */
export const deleteRun = internalMutation({
  args: { runId: v.id("agentRuns"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertOwner(run, args.userId);
    const steps = await ctx.db
      .query("agentSteps")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    for (const s of steps) await ctx.db.delete(s._id);
    await ctx.db.delete(args.runId);
  },
});

// ---------------------------------------------------------------------------
// The workspace
//
// These are deliberately low-level. The mode check, the checkpoint, the diff
// and the write all have to happen together or not at all, so the agent action
// sequences them; giving it a single `writeVerified` here would push the policy
// into this file and make it untestable from the loop.
// ---------------------------------------------------------------------------

export const listFiles = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaceFiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});

export const getFile = internalQuery({
  args: { userId: v.id("users"), path: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workspaceFiles")
      .withIndex("by_user_path", (q) =>
        q.eq("userId", args.userId).eq("path", args.path),
      )
      .first();
  },
});

export const putFile = internalMutation({
  args: {
    userId: v.id("users"),
    path: v.string(),
    content: v.string(),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspaceFiles")
      .withIndex("by_user_path", (q) =>
        q.eq("userId", args.userId).eq("path", args.path),
      )
      .first();
    const size = args.content.length;
    if (existing) {
      await ctx.db.patch(existing._id, {
        content: args.content,
        size,
        updatedAt: args.now,
      });
      return { created: false, id: existing._id };
    }
    const id = await ctx.db.insert("workspaceFiles", {
      userId: args.userId,
      path: args.path,
      content: args.content,
      size,
      createdAt: args.now,
      updatedAt: args.now,
    });
    return { created: true, id };
  },
});

export const removeFile = internalMutation({
  args: { userId: v.id("users"), path: v.string() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspaceFiles")
      .withIndex("by_user_path", (q) =>
        q.eq("userId", args.userId).eq("path", args.path),
      )
      .first();
    if (!existing) return { removed: false };
    await ctx.db.delete(existing._id);
    return { removed: true };
  },
});

/**
 * Snapshot a file's current contents so a rewind can put it back.
 *
 * `previous` being absent is not a bug: it records that the file did not exist
 * before this write, which is exactly what a rewind needs in order to delete
 * rather than restore.
 */
export const recordCheckpoint = internalMutation({
  args: {
    userId: v.id("users"),
    path: v.string(),
    previous: v.optional(v.string()),
    runId: v.optional(v.id("agentRuns")),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("workspaceCheckpoints", {
      userId: args.userId,
      path: args.path,
      previous: args.previous,
      runId: args.runId,
      createdAt: args.now,
    });

    // Bound the history here, in the one place every checkpoint is written,
    // rather than in whichever caller happened to remember. Auto runs create a
    // checkpoint per file change and each one stores the file's full previous
    // contents, so without this the table grows with every write.
    //
    // The window is deliberately finite: prune on every write, so the steady
    // state sits at the cap and a table left over from a looser limit is drawn
    // down a window at a time instead of in one unbounded read.
    const rows = await ctx.db
      .query("workspaceCheckpoints")
      .withIndex("by_user_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(CHECKPOINT_KEEP + 25);
    for (const row of rows.slice(CHECKPOINT_KEEP)) {
      await ctx.db.delete(row._id);
    }

    return id;
  },
});

/** Newest first, so "undo the last thing" is `list[0]`. */
export const listCheckpoints = internalQuery({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    return await ctx.db
      .query("workspaceCheckpoints")
      .withIndex("by_user_time", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(limit);
  },
});

// ---------------------------------------------------------------------------
// Edit proposals
// ---------------------------------------------------------------------------

export const proposeEdit = internalMutation({
  args: {
    runId: v.id("agentRuns"),
    userId: v.id("users"),
    path: v.string(),
    before: v.optional(v.string()),
    // Optional because a delete proposal has no "after". An approved delete
    // that restored the file instead would be worse than no approval at all.
    after: v.optional(v.string()),
    summary: v.optional(v.string()),
    now: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentProposals", {
      runId: args.runId,
      userId: args.userId,
      path: args.path,
      before: args.before,
      after: args.after,
      summary: args.summary,
      status: "pending",
      createdAt: args.now,
    });
  },
});

export const pendingProposals = internalQuery({
  args: { runId: v.id("agentRuns"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    assertOwner(run, args.userId);
    return await ctx.db
      .query("agentProposals")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

export const decideProposal = internalMutation({
  args: {
    proposalId: v.id("agentProposals"),
    status: v.union(v.literal("applied"), v.literal("rejected")),
  },
  handler: async (ctx, args) => {
    const proposal = await ctx.db.get(args.proposalId);
    if (!proposal) throw new Error("That proposal is gone.");
    await ctx.db.patch(args.proposalId, { status: args.status });
    return proposal;
  },
});

/** One snapshot, for a single rewind. Ownership is checked before it is read. */
export const getCheckpoint = internalQuery({
  args: { checkpointId: v.id("workspaceCheckpoints"), userId: v.id("users") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.checkpointId);
    if (!row || row.userId !== args.userId) return null;
    return row;
  },
});

/** A spent snapshot is deleted, so a rewind cannot be applied twice. */
export const dropCheckpoint = internalMutation({
  args: { checkpointId: v.id("workspaceCheckpoints") },
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.checkpointId);
    if (!row) return { dropped: false };
    await ctx.db.delete(args.checkpointId);
    return { dropped: true };
  },
});

// ---------------------------------------------------------------------------
// Client-facing reads
// ---------------------------------------------------------------------------

// The identity's `subject` is `userId|sessionId`, not the user id — that is
// precisely what `getAuthUserId` splits off. Comparing a stored `userId`
// against the raw subject never matches, which silently returned null/empty
// from every read below and stopped the panel's driver from ever calling
// `advance`. One helper, used everywhere, so this cannot drift again.
export const get = query({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const run = await ctx.db.get(args.runId);
    if (!run || run.userId !== userId) return null;
    return run;
  },
});

export const steps = query({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const run = await ctx.db.get(args.runId);
    if (!run || run.userId !== userId) return [];
    return await ctx.db
      .query("agentSteps")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const limit = Math.min(Math.max(args.limit ?? 8, 1), 25);
    return await ctx.db
      .query("agentRuns")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
  },
});

/**
 * Switch the mode of a live run.
 *
 * The mode is read fresh on every step, so this takes effect from the next
 * step rather than needing a restart — which is the point of it: "this is
 * going too slowly, just write it" is said once, mid-run, not by killing the
 * run and paying for a new plan.
 *
 * Deliberately does *not* sweep up edits already waiting for approval. Moving
 * to `auto` is permission for what happens next, not retroactive consent for
 * what is already on the table — those are approved one by one, or all at once,
 * in the panel.
 */
export const setMode = mutation({
  args: {
    runId: v.id("agentRuns"),
    mode: v.union(
      v.literal("readonly"),
      v.literal("ask"),
      v.literal("auto"),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use AeroTransformGen Dev.");
    const run = await ctx.db.get(args.runId);
    assertOwner(run, userId);
    if (run.mode === args.mode) return { mode: args.mode };
    await ctx.db.patch(args.runId, { mode: args.mode, updatedAt: Date.now() });
    return { mode: args.mode };
  },
});

/**
 * Turn the trace inspector on or off for this run.
 *
 * Deliberately a live toggle rather than a start-time choice: recording is
 * something you decide you want five minutes into a step that is behaving
 * strangely, and asking for a restart to get it would miss exactly the run
 * you needed.
 */
export const setDebug = mutation({
  args: { runId: v.id("agentRuns"), enabled: v.boolean() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use AeroTransformGen Dev.");
    const run = await ctx.db.get(args.runId);
    assertOwner(run, userId);
    if (Boolean(run.debug) === args.enabled) return;
    await ctx.db.patch(args.runId, {
      debug: args.enabled,
      updatedAt: Date.now(),
    });
  },
});

// ---------------------------------------------------------------------------
// Client-facing workspace reads
// ---------------------------------------------------------------------------

/**
 * Every file's contents, for the preview pane.
 *
 * Unlike {@link workspaceTree} this carries the bodies, so the caller asks for
 * it only while the preview is on screen — a reactive subscription to the
 * whole workspace would otherwise be paying for bytes nobody is looking at.
 */
export const workspaceContents = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("workspaceFiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((r) => ({ path: r.path, content: r.content }));
  },
});

/** The tree. Contents are excluded — listing a workspace should be cheap. */
export const workspaceTree = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("workspaceFiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((r) => ({
      path: r.path,
      size: r.size,
      updatedAt: r.updatedAt,
    }));
  },
});

export const workspaceFile = query({
  args: { path: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const row = await ctx.db
      .query("workspaceFiles")
      .withIndex("by_user_path", (q) =>
        q.eq("userId", userId).eq("path", args.path),
      )
      .first();
    return row ?? null;
  },
});

/** Edits waiting on the user, oldest first. */
export const proposals = query({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const run = await ctx.db.get(args.runId);
    if (!run || run.userId !== userId) return [];
    return await ctx.db
      .query("agentProposals")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

export const checkpoints = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const rows = await ctx.db
      .query("workspaceCheckpoints")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(limit);
    return rows.map((r) => ({
      _id: r._id,
      path: r.path,
      existed: r.previous !== undefined,
      bytes: r.previous?.length ?? 0,
      createdAt: r.createdAt,
      runId: r.runId ?? null,
    }));
  },
});

/** Seed the workspace so the agent has something real to work on. */
export const seedWorkspace = internalMutation({
  args: { userId: v.id("users"), now: v.number() },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("workspaceFiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .first();
    if (existing) return { seeded: false };

    const readme = `# Workspace

This is Jarvis's working directory. Hand it a task and it reads, edits and
runs files here.

- Every file is yours. Jarvis proposes changes; you approve them.
- There is no shell and no real filesystem — only these files.
- Snapshots are taken before each edit, so a run can be rewound.
`;
    await ctx.db.insert("workspaceFiles", {
      userId: args.userId,
      path: "README.md",
      content: readme,
      size: readme.length,
      createdAt: args.now,
      updatedAt: args.now,
    });
    return { seeded: true };
  },
});

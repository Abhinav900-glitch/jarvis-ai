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
import { internalMutation, internalQuery, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { runStatus, stepStatus } from "../lib/agent-contract";

/** A run id is not a capability. */
function assertOwner(
  run: { userId: string } | null | undefined,
  userId: Id<"users">,
): void {
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
    now: v.number(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentRuns", {
      userId: args.userId,
      goal: args.goal,
      title: args.title,
      status: "planning",
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
// Client-facing reads
// ---------------------------------------------------------------------------

export const get = query({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return null;
    const run = await ctx.db.get(args.runId);
    if (!run || run.userId !== identity.subject) return null;
    return run;
  },
});

export const steps = query({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return [];
    const run = await ctx.db.get(args.runId);
    if (!run || run.userId !== identity.subject) return [];
    return await ctx.db
      .query("agentSteps")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (identity === null) return [];
    const limit = Math.min(Math.max(args.limit ?? 8, 1), 25);
    return await ctx.db
      .query("agentRuns")
      .withIndex("by_user_time", (q) =>
        q.eq("userId", identity.subject as Id<"users">),
      )
      .order("desc")
      .take(limit);
  },
});

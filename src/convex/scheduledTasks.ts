import { v } from "convex/values";
import { internalMutation, internalQuery, internalAction, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { nextRunAt } from "../lib/schedule-time";

// ---------------------------------------------------------------------------
// Scheduled tasks: CRUD.
//
// The execution side lives in scheduledRunner.ts, which the cron calls. It is
// split out because a file holding a cron may only export the cron.
//
// A completed run is written into a real chat, not pushed as a notification, so
// the output stays searchable and exportable instead of vanishing.
// ---------------------------------------------------------------------------

export const listTasks = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("scheduledTasks")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const createTask = mutation({
  args: {
    title: v.string(),
    prompt: v.string(),
    kind: v.union(
      v.literal("once"),
      v.literal("hourly"),
      v.literal("daily"),
      v.literal("weekly"),
    ),
    runAt: v.optional(v.number()),
    minuteOfDay: v.optional(v.number()),
    dayOfWeek: v.optional(v.number()),
    timezone: v.optional(v.string()),
    sessionId: v.optional(v.id("chatSessions")),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to create a task.");

    const title = args.title.trim().slice(0, 120);
    if (!title) throw new Error("Give the task a title.");
    const prompt = args.prompt.trim().slice(0, 4_000);
    if (!prompt) throw new Error("The task needs an instruction to run.");

    // Ownership is checked before a task can be pointed at somebody's chat.
    if (args.sessionId) {
      const session = await ctx.db.get(args.sessionId);
      if (!session || session.userId !== userId) throw new Error("Chat not found.");
    }

    const now = Date.now();
    return await ctx.db.insert("scheduledTasks", {
      userId,
      title,
      prompt,
      sessionId: args.sessionId,
      kind: args.kind,
      runAt: args.runAt,
      minuteOfDay: args.minuteOfDay,
      dayOfWeek: args.dayOfWeek,
      timezone: args.timezone,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const updateTask = mutation({
  args: {
    taskId: v.id("scheduledTasks"),
    enabled: v.optional(v.boolean()),
    title: v.optional(v.string()),
    prompt: v.optional(v.string()),
    /** Fire it on the next sweep instead of waiting for the schedule. */
    runNow: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== userId) throw new Error("Task not found.");

    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    if (args.enabled !== undefined) patch.enabled = args.enabled;
    if (args.title !== undefined) patch.title = args.title.trim().slice(0, 120);
    if (args.prompt !== undefined) patch.prompt = args.prompt.trim().slice(0, 4_000);
    // "Run now" simply makes the task due: a one-shot fires on the next sweep
    // because its runAt is now in the past. Reusing the normal path means
    // "run now" and "ran on schedule" cannot drift apart.
    if (args.runNow) {
      if (task.kind === "once") {
        patch.runAt = Date.now();
      } else {
        patch.lastRunAt = 0;
      }
    }

    await ctx.db.patch(args.taskId, patch);
  },
});

export const deleteTask = mutation({
  args: { taskId: v.id("scheduledTasks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== userId) throw new Error("Task not found.");
    await ctx.db.delete(args.taskId);
  },
});

// ---------------------------------------------------------------------------
// Runner-facing internals. These have no auth check by design: the cron has no
// session, and the rows were written by their owner in the first place. The
// only caller is scheduledRunner.ts.
// ---------------------------------------------------------------------------

export const listDueTasks = internalQuery({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const tasks = await ctx.db
      .query("scheduledTasks")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();

    const due = tasks.filter((task) => {
      // `lastRunAt ?? 0` anchors a never-run task at the epoch so its very
      // first due time is its own start time, not "immediately, forever".
      const anchor = task.lastRunAt ?? 0;
      return nextRunAt(task, anchor) <= now;
    });

    return due.map((task) => ({
      _id: task._id,
      userId: task.userId,
      title: task.title,
      prompt: task.prompt,
      sessionId: task.sessionId ?? null,
      kind: task.kind,
    }));
  },
});

export const recordRun = internalMutation({
  args: {
    taskId: v.id("scheduledTasks"),
    result: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return;

    const now = Date.now();
    const summary = args.error
      ? `Failed: ${args.error}`.slice(0, 200)
      : (args.result?.slice(0, 200) ?? "Done");

    // A one-shot retires itself whatever the outcome. Left enabled, it would
    // be re-found by every sweep forever, because its runAt stays in the past.
    await ctx.db.patch(args.taskId, {
      enabled: task.kind === "once" ? false : task.enabled,
      lastRunAt: now,
      lastResult: summary,
      updatedAt: now,
    });
  },
});

/**
 * The chat a task posts into, created on first run.
 *
 * One session per task, reused forever, so a daily digest accumulates into a
 * single readable thread rather than scattering one message per day across
 * fresh chats the user has to hunt for.
 */
export const ensureTaskSession = internalMutation({
  args: { userId: v.id("users"), title: v.string() },
  handler: async (ctx, args) => {
    const now = Date.now();
    return await ctx.db.insert("chatSessions", {
      userId: args.userId,
      title: args.title,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Appends a turn to a task's chat. Used for both the trigger and the reply. */
export const appendTaskMessage = internalMutation({
  args: {
    sessionId: v.id("chatSessions"),
    userId: v.id("users"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    model: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const messageId = await ctx.db.insert("chatMessages", {
      sessionId: args.sessionId,
      userId: args.userId,
      role: args.role,
      content: args.content,
      model: args.model,
      createdAt: now,
    });
    await ctx.db.patch(args.sessionId, { updatedAt: now });
    return messageId;
  },
});

/** When a task will next fire, for the list. Public so the panel can show it. */
export const nextRunPreview = query({
  args: { taskId: v.id("scheduledTasks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== userId) return null;
    if (task.enabled === false) return null;

    return nextRunAt(task, task.lastRunAt ?? 0);
  },
});

/**
 * Fire this task now, from the user's own session.
 *
 * Kept separate from the cron so "Run now" is immediate and visibly the user's
 * own action, rather than something that silently waits for the next sweep.
 */
export const runTaskNow = mutation({
  args: { taskId: v.id("scheduledTasks") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const task = await ctx.db.get(args.taskId);
    if (!task || task.userId !== userId) throw new Error("Task not found.");

    // Creating the session here is what makes the result navigable straight
    // away: the panel links to the chat the answer is about to land in.
    const sessionId =
      task.sessionId ??
      (await ctx.db.insert("chatSessions", {
        userId,
        title: task.title,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }));
    if (!task.sessionId) await ctx.db.patch(task._id, { sessionId });

    return sessionId;
  },
});

// ---------------------------------------------------------------------------
// The sweep itself.
//
// Lives here rather than in scheduledRunner.ts because that file is a module
// whose default export is a cron registry, and such a module may not export
// anything else — the cron needs a *reference* to a registered function, which
// means the function has to be declared somewhere else.
// ---------------------------------------------------------------------------

export const runDueTasks = internalAction({
  args: {},
  handler: async (ctx): Promise<{ checked: number }> => {
    // Annotated explicitly: this action is referenced by its own module's cron
    // registration, so an inferred return type would be circular.
    const due = await ctx.runQuery(internal.scheduledTasks.listDueTasks, {});

    // Sequential on purpose. A burst of tasks hitting one provider at the same
    // instant is exactly how you get rate-limited, and each run takes seconds,
    // so a handful of tasks still finishes well inside the sweep.
    for (const task of due) {
      try {
        const sessionId =
          task.sessionId ??
          (await ctx.runMutation(internal.scheduledTasks.ensureTaskSession, {
            userId: task.userId,
            title: task.title,
          }));

        // The trigger is stored as a real message so the chat reads as a
        // conversation and exports include what was asked.
        await ctx.runMutation(internal.scheduledTasks.appendTaskMessage, {
          sessionId,
          userId: task.userId,
          role: "user",
          content: `⏰ ${task.title}`,
        });

        const result = await ctx.runAction(internal.ai.askForTask, {
          userId: task.userId,
          prompt: task.prompt,
        });

        await ctx.runMutation(internal.scheduledTasks.appendTaskMessage, {
          sessionId,
          userId: task.userId,
          role: "assistant",
          content: result.text,
          model: result.model,
        });

        await ctx.runMutation(internal.scheduledTasks.recordRun, {
          taskId: task._id,
          result: result.text,
        });
      } catch (err) {
        // One bad task must never stop the rest of the sweep, and the failure is
        // recorded on the task itself where the user can see it.
        const message = err instanceof Error ? err.message : "unknown error";
        console.error("[scheduledTasks] sweep: task failed:", message);
        try {
          await ctx.runMutation(internal.scheduledTasks.recordRun, {
            taskId: task._id,
            error: message,
          });
        } catch {
          // Nothing more can be done for this task.
        }
      }
    }

    return { checked: due.length };
  },
});

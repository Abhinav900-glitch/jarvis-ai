// ---------------------------------------------------------------------------
// A machine the user connected as Jarvis's own computer.
//
// Colab has no API and no keys to add: a notebook is a browser tab running a
// Python kernel, and nothing outside can reach into it. So the connection runs
// the other way. A cell pasted into the notebook polls this deployment for
// work, runs it on the notebook's own interpreter, and posts the result back.
// That is what makes a Colab Pro runtime usable as a computer rather than a
// place to paste code: it can install anything pip has, it keeps state between
// runs, and on a paid runtime it has a GPU.
//
// The token is the whole authorisation, exactly as with `/artifact`. It is
// minted on connect, replaces any previous one, and every request the worker
// makes is checked against it — the notebook holds no session and no user id.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { action, mutation, query } from "./_generated/server";
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";

/**
 * How recently the worker must have polled for the machine to count as online.
 *
 * Generous on purpose: the worker does not poll while it is running a job, so a
 * ninety-second program would otherwise make a perfectly healthy machine look
 * dead the moment it answered, and the next run would be sent to a sandbox for
 * no reason.
 */
const ONLINE_WINDOW_MS = 180_000;

/** What the worker is told it may spend on one program. */
export const JOB_TIMEOUT_MS = 90_000;

/** Jobs that can be waiting at once. A backlog helps nobody: it ages out. */
const MAX_QUEUED = 4;

/** Caps on what a job may carry, so one run cannot bloat the table. */
const MAX_OUTPUT_CHARS = 200_000;
const MAX_SOURCE_CHARS = 200_000;

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text;
}

function mintToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// From the app
// ---------------------------------------------------------------------------

/**
 * Give the user a token and the endpoint to paste into a notebook.
 *
 * Called again, it rotates the token: the old cell stops being able to fetch
 * work, which is the only way to cut off a machine the user no longer trusts.
 * The cell text itself is built in the browser, because it is just a Python
 * string and has no business being assembled on the server.
 */
export const connect = action({
  args: {},
  handler: async (ctx): Promise<{ token: string; endpoint: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to connect a machine.");

    const endpoint = process.env.CONVEX_SITE_URL?.trim();
    if (!endpoint) {
      throw new Error(
        "This deployment has no CONVEX_SITE_URL, so a machine would have nowhere to fetch work from.",
      );
    }

    const token = await ctx.runMutation(internal.machines.upsert, { userId });
    return { token, endpoint };
  },
});

/**
 * Drop the machine and everything waiting for it.
 *
 * The queued jobs go with it because nobody is left to run them, and a run that
 * was waiting on one would otherwise sit until its own deadline.
 */
export const disconnect = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");

    const machine = await ctx.db
      .query("machines")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!machine) return null;
    await ctx.db.delete(machine._id);

    const queued = await ctx.db
      .query("machineJobs")
      .withIndex("by_user_state", (q) => q.eq("userId", userId).eq("state", "queued"))
      .take(MAX_QUEUED);
    for (const job of queued) await ctx.db.delete(job._id);

    return machine._id;
  },
});

/**
 * The machine as the panel shows it.
 *
 * `online` is inferred from the last poll rather than asked for, because a
 * polling worker has no other way to say it is alive. The token comes back
 * because the panel has to be able to show the cell again in a new Colab
 * session, and the user is the only person who can read it.
 */
export const myMachine = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const machine = await ctx.db
      .query("machines")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!machine) return null;

    const queued = await ctx.db
      .query("machineJobs")
      .withIndex("by_user_state", (q) => q.eq("userId", userId).eq("state", "queued"))
      .take(MAX_QUEUED);

    return {
      token: machine.token,
      // The panel rebuilds the cell from this, so it never has to keep a copy of
      // the text around or ask the server for it again.
      endpoint: process.env.CONVEX_SITE_URL?.trim() ?? null,
      name: machine.name,
      version: machine.version ?? null,
      platform: machine.platform ?? null,
      connectedAt: machine.connectedAt,
      lastSeenAt: machine.lastSeenAt,
      jobsRun: machine.jobsRun,
      lastError: machine.lastError ?? null,
      online: Date.now() - machine.lastSeenAt < ONLINE_WINDOW_MS,
      queued: queued.length,
    };
  },
});

// ---------------------------------------------------------------------------
// From the worker
// ---------------------------------------------------------------------------

/** Create or rotate the row, and hand back the new token. */
export const upsert = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const token = mintToken();
    const now = Date.now();
    const existing = await ctx.db
      .query("machines")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    if (existing) {
      // A rotation keeps the history — how many jobs it has run — and resets
      // liveness, because the cell that held the old token is now cut off.
      await ctx.db.patch(existing._id, { token, connectedAt: now, lastSeenAt: 0 });
      return token;
    }

    await ctx.db.insert("machines", {
      userId,
      name: "Colab",
      token,
      connectedAt: now,
      lastSeenAt: 0,
      jobsRun: 0,
    });
    return token;
  },
});

/**
 * One poll: prove the token, record that the machine is alive, and hand over
 * the oldest waiting job.
 *
 * All three land in a single mutation because they have to agree. Two workers
 * polling with the same token — a notebook left running in another tab — must
 * not both be given the same job, and a mutation is serialisable, so the second
 * one simply finds nothing queued.
 */
export const claim = internalMutation({
  args: {
    token: v.string(),
    version: v.optional(v.string()),
    platform: v.optional(v.string()),
  },
  handler: async (ctx, { token, version, platform }) => {
    const machine = await ctx.db
      .query("machines")
      .withIndex("by_token", (q) => q.eq("token", token))
      .first();
    if (!machine) return { ok: false as const, job: null };

    const now = Date.now();
    await ctx.db.patch(machine._id, {
      lastSeenAt: now,
      version: version?.slice(0, 60) ?? machine.version,
      platform: platform?.slice(0, 80) ?? machine.platform,
    });

    // Finished jobs are kept only long enough for the waiting action to read
    // them, and this poll is the one heartbeat that happens regardless of work.
    const stale = await ctx.db
      .query("machineJobs")
      .withIndex("by_state", (q) => q.eq("state", "done"))
      .order("asc")
      .take(6);
    for (const job of stale) {
      if (job.finishedAt && job.finishedAt < now - 10 * 60_000) {
        await ctx.db.delete(job._id);
      }
    }

    const waiting = await ctx.db
      .query("machineJobs")
      .withIndex("by_user_state", (q) => q.eq("userId", machine.userId).eq("state", "queued"))
      .order("asc")
      .take(1);
    const job = waiting[0];
    if (!job) return { ok: true as const, job: null };

    await ctx.db.patch(job._id, { state: "running", startedAt: now });
    return {
      ok: true as const,
      job: {
        id: job._id,
        language: job.language,
        source: job.source,
        stdin: job.stdin,
        packages: job.packages,
        timeoutMs: job.timeoutMs,
        artifactToken: job.artifactToken ?? null,
      },
    };
  },
});

/**
 * The worker's answer.
 *
 * Refused unless the job is running and belongs to the machine that is
 * reporting, so a token cannot write into somebody else's run. A result that
 * arrives twice — the cell retried after a network blip — is accepted once and
 * ignored after that.
 */
export const finish = internalMutation({
  args: {
    token: v.string(),
    jobId: v.string(),
    output: v.string(),
    error: v.string(),
    failed: v.boolean(),
    timedOut: v.boolean(),
    exitCode: v.number(),
    ms: v.number(),
  },
  handler: async (ctx, args) => {
    const machine = await ctx.db
      .query("machines")
      .withIndex("by_token", (q) => q.eq("token", args.token))
      .first();
    if (!machine) return false;

    // The worker has this as a plain string from JSON, so an id that is not
    // even shaped like one has to fail as a refusal rather than a thrown 500.
    const jobId = ctx.db.normalizeId("machineJobs", args.jobId);
    if (!jobId) return false;
    const job = await ctx.db.get(jobId);
    if (!job || job.userId !== machine.userId) return false;
    if (job.state !== "running") return job.state === "done";

    await ctx.db.patch(job._id, {
      state: "done",
      output: clamp(args.output ?? "", MAX_OUTPUT_CHARS),
      error: clamp(args.error ?? "", MAX_OUTPUT_CHARS),
      failed: args.failed,
      timedOut: args.timedOut,
      exitCode: args.exitCode,
      finishedAt: Date.now(),
    });
    await ctx.db.patch(machine._id, {
      lastSeenAt: Date.now(),
      jobsRun: machine.jobsRun + 1,
      lastError: undefined,
    });
    return true;
  },
});

// ---------------------------------------------------------------------------
// From the runner
// ---------------------------------------------------------------------------

/** The machine, if there is one, with whether it is worth waiting for. */
export const machineForUser = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const machine = await ctx.db
      .query("machines")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    if (!machine) return null;
    return {
      online: Date.now() - machine.lastSeenAt < ONLINE_WINDOW_MS,
      version: machine.version ?? null,
      platform: machine.platform ?? null,
      lastSeenAt: machine.lastSeenAt,
    };
  },
});

/** Queue a job. Refused when the machine already has a backlog. */
export const enqueue = internalMutation({
  args: {
    userId: v.id("users"),
    language: v.string(),
    source: v.string(),
    stdin: v.string(),
    packages: v.array(v.string()),
    artifactToken: v.optional(v.string()),
    timeoutMs: v.number(),
  },
  handler: async (ctx, args) => {
    const waiting = await ctx.db
      .query("machineJobs")
      .withIndex("by_user_state", (q) => q.eq("userId", args.userId).eq("state", "queued"))
      .take(MAX_QUEUED);
    if (waiting.length >= MAX_QUEUED) return null;

    return await ctx.db.insert("machineJobs", {
      userId: args.userId,
      language: args.language,
      source: clamp(args.source, MAX_SOURCE_CHARS),
      stdin: args.stdin,
      packages: args.packages,
      artifactToken: args.artifactToken,
      state: "queued",
      output: "",
      error: "",
      failed: false,
      timedOut: false,
      exitCode: 0,
      timeoutMs: args.timeoutMs,
      createdAt: Date.now(),
    });
  },
});

/** What the runner polls while it waits. */
export const jobState = internalQuery({
  args: { jobId: v.id("machineJobs") },
  handler: async (ctx, { jobId }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return null;
    return {
      state: job.state,
      output: job.output,
      error: job.error,
      failed: job.failed,
      timedOut: job.timedOut,
      exitCode: job.exitCode,
      startedAt: job.startedAt ?? null,
      finishedAt: job.finishedAt ?? null,
    };
  },
});

/**
 * Give up on a job the runner stopped waiting for.
 *
 * Nothing is deleted: if the worker answers a moment later, `finish` finds a
 * job that is no longer running and quietly drops the result, which is exactly
 * what should happen after the user has already been given the sandbox answer.
 */
export const abandon = internalMutation({
  args: { jobId: v.id("machineJobs"), message: v.string() },
  handler: async (ctx, { jobId, message }) => {
    const job = await ctx.db.get(jobId);
    if (!job) return false;
    if (job.state === "done") return false;
    await ctx.db.patch(jobId, {
      state: "error",
      error: message,
      finishedAt: Date.now(),
    });
    return true;
  },
});

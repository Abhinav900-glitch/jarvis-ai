import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

// ---------------------------------------------------------------------------
// The scheduler sweep.
//
// Every five minutes the cron calls scheduledTasks.runDueTasks, which finds the
// tasks whose time has come, runs them, and writes each answer into its chat.
//
// Five minutes is the resolution a person actually perceives: a "daily at 09:00"
// task that fires at 09:03 is still a daily 09:00 task, and it costs a fraction
// of a per-minute sweep.
//
// This module exports only the registry, because a module whose default export
// is a cron registry may not export anything else. The sweep body lives in
// scheduledTasks.ts.
// ---------------------------------------------------------------------------

const crons = cronJobs();

crons.cron(
  "*/5 * * * *",
  "scheduled tasks sweep",
  internal.scheduledTasks.runDueTasks,
);

export default crons;
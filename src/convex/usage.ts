// ---------------------------------------------------------------------------
// Per-day message and token usage for the signed-in account.
//
// Reads `chatMessages` through the existing `by_user` index, newest first, and
// buckets the rows into UTC days. Buckets are seeded for the whole window so
// the chart has a continuous x-axis instead of collapsing quiet days.
//
// Tokens are only counted when the provider reported them; several engines
// answer without usage numbers, which is why the caller also gets a coverage
// count and can say so rather than presenting the total as complete.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { query } from "./_generated/server";

const DAY_MS = 86_400_000;
/** Enough for a year of heavy personal use, and one indexed read. */
const MAX_ROWS = 5_000;

export const daily = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    const days = Math.min(90, Math.max(7, Math.round(args.days ?? 30)));

    if (!userId) {
      return {
        window: days,
        points: [],
        totals: { messages: 0, tokens: 0 },
        reported: 0,
        replies: 0,
      };
    }

    const now = new Date();
    const todayStart = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    const start = todayStart - (days - 1) * DAY_MS;

    const buckets = new Map<
      string,
      { messages: number; tokens: number; promptTokens: number; completionTokens: number }
    >();
    for (let i = 0; i < days; i++) {
      const key = new Date(start + i * DAY_MS).toISOString().slice(0, 10);
      buckets.set(key, {
        messages: 0,
        tokens: 0,
        promptTokens: 0,
        completionTokens: 0,
      });
    }

    // Newest first, then drop anything older than the window. Without the
    // `order("desc")` this would read the oldest rows and chart the wrong end
    // of a long conversation history.
    const rows = await ctx.db
      .query("chatMessages")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(MAX_ROWS);

    let reported = 0;
    let replies = 0;
    for (const row of rows) {
      if (row.createdAt < start) continue;
      if (row.role === "system") continue;
      const key = new Date(row.createdAt).toISOString().slice(0, 10);
      const bucket = buckets.get(key);
      if (!bucket) continue;

      bucket.messages += 1;
      if (row.role === "assistant") replies += 1;
      const prompt = row.promptTokens ?? 0;
      const completion = row.completionTokens ?? 0;
      if (row.promptTokens !== undefined || row.completionTokens !== undefined) {
        reported += 1;
      }
      bucket.promptTokens += prompt;
      bucket.completionTokens += completion;
      bucket.tokens += prompt + completion;
    }

    const points = [...buckets.entries()].map(([date, bucket]) => ({
      date,
      ...bucket,
    }));
    const totals = points.reduce(
      (sum, point) => ({
        messages: sum.messages + point.messages,
        tokens: sum.tokens + point.tokens,
      }),
      { messages: 0, tokens: 0 },
    );

    return { window: days, points, totals, reported, replies };
  },
});

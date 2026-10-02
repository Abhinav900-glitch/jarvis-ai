"use node";

// ---------------------------------------------------------------------------
// Jarvis Code — the agentic surface.
//
// A run is one task handed over. Jarvis plans it, works the steps, and keeps
// going on its own. The design constraint the user actually asked for is the
// gate: the agent decides everything it can reasonably decide by itself, and
// stops for the user only when a step is genuinely theirs to call — deleting
// something, spending money, putting a credential in play, or pushing outward
// to a person. Everything else it just gets on with.
//
// Three decisions worth stating plainly, because all of them are load-bearing:
//
//   1. The gate is CODE, not the model. If "should I ask?" were a prompt line,
//      the agent would wave through exactly the steps that matter — a model
//      asked to be cautious is unreliable precisely when caution is expensive.
//      The rules live in lib/agent-contract.ts, cannot be argued with, and the
//      UI shows which one fired. The model may *also* ask, but only the code can
//      force a stop.
//
//   2. One model call per step, not two. A separate "execute" call and a
//      separate "decide" call would double the cost of every step, and the free
//      tier allows 50 requests a day. So the executor returns a single envelope
//      carrying its output *and* its decision about what happens next, and
//      re-planning rides along in that envelope instead of costing a call.
//      That is the difference between a 6-step run costing 7 requests and 13.
//
//   3. Persistence lives in agentStore.ts, not here. A Convex module marked
//      `"use node"` may only export actions, so the thing that drives the agent
//      cannot own the tables it writes. This file runs the loop; that one
//      stores it.
//
// Cost note, since it constrains everything: OpenRouter's free tier is 20
// requests/minute and 50/day, or 1,000/day once a one-time $10 of credits has
// been bought. The existing keyed providers remain the fallback when the free
// pool is dry, which is why the plan prefers free engines but never requires
// them.
// ---------------------------------------------------------------------------

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { GenericActionCtx } from "convex/server";
import type { DataModel, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { runProviderChain, type ChatTurn } from "./ai";
import { inferTask, rankEngines, type RankedEngine } from "./engines";
import { gateFor } from "../lib/agent-contract";

/** A plan longer than this is not a plan, it is a wish list. */
const MAX_PLAN_STEPS = 6;
/** Steps worked per `advance` call, so one action never runs long. */
const MAX_STEPS_PER_ADVANCE = 3;
/** Characters of earlier step output carried into the next step's prompt. */
const CONTEXT_CHARS = 600;

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const PLANNER_SYSTEM = `You are Jarvis, planning a task you will then carry out yourself, one step at a time.

Break the goal into the smallest number of steps that actually finishes it. Each step must be independently checkable — a step whose output you cannot tell is right or wrong is two steps pretending to be one.

Rules:
- Between 2 and ${MAX_PLAN_STEPS} steps. Fewer is better. Never pad.
- No step may be "ask the user for permission" — you decide what you can decide yourself.
- Put anything irreversible, outward-facing, expensive, or credential-touching in its own final step, phrased as the concrete action ("Send the revised contract to legal"), so it can be gated before it runs.
- The \`detail\` is one sentence of instruction to yourself. Not context, not preamble.

Reply with JSON only, no prose and no code fence:
{"title":"a four-word name for the run","steps":[{"title":"imperative, under 60 chars","detail":"one sentence"}]}`;

const EXECUTOR_SYSTEM = `You are Jarvis, working one step of a task you planned. You decide how to approach it. You do not ask permission for anything reversible.

Reply with JSON only, no prose and no code fence:
{"output":"the result of this step, in full — this is what the user reads","status":"continue|done|needs_decision|blocked","next":"if continuing, the single next action, phrased concretely; empty otherwise","question":"if needs_decision, the exact question for the user; empty otherwise","options":["if needs_decision, 2-4 concrete options; empty otherwise"],"rationale":"one short clause on how you approached this step"}

Status:
- "continue" — step worked, more to do.
- "done" — the whole goal is now satisfied. \`output\` is the complete answer, written for the person who set the task.
- "needs_decision" — you hit a genuine fork. Only for a real choice between materially different directions, never to confirm routine progress. Put the decision in \`question\` and the options in \`options\`.
- "blocked" — you cannot proceed without something you do not have. Say what in \`output\`.

Write \`output\` for a human: conclusion first, no restating the step, no filler, no trailing summary of what you just said. Use fenced code for code.`;

// ---------------------------------------------------------------------------
// Engine selection
// ---------------------------------------------------------------------------

/**
 * Route one agent call.
 *
 * Prefers the free OpenRouter roster when a key exists, because it is the
 * widest pool and costs nothing — a run should spend free capacity before it
 * spends a metered one. The sort is stable, so within each group the router's
 * own scoring still decides; this only decides which group goes first, and with
 * no OpenRouter key it changes nothing at all.
 */
function agentPlan(text: string, promptChars: number) {
  const task = inferTask(text, false);
  const plan = rankEngines({ task, order: "smart", promptChars });
  const freeFirst = (e: RankedEngine) => e.engine.provider === "openrouter";
  const ranked = [...plan.ranked].sort(
    (a, b) => Number(freeFirst(b)) - Number(freeFirst(a)),
  );
  const usable = ranked.filter((e) => e.available);
  return {
    ...plan,
    ranked,
    usable,
    primary: usable[0] ?? null,
    reason: usable[0]
      ? `${usable[0].engine.label} — ${usable[0].because}`
      : "No AI provider is configured for this deployment.",
  };
}

// ---------------------------------------------------------------------------
// Parsing model output
// ---------------------------------------------------------------------------

interface Envelope {
  output: string;
  status: "continue" | "done" | "needs_decision" | "blocked";
  next: string;
  question: string;
  options: string[];
  rationale: string;
}

/** Trim a model reply down to its first JSON object, fences and prose included. */
function jsonSlice(text: string): string | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fence?.[1] ?? text).trim();
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return body.slice(start, end + 1);
}

/**
 * Pull the envelope out of whatever the model actually sent.
 *
 * Free models are inconsistent about fences and preamble, and a parse failure
 * must not cost the user their step. So the whole text is kept as `output` when
 * nothing parses — a plan that slightly disobeys the format is far better than
 * a run that stops on step one.
 */
function parseEnvelope(raw: string): Envelope {
  const text = (raw ?? "").trim();
  const bare: Envelope = {
    output: text,
    status: "continue",
    next: "",
    question: "",
    options: [],
    rationale: "",
  };
  if (!text) return bare;

  const slice = jsonSlice(text);
  if (!slice) return bare;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(slice) as Record<string, unknown>;
  } catch {
    return bare;
  }

  const asString = (value: unknown) => (typeof value === "string" ? value : "");
  const claimed = asString(parsed.status).toLowerCase();
  const status =
    claimed === "done" || claimed === "needs_decision" || claimed === "blocked"
      ? claimed
      : "continue";

  return {
    output: asString(parsed.output) || text,
    status,
    next: asString(parsed.next).slice(0, 300),
    question: asString(parsed.question).slice(0, 400),
    options: Array.isArray(parsed.options)
      ? parsed.options
          .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
          .slice(0, 4)
          .map((o) => o.slice(0, 200))
      : [],
    rationale: asString(parsed.rationale).slice(0, 240),
  };
}

interface PlannedStep {
  title: string;
  detail: string;
}

function parsePlan(
  raw: string,
  goal: string,
): { title: string; steps: PlannedStep[] } {
  // Never dead-end on a formatting slip: an unparseable plan becomes one step
  // that just does the goal, which is worse planning but a working run.
  const fallback = {
    title: goal.slice(0, 60),
    steps: [{ title: `Work on: ${goal.slice(0, 80)}`, detail: goal.slice(0, 500) }],
  };

  const slice = jsonSlice((raw ?? "").trim());
  if (!slice) return fallback;

  let parsed: { title?: unknown; steps?: unknown };
  try {
    parsed = JSON.parse(slice) as { title?: unknown; steps?: unknown };
  } catch {
    return fallback;
  }

  const rows = Array.isArray(parsed.steps) ? parsed.steps : [];
  const steps: PlannedStep[] = rows
    .filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null)
    .map((r) => ({
      title: String(r.title ?? "").trim().slice(0, 120),
      detail: String(r.detail ?? "").trim().slice(0, 500),
    }))
    .filter((s) => s.title.length > 0)
    .slice(0, MAX_PLAN_STEPS);

  if (steps.length === 0) return fallback;
  return {
    title: String(parsed.title ?? "").trim().slice(0, 80) || fallback.title,
    steps,
  };
}

// ---------------------------------------------------------------------------
// The loop
// ---------------------------------------------------------------------------

interface RunRow {
  goal: string;
  status: string;
  planned: number;
  done: number;
  calls: number;
}

interface StepRow {
  _id: Id<"agentSteps">;
  position: number;
  title: string;
  detail?: string;
  status: string;
  output?: string;
}

const message = (err: unknown) =>
  err instanceof Error ? err.message : String(err).slice(0, 200);

/**
 * Work steps until the run finishes, blocks, or the per-call budget runs out.
 *
 * Shared by `advance` (the normal case) and `answer` (after the user has
 * unblocked a step) so both resume through identical logic.
 */
async function runLoop(
  ctx: GenericActionCtx<DataModel>,
  runId: Id<"agentRuns">,
  userId: Id<"users">,
): Promise<{ status: string; remaining: number }> {
  let budget = MAX_STEPS_PER_ADVANCE;

  for (;;) {
    const run = (await ctx.runQuery(internal.agentStore.getRun, {
      runId,
      userId,
    })) as RunRow | null;
    if (!run) throw new Error("That run no longer exists.");
    if (run.status !== "running") return { status: run.status, remaining: budget };

    const step = (await ctx.runQuery(internal.agentStore.nextStep, {
      runId,
      userId,
    })) as StepRow | null;

    if (!step) {
      // The plan ran out without the model ever saying "done". Report that
      // honestly rather than inventing a conclusion.
      await ctx.runMutation(internal.agentStore.setRun, {
        runId,
        status: "done",
        answer:
          run.done > 0
            ? `Worked all ${run.done} planned step${run.done === 1 ? "" : "s"}. No final summary was produced.`
            : "Nothing was actionable in the plan.",
        now: Date.now(),
      });
      return { status: "done", remaining: budget };
    }

    const stepText = `${step.title}. ${step.detail ?? ""}`;

    // --- the gate, before any request is spent ---------------------------
    const gate = gateFor(stepText);
    if (gate) {
      await ctx.runMutation(internal.agentStore.gateStep, {
        stepId: step._id,
        reason: gate,
        question: `${step.title} — this ${gate}, so it is yours to call.`,
        options: [],
      });
      await ctx.runMutation(internal.agentStore.setRun, {
        runId,
        status: "awaiting_user",
        now: Date.now(),
      });
      return { status: "awaiting_user", remaining: budget };
    }

    await ctx.runMutation(internal.agentStore.patchStep, {
      stepId: step._id,
      patch: { status: "running" },
    });

    // --- context: the goal plus what earlier steps produced ---------------
    const history = (await ctx.runQuery(internal.agentStore.runSteps, {
      runId,
      userId,
    })) as StepRow[];

    const brief = history
      .filter((h) => h.status === "done" && h.output)
      .slice(-6)
      .map(
        (h, i) =>
          `${i + 1}. ${h.title}\n${(h.output ?? "").slice(0, CONTEXT_CHARS)}`,
      )
      .join("\n\n");

    const prompt = [
      `GOAL\n${run.goal}`,
      brief ? `\nWHAT YOU HAVE ALREADY DONE\n${brief}` : "",
      `\nTHIS STEP (${step.position + 1} of ${run.planned || "?"})\n${step.title}\n${step.detail ?? ""}`,
      "\nReturn the JSON envelope only.",
    ]
      .filter(Boolean)
      .join("\n");

    // --- run it ------------------------------------------------------------
    let result;
    try {
      const plan = agentPlan(stepText, prompt.length);
      const turns: ChatTurn[] = [{ role: "user", content: prompt }];
      result = await runProviderChain(
        turns,
        EXECUTOR_SYSTEM,
        "Every engine failed on this step.",
        plan,
      );
    } catch (err) {
      const detail = message(err);
      await ctx.runMutation(internal.agentStore.patchStep, {
        stepId: step._id,
        patch: { status: "failed", output: detail },
      });
      await ctx.runMutation(internal.agentStore.setRun, {
        runId,
        status: "failed",
        error: detail,
        now: Date.now(),
      });
      return { status: "failed", remaining: budget };
    }

    const env = parseEnvelope(result.text);
    budget--;

    // The model hit a fork. Same treatment as a code gate: stop, and say why.
    if (env.status === "needs_decision") {
      await ctx.runMutation(internal.agentStore.gateStep, {
        stepId: step._id,
        reason: env.rationale || "Jarvis hit a fork it should not settle alone",
        question: env.question || `${step.title} — how should I proceed?`,
        options: env.options,
      });
      await ctx.runMutation(internal.agentStore.setRun, {
        runId,
        status: "awaiting_user",
        now: Date.now(),
      });
      return { status: "awaiting_user", remaining: budget };
    }

    if (env.status === "blocked") {
      await ctx.runMutation(internal.agentStore.patchStep, {
        stepId: step._id,
        patch: {
          status: "failed",
          output: env.output,
          engineId: result.engineId,
        },
      });
      await ctx.runMutation(internal.agentStore.setRun, {
        runId,
        status: "failed",
        error: env.output.slice(0, 400),
        now: Date.now(),
      });
      return { status: "failed", remaining: budget };
    }

    await ctx.runMutation(internal.agentStore.patchStep, {
      stepId: step._id,
      patch: {
        status: "done",
        output: env.output,
        rationale: env.rationale,
        engineId: result.engineId,
      },
    });
    await ctx.runMutation(internal.agentStore.bumpRun, { runId, calls: 1 });

    if (env.status === "done") {
      await ctx.runMutation(internal.agentStore.setRun, {
        runId,
        status: "done",
        answer: env.output,
        now: Date.now(),
      });
      return { status: "done", remaining: budget };
    }

    // Re-planning is free — it rode along in the envelope.
    if (env.next) {
      const next = (await ctx.runQuery(internal.agentStore.nextStep, {
        runId,
        userId,
      })) as StepRow | null;
      if (next) {
        await ctx.runMutation(internal.agentStore.patchStep, {
          stepId: next._id,
          patch: { title: env.next.slice(0, 120) },
        });
      }
    }

    if (budget <= 0) return { status: "running", remaining: 0 };
  }
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * Start a run: one request to plan, then store the plan as steps.
 *
 * Planning is kept separate from execution on purpose. The free tier allows 50
 * requests a day, so the client is expected to call `advance` straight after
 * this returns — but the user should see the plan land before any of it runs.
 */
export const start = action({
  args: { goal: v.string() },
  handler: async (ctx, args): Promise<{ runId: Id<"agentRuns"> }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use Jarvis Code.");
    const goal = args.goal.trim().slice(0, 4000);
    if (goal.length < 8) {
      throw new Error("Give Jarvis a real task — a sentence or two.");
    }

    const now = Date.now();
    const runId = (await ctx.runMutation(internal.agentStore.createRun, {
      userId,
      goal,
      title: goal.slice(0, 70),
      now,
    })) as Id<"agentRuns">;

    let plan: { title: string; steps: PlannedStep[] };
    try {
      const route = agentPlan(goal, goal.length);
      const result = await runProviderChain(
        [{ role: "user", content: `GOAL\n${goal}` }],
        PLANNER_SYSTEM,
        "Could not plan this task.",
        route,
      );
      plan = parsePlan(result.text, goal);
    } catch (err) {
      await ctx.runMutation(internal.agentStore.setRun, {
        runId,
        status: "failed",
        error: message(err),
        now: Date.now(),
      });
      return { runId };
    }

    await ctx.runMutation(internal.agentStore.addSteps, {
      runId,
      userId,
      title: plan.title,
      steps: plan.steps,
      now,
    });
    return { runId };
  },
});

/** Work the next steps. Safe to call repeatedly; the loop holds the budget. */
export const advance = action({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args): Promise<{ status: string; remaining: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use Jarvis Code.");
    return runLoop(ctx, args.runId, userId);
  },
});

/** The user's call on a gated step, then straight back into the loop. */
export const answer = action({
  args: { runId: v.id("agentRuns"), choice: v.string() },
  handler: async (ctx, args): Promise<{ status: string; remaining: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use Jarvis Code.");
    const choice = args.choice.trim().slice(0, 600);
    if (!choice) throw new Error("Pick an option or type what to do.");

    const step = (await ctx.runQuery(internal.agentStore.gatedStep, {
      runId: args.runId,
      userId,
    })) as StepRow | null;
    if (!step) throw new Error("Nothing is waiting on you.");

    // Recorded as a completed step, not a skipped one: the user's decision is
    // part of the run's history, and later steps need to see it.
    await ctx.runMutation(internal.agentStore.patchStep, {
      stepId: step._id,
      patch: {
        status: "done",
        answer: choice,
        output: `You decided: ${choice}`,
      },
    });
    await ctx.runMutation(internal.agentStore.setRun, {
      runId: args.runId,
      status: "running",
      now: Date.now(),
    });

    return runLoop(ctx, args.runId, userId);
  },
});

export const cancel = action({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use Jarvis Code.");
    await ctx.runMutation(internal.agentStore.cancelRun, {
      runId: args.runId,
      userId,
      now: Date.now(),
    });
    return { status: "cancelled" };
  },
});

/**
 * What is free right now, read live from OpenRouter.
 *
 * Deliberately not cached and not hardcoded. The `:free` roster turns over
 * month to month — DeepSeek R1, Qwen3 Coder 480B, Llama 3.3 70B and Llama 4
 * Scout were all free earlier in 2026 and are not now — so a static list in the
 * registry is a list that is quietly wrong. The named engines there are fast
 * paths; this is the truth.
 */
export const freeRoster = action({
  args: {},
  handler: async (): Promise<{
    models: { id: string; label: string; context: number }[];
    configured: boolean;
    error: string | null;
  }> => {
    const key =
      process.env.OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER_KEY?.trim();
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        return {
          models: [],
          configured: Boolean(key),
          error: `Roster (${res.status})`,
        };
      }
      const data = (await res.json()) as {
        data?: { id?: string; name?: string; context_length?: number }[];
      };
      const models = (data.data ?? [])
        .filter(
          (m): m is { id: string; name?: string; context_length?: number } =>
            typeof m.id === "string" && m.id.endsWith(":free"),
        )
        .map((m) => ({
          id: m.id,
          label: m.name ?? m.id,
          context: m.context_length ?? 0,
        }))
        .sort((a, b) => b.context - a.context);
      return { models, configured: Boolean(key), error: null };
    } catch (err) {
      return {
        models: [],
        configured: Boolean(key),
        error: message(err).slice(0, 120),
      };
    }
  },
});

/**
 * How much free-tier budget is left today.
 *
 * Worth a round trip on its own: 50 requests a day is roughly four to seven
 * agent runs, and knowing that before starting a long task is the difference
 * between a quota surprise and a plan.
 */
export const quota = action({
  args: {},
  handler: async (): Promise<{
    configured: boolean;
    usage: number | null;
    limitRemaining: number | null;
    isFreeTier: boolean | null;
  }> => {
    const key =
      process.env.OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER_KEY?.trim();
    const blank = {
      configured: Boolean(key),
      usage: null,
      limitRemaining: null,
      isFreeTier: null,
    };
    if (!key) return { ...blank, configured: false };

    try {
      const res = await fetch("https://openrouter.ai/api/v1/key", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) return blank;
      const body = (await res.json()) as {
        data?: {
          usage?: number;
          limit_remaining?: number | null;
          is_free_tier?: boolean;
        };
      };
      return {
        configured: true,
        usage: body.data?.usage ?? null,
        limitRemaining: body.data?.limit_remaining ?? null,
        isFreeTier: body.data?.is_free_tier ?? null,
      };
    } catch {
      return blank;
    }
  },
});

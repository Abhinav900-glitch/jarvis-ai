"use node";

// ---------------------------------------------------------------------------
// AeroTransformGen Dev — the agentic surface.
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
import { inferTask, rankEngines, ENGINES, retiringSoon, type RankedEngine } from "./engines";
import { gateFor } from "../lib/agent-contract";
import { executeTool, type ExecContext } from "./agentExec";
import {
  assistantToolMessage,
  languageForPath,
  toolMessage,
  toolSpecs,
  type AgentMode,
} from "../lib/agent-tools";

/** A plan longer than this is not a plan, it is a wish list. */
const MAX_PLAN_STEPS = 6;
/**
 * Steps worked per `advance` call.
 *
 * Two rather than three, because a step is no longer one request: each may
 * spend up to {@link MAX_TOOL_ITERATIONS} on tool rounds. Two steps is a worst
 * case of eight requests per call, which keeps a full run inside the free
 * tier's daily allowance instead of eating it.
 */
const MAX_STEPS_PER_ADVANCE = 2;
/** Characters of earlier step output carried into the next step's prompt. */
const CONTEXT_CHARS = 600;
/**
 * Model calls one step may spend on tool use.
 *
 * Each iteration is a real request, and the free tier allows 50 a day, so this
 * is the main cost dial. Four is enough for read → edit → run → correct, which
 * is the shape of most real work; beyond that the loop is thrashing and the
 * model should summarise what it has instead.
 */
const MAX_TOOL_ITERATIONS = 4;
/**
 * Characters of one request or response kept for the trace inspector.
 *
 * A step's message list carries tool output the model has read, so it runs to
 * tens of kilobytes; clipping keeps a recorded step the same size as an
 * unrecorded one, give or take, while still showing what was actually sent.
 */
const TRACE_CHARS = 12_000;

const clip = (s: string) =>
  s.length > TRACE_CHARS
    ? `${s.slice(0, TRACE_CHARS)}\n…[truncated ${s.length - TRACE_CHARS} characters]`
    : s;

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

const CODER_SYSTEM = `You are Jarvis, working one step of a task you planned, in a real workspace of files you can read, edit and run.

How to work:
- Use the tools. A step that needs to know what a file says is done by reading it, not by recalling what such a file usually says. You cannot see the workspace otherwise.
- Read before you write. An edit must match the current text exactly; guessing wastes the attempt and the request.
- Make one change at a time, then check it. Prefer edit_file over write_file — a full overwrite silently discards whatever you did not read.
- Run what you write. A file you created or changed is unverified until run_file has executed it here and you have read its exit code and stderr. Looking correct is not evidence; code that has never run is not finished. If it genuinely cannot run in this sandbox, say so plainly instead of implying it works.
- If a tool tells you it was refused or the edit was only proposed, believe it and adapt. Never claim a file contains something you have not seen.
- Stop when the step is done. Say so rather than starting the next piece of work.

When the step is finished, reply with JSON only, no prose and no code fence:
{"output":"the result of this step, in full — this is what the user reads","status":"continue|done|needs_decision|blocked","next":"if continuing, the single next action, phrased concretely; empty otherwise","question":"if needs_decision, the exact question for the user; empty otherwise","options":["if needs_decision, 2-4 concrete options; empty otherwise"],"rationale":"one short clause on how you approached this step"}

Status:
- "continue" — step worked, more to do.
- "done" — the whole goal is now satisfied. \`output\` is the complete answer, written for the person who set the task. Never for code you have written but not run.
- "needs_decision" — you hit a genuine fork. Only for a real choice between materially different directions, never to confirm routine progress. Put the decision in \`question\` and the options in \`options\`.
- "blocked" — you cannot proceed without something you do not have. Say what in \`output\`.

Write \`output\` for a human: conclusion first, no restating the step, no filler, no trailing summary of what you just said. Use fenced code for code.`;

// ---------------------------------------------------------------------------
// Engine selection
// ---------------------------------------------------------------------------

/**
 * Route one agent call.
 *
 * Prefers the free OpenRouter roster, because it is the widest pool and costs
 * nothing — a run should spend free capacity before it spends a metered one.
 *
 * The fallback *order* itself is not built here. `runProviderChain` round-robins
 * across providers when it walks the plan, and doing that here as well would be
 * undone: it regroups the ranking into per-provider blocks before attempting
 * anything, so a plan sorted this way still tries every OpenRouter engine
 * before it ever reaches Mistral. One withdrawn model would cost a dozen
 * attempts — most of a free day's budget — to discover one bad URL.
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
  mode: AgentMode;
  /** Whether request/response bodies are being recorded for this run. */
  debug?: boolean;
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

/** The `path` a tool call names, or an empty string when it names none. */
function callPath(call: { arguments: string }): string {
  try {
    const parsed = JSON.parse(call.arguments || "{}") as { path?: unknown };
    return typeof parsed.path === "string" ? parsed.path.trim() : "";
  } catch {
    return "";
  }
}

/**
 * Work one step, letting the model reach for tools until it answers in prose.
 *
 * The loop is the part that makes this a coding agent rather than a chat turn:
 * the model is given functions, calls one, the result goes back, and it
 * decides again. It ends when the model replies *without* requesting a tool —
 * which, for a model that ignores tools entirely, is simply the first
 * iteration, so an engine without tool support degrades to the previous
 * behaviour rather than breaking.
 *
 * Two exits other than "the model answered":
 *   - a tool proposed an edit in `ask` mode, so the run must pause;
 *   - the iteration cap, which is reported as-is rather than quietly presented
 *     as a finished step.
 */
async function runStepWithTools(
  ctx: GenericActionCtx<DataModel>,
  run: RunRow,
  step: StepRow,
  history: StepRow[],
  ec: ExecContext,
): Promise<{ env: Envelope | null; proposed: boolean; activity: string[] }> {
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
    "\nUse the tools to find out what you need, then return the JSON envelope.",
  ]
    .filter(Boolean)
    .join("\n");

  const messages: ChatTurn[] = [{ role: "user", content: prompt }];
  const tools = toolSpecs(ec.mode);
  const activity: string[] = [];
  /** A runnable file this step changed and has not executed since. */
  let unrun: string | null = null;
  /** How the last execution went, so "done" can be checked against evidence. */
  let lastRun: { path: string; ok: boolean; detail: string } | null = null;
  /** One forced repair round; after that the step is reported honestly. */
  let nudged = false;

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const stepText = `${step.title}. ${step.detail ?? ""}`;
    const plan = agentPlan(stepText, JSON.stringify(messages).length);
    const result = await runProviderChain(
      messages,
      CODER_SYSTEM,
      "Every engine failed on this step.",
      plan,
      // Low temperature: a model rewriting code should not be exploring.
      { tools, temperature: 0.2 },
    );

    // Two writes per round, both live: the console log is always kept because
    // it is small and it is the product, and the request/response trace only
    // when the run has recording on, because bodies are the largest strings
    // this app stores.
    const roundCalls = result.toolCalls ?? [];
    await ctx.runMutation(internal.agentStore.logStep, {
      stepId: step._id,
      entry: {
        at: Date.now(),
        kind: "model",
        label: result.engineId ?? result.model,
        detail: roundCalls.length
          ? `${roundCalls.length} tool call${roundCalls.length === 1 ? "" : "s"}`
          : "answered in prose",
        ms: result.latencyMs,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
      },
    });
    if (run.debug) {
      await ctx.runMutation(internal.agentStore.appendTrace, {
        stepId: step._id,
        entry: {
          round: i + 1,
          engineId: result.engineId,
          model: result.model,
          ms: result.latencyMs,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          // The messages as they were sent for this round — captured before
          // the replies below are pushed onto the same array.
          request: clip(JSON.stringify(messages, null, 2)),
          response: clip(
            result.text ||
              `[${roundCalls.length} tool call${roundCalls.length === 1 ? "" : "s"}: ${roundCalls.map((c) => c.name).join(", ")}]`,
          ),
          toolCalls: roundCalls.map((c) => c.name).join(", ") || undefined,
        },
      });
    }

    if (roundCalls.length === 0) {
      const env = parseEnvelope(result.text);
      // A model can be certain about code it never ran; the sandbox cannot be.
      // When the last execution failed, the step is not finished, so one repair
      // round is forced and the failure has to be dealt with here instead of
      // being described away in the final answer.
      const canRetry = i < MAX_TOOL_ITERATIONS - 1;
      const claimsProgress = env.status !== "blocked" && env.status !== "needs_decision";
      if (lastRun && !lastRun.ok && !nudged && canRetry && claimsProgress) {
        nudged = true;
        messages.push({
          role: "assistant",
          content: result.text.trim() || "Not finished.",
        });
        messages.push({
          role: "user",
          content: [
            `Not finished: ${lastRun.path} fails when it runs.`,
            lastRun.detail.slice(0, 2500),
            "Fix the cause and run it again with run_file. Only answer once it exits clean, or say plainly what you could not make work.",
          ].join("\n\n"),
        });
        continue;
      }
      return { env, proposed: false, activity };
    }

    messages.push(assistantToolMessage(result.text, roundCalls));
    // The whole batch is worked before the pause, not just its first edit:
    // four writes in one round become four proposals the user can approve in a
    // single click. Nothing reasons over a half-applied batch either — these
    // messages are discarded when we return, so the next turn starts from the
    // workspace as it actually is after the decisions.
    let proposed = false;
    for (const call of roundCalls) {
      const called = Date.now();
      const outcome = await executeTool(ec, call);
      activity.push(`${call.name} → ${outcome.summary}`);
      // Timed around the call itself, so `run_code` shows what a slow program
      // actually cost instead of being booked against the model round above.
      await ctx.runMutation(internal.agentStore.logStep, {
        stepId: step._id,
        entry: {
          at: Date.now(),
          kind: "tool",
          label: call.name,
          detail: outcome.summary,
          ms: Date.now() - called,
        },
      });
      messages.push(toolMessage(call.id, call.name, outcome.result));
      if (outcome.proposed) proposed = true;
      // A change to a file this sandbox can execute is unverified until it has
      // actually run, so remember the last one. A run of any kind clears it.
      if (outcome.mutated && (call.name === "write_file" || call.name === "edit_file")) {
        const path = callPath(call);
        if (path && languageForPath(path)) unrun = path;
      }
      if (call.name === "run_file" || call.name === "run_code") {
        unrun = null;
        lastRun = {
          path: call.name === "run_file" ? callPath(call) || "that file" : "that snippet",
          ok: !outcome.refused,
          detail: outcome.result,
        };
      }
    }
    if (proposed) return { env: null, proposed: true, activity };

    // The model may simply forget to check its work, so the check is not left
    // solely to it: a runnable file changed this round gets run once here, and
    // the output goes back into the transcript. Its next round sees the real
    // exit code, and a model that skips straight to prose gets nudged above.
    // Only when a round remains to act on the result — a run nobody reads costs
    // sandbox time and changes nothing.
    if (unrun && i < MAX_TOOL_ITERATIONS - 1) {
      const target = unrun;
      unrun = null;
      const called = Date.now();
      const check = await executeTool(ec, {
        id: `verify-${i}`,
        name: "run_file",
        arguments: JSON.stringify({ path: target }),
      });
      activity.push(`run_file → ${check.summary}`);
      await ctx.runMutation(internal.agentStore.logStep, {
        stepId: step._id,
        entry: {
          at: Date.now(),
          kind: "tool",
          label: "run_file",
          detail: `checked ${target} — ${check.summary}`,
          ms: Date.now() - called,
        },
      });
      lastRun = { path: target, ok: !check.refused, detail: check.result };
      messages.push({
        role: "user",
        content: [
          `AUTOMATIC CHECK — ${target} was changed on this step but never run, so it was run here.`,
          check.result,
          check.refused
            ? "It failed. Fix the cause above, run it with run_file until it exits clean, and only then finish this step."
            : "It exited clean.",
        ].join("\n\n"),
      });
    }
  }

  return {
    env: {
      output: `Spent ${MAX_TOOL_ITERATIONS} tool rounds on this step without settling it.`,
      status: "continue",
      next: "",
      question: "",
      options: [],
      rationale: "",
    },
    proposed: false,
    activity,
  };
}

/**
 * Work steps until the run finishes, blocks, or the per-call budget runs out.
 *
 * Shared by `advance` (the normal case) and `decide` (after the user has
 * answered a gate or an edit proposal) so both resume through identical logic.
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

    const history = (await ctx.runQuery(internal.agentStore.runSteps, {
      runId,
      userId,
    })) as StepRow[];

    // --- run the step ------------------------------------------------------
    let outcome;
    try {
      outcome = await runStepWithTools(
        ctx,
        run,
        step,
        history,
        { ctx, userId, runId, mode: run.mode },
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

    // An edit is sitting unapplied. The step is parked as `needs_decision` so
    // `nextStep` skips it — leaving it `running` would have the very next
    // iteration pick up the same step and propose the same edit again.
    if (outcome.proposed) {
      await ctx.runMutation(internal.agentStore.gateStep, {
        stepId: step._id,
        reason: "edit needs your approval",
        question:
          "Jarvis wants to change a file. Review the diff below and approve or reject it.",
        options: [],
      });
      await ctx.runMutation(internal.agentStore.setRun, {
        runId,
        status: "awaiting_user",
        now: Date.now(),
      });
      return { status: "awaiting_user", remaining: budget };
    }

    const env = outcome.env as Envelope;
    const trail = outcome.activity.length
      ? `\n\n---\nTools: ${outcome.activity.join(" · ")}`
      : "";

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
          output: `${env.output}${trail}`,
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
        output: `${env.output}${trail}`,
        rationale: env.rationale,
      },
    });
    // Billed per tool round, not per step. A step that read three files and
    // edited one cost four requests, and showing it as one would hide exactly
    // the thing the free budget depends on being honest about.
    await ctx.runMutation(internal.agentStore.bumpRun, {
      runId,
      calls: Math.max(1, outcome.activity.length),
    });
    budget--;

    if (env.status === "done") {
      // Auto mode proves the work rather than asserting it. The verify step is
      // appended here instead of at plan time because a run that wrote nothing
      // has nothing to prove — and `appendVerifyStep` refuses a second one, so
      // this cannot loop. Returning `running` hands straight back to the panel's
      // driver, which pokes again because the run document just changed.
      const appended = await ctx.runMutation(
        internal.agentStore.appendVerifyStep,
        { runId, userId, now: Date.now() },
      );
      if (appended) {
        if (budget <= 0) return { status: "running", remaining: 0 };
        continue;
      }
      await ctx.runMutation(internal.agentStore.setRun, {
        runId,
        status: "done",
        answer: `${env.output}${trail}`,
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
// Deciding on proposals
// ---------------------------------------------------------------------------

interface PendingProposal {
  _id: Id<"agentProposals">;
  path: string;
  before?: string;
  after?: string;
  status: string;
}

/**
 * Apply or reject one proposal. Ownership has already been checked — this is
 * the shared half of deciding, so a single approval and an approve-all cannot
 * disagree about what "apply" means.
 *
 * Applying goes through the same checkpoint path `auto` mode uses, so an
 * approved edit is exactly as reversible as an automatic one: the gate changes
 * who decided, not whether it can be undone.
 */
async function decideOne(
  ctx: GenericActionCtx<DataModel>,
  userId: Id<"users">,
  runId: Id<"agentRuns">,
  proposal: PendingProposal,
  decision: "apply" | "reject",
  now: number,
): Promise<void> {
  if (decision === "apply") {
    await ctx.runMutation(internal.agentStore.recordCheckpoint, {
      userId,
      path: proposal.path,
      previous: proposal.before,
      runId,
      now,
    });
    if (proposal.after === undefined) {
      await ctx.runMutation(internal.agentStore.removeFile, {
        userId,
        path: proposal.path,
      });
    } else {
      await ctx.runMutation(internal.agentStore.putFile, {
        userId,
        path: proposal.path,
        content: proposal.after,
        now,
      });
    }
  }

  await ctx.runMutation(internal.agentStore.decideProposal, {
    proposalId: proposal._id,
    status: decision === "apply" ? "applied" : "rejected",
  });
}

/**
 * Un-park the step that asked, put the run back to `running`, resume the loop.
 *
 * The step goes back to `pending` rather than being marked done. Re-running it
 * is deliberate: the model re-reads the file as it now actually is, so an
 * approval lands as "the edit is there, carry on" and a rejection as "that did
 * not happen, find another way". Marking it done would claim work that never
 * happened.
 *
 * The loop is entered once, after every decision has been recorded — several
 * approvals are one decision to the user, not one request each.
 */
async function resumeAfterDecision(
  ctx: GenericActionCtx<DataModel>,
  runId: Id<"agentRuns">,
  userId: Id<"users">,
  decision: "apply" | "reject",
  now: number,
): Promise<{ status: string; remaining: number }> {
  const parked = (await ctx.runQuery(internal.agentStore.gatedStep, {
    runId,
    userId,
  })) as StepRow | null;
  if (parked) {
    await ctx.runMutation(internal.agentStore.patchStep, {
      stepId: parked._id,
      patch: {
        status: "pending",
        question: undefined,
        gateReason: undefined,
        options: undefined,
        answer: decision === "apply" ? "approved" : "rejected",
      },
    });
  }

  await ctx.runMutation(internal.agentStore.setRun, {
    runId,
    status: "running",
    now,
  });
  return runLoop(ctx, runId, userId);
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
  args: {
    goal: v.string(),
    mode: v.optional(v.union(
      v.literal("readonly"),
      v.literal("ask"),
      v.literal("auto"),
    )),
  },
  handler: async (ctx, args): Promise<{ runId: Id<"agentRuns"> }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use AeroTransformGen Dev.");
    const goal = args.goal.trim().slice(0, 4000);
    if (goal.length < 8) {
      throw new Error("Give Jarvis a real task — a sentence or two.");
    }

    const now = Date.now();
    // A first run against an empty workspace would spend a plan request to
    // discover there is nothing to read, so seed it before the plan is made.
    await ctx.runMutation(internal.agentStore.seedWorkspace, { userId, now });

    const runId = (await ctx.runMutation(internal.agentStore.createRun, {
      userId,
      goal,
      title: goal.slice(0, 70),
      mode: args.mode ?? "auto",
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
    if (userId === null) throw new Error("Sign in to use AeroTransformGen Dev.");
    return runLoop(ctx, args.runId, userId);
  },
});

/** The user's call on a gated step, then straight back into the loop. */
export const answer = action({
  args: { runId: v.id("agentRuns"), choice: v.string() },
  handler: async (ctx, args): Promise<{ status: string; remaining: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use AeroTransformGen Dev.");
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

/**
 * Approve or reject one proposed edit, then carry straight on.
 *
 * The applying and the resuming are `decideOne` and `resumeAfterDecision`,
 * shared with `decideAll` so that one approval and a batch of them cannot drift
 * apart about what "apply" means.
 */
export const decideProposal = action({
  args: {
    runId: v.id("agentRuns"),
    proposalId: v.id("agentProposals"),
    decision: v.union(v.literal("apply"), v.literal("reject")),
  },
  handler: async (ctx, args): Promise<{ status: string; remaining: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use AeroTransformGen Dev.");

    const rows = (await ctx.runQuery(internal.agentStore.pendingProposals, {
      runId: args.runId,
      userId,
    })) as PendingProposal[];
    const proposal = rows.find((r) => r._id === args.proposalId);
    if (!proposal) throw new Error("That proposal is gone.");
    if (proposal.status !== "pending") {
      throw new Error("That edit was already decided.");
    }

    const now = Date.now();
    await decideOne(ctx, userId, args.runId, proposal, args.decision, now);
    return resumeAfterDecision(ctx, args.runId, userId, args.decision, now);
  },
});

/**
 * Approve or reject every edit waiting on this run, then carry straight on.
 *
 * Worth having as its own call rather than a client-side loop over
 * `decideProposal`: one action, one set of mutations, and exactly one entry
 * into the loop at the end — so a batch of four approvals costs no more than
 * one, and the driver guard in the panel cannot be re-entered between them.
 */
export const decideAll = action({
  args: {
    runId: v.id("agentRuns"),
    decision: v.union(v.literal("apply"), v.literal("reject")),
  },
  handler: async (ctx, args): Promise<{ status: string; remaining: number }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use AeroTransformGen Dev.");

    const rows = (await ctx.runQuery(internal.agentStore.pendingProposals, {
      runId: args.runId,
      userId,
    })) as PendingProposal[];
    const open = rows.filter((r) => r.status === "pending");
    if (open.length === 0) throw new Error("Nothing is waiting on you.");

    const now = Date.now();
    for (const proposal of open) {
      await decideOne(ctx, userId, args.runId, proposal, args.decision, now);
    }
    return resumeAfterDecision(ctx, args.runId, userId, args.decision, now);
  },
});

/**
 * Put one file back the way it was before the agent's last change to it.
 *
 * Single-step, not a whole-run undo, because that is the operation someone
 * actually reaches for: "no, not that file". A `previous` of undefined means
 * the file did not exist before, so the rewind deletes it rather than leaving
 * it behind.
 */
export const rewind = action({
  args: { checkpointId: v.id("workspaceCheckpoints") },
  handler: async (
    ctx,
    args,
  ): Promise<{ path: string; restored: boolean }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use AeroTransformGen Dev.");

    const row = (await ctx.runQuery(internal.agentStore.getCheckpoint, {
      checkpointId: args.checkpointId,
      userId,
    })) as { path: string; previous?: string } | null;
    if (!row) throw new Error("Nothing to undo there.");

    const now = Date.now();
    if (row.previous === undefined) {
      await ctx.runMutation(internal.agentStore.removeFile, {
        userId,
        path: row.path,
      });
    } else {
      await ctx.runMutation(internal.agentStore.putFile, {
        userId,
        path: row.path,
        content: row.previous,
        now,
      });
    }
    await ctx.runMutation(internal.agentStore.dropCheckpoint, {
      checkpointId: args.checkpointId,
    });
    return { path: row.path, restored: true };
  },
});

export const cancel = action({
  args: { runId: v.id("agentRuns") },
  handler: async (ctx, args): Promise<{ status: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use AeroTransformGen Dev.");
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
    /** Jarvis's own free engines that are no longer on the live roster. */
    missing: string[];
    /** Registered free engines with a published withdrawal date ahead of us. */
    retiring: { id: string; label: string; on: string }[];
    configured: boolean;
    error: string | null;
  }> => {
    const key =
      process.env.OPENROUTER_API_KEY?.trim() || process.env.OPENROUTER_KEY?.trim();
    const blank = {
      models: [],
      missing: [] as string[],
      retiring: retiringSoon(),
      configured: Boolean(key),
      error: null as string | null,
    };
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        return { ...blank, error: `Roster (${res.status})` };
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

      // Cross-check the registry against reality. This is what catches a
      // withdrawn model without anyone maintaining a list: the moment it leaves
      // the free roster it is reported here, instead of costing one failed
      // request per step forever because the chain keeps trying it.
      const live = new Set(models.map((m) => m.id));
      const missing = ENGINES.filter(
        (e) =>
          e.provider === "openrouter" &&
          // `openrouter/free` is a router, not a roster entry.
          !e.modelId.startsWith("openrouter/") &&
          !live.has(e.modelId),
      ).map((e) => e.modelId);

      return { models, missing, retiring: retiringSoon(), configured: Boolean(key), error: null };
    } catch (err) {
      return {
        ...blank,
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

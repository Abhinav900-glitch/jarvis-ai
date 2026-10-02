// ---------------------------------------------------------------------------
// JarvisCodePanel — the agentic surface.
//
// The design brief this panel is built to: Jarvis decides for itself, and the
// user is interrupted only for decisions that are genuinely theirs. So the
// screen is weighted towards *watching it work* — every step shows which model
// answered and why it approached the step that way — and towards *the one
// moment that needs you*, which is rendered as a single unmissable card rather
// than a line in a log.
//
// The gate rules are imported and shown verbatim. An agent that silently decides
// things for you is unsettling; one that tells you exactly which rule stopped
// it, and shows you the whole rulebook up front, is not.
// ---------------------------------------------------------------------------

import { useAction, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  Bot,
  Check,
  ChevronRight,
  CircleAlert,
  Cpu,
  Gauge,
  Loader2,
  Play,
  ShieldQuestion,
  Square,
  X,
} from "lucide-react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { GATE_RULES } from "@/lib/agent-contract";
import { MarkdownMessage } from "@/components/markdown-message";
import { cn } from "@/lib/utils";

export interface JarvisCodePanelProps {
  open: boolean;
  onClose: () => void;
}

const STATUS_TONE: Record<string, { tone: string; label: string }> = {
  planning: { tone: "blue", label: "Planning" },
  running: { tone: "cyan", label: "Working" },
  awaiting_user: { tone: "amber", label: "Your call" },
  done: { tone: "green", label: "Done" },
  failed: { tone: "rose", label: "Failed" },
  cancelled: { tone: "amber", label: "Cancelled" },
};

const STEP_DOT: Record<string, string> = {
  pending: "bg-muted-foreground/30",
  running: "bg-[var(--signal-cyan)] animate-pulse",
  done: "bg-[var(--signal-green)]",
  failed: "bg-[var(--signal-rose)]",
  needs_decision: "bg-[var(--signal-amber)]",
};

function formatContext(n: number): string {
  if (n >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function StepCard({
  step,
  index,
  open,
  onToggle,
}: {
  step: {
    _id: string;
    title: string;
    detail?: string;
    status: string;
    output?: string;
    rationale?: string;
    engineId?: string;
    answer?: string;
  };
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const hasBody = Boolean(step.output);
  return (
    <li className="relative pl-6">
      <span
        className={cn(
          "absolute left-0 top-2 size-2 rounded-full",
          STEP_DOT[step.status] ?? "bg-muted-foreground/30",
        )}
      />
      {index > 0 ? (
        <span className="absolute left-[3px] top-4 h-[calc(100%-1rem)] w-px bg-border/60" />
      ) : null}
      <div className="pb-3">
        <button
          type="button"
          onClick={onToggle}
          disabled={!hasBody}
          className="group flex w-full items-start gap-2 text-left disabled:cursor-default"
        >
          <ChevronRight
            className={cn(
              "mt-0.5 size-3 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
              !hasBody && "opacity-0",
            )}
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] leading-5 text-foreground">
              {step.title}
            </span>
            {step.rationale ? (
              <span className="hud-label mt-0.5 block truncate" data-tone="blue">
                {step.rationale}
              </span>
            ) : null}
          </span>
          {step.engineId ? (
            <span className="hud-readout shrink-0 rounded border border-primary/20 bg-primary/8 px-1.5 py-0.5 text-[10px] text-primary/90">
              {step.engineId}
            </span>
          ) : null}
        </button>

        {step.answer ? (
          <p className="mt-1.5 ml-5 border-l-2 border-[var(--signal-amber)]/50 pl-2 text-[11px] text-[var(--signal-amber)]">
            You decided: {step.answer}
          </p>
        ) : null}

        <AnimatePresence initial={false}>
          {open && hasBody ? (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              className="overflow-hidden"
            >
              <div className="jarvis-hud-prose mt-2 ml-5 border-l border-border/60 pl-3 text-[13px]">
                <MarkdownMessage content={step.output ?? ""} />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>
    </li>
  );
}

export function JarvisCodePanel({ open, onClose }: JarvisCodePanelProps) {
  // State first: the queries below are keyed off runId, so it has to exist
  // before they are declared or the first render reads it in its temporal dead
  // zone.
  const [runId, setRunId] = useState<Id<"agentRuns"> | null>(null);
  const [goal, setGoal] = useState("");
  const [choice, setChoice] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openStep, setOpenStep] = useState<string | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const [showRoster, setShowRoster] = useState(false);
  const [poke, setPoke] = useState(0);

  const startRun = useAction(api.agent.start);
  const advance = useAction(api.agent.advance);
  const answer = useAction(api.agent.answer);
  const cancel = useAction(api.agent.cancel);
  const loadRoster = useAction(api.agent.freeRoster);
  const loadQuota = useAction(api.agent.quota);
  type Roster = Awaited<ReturnType<typeof loadRoster>>;
  type Quota = Awaited<ReturnType<typeof loadQuota>>;

  const run = useQuery(api.agentStore.get, runIdArg(runId));
  const steps = useQuery(api.agentStore.steps, runIdArg(runId));

  // Guards against two concurrent advances. On a 50-requests-a-day budget a
  // double-fired effect is not a cosmetic bug, it is a wasted fifth of the day.
  const driving = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  // The driver. One action call works up to three steps; when it comes back
  // still running, the budget ran out and the next tick picks it up again.
  //
  // The ref guard is the load-bearing part. The effect re-runs on every
  // reactive update to the run, which is exactly what it should do — but each
  // of those updates also lands *while* an advance is in flight, so without the
  // guard the same step would be dispatched repeatedly and the free quota spent
  // on duplicates.
  useEffect(() => {
    if (!runId || !run || run.status !== "running" || driving.current) return;
    driving.current = true;
    void (async () => {
      setBusy(true);
      try {
        const r = await advance({ runId });
        if (r.status === "running" && r.remaining > 0) setPoke((n) => n + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "That step failed.");
      } finally {
        driving.current = false;
        setBusy(false);
      }
    })();
  }, [runId, run, advance, poke]);

  if (!open) return null;

  const handleStart = async () => {
    const text = goal.trim();
    if (text.length < 8 || busy) return;
    setBusy(true);
    setError(null);
    setOpenStep(null);
    setChoice("");
    try {
      const { runId: id } = await startRun({ goal: text });
      setRunId(id);
      setGoal("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start that run.");
    } finally {
      setBusy(false);
    }
  };

  const handleAnswer = async (value: string) => {
    if (!runId || !value.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await answer({ runId, choice: value.trim() });
      setChoice("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not record that.");
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    if (!runId || busy) return;
    setBusy(true);
    try {
      await cancel({ runId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop the run.");
    } finally {
      setBusy(false);
    }
  };

  const handleRoster = async () => {
    setShowRoster((v) => !v);
    if (roster) return;
    try {
      const [list, q] = await Promise.all([loadRoster({}), loadQuota({})]);
      setRoster(list);
      setQuota(q);
    } catch {
      setRoster({ models: [], configured: false, error: "Could not read it." });
    }
  };

  const rows = steps ?? [];
  const gated = rows.find((s) => s.status === "needs_decision");
  const status = run ? (STATUS_TONE[run.status] ?? STATUS_TONE.running) : null;
  const working = run?.status === "running" || run?.status === "planning";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#020a14]/75 p-4 pt-[6vh] backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.99 }}
          transition={{ duration: 0.18 }}
          onClick={(e) => e.stopPropagation()}
          className="hud-panel hud-corners w-full max-w-3xl"
          role="dialog"
          aria-modal="true"
          aria-label="Jarvis Code"
        >
          {/* ---- header ---- */}
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
            <Bot className="size-4 text-primary" />
            <span className="hud-label" data-tone="cyan">
              Jarvis Code
            </span>
            {status ? (
              <span className="ml-2 inline-flex items-center gap-1.5">
                <span
                  className="hud-dot"
                  data-tone={status.tone}
                  data-static={!working ? "true" : undefined}
                />
                <span className="hud-label" data-tone={status.tone}>
                  {status.label}
                </span>
              </span>
            ) : null}
            {run ? (
              <span className="hud-readout ml-auto text-[11px] text-muted-foreground">
                {run.done}/{run.planned || "–"} steps · {run.calls} calls
              </span>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              title="Close"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="space-y-4 px-4 py-4">
            {/* ---- handover ---- */}
            <div>
              <label
                htmlFor="jarvis-code-goal"
                className="hud-label block"
                data-tone="blue"
              >
                Hand it a task
              </label>
              <textarea
                id="jarvis-code-goal"
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void handleStart();
                  }
                }}
                rows={3}
                disabled={busy}
                placeholder="Audit my API routes and write up the three riskiest ones."
                className="hud-focus mt-1.5 w-full resize-none rounded-lg border border-primary/25 bg-accent/25 px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleStart()}
                  disabled={busy || goal.trim().length < 8}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-40"
                >
                  {busy && !run ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  Start
                </button>
                {working ? (
                  <button
                    type="button"
                    onClick={() => void handleCancel()}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border/70 px-2.5 py-1.5 text-xs transition-colors hover:border-foreground/30 hover:text-foreground disabled:opacity-40"
                  >
                    <Square className="size-3" />
                    Stop
                  </button>
                ) : null}
                <span className="text-[11px] text-muted-foreground/70">
                  ⌘↵ to start
                </span>
                <button
                  type="button"
                  onClick={() => void handleRoster()}
                  className="ml-auto inline-flex items-center gap-1.5 rounded px-1.5 py-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Cpu className="size-3" />
                  {showRoster ? "Hide" : "Free models"}
                </button>
              </div>
            </div>

            {error ? (
              <p className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <CircleAlert className="mt-px size-3.5 shrink-0" />
                {error}
              </p>
            ) : null}

            {/* ---- the one moment that needs you ---- */}
            {gated ? (
              <div className="hud-panel" data-tone="amber">
                <div className="flex items-center gap-2 border-b border-[var(--signal-amber)]/25 px-3 py-2">
                  <ShieldQuestion className="size-3.5 text-[var(--signal-amber)]" />
                  <span className="hud-label" data-tone="amber">
                    Your call
                  </span>
                  {gated.gateReason ? (
                    <span className="hud-readout ml-auto rounded border border-[var(--signal-amber)]/30 px-1.5 py-0.5 text-[10px] text-[var(--signal-amber)]">
                      {gated.gateReason}
                    </span>
                  ) : null}
                </div>
                <div className="px-3 py-3">
                  <p className="text-sm leading-6 text-foreground">
                    {gated.question}
                  </p>
                  {gated.options?.length ? (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {gated.options.map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => void handleAnswer(opt)}
                          disabled={busy}
                          className="rounded-md border border-[var(--signal-amber)]/35 px-2.5 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-[var(--signal-amber)]/10 disabled:opacity-40"
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  ) : null}
                  <div className="mt-2.5 flex gap-2">
                    <input
                      value={choice}
                      onChange={(e) => setChoice(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleAnswer(choice);
                        }
                      }}
                      disabled={busy}
                      placeholder="Or tell it what to do…"
                      className="hud-focus flex-1 rounded-md border border-border/70 bg-accent/25 px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground/60 disabled:opacity-50"
                    />
                    <button
                      type="button"
                      onClick={() => void handleAnswer(choice)}
                      disabled={busy || !choice.trim()}
                      className="rounded-md bg-[var(--signal-amber)] px-3 py-1.5 text-xs font-medium text-background transition-opacity disabled:opacity-40"
                    >
                      Send
                    </button>
                  </div>
                </div>
              </div>
            ) : null}

            {/* ---- timeline ---- */}
            {rows.length > 0 ? (
              <div>
                <div className="flex items-center gap-2">
                  <span className="hud-label" data-tone="blue">
                    Plan
                  </span>
                  {working ? (
                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
                  ) : null}
                </div>
                <ul className="mt-2 space-y-0">
                  {rows.map((s, i) => (
                    <StepCard
                      key={s._id}
                      step={s}
                      index={i}
                      open={openStep === s._id}
                      onToggle={() =>
                        setOpenStep((cur) => (cur === s._id ? null : s._id))
                      }
                    />
                  ))}
                </ul>
              </div>
            ) : null}

            {/* ---- answer ---- */}
            {run?.answer ? (
              <div>
                <span className="hud-label" data-tone="green">
                  Result
                </span>
                <div className="jarvis-hud-prose mt-1.5 rounded-lg border border-[var(--signal-green)]/20 bg-[var(--signal-green)]/5 px-3 py-2.5 text-sm">
                  <MarkdownMessage content={run.answer} />
                </div>
              </div>
            ) : null}

            {run?.error ? (
              <p className="flex items-start gap-1.5 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <CircleAlert className="mt-px size-3.5 shrink-0" />
                {run.error}
              </p>
            ) : null}

            {/* ---- live free roster ---- */}
            {showRoster ? (
              <div className="hud-panel px-3 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Cpu className="size-3.5 text-primary" />
                  <span className="hud-label" data-tone="cyan">
                    Free right now
                  </span>
                  {roster?.configured ? (
                    <span className="hud-label text-[var(--signal-green)]">
                      key set
                    </span>
                  ) : (
                    <span className="hud-label text-[var(--signal-amber)]">
                      add OPENROUTER_API_KEY
                    </span>
                  )}
                  {quota?.limitRemaining !== null &&
                  quota?.limitRemaining !== undefined ? (
                    <span className="hud-readout ml-auto text-[11px] text-muted-foreground">
                      {quota.usage ?? 0} used
                      {quota.isFreeTier ? " · free tier" : ""}
                    </span>
                  ) : null}
                </div>

                {roster?.error ? (
                  <p className="mt-1.5 text-[11px] text-destructive">
                    {roster.error}
                  </p>
                ) : null}

                <p className="mt-1.5 text-[11px] leading-4 text-muted-foreground/80">
                  Read live from OpenRouter. The roster turns over every few
                  weeks, so Jarvis routes across whatever is free at the moment
                  rather than a list that would quietly rot.
                </p>

                <ul className="mt-2 grid max-h-52 grid-cols-1 gap-1 overflow-y-auto sm:grid-cols-2">
                  {(roster?.models ?? []).map((m) => (
                    <li
                      key={m.id}
                      className="flex items-center gap-2 rounded border border-border/50 px-2 py-1"
                    >
                      <span className="min-w-0 flex-1 truncate text-[11px]">
                        {m.label}
                      </span>
                      <span className="hud-readout shrink-0 text-[10px] text-muted-foreground/70">
                        {formatContext(m.context)}
                      </span>
                    </li>
                  ))}
                </ul>
                {roster && roster.models.length === 0 && !roster.error ? (
                  <p className="mt-2 text-[11px] text-muted-foreground/70">
                    Nothing reported as free right now.
                  </p>
                ) : null}
              </div>
            ) : null}

            {/* ---- the rulebook ---- */}
            <details className="group">
              <summary className="hud-label flex cursor-pointer list-none items-center gap-1.5 hover:text-foreground">
                <Gauge className="size-3" />
                When Jarvis stops and asks ({GATE_RULES.length} rules)
                <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
              </summary>
              <ul className="mt-1.5 space-y-1 pl-4">
                {GATE_RULES.map((rule) => (
                  <li
                    key={rule.reason}
                    className="flex items-start gap-1.5 text-[11px] text-muted-foreground/80"
                  >
                    <Check className="mt-0.5 size-3 shrink-0 text-[var(--signal-amber)]/70" />
                    <span>{rule.reason}</span>
                  </li>
                ))}
                <li className="flex items-start gap-1.5 text-[11px] text-muted-foreground/60">
                  <Check className="mt-0.5 size-3 shrink-0 opacity-40" />
                  <span>
                    Drafting, planning and comparing never ask — asking
                    permission to think is the fastest way to be useless.
                  </span>
                </li>
              </ul>
            </details>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

/** Convex wants the literal "skip", not a null id. */
function runIdArg(id: Id<"agentRuns"> | null) {
  return id ? { runId: id } : "skip";
}

// ---------------------------------------------------------------------------
// AnswerInspector — what actually produced a reply.
//
// Every assistant message now records the engine that answered it, why the
// router picked that one, how long it took to the first token, and the token
// counts. Before this existed the model name was shown only on replies that
// used search or fell back, which made a slow or terse answer impossible to
// explain: you could not tell whether a reply came from the model you expected,
// and you had no way to see what it cost.
//
// Deliberately a hover card rather than permanent chrome. The data is worth
// having and not worth reading on every message.
// ---------------------------------------------------------------------------

import { motion } from "framer-motion";
import { Cpu, Clock3, Coins, AlertTriangle, GitCompare } from "lucide-react";
import { cn } from "@/lib/utils";

export interface AnswerMeta {
  model?: string | null;
  engineId?: string | null;
  decisionReason?: string | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  usedFallback?: boolean | null;
  truncated?: boolean | null;
}

export interface AnswerInspectorProps extends AnswerMeta {
  /** Present when a second answer exists on a decision branch. */
  onCompare?: () => void;
  compareLabel?: string;
}

/** "2.4s" / "840ms". Sub-second precision is noise; seconds are the unit. */
function formatLatency(ms: number): string {
  if (!Number.isFinite(ms)) return "—";
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatTokens(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function AnswerInspector(props: AnswerInspectorProps) {
  const {
    model,
    engineId,
    decisionReason,
    latencyMs,
    promptTokens,
    completionTokens,
    usedFallback,
    truncated,
    onCompare,
    compareLabel,
  } = props;

  const engine = engineId ?? model ?? "unknown";
  const hasUsage =
    typeof promptTokens === "number" || typeof completionTokens === "number";

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.14 }}
      className="hud-panel hud-corners absolute right-0 top-full z-40 mt-1.5 w-72 rounded-xl p-3 text-[11px]"
    >
      <div className="mb-2 flex items-center gap-2">
        <Cpu className="size-3.5 shrink-0 text-primary" />
        <span className="hud-readout text-[11px] font-medium">{engine}</span>
        {usedFallback ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-amber-500/90">
            <AlertTriangle className="size-2.5" />
            fallback
          </span>
        ) : (
          <span className="hud-dot ml-auto" data-tone="cyan" />
        )}
      </div>

      {decisionReason ? (
        <p className="mb-2 leading-5 text-muted-foreground">{decisionReason}</p>
      ) : null}

      {/* Telemetry rows: label left, measured value right, hairline between. */}
      <div className="divide-y divide-border/60 text-muted-foreground">
        <div className="flex items-center justify-between gap-2 py-1.5">
          <span className="hud-label inline-flex items-center gap-1.5">
            <Clock3 className="size-3" />
            First token
          </span>
          <span className="hud-readout">{formatLatency(latencyMs ?? NaN)}</span>
        </div>
        {hasUsage ? (
          <div className="flex items-center justify-between gap-2 py-1.5">
            <span className="hud-label inline-flex items-center gap-1.5">
              <Coins className="size-3" />
              Tokens
            </span>
            <span className="hud-readout">
              {formatTokens(promptTokens ?? 0)} in ·{" "}
              {formatTokens(completionTokens ?? 0)} out
            </span>
          </div>
        ) : null}
        {truncated ? (
          <p className="pt-1.5 text-amber-500/90">Stopped early, so these are partial.</p>
        ) : null}
      </div>

      {onCompare ? (
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={onCompare}
          className={cn(
            "mt-3 flex w-full items-center gap-1.5 rounded-lg border border-primary/25 bg-accent/30 px-2 py-1.5",
            "text-left transition-colors hover:border-primary/50 hover:bg-primary/10 hover:text-foreground",
          )}
        >
          <GitCompare className="size-3 shrink-0" />
          <span className="truncate">{compareLabel ?? "Compare with the other engine"}</span>
        </button>
      ) : null}
    </motion.div>
  );
}
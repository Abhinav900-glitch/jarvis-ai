// ---------------------------------------------------------------------------
// BranchCompare — two answers to the same question, side by side.
//
// `branch-bar` lets you switch between branches; this is the other half, because
// switching means remembering what the other one said. Comparing is the point
// of having kept both.
//
// Each column shows the fork's prompt, which engine answered it, and the
// diff-highlighted answer: unchanged text plain, removed text struck through,
// added text underlined. That is enough to see whether the second engine added
// anything or just reworded it, which is the only thing worth knowing.
// ---------------------------------------------------------------------------

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { X, GitCompare, ArrowLeftRight } from "lucide-react";
import { MarkdownMessage } from "@/components/markdown-message";
import { changeRatio, diffWords } from "@/lib/diff";
import { cn } from "@/lib/utils";

export interface CompareSide {
  /** Label for the branch, e.g. "Original" or "Branch 2". */
  label: string;
  /** The user message both sides answered, when they share one. */
  prompt?: string | null;
  content: string;
  model?: string | null;
  engineId?: string | null;
  decisionReason?: string | null;
  latencyMs?: number | null;
}

export interface BranchCompareProps {
  open: boolean;
  left: CompareSide;
  right: CompareSide;
  onClose: () => void;
  /** Promote one side: make that branch the one you are reading. */
  onKeep?: (side: "left" | "right") => void;
}

function engineOf(side: CompareSide): string {
  return side.engineId ?? side.model ?? "unknown";
}

function Header({
  side,
  tone,
  onKeep,
}: {
  side: CompareSide;
  tone: "left" | "right";
  onKeep?: (side: "left" | "right") => void;
}) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <span className="text-xs font-medium">{side.label}</span>
      <span className="truncate font-mono text-[10px] text-muted-foreground">
        {engineOf(side)}
      </span>
      {side.latencyMs ? (
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {side.latencyMs < 1000
            ? `${Math.round(side.latencyMs)}ms`
            : `${(side.latencyMs / 1000).toFixed(1)}s`}
        </span>
      ) : null}
      {onKeep ? (
        <button
          type="button"
          onClick={() => onKeep(tone)}
          className="ml-auto shrink-0 rounded-md border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
        >
          Keep this
        </button>
      ) : null}
    </div>
  );
}

export function BranchCompare({ open, left, right, onClose, onKeep }: BranchCompareProps) {
  const [mode, setMode] = useState<"diff" | "plain">("diff");

  // Diffing the markdown source rather than the rendered output: the renderer
  // throws away exactly the whitespace and punctuation that makes a diff
  // readable.
  const parts = useMemo(() => diffWords(left.content, right.content), [left.content, right.content]);
  const changed = useMemo(() => changeRatio(parts), [parts]);

  if (!open) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 12, scale: 0.99 }}
        transition={{ duration: 0.18 }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl"
      >
        <div className="flex items-center gap-3 border-b px-4 py-3">
          <GitCompare className="size-4 text-muted-foreground" />
          <div className="min-w-0">
            <h2 className="text-sm font-medium">Compare answers</h2>
            <p className="truncate text-[11px] text-muted-foreground">
              {left.label} vs {right.label} ·{" "}
              {Math.round(changed * 100)}% of the second answer is new text
            </p>
          </div>

          <div className="ml-auto flex items-center gap-1 rounded-lg border p-0.5">
            {(["diff", "plain"] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => setMode(value)}
                className={cn(
                  "rounded-md px-2 py-1 text-[10px] capitalize transition-colors",
                  mode === value
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {value === "diff" ? (
                  <span className="inline-flex items-center gap-1">
                    <ArrowLeftRight className="size-3" />
                    Diff
                  </span>
                ) : (
                  "Plain"
                )}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="size-4" />
          </button>
        </div>

        {left.prompt ? (
          <div className="border-b px-4 py-2 text-[11px] leading-5 text-muted-foreground">
            <span className="font-medium text-foreground/80">Asked:</span> {left.prompt}
          </div>
        ) : null}

        {/* Stacked on a phone: two prose columns at 180px each are unreadable,
            so the divide flips to horizontal until there is room side by side. */}
        <div className="grid min-h-0 flex-1 grid-cols-1 divide-y overflow-hidden md:grid-cols-2 md:divide-x md:divide-y-0">
          {(["left", "right"] as const).map((tone) => {
            const side = tone === "left" ? left : right;
            return (
              <div key={tone} className="flex min-h-0 flex-col">
                <Header side={side} tone={tone} onKeep={onKeep} />
                <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
                  {side.decisionReason ? (
                    <p className="mb-2 text-[10px] leading-4 text-muted-foreground/80">
                      {side.decisionReason}
                    </p>
                  ) : null}

                  {mode === "plain" ? (
                    <div className="text-sm leading-7">
                      <MarkdownMessage content={side.content} />
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-sm leading-7">
                      {parts.map((part, i) => (
                        <span
                          key={i}
                          className={cn(
                            part.op === "add" && "rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
                            part.op === "remove" &&
                              "rounded bg-destructive/15 text-muted-foreground line-through",
                          )}
                        >
                          {part.text}
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </motion.div>
    </motion.div>
  );
}
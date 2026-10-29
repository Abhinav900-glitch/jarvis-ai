// ---------------------------------------------------------------------------
// SessionStatsDialog — what actually happened in this conversation.
//
// The numbers come from the messages already on screen (see
// lib/session-stats), so the dialog opens instantly and stays consistent with
// the transcript beside it: if the visible branch shows 12 replies, the stats
// say 12 replies. No extra query, no server round-trip.
//
// Engine rows use the short label form (provider prefix stripped) because
// `googleai/gemini-3.5-flash` is three times wider than the bar next to it.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  engineLabel,
  sessionStats,
  type StatsMessage,
} from "@/lib/session-stats";

export interface SessionStatsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chat's title — shown so a stats view opened from the palette is
   *  unambiguous when several chats are in flight. */
  title: string;
  messages: StatsMessage[];
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
}

function formatDate(at: number): string {
  return new Date(at).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border bg-accent/30 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums leading-none">
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[10px] leading-4 text-muted-foreground/80">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function SessionStatsDialog({
  open,
  onOpenChange,
  title,
  messages,
}: SessionStatsDialogProps) {
  const stats = useMemo(() => sessionStats(messages), [messages]);
  const empty = stats.messages === 0;
  const topReplies = stats.engines.reduce((sum, e) => sum + e.replies, 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Session stats</DialogTitle>
          <DialogDescription className="truncate">
            {title || "This conversation"} — computed from the transcript on
            screen.
          </DialogDescription>
        </DialogHeader>

        {empty ? (
          <p className="px-1 pb-2 text-center text-xs leading-5 text-muted-foreground">
            No messages yet. Send something and the numbers will show up here.
          </p>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <StatTile
                label="Messages"
                value={String(stats.messages)}
                hint={`${stats.userMessages} you · ${stats.replies} replies`}
              />
              <StatTile
                label="Words"
                value={formatTokens(stats.words)}
                hint="across every message"
              />
              <StatTile
                label="Tokens"
                value={formatTokens(stats.promptTokens + stats.completionTokens)}
                hint={`${formatTokens(stats.promptTokens)} in · ${formatTokens(
                  stats.completionTokens,
                )} out`}
              />
              <StatTile
                label="Avg first token"
                value={
                  stats.avgLatencyMs === null
                    ? "—"
                    : formatLatency(stats.avgLatencyMs)
                }
                hint="time to first word"
              />
              <StatTile
                label="Ratings"
                value={`${stats.feedbackUp}↑ ${stats.feedbackDown}↓`}
                hint="thumbs on replies"
              />
              <StatTile
                label="Span"
                value={
                  stats.firstAt === null || stats.lastAt === null
                    ? "—"
                    : stats.firstAt === stats.lastAt
                      ? formatDate(stats.firstAt)
                      : `${formatDate(stats.firstAt)} → ${formatDate(stats.lastAt)}`
                }
                hint="first to last message"
              />
            </div>

            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                Engines used
              </p>
              {stats.engines.length === 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  No reply has reported its engine yet.
                </p>
              ) : (
                <ul className="mt-2 space-y-1.5">
                  {stats.engines.map((engine) => {
                    const share =
                      topReplies > 0
                        ? Math.round((engine.replies / topReplies) * 100)
                        : 0;
                    return (
                      <li key={engine.id} className="flex items-center gap-2">
                        <span
                          className="w-40 shrink-0 truncate text-xs"
                          title={engine.id}
                        >
                          {engineLabel(engine.id)}
                        </span>
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent">
                          <span
                            className="block h-full rounded-full bg-primary/70"
                            style={{ width: `${share}%` }}
                          />
                        </span>
                        <span className="w-14 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
                          {engine.replies} · {share}%
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

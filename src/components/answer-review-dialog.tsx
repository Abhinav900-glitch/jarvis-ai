// ---------------------------------------------------------------------------
// AnswerReviewDialog — what a second engine thinks of the last reply.
//
// The verdict is the headline and everything else is evidence for it, so the
// badge, the confidence meter and the issues share one column: the reader should
// be able to stop at the colour and keep going only when it is not green.
//
// Deliberately not optimistic. A reviewer that ignored the format comes back as
// "Unclear" with its prose shown, and a review run by the engine that wrote the
// answer says so — an audit that hides who performed it is worth less than none.
// ---------------------------------------------------------------------------

import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  ShieldQuestion,
  ShieldX,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  verdictLabel,
  verdictTone,
  type AnswerReview,
  type ReviewVerdict,
} from "@/lib/answer-review";
import { engineLabel } from "@/lib/session-stats";
import { cn } from "@/lib/utils";

export type AnswerReviewResult = AnswerReview & {
  reviewer: string;
  reviewerEngineId: string | null;
  independent: boolean;
};

export type AnswerReviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; review: AnswerReviewResult };

export interface AnswerReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: AnswerReviewState;
}

const TONE_STYLES: Record<
  "good" | "warn" | "bad" | "neutral",
  { badge: string; meter: string; icon: typeof CheckCircle2 }
> = {
  good: {
    badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
    meter: "bg-emerald-500",
    icon: CheckCircle2,
  },
  warn: {
    badge: "border-amber-500/40 bg-amber-500/10 text-amber-500",
    meter: "bg-amber-500",
    icon: AlertTriangle,
  },
  bad: {
    badge: "border-destructive/40 bg-destructive/10 text-destructive",
    meter: "bg-destructive",
    icon: ShieldX,
  },
  neutral: {
    badge: "border-border bg-accent/40 text-muted-foreground",
    meter: "bg-muted-foreground/60",
    icon: ShieldQuestion,
  },
};

function VerdictBadge({ verdict }: { verdict: ReviewVerdict }) {
  const tone = TONE_STYLES[verdictTone(verdict)];
  const Icon = tone.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]",
        tone.badge,
      )}
    >
      <Icon className="size-3.5" />
      {verdictLabel(verdict)}
    </span>
  );
}

export function AnswerReviewDialog({
  open,
  onOpenChange,
  state,
}: AnswerReviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Answer review</DialogTitle>
          <DialogDescription>
            A second engine read the last reply and checked its claims.
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" ? (
          <div className="flex items-center gap-2.5 px-1 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary" />
            Reading the answer…
          </div>
        ) : state.status === "error" ? (
          <p className="px-1 py-4 text-xs leading-5 text-destructive">
            {state.message}
          </p>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <VerdictBadge verdict={state.review.verdict} />
              {state.review.confidence !== null ? (
                <div className="flex min-w-24 flex-1 items-center gap-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-accent">
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        TONE_STYLES[verdictTone(state.review.verdict)].meter,
                      )}
                      style={{
                        width: `${Math.round(state.review.confidence * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {Math.round(state.review.confidence * 100)}% sure
                  </span>
                </div>
              ) : null}
            </div>

            {state.review.summary ? (
              <p className="text-xs leading-5 text-muted-foreground">
                {state.review.summary}
              </p>
            ) : null}

            {state.review.issues.length > 0 ? (
              <ul className="space-y-2">
                {state.review.issues.map((issue, index) => (
                  <li
                    key={index}
                    className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2"
                  >
                    {issue.claim ? (
                      <p className="text-[11px] font-medium leading-4">
                        “{issue.claim}”
                      </p>
                    ) : null}
                    <p className="text-xs leading-5 text-muted-foreground">
                      {issue.problem}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}

            {state.review.fix ? (
              <div className="rounded-lg border bg-accent/30 px-3 py-2">
                <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  Instead
                </p>
                <p className="mt-1 text-xs leading-5">{state.review.fix}</p>
              </div>
            ) : null}

            {state.review.verdict === "solid" &&
            state.review.issues.length === 0 ? (
              <p className="flex items-center gap-1.5 text-xs text-emerald-500">
                <CheckCircle2 className="size-3.5 shrink-0" />
                No claim was flagged. Read that as “nothing obvious is wrong”,
                not proof.
              </p>
            ) : null}

            <p className="flex items-start gap-1.5 border-t pt-3 text-[10px] leading-4 text-muted-foreground/80">
              <Info className="mt-px size-3 shrink-0" />
              <span>
                Reviewed by{" "}
                {engineLabel(
                  state.review.reviewerEngineId ?? state.review.reviewer,
                )}
                {state.review.independent
                  ? " — not the engine that wrote the answer."
                  : " — the same engine that wrote it, because no other was available."}
              </span>
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// ChatRecapDialog — where a long conversation stands.
//
// Three sections, in the order a returning reader needs them: what was settled,
// what is still open, what to do next. Empty sections are dropped rather than
// shown with "None" — a digest with nothing to say about next steps should not
// draw attention to that.
//
// The copy button exports markdown with the same headings, so a recap can be
// pasted into notes or a ticket instead of being re-read off the screen.
// ---------------------------------------------------------------------------

import { ArrowRight, CheckCircle2, CircleHelp, Copy, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  digestIsEmpty,
  digestToMarkdown,
  type ChatDigest,
} from "@/lib/chat-digest";
import { engineLabel } from "@/lib/session-stats";

export type ChatDigestResult = ChatDigest & {
  model: string;
  engineId: string | null;
};

export type ChatDigestState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; digest: ChatDigestResult };

export interface ChatRecapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ChatDigestState;
  title: string;
}

function Section({
  heading,
  items,
  icon: Icon,
}: {
  heading: string;
  items: string[];
  icon: typeof CheckCircle2;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="size-3" />
        {heading}
      </p>
      <ul className="mt-1.5 space-y-1">
        {items.map((item, index) => (
          <li key={index} className="flex gap-2 text-xs leading-5">
            <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/30" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ChatRecapDialog({
  open,
  onOpenChange,
  state,
  title,
}: ChatRecapDialogProps) {
  const copy = async (digest: ChatDigestResult) => {
    try {
      await navigator.clipboard.writeText(digestToMarkdown(digest, title));
      toast.success("Recap copied as markdown.");
    } catch {
      toast.error("Could not copy the recap.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Recap</DialogTitle>
          <DialogDescription className="truncate">
            {title || "This conversation"} — what was settled, and what is left.
          </DialogDescription>
        </DialogHeader>

        {state.status === "loading" ? (
          <div className="flex items-center gap-2.5 px-1 py-6 text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin text-primary" />
            Reading back over the conversation…
          </div>
        ) : state.status === "error" ? (
          <p className="px-1 py-4 text-xs leading-5 text-destructive">
            {state.message}
          </p>
        ) : (
          <div className="space-y-4">
            {digestIsEmpty(state.digest) ? (
              <p className="px-1 py-2 text-xs leading-5 text-muted-foreground">
                The model came back with nothing to report. Try again, or ask it
                directly what it remembers.
              </p>
            ) : (
              <>
                {state.digest.summary ? (
                  <p className="text-sm leading-6">{state.digest.summary}</p>
                ) : null}
                <div className="space-y-3.5">
                  <Section
                    heading="Decided"
                    items={state.digest.decisions}
                    icon={CheckCircle2}
                  />
                  <Section
                    heading="Still open"
                    items={state.digest.open}
                    icon={CircleHelp}
                  />
                  <Section
                    heading="Next"
                    items={state.digest.next}
                    icon={ArrowRight}
                  />
                </div>
              </>
            )}

            <div className="flex items-center justify-between gap-3 border-t pt-3">
              <span className="truncate text-[10px] text-muted-foreground/80">
                Written by {engineLabel(state.digest.engineId ?? state.digest.model)}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-2 text-xs"
                onClick={() => void copy(state.digest)}
              >
                <Copy className="size-3" />
                Copy
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

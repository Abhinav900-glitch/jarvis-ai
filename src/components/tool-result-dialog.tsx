// ---------------------------------------------------------------------------
// ToolResultDialog — the answer from a local tool.
//
// Every exact tool returns the same shape (a title and preformatted text), so
// they share one surface rather than twelve: a result should be readable,
// copyable, and gone in one click. Errors land here too, because "10 km to
// apples" is a message, not a reason to fail the turn.
// ---------------------------------------------------------------------------

import { AlertTriangle, Copy, Terminal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ToolDialogState =
  | { status: "ready"; title: string; body: string }
  | { status: "error"; message: string };

export interface ToolResultDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: ToolDialogState | null;
}

export function ToolResultDialog({
  open,
  onOpenChange,
  state,
}: ToolResultDialogProps) {
  const copy = async () => {
    if (!state) return;
    const text = state.status === "ready" ? state.body : state.message;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Copied.");
    } catch {
      toast.error("Could not copy that.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Terminal className="size-4 text-primary" />
            {state?.status === "ready" ? state.title : "Tool error"}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {state?.status === "ready"
              ? "Computed locally — no model was involved."
              : "Nothing was sent to a model."}
          </DialogDescription>
        </DialogHeader>

        {state?.status === "error" ? (
          <p className="flex items-start gap-2 text-xs leading-5 text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{state.message}</span>
          </p>
        ) : state ? (
          <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/40 p-3 font-mono text-xs leading-5">
            {state.body}
          </pre>
        ) : null}

        <div className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => void copy()}
          >
            <Copy className="size-3" />
            Copy
          </Button>
          <Button
            size="sm"
            className="h-7 px-3 text-xs"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

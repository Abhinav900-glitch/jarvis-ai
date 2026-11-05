// ---------------------------------------------------------------------------
// ToolResultDialog — the answer from a local tool.
//
// Every exact tool returns the same shape (a title and preformatted text), so
// they share one surface rather than twelve: a result should be readable,
// copyable, and gone in one click. Errors land here too, because "10 km to
// apples" is a message, not a reason to fail the turn.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Copy,
  FileCode,
  Files,
  Globe,
  Terminal,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ToolDialogState =
  | { status: "ready"; title: string; body: string; kind: "terminal" | "web" | "code"; previewPath?: string }
  | { status: "error"; message: string }

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
  const [copyOnce, setCopyOnce] = useState<string | null>(null);

  const copy = async () => {
    if (!state) return;
    const text = state.status === "ready" ? state.body : state.message;
    try {
      await navigator.clipboard.writeText(text);
      setCopyOnce("tool");
      setTimeout(() => setCopyOnce(null), 1400);
    } catch {
      toast.error("Could not copy that.");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            {(() => {
              switch (state?.status) {
                case "error":
                  return (
                    <>
                      <AlertTriangle className="size-4 text-destructive" />
                      Tool error
                    </>
                  );
                case "ready":
                  switch (state.kind) {
                    case "web":
                      return (
                        <>
                          <Globe className="size-4 text-primary" />
                          Render preview
                        </>
                      );
                    case "code":
                      return (
                        <>
                          <FileCode className="size-4 text-primary" />
                          Full file
                        </>
                      );
                    case "terminal":
                    default:
                      return (
                        <>
                          <Terminal className="size-4 text-primary" />
                          Tool output
                        </>
                      );
                  }
            })()}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {state?.status === "ready"
              ? state.kind === "web"
                ? "A file the agent wrote, rendered in this frame. Open it on the left to inspect the source."
                : state.kind === "code"
                  ? "The file the agent wrote is available in full here and on the left for editing."
                  : "Computed locally — no model was involved."
              : "Nothing was sent to a model."}
          </DialogDescription>
        </DialogHeader>

        {state?.status === "error" ? (
          <p className="flex items-start gap-2 text-xs leading-5 text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{state.message}</span>
          </p>
        ) : state ? (
          <ToolResultDialogContent state={state} onView={() => {}} />
        ) : null}

        <div className="mt-3 flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => void copy()}
          >
            <Copy className="size-3" />
            {copyOnce === "tool" ? "Copied" : "Copy all"}
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

type ContentState =
  | { status: "ready"; kind: "terminal"; }
  | { status: "ready"; kind: "code"; }
  | { status: "ready"; kind: "web"; }
  | { status: "error" };

export function ToolResultDialogContent({
  state,
  onView,
}: {
  state: ToolDialogState | null;
  onView: (path: string) => void;
}) {
  const ready = state?.status === "ready";
  const body = ready ? state.body : "";
  const kind = state?.kind ?? "terminal";

  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 1400);
    } catch {
      setCopied(null);
    }
  };

  const terminal = useMemo(
    () =>
      ready && kind === "terminal"
        ? (
            <details className="group mb-2">
              <summary className="flex cursor-pointer items-baseline gap-1.5 rounded px-1 py-0.5 font-mono text-[11px] text-foreground/80 hover:bg-accent">
                <span className="shrink-0 text-muted-foreground/50 group-open:opacity-60">▸</span>
                <span>{state.title}</span>
                <span className="hud-readout text-[10px] text-muted-foreground/60 ml-auto">
                  {body.split("\n").length} lines
                </span>
              </summary>
              <pre
                className="mt-1.5 max-h-[42vh] overflow-auto whitespace-pre-wrap break-all rounded border border-border/50 bg-background/60 p-2 font-mono text-[11px] leading-5 text-foreground/90"
              >
                {body}
              </pre>
            </details>
          )
        : null,
    [ready, kind, body, state?.title],
  );

  const preview = useMemo(
    () =>
      ready && kind === "web"
        ? (
            <div className="min-h-0 flex-1 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Globe className="size-3.5 text-primary" />
                <span className="flex-1 truncate text-[11px] text-foreground/80">
                  {state.previewPath ?? "Agent page"}
                </span>
                <button
                  type="button"
                  onClick={() => state.previewPath && onView(state.previewPath)}
                  className="shrink-0 rounded-md border border-border/70 px-2 py-0.5 text-[10px] transition-colors hover:bg-accent"
                >
                  Open in files
                </button>
              </div>
              <iframe
                title="Tool preview"
                sandbox="allow-scripts"
                className="min-h-32 flex-1 border-0 bg-white"
                srcDoc={body}
              />
            </div>
          )
        : null,
    [ready, kind, body, state?.previewPath, onView],
  );

  const code = useMemo(
    () =>
      ready && kind === "code"
        ? (
            <details className="group mb-2">
              <summary className="flex cursor-pointer items-baseline gap-1.5 rounded px-1 py-0.5 font-mono text-[11px] text-foreground/80 hover:bg-accent">
                <span className="shrink-0 text-muted-foreground/50 group-open:opacity-60">▸</span>
                <span>{state.title}</span>
                <span className="hud-readout text-[10px] text-muted-foreground/60 ml-auto">
                  {body.length.toLocaleString()} chars
                </span>
              </summary>
              <pre
                className="mt-1.5 max-h-[240px] overflow-auto rounded border border-border/50 bg-background/60 p-2 font-mono text-[11px] leading-5 text-foreground/90"
              >
                {body}
              </pre>
            </details>
          )
        : null,
    [ready, kind, body, state?.title],
  );

  return (
    <>
      {terminal}
      {preview}
      {code}
      {!terminal && !preview && !code && (
        <pre className="max-h-[55vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/50 bg-background/60 p-3 font-mono text-xs leading-5">
          {body}
        </pre>
      )}
    </>
  );
}

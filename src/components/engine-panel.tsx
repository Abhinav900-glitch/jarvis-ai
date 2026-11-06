// ---------------------------------------------------------------------------
// EnginePanel — settings for the engine router.
//
// Three settings, because they answer three different questions:
//
//   - Smart routing. Off means the fixed provider ladder, exactly as it behaved
//     before the router existed. On means each turn is matched to the model that
//     suits it. Default on.
//   - Pinned engine. Overrides everything, including smart routing. Some people
//     would rather always have the same model than a different one each turn.
//   - Decision branches. Also answer with the best *different* engine, on a new
//     branch, so the two can be compared. Off by default: it costs a second
//     full generation per reply, which is not a cost to spend silently.
//
// The list shows the real registry with live availability, and the router's
// own reason for its current pick — so this panel is also the place to find out
// why an answer came from a particular model.
// ---------------------------------------------------------------------------

import { useMutation, useQuery } from "convex/react";
import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Brain, Check, GitBranch, X } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

export interface EnginePanelProps {
  open: boolean;
  onClose: () => void;
}

export function EnginePanel({ open, onClose }: EnginePanelProps) {
  const settings = useQuery(api.workspace.getEngineSettings);
  const options = useQuery(api.config.engineOptions, open ? { task: "chat" } : "skip");
  const save = useMutation(api.workspace.saveEngineSettings);

  // Read straight from the reactive query rather than mirrored into local state.
  // Convex re-renders the moment the mutation lands, so a second copy of the
  // truth would only exist to disagree with the server.
  const pinned = settings?.pinnedEngineId ?? null;
  const smart = settings?.smartEngine ?? true;
  const autoBranch = settings?.autoBranch ?? false;

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

  if (!open) return null;

  const engines = options?.engines ?? [];

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-0 backdrop-blur-sm sm:p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 10, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 10, scale: 0.99 }}
          transition={{ duration: 0.16 }}
          onClick={(e) => e.stopPropagation()}
          className="h-full max-h-none w-full max-w-none overflow-hidden bg-background pt-[env(safe-area-inset-top)] shadow-2xl sm:h-auto sm:max-h-[84vh] sm:max-w-lg sm:rounded-2xl sm:border sm:pt-0"
        >
          <div className="flex items-center gap-2 border-b px-4 py-3">
            <Brain className="size-4 text-muted-foreground" />
            <div className="min-w-0">
              <h2 className="text-sm font-medium">Engines</h2>
              <p className="truncate text-[11px] text-muted-foreground">
                {options?.reason ?? "Which model answers, and why."}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
              title="Close"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="divide-y">
            <div className="space-y-2 px-4 py-3">
              <Toggle
                label="Smart routing"
                description="Match the model to each turn — an image question only reaches a model that can see, research prefers one that reasons."
                checked={smart}
                onChange={(next) => {
                  void save({ smartEngine: next });
                }}
              />
              <Toggle
                label="Decision branches"
                description="Also answer with the best different engine, on its own branch, so you can compare. Costs a second generation per reply."
                checked={autoBranch}
                onChange={(next) => {
                  void save({ autoBranch: next });
                }}
              />
            </div>

            <div className="px-4 py-3">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-xs font-medium">Pinned engine</span>
                <span className="text-[10px] text-muted-foreground">
                  overrides routing
                </span>
              </div>

              <div className="mb-2 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    void save({ pinnedEngineId: null });
                  }}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                    pinned === null
                      ? "border-foreground/25 bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                  )}
                >
                  Automatic
                </button>
              </div>

              <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
                {engines.map((engine) => {
                  const selected = pinned === engine.id;
                  return (
                    <li key={engine.id}>
                      <button
                        type="button"
                        disabled={!engine.available}
                        onClick={() => {
                          void save({ pinnedEngineId: engine.id });
                        }}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors",
                          selected
                            ? "border-foreground/25 bg-accent"
                            : "border-transparent hover:bg-accent/50",
                          !engine.available && "cursor-not-allowed opacity-45",
                        )}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="truncate text-xs font-medium">
                              {engine.label}
                            </span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {engine.provider}
                            </span>
                            {engine.vision ? (
                              <span className="shrink-0 rounded bg-primary/15 px-1 text-[9px] text-primary">
                                vision
                              </span>
                            ) : null}
                            {engine.reasoning ? (
                              <span className="shrink-0 rounded bg-violet-500/15 px-1 text-[9px] text-violet-300">
                                reasons
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                            {engine.available ? engine.because : "no API key configured"}
                          </span>
                        </span>
                        {selected ? (
                          <Check className="size-3.5 shrink-0 text-foreground" />
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {autoBranch ? (
              <p className="flex items-start gap-2 px-4 py-2.5 text-[10px] leading-4 text-muted-foreground">
                <GitBranch className="mt-px size-3 shrink-0" />
                When a decision branch is created, the reply shows a “compare”
                badge that opens both answers side by side with the differences
                highlighted.
              </p>
            ) : null}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cn(
          "mt-0.5 h-4 w-7 shrink-0 rounded-full border transition-colors",
          checked ? "border-primary/60 bg-primary/40" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "block size-3 rounded-full bg-foreground transition-transform",
            checked ? "translate-x-3.5" : "translate-x-0.5",
          )}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-xs font-medium">{label}</span>
        <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
          {description}
        </span>
      </span>
    </div>
  );
}
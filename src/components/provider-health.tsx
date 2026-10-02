// ---------------------------------------------------------------------------
// ProviderHealth — which providers are actually plugged in.
//
// Sits in the live HUD. It exists because the answer used to be "why was that
// slow?" with nothing to read: a reply could come from any of four vendors, and
// a missing key looked identical to a slow model. A row of dots settles it at a
// glance, and the tooltip names the exact environment variable to add.
//
// Reads key presence only — never any key material — from the same registry the
// router reads, so this cannot disagree with what will actually be called.
// ---------------------------------------------------------------------------

import { useQuery } from "convex/react";
import { useState } from "react";
import { Activity, ChevronDown } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/convex/_generated/api";
import { cn } from "@/lib/utils";

export interface ProviderHealthProps {
  /** Compact single-row form for the HUD header. */
  className?: string;
}

export function ProviderHealth({ className }: ProviderHealthProps) {
  const health = useQuery(api.config.providerHealth);
  const [open, setOpen] = useState(false);

  const providers = health?.providers ?? [];
  const live = providers.filter((p) => p.configured);

  return (
    <div className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Provider health"
        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <Activity className="size-3" />
        <span className="tabular-nums">
          {live.length}/{providers.length || 0}
        </span>
        <span className="flex items-center gap-1">
          {providers.map((p) => (
            <span
              key={p.id}
              className={cn(
                "size-1.5 rounded-full",
                p.configured ? "bg-emerald-500" : "bg-muted-foreground/30",
              )}
            />
          ))}
        </span>
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </button>

      <AnimatePresence>
        {open && providers.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full z-50 mt-1.5 w-72 rounded-xl border bg-popover/95 p-2.5 text-[11px] shadow-xl backdrop-blur"
          >
            <p className="mb-2 px-0.5 text-[10px] uppercase tracking-widest text-muted-foreground/70">
              AI providers
            </p>
            <ul className="space-y-1.5">
              {providers.map((p) => (
                <li key={p.id} className="rounded-lg px-1 py-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        p.configured ? "bg-emerald-500" : "bg-muted-foreground/30",
                      )}
                    />
                    <span className="font-medium">{p.label}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      {p.configured ? `${p.engines.length} models` : "not configured"}
                    </span>
                  </div>
                  {p.configured ? (
                    <p className="mt-1 pl-3.5 text-[10px] leading-4 text-muted-foreground/80">
                      {p.engines.map((e) => e.label).join(" · ")}
                    </p>
                  ) : (
                    <p className="mt-1 pl-3.5 font-mono text-[10px] leading-4 text-muted-foreground/80">
                      {p.note}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
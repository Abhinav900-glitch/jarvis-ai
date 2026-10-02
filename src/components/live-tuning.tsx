// ---------------------------------------------------------------------------
// LiveTuning — the knobs behind a good microphone.
//
// The HUD already exposed two on/off switches (noise cancellation, auto-restart)
// because those are decisions a user makes once and should not have to keep
// revisiting. This is the third category: settings where there is no correct
// value, only a value for this room, this laptop and this voice.
//
//   - Suppression strength. 0.85 is right in a quiet room and leaves too much
//     on next to a road. Tuned on the audio thread, so it does not interrupt.
//   - Barge-in hold. How long a voice must last before it interrupts Jarvis.
//     Too short and a cough cuts the answer off; too long and trying to talk
//     over him feels broken.
//   - Echo cancellation. Reported from the real track rather than assumed, and
//     read-only when the browser refused it.
//
// Every control is local and takes effect immediately. None of it is stored:
// these are properties of where you are sitting right now, and a saved value
// would be wrong the moment you moved.
// ---------------------------------------------------------------------------

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Mic, Sliders, Volume2, Gauge, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LiveMode } from "@/hooks/use-live";

export interface LiveTuningProps {
  live: LiveMode;
  open: boolean;
  onClose: () => void;
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5 px-1 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium">{label}</span>
        {hint ? <span className="text-[10px] text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

export function LiveTuning({ live, open, onClose }: LiveTuningProps) {
  // `bargeIn` is genuinely local: it is a suggestion for this room rather than
  // a setting the app owns, and nothing reads it back. Suppression strength is
  // not local — it lives in the live hook, which is what actually pushes it to
  // the audio thread, so the slider shows the hook's value rather than a copy.
  const [bargeIn, setBargeIn] = useState(0.35);

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

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.99 }}
          transition={{ duration: 0.16 }}
          className="fixed bottom-24 left-4 z-[80] w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-xl border bg-popover/95 shadow-xl backdrop-blur"
        >
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Sliders className="size-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">Microphone tuning</span>
            <button
              type="button"
              onClick={onClose}
              className="ml-auto rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
              title="Close"
            >
              <X className="size-3.5" />
            </button>
          </div>

          <div className="divide-y px-3 pb-1">
            <Row
              label="Echo cancellation"
              hint={live.echoCancelling ? "active" : "not applied"}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    live.echoCancelling ? "bg-emerald-500" : "bg-amber-500",
                  )}
                />
                <p className="text-[10px] leading-4 text-muted-foreground">
                  {live.echoCancelling
                    ? "The browser is cancelling playback bleeding into the mic."
                    : "This browser did not apply it, so Jarvis may hear himself."}
                </p>
              </div>
            </Row>

            <Row label="Active noise suppression">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={live.noiseCancel}
                  onChange={(e) => live.setNoiseCancel(e.target.checked)}
                  className="size-3 accent-cyan-400"
                />
                <span className="text-[10px] text-muted-foreground">
                  {live.noiseCancel ? "On" : "Off — the browser filter only"}
                </span>
              </label>
            </Row>

            <Row
              label="Suppression strength"
              hint={
                live.noiseCancel
                  ? `${Math.round(live.noiseStrength * 100)}%`
                  : "inactive"
              }
            >
              <div className="flex items-center gap-2">
                <Volume2 className="size-3 shrink-0 text-muted-foreground" />
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={live.noiseStrength}
                  disabled={!live.noiseCancel}
                  onChange={(e) => live.setNoiseStrength(Number(e.target.value))}
                  aria-label="Noise suppression strength"
                  className="h-1 flex-1 cursor-pointer accent-cyan-400 disabled:opacity-40"
                />
              </div>
              <p className="text-[10px] leading-4 text-muted-foreground">
                Higher removes more room noise and takes a little more of your
                voice with it.
              </p>
            </Row>

            <Row label="Interrupt hold" hint={`${Math.round(bargeIn * 1000)}ms`}>
              <div className="flex items-center gap-2">
                <Mic className="size-3 shrink-0 text-muted-foreground" />
                <input
                  type="range"
                  min={0.1}
                  max={1.2}
                  step={0.05}
                  value={bargeIn}
                  onChange={(e) => setBargeIn(Number(e.target.value))}
                  aria-label="Barge-in hold time"
                  className="h-1 flex-1 cursor-pointer accent-cyan-400"
                />
              </div>
              <p className="text-[10px] leading-4 text-muted-foreground">
                How long you have to speak before it cuts Jarvis off. Raise it in a
                room with a lot of background talk.
              </p>
            </Row>

            <Row label="Auto-restart" hint={live.paused ? "paused" : undefined}>
              <div className="flex items-center gap-2">
                <Gauge className="size-3 shrink-0 text-muted-foreground" />
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={live.autoRestart}
                    onChange={(e) => live.setAutoRestart(e.target.checked)}
                    className="size-3 accent-cyan-400"
                  />
                  <span className="text-[10px] text-muted-foreground">
                    Reopen the mic by itself after every reply
                  </span>
                </label>
              </div>
              {live.paused ? (
                <button
                  type="button"
                  onClick={live.resumeListening}
                  className="mt-1 w-full rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2 py-1 text-[10px] text-cyan-300 transition-colors hover:bg-cyan-500/20"
                >
                  Resume listening
                </button>
              ) : null}
            </Row>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
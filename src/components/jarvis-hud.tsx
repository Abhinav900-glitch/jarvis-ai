// ---------------------------------------------------------------------------
// JarvisHud — full-screen live-mode interface built around a rainbow sphere.
//
// The sphere is a conic-gradient globe whose speed is driven by the
// conversation phase: it drifts while idle, perks up while listening, steadies
// while Jarvis thinks, and sprints while it speaks. Tapping it boosts the spin
// on demand.
//
// All state comes from useLiveMode; the written conversation is streamed in
// through the `transcript` prop so the reply is readable, not just audible.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Mic, MicOff, SkipForward, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownMessage } from "@/components/markdown-message";
import { WAKE_PHRASE } from "@/lib/wake-word";

export type HudPhase = "listening" | "processing" | "speaking" | "idle";

export interface LiveTurn {
  user: string;
  assistant: string;
}

export interface JarvisHudProps {
  open: boolean;
  phase: HudPhase;
  /** 0..1 live mic level — nudges the glow and the equalizer */
  level: number;
  /** Rolling conversation log, oldest first — mirrors a ChatGPT voice call */
  transcript: LiveTurn[];
  /** Selected country/language name for the HUD readout */
  language: string;
  /** When true, turns that don't open with the wake phrase are ignored */
  wakeGated: boolean;
  onToggleWake: () => void;
  onStop: () => void;
  /** Interrupt the spoken reply — drop straight back to listening */
  onSkip: () => void;
}

const STATUS_LABELS: Record<HudPhase, string> = {
  listening: "Listening…",
  processing: "Thinking…",
  speaking: "Speaking…",
  idle: "Ready when you are",
};

const STATUS_HINTS: Record<HudPhase, string> = {
  listening: "Just start talking — Jarvis answers when you pause",
  processing: "Working on your reply",
  speaking: "Tap the sphere to skip · talk over Jarvis to interrupt",
  idle: "Say something to begin the conversation",
};

/** 8-bar equalizer, animated by CSS whenever the session is live. */
function Equalizer() {
  return (
    <div className="sphere-eq" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <i key={i} />
      ))}
    </div>
  );
}

/**
 * ChatGPT-call style caption log: you on the right, Jarvis answering below.
 * Rendered as the same written markdown the chat pane uses, so headings,
 * lists and maths stay readable while Jarvis talks.
 */
function ConversationLog({ turns }: { turns: LiveTurn[] }) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns.length, turns[turns.length - 1]?.assistant]);

  if (turns.length === 0) {
    return (
      <p className="text-center text-sm text-[#9ea6c5]">
        Go ahead — I&rsquo;m listening.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {turns.map((turn, i) => (
        <div key={i} className="space-y-2">
          {turn.user && (
            <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm border border-white/10 bg-white/[0.07] px-3.5 py-2 text-sm leading-6 text-[#f3f4ff]/90">
              {turn.user}
            </p>
          )}
          {turn.assistant && (
            <div className="max-w-[95%] text-sm leading-6">
              <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.28em] text-[#818cf8]">
                Jarvis
              </span>
              {/* `dark` scopes the markdown prose tokens to this always-dark
                  surface even when the app itself is in light mode. */}
              <div className="jarvis-hud-prose dark">
                <MarkdownMessage content={turn.assistant} />
              </div>
            </div>
          )}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

export function JarvisHud({
  open,
  phase,
  level,
  transcript,
  language,
  wakeGated,
  onToggleWake,
  onStop,
  onSkip,
}: JarvisHudProps) {
  const [boost, setBoost] = useState(false);

  // A manual boost only makes sense while the session is running; drop it
  // when the HUD closes so the next call starts at the phase-driven speed.
  useEffect(() => {
    if (!open) setBoost(false);
  }, [open]);

  if (!open) return null;

  // Speaking already spins fast, so the boost toggle is only meaningful for
  // the slower phases.
  const fast = boost || phase === "speaking";
  const glowBoost = level * 0.5;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      data-phase={phase}
      className="sphere-stage fixed inset-0 z-[80] overflow-hidden"
    >
      {/* Top status bar */}
      <div className="pointer-events-none absolute top-6 left-0 right-0 text-center text-[11px] tracking-[0.28em] text-[#9ea6c5] uppercase">
        <b className="font-semibold text-[#e9eaff]">JARVIS</b> &nbsp;·&nbsp;{" "}
        {language}
      </div>

      {/* Close button */}
      <button
        onClick={onStop}
        title="End Live Mode"
        className="absolute top-5 right-5 z-20 inline-flex size-9 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10 text-red-400 transition-colors hover:bg-red-500/20"
      >
        <X className="size-4" />
      </button>

      {/* Sphere: orb on top, written conversation below it, in a flex column
          so a long reply grows downward and never covers the globe. */}
      <div className="flex h-full w-full flex-col items-center px-6 pt-16 pb-6">
        <div className="sphere-scene relative flex shrink-0 flex-col items-center">
          <div
            className="relative grid aspect-square w-[78vw] max-w-[300px] place-items-center"
            style={{ transform: `scale(${1 + glowBoost * 0.06})` }}
          >
            <button
              type="button"
              onClick={() => setBoost((v) => !v)}
              aria-pressed={boost}
              aria-label={
                boost ? "Return the sphere to its normal speed" : "Spin the sphere faster"
              }
              className={cn("sphere-button", fast && "fast")}
            >
              <span className="sphere" />
            </button>
            <span className="sphere-glow" aria-hidden="true" />
          </div>

          <div className="mt-3 flex shrink-0 flex-col items-center gap-2">
            <Equalizer />
            <div
              aria-live="polite"
              className="text-sm tracking-[0.015em] text-[#f3f4ff]"
            >
              {wakeGated && (phase === "listening" || phase === "idle")
                ? `Say “${WAKE_PHRASE}” to wake it`
                : STATUS_LABELS[phase]}
            </div>
            <div className="text-center text-xs text-[#8189a7]">
              {STATUS_HINTS[phase]}
            </div>
          </div>

          {boost && phase !== "speaking" && (
            <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-[#818cf8]/30 bg-[#818cf8]/10 px-2.5 py-1 text-[10px] font-semibold tracking-[0.2em] text-[#a5b4fc] uppercase">
              <Zap className="size-3" />
              Boost
            </div>
          )}
        </div>

        {/* Written conversation + controls */}
        <div className="mt-4 flex min-h-0 w-full max-w-2xl flex-1 flex-col">
          <div className="jarvis-hud-scroll flex min-h-0 flex-1 flex-col justify-end overflow-y-auto pb-1">
            <ConversationLog turns={transcript} />
          </div>

          <div className="flex h-12 shrink-0 items-center justify-center gap-4">
            <button
              onClick={onToggleWake}
              title={
                wakeGated
                  ? `Wake gate on — turns are ignored until you say “${WAKE_PHRASE}”`
                  : "Wake gate off — Jarvis answers anything it hears"
              }
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] transition-colors",
                wakeGated
                  ? "border-[#818cf8]/40 bg-[#818cf8]/15 text-[#a5b4fc]"
                  : "border-white/10 bg-white/[0.04] text-[#8189a7] hover:bg-white/[0.08]",
              )}
            >
              {wakeGated ? <Mic className="size-3" /> : <MicOff className="size-3" />}
              {wakeGated ? "Wake gate on" : "Wake gate off"}
            </button>
            {phase === "speaking" && (
              <button
                onClick={onSkip}
                title="Skip reply"
                className="inline-flex size-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-[#c7d2fe] transition-colors hover:bg-white/[0.12]"
              >
                <SkipForward className="size-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

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

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  Mic,
  MicOff,
  SkipForward,
  X,
  Zap,
  Hand,
  Copy,
  Check,
  Download,
  Waves,
  MicVocal,
  Pause,
  Play,
  ChevronDown,
  Sliders,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MarkdownMessage } from "@/components/markdown-message";
import { WAKE_PHRASE } from "@/lib/wake-word";
import type { Mood } from "@/lib/voice-mood";
import type { GestureAction } from "@/lib/gesture-actions";
import { UltronOrb } from "@/components/ultron-orb";

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
  /** Coarse delivery read of the user's last turn, or null if unmeasurable. */
  mood?: Mood | null;
  /** When true, turns that don't open with the wake phrase are ignored */
  wakeGated: boolean;
  onToggleWake: () => void;
  onStop: () => void;
  /** Interrupt the spoken reply — drop straight back to listening */
  onSkip: () => void;
  /** 0..1 mic / speech level, drives the orb's energy. */
  energy?: number;
  /** A camera stream already open (live mode holds one for vision). */
  cameraStream?: MediaStream | null;
  /** Webcam hand tracking for the orb. */
  gesturesEnabled?: boolean;
  /** Turn webcam hand tracking on or off. */
  onToggleGestures?: () => void;
  /** True while the mic is switched off by a clap. */
  muted?: boolean;
  /** A confirmed hand gesture resolved to a Jarvis action. */
  onGestureAction?: (action: GestureAction) => void;

  // --- New controls ---------------------------------------------------

  /** Up but not listening, because auto-restart is off. */
  paused?: boolean;
  /** Open the mic after a deliberate pause. */
  onResume?: () => void;
  autoRestart?: boolean;
  onToggleAutoRestart?: () => void;
  noiseCancel?: boolean;
  onToggleNoiseCancel?: () => void;
  /** Whether the browser really applied echo cancellation, read back from the track. */
  echoCancelling?: boolean;
  /** Voices the server can speak with, grouped by provider. */
  voiceOptions?: VoiceOptions | null;
  /** Currently selected voice name, and the setter for it. */
  voice?: string;
  onVoiceChange?: (voice: string) => void;
  /** Speaking rate, and the setter for it. */
  pace?: number;
  onPaceChange?: (pace: number) => void;

  /** Slot for the provider-health strip, rendered in the header row. */
  providerHealth?: React.ReactNode;
  /** Open the microphone tuning panel. */
  onOpenTuning?: () => void;
}

/** Shape returned by `config.voiceOptions`. */
export interface VoiceOptions {
  providers: {
    id: string;
    label: string;
    available: boolean;
    voices: string[];
  }[];
  paceRange: { min: number; max: number; default: number };
}

const STATUS_LABELS: Record<HudPhase, string> = {
  listening: "Listening…",
  processing: "Thinking…",
  speaking: "Speaking…",
  idle: "Ready when you are",
};

/**
 * What the mood detector heard, phrased as an observation rather than a
 * diagnosis. It is a coarse prosodic read, so the HUD says what it noticed
 * ("you sound tense") instead of claiming to know a feeling.
 */
const MOOD_LABELS: Record<Mood, string> = {
  stressed: "you sound tense",
  animated: "you sound animated",
  tired: "you sound tired",
  calm: "you sound settled",
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

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

/** Pill toggle used by the control row. `tone` picks the spectrum step. */
function Pill({
  on,
  onClick,
  title,
  accent = "var(--spec-6)",
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  accent?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-pressed={on}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] transition-colors",
        on ? "jarvis-spectrum" : "border-white/10 bg-white/[0.04] text-[var(--hud-dim)]",
      )}
      style={
        on
          ? {
              borderColor: `${accent}66`,
              backgroundColor: `${accent}1f`,
              color: accent,
            }
          : undefined
      }
    >
      {children}
    </button>
  );
}

/** Download the transcript as Markdown, named for the moment it was taken. */
function downloadTranscript(turns: LiveTurn[]) {
  const body = turns
    .filter((t) => t.user.trim() || t.assistant.trim())
    .map((t) => {
      const head = t.user.trim() ? `**You:** ${t.user.trim()}` : "";
      const bodyText = t.assistant.trim() ? `**Jarvis:** ${t.assistant.trim()}` : "";
      return [head, bodyText].filter(Boolean).join("\n\n");
    })
    .join("\n\n---\n\n");

  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const blob = new Blob([`# Jarvis live transcript\n\n${body}\n`], {
    type: "text/markdown;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `jarvis-transcript-${stamp}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoked on the next tick so the download has certainly started.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Voice picker + speed slider, collapsed behind a single pill until wanted. */
function VoiceControls({
  options,
  voice,
  onVoiceChange,
  pace,
  onPaceChange,
}: {
  options: VoiceOptions | null;
  voice: string;
  onVoiceChange: (v: string) => void;
  pace: number;
  onPaceChange: (p: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const { min, max } = options?.paceRange ?? { min: 0.5, max: 2, default: 1.05 };

  // Flattened with the provider kept, because the same name can exist on two
  // providers and picking by bare name would be ambiguous.
  const all = useMemo(() => {
    const providers = options?.providers ?? [];
    return providers.flatMap((p) =>
      p.voices.map((v) => ({ voice: v, label: p.label, available: p.available })),
    );
  }, [options]);

  if (all.length === 0) return null;

  return (
    <div className="relative">
      <Pill
        on={open}
        onClick={() => setOpen((v) => !v)}
        title="Choose Jarvis's voice and speaking speed"
        accent="var(--spec-5)"
      >
        <MicVocal className="size-3" />
        Voice · {pace.toFixed(2)}×
        <ChevronDown className={cn("size-3 transition-transform", open && "rotate-180")} />
      </Pill>

      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-2 w-64 rounded-xl border border-[var(--hud-accent)]/25 bg-[var(--hud-panel)]/95 p-3 shadow-2xl backdrop-blur">
          <label className="mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--hud-dim)]">
            Voice
          </label>
          <div className="max-h-44 space-y-1 overflow-y-auto pr-1">
            {all.map((v) => {
              const selected = v.voice.toLowerCase() === voice.toLowerCase();
              return (
                <button
                  key={`${v.label}-${v.voice}`}
                  disabled={!v.available}
                  onClick={() => onVoiceChange(v.voice)}
                  title={
                    v.available
                      ? `${v.voice} — ${v.label}`
                      : `${v.label} is not configured. Add its key in the Keys tab to use it.`
                  }
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors",
                    !v.available && "cursor-not-allowed opacity-40",
                    v.available && "hover:bg-white/[0.06]",
                    selected && "bg-white/[0.1]",
                  )}
                  style={selected ? { color: "var(--spec-3)" } : undefined}
                >
                  <span className="capitalize">{v.voice}</span>
                  <span className="text-[10px] text-[var(--hud-dim)]">{v.label}</span>
                </button>
              );
            })}
          </div>

          <label className="mt-3 mb-1.5 block text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--hud-dim)]">
            Speed · {pace.toFixed(2)}×
          </label>
          <input
            type="range"
            min={min}
            max={max}
            step={0.05}
            value={pace}
            onChange={(e) => onPaceChange(Number(e.target.value))}
            className="w-full accent-[var(--spec-3)]"
            aria-label="Speaking speed"
          />
        </div>
      )}
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
  const lastReply = turns[turns.length - 1]?.assistant;

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [turns.length, lastReply]);

  if (turns.length === 0) {
    return (
      <p className="text-center text-sm text-[var(--hud-dim)]">
        Go ahead — I&rsquo;m listening.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {turns.map((turn, i) => (
        <div key={i} className="space-y-2">
          {turn.user && (
            <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm border border-[var(--hud-accent)]/25 bg-[var(--hud-accent)]/[0.08] px-3.5 py-2 text-sm leading-6 text-[var(--hud-bright)]/90">
              {turn.user}
            </p>
          )}
          {turn.assistant && (
            <div className="max-w-[95%] text-sm leading-6">
              <span
                className="jarvis-spectrum mb-1 block text-[10px] font-semibold uppercase tracking-[0.28em]"
                style={{ color: "var(--spec-4)" }}
              >
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
  mood,
  wakeGated,
  onToggleWake,
  onStop,
  onSkip,
  energy = 0,
  cameraStream = null,
  gesturesEnabled = false,
  onToggleGestures,
  muted = false,
  onGestureAction,
  paused = false,
  onResume,
  autoRestart = true,
  onToggleAutoRestart,
  noiseCancel = true,
  onToggleNoiseCancel,
  echoCancelling = false,
  voiceOptions = null,
  voice = "",
  onVoiceChange,
  pace = 1.05,
  onPaceChange,
  providerHealth = null,
  onOpenTuning,
}: JarvisHudProps) {
  const [boost, setBoost] = useState(false);
  // The Three.js orb replaces the CSS sphere. Optimistic: it mounts and tries
  // to create a WebGL context, and flips this back to false (revealing the CSS
  // sphere) if that fails.
  const [orbLive, setOrbLive] = useState(true);
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  // A manual boost only makes sense while the session is running. Deriving it
  // (rather than clearing it in an effect) means the next call always starts
  // at the phase-driven speed without a wasted render.
  const boosting = boost;
  // Speaking already spins fast, so the boost toggle is only meaningful for
  // the slower phases.
  const fast = boosting || phase === "speaking";
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
      <div className="pointer-events-none absolute top-6 left-0 right-0 text-center text-[11px] tracking-[0.28em] text-[var(--hud-dim)] uppercase">
        <b className="font-semibold text-[var(--hud-bright)]">JARVIS</b> &nbsp;·&nbsp;{" "}
        {language}
        {mood ? (
          <>
            {" "}
            &nbsp;·&nbsp;{" "}
            <span className="normal-case tracking-normal text-[var(--hud-faint)]">
              {MOOD_LABELS[mood]}
            </span>
          </>
        ) : null}
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
            className="sphere-frame relative grid aspect-square w-[78vw] max-w-[300px] place-items-center"
            style={{ transform: `scale(${1 + glowBoost * 0.06})` }}
          >
            <button
              type="button"
              onClick={() => setBoost((v) => !v)}
              aria-pressed={boosting}
              aria-label={
                boosting ? "Return the sphere to its normal speed" : "Spin the sphere faster"
              }
              className={cn("sphere-button", orbLive && "hidden", fast && "fast")}
            >
              {/* The lit body. It only breathes — all rotation is in the cage,
                  because in-plane rotation is what makes a sphere read flat. */}
              <span className="sphere" />
              {/* 3D wireframe cage: latitude great circles (sized to
                    R·sinθ so they sit on the ball), meridian great circles,
                    and two orbits whose paired dots swap in/out of view via
                    backface-visibility. This is what makes the sphere read as
                    a rotating sphere rather than a spinning flat disc. */}
              <span className="sphere-axis" aria-hidden="true">
                <i className="sphere-lat" style={{ transform: "rotateX(72deg)" }} />
                <i className="sphere-lat-36" style={{ transform: "rotateX(36deg)" }} />
                <i className="sphere-lat-12" style={{ transform: "rotateX(12deg)" }} />
                <i className="sphere-lat-12" style={{ transform: "rotateX(-12deg)" }} />
                <i className="sphere-lat-36" style={{ transform: "rotateX(-36deg)" }} />
                <i className="sphere-lat" style={{ transform: "rotateX(-72deg)" }} />
                <i className="sphere-mer" style={{ transform: "rotateY(0deg)" }} />
                <i className="sphere-mer" style={{ transform: "rotateY(45deg)" }} />
                <i className="sphere-mer" style={{ transform: "rotateY(90deg)" }} />
                <i className="sphere-mer" style={{ transform: "rotateY(135deg)" }} />
                <span className="sphere-orbit sphere-orbit-a">
                  <i />
                  <i />
                </span>
                <span className="sphere-orbit sphere-orbit-b">
                  <i />
                  <i />
                </span>
              </span>
            </button>
            <span className={cn("sphere-glow", orbLive && "hidden")} aria-hidden="true" />
            <UltronOrb
              className={cn("absolute inset-0 rounded-full", !orbLive && "hidden")}
              energy={energy}
              mood={mood}
              stream={cameraStream}
              gesturesEnabled={gesturesEnabled}
              onGestureAction={onGestureAction}
              onUnavailable={() => setOrbLive(false)}
            />
          </div>

          <div className="mt-3 flex shrink-0 flex-col items-center gap-2">
            <Equalizer />
            <div
              aria-live="polite"
              className="text-sm tracking-[0.015em] text-[var(--hud-bright)]"
            >
              {wakeGated && (phase === "listening" || phase === "idle")
                ? `Say “${WAKE_PHRASE}” to wake it`
                : STATUS_LABELS[phase]}
            </div>
            <div className="text-center text-xs text-[var(--hud-dim)]">
              {STATUS_HINTS[phase]}
            </div>
          </div>

          {boosting && phase !== "speaking" && (
            <div
              className="jarvis-spectrum mt-2 inline-flex items-center gap-1.5 rounded-full border border-[var(--spec-6)]/30 bg-[var(--spec-6)]/10 px-2.5 py-1 text-[10px] font-semibold tracking-[0.2em] text-[var(--spec-5)] uppercase"
            >
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

          <div className="flex shrink-0 flex-wrap items-center justify-center gap-2 pb-2">
            {paused && onResume && (
              <button
                onClick={onResume}
                className="jarvis-spectrum inline-flex items-center gap-1.5 rounded-full border border-[var(--spec-4)]/50 bg-[var(--spec-4)]/15 px-3.5 py-1.5 text-[11px] font-medium text-[var(--spec-4)]"
              >
                <Play className="size-3" />
                Resume listening
              </button>
            )}
            <button
              onClick={onToggleGestures}
              title={
                gesturesEnabled
                  ? "Hand control on — pinch to spin, two hands to zoom, open palm to interrupt"
                  : "Hand control off — uses the camera for gestures"
              }
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] transition-colors",
                gesturesEnabled
                  ? "jarvis-spectrum border-[var(--spec-2)]/40 bg-[var(--spec-2)]/15 text-[var(--spec-2)]"
                  : "border-white/10 bg-white/[0.04] text-[var(--hud-dim)] hover:bg-white/[0.08]",
              )}
            >
              <Hand className="size-3" />
              Gestures
              {muted ? " · off" : ""}
            </button>
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
                  ? "jarvis-spectrum border-[var(--spec-6)]/40 bg-[var(--spec-6)]/15 text-[var(--spec-5)]"
                  : "border-white/10 bg-white/[0.04] text-[var(--hud-dim)] hover:bg-white/[0.08]",
              )}
            >
              {wakeGated ? <Mic className="size-3" /> : <MicOff className="size-3" />}
              {wakeGated ? "Wake gate on" : "Wake gate off"}
            </button>
            {onToggleAutoRestart && (
              <Pill
                on={autoRestart}
                onClick={onToggleAutoRestart}
                accent="var(--spec-4)"
                title={
                  autoRestart
                    ? "Auto-restart on — the mic reopens by itself after every reply"
                    : "Auto-restart off — Jarvis waits for you to resume listening"
                }
              >
                {autoRestart ? <Waves className="size-3" /> : <Pause className="size-3" />}
                Auto
              </Pill>
            )}
            {onToggleNoiseCancel && (
              <Pill
                on={noiseCancel}
                onClick={onToggleNoiseCancel}
                accent="var(--spec-5)"
                title={
                  noiseCancel
                    ? `Noise cancellation on — ${echoCancelling ? "browser echo cancellation active" : "browser echo cancellation unavailable on this device"}`
                    : "Noise cancellation off — the raw microphone signal is used"
                }
              >
                <Waves className="size-3" />
                Noise
              </Pill>
            )}
            {onOpenTuning ? (
              <Pill
                on={false}
                onClick={onOpenTuning}
                accent="var(--spec-3)"
                title="Microphone tuning — suppression strength, interrupt hold, echo cancellation"
              >
                <Sliders className="size-3" />
                Tuning
              </Pill>
            ) : null}
            {providerHealth}
            {onVoiceChange && onPaceChange && (
              <VoiceControls
                options={voiceOptions}
                voice={voice}
                onVoiceChange={onVoiceChange}
                pace={pace}
                onPaceChange={onPaceChange}
              />
            )}
            <button
              onClick={() => {
                const text = transcript
                  .map((t) =>
                    [t.user.trim() && `You: ${t.user.trim()}`, t.assistant.trim() && `Jarvis: ${t.assistant.trim()}`]
                      .filter(Boolean)
                      .join("\n"),
                  )
                  .filter(Boolean)
                  .join("\n\n");
                if (!text) return;
                void navigator.clipboard
                  ?.writeText(text)
                  .then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1600);
                  })
                  .catch(() => {});
              }}
              disabled={transcript.length === 0}
              title="Copy the whole conversation"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-[var(--hud-dim)] transition-colors hover:bg-white/[0.08] disabled:opacity-30"
            >
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              onClick={() => downloadTranscript(transcript)}
              disabled={transcript.length === 0}
              title="Download the conversation as Markdown"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] text-[var(--hud-dim)] transition-colors hover:bg-white/[0.08] disabled:opacity-30"
            >
              <Download className="size-3" />
              Export
            </button>
            {phase === "speaking" && (
              <button
                onClick={onSkip}
                title="Skip reply (Space)"
                className="jarvis-spectrum inline-flex size-11 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-[var(--spec-5)] transition-colors hover:bg-white/[0.12]"
              >
                <SkipForward className="size-4" />
              </button>
            )}
          </div>
          <p className="shrink-0 pb-1 text-center text-[10px] tracking-[0.18em] text-[var(--hud-faint)] uppercase">
            Space interrupt · Esc end · M mute
          </p>
        </div>
      </div>
    </motion.div>
  );
}

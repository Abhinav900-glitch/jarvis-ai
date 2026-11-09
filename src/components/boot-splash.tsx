import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { motion } from "framer-motion";
import { JarvisMark } from "@/components/jarvis-logo";
import { ReactorCore } from "@/components/reactor-core";

const SEEN_KEY = "jarvis-boot-seen";
/** How long the arc takes to fill. The hold is slightly longer than the fill,
 *  so the ring closes before the screen starts leaving. */
const RUN_MS = 2_050;
const HOLD_MS = 2_350;
const FADE_MS = 520;
/** Reduced motion still gets a beat of the frame, just no travel. */
const CALM_HOLD_MS = 650;

/**
 * The boot log. Each line is a real subsystem of this build rather than filler
 * text: the router is the engine ladder, memory is the embedding store, and
 * vision is the web-image path. Cheap to keep honest, and it tells a returning
 * user what survived the deploy.
 */
const BEATS = [
  { at: 420, key: "core", value: "online" },
  { at: 780, key: "router", value: "engine ladder armed" },
  { at: 1_120, key: "memory", value: "index mounted" },
  { at: 1_460, key: "vision", value: "image search ready" },
] as const;

type Phase = "hidden" | "visible" | "leaving";

/**
 * The opening animation: the core spins up, the arc fills, the boot log ticks
 * down one subsystem at a time, then the whole frame lifts.
 *
 * Shown once per browser session, and never in the embed frame — a full-screen
 * takeover would land inside somebody else's page. The route is already
 * mounted underneath, so this is pure paint: nothing waits on it, and a slow
 * Convex query still starts when it would have. Clicking anywhere, or Escape,
 * dismisses it early; the choice is remembered for the session so the skip
 * sticks instead of the animation replaying on the next link.
 */
export function BootSplash() {
  const { pathname } = useLocation();
  const skip = pathname.startsWith("/embed");

  const [reduced] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  const [phase, setPhase] = useState<Phase>(() => {
    if (skip) return "hidden";
    try {
      return sessionStorage.getItem(SEEN_KEY) ? "hidden" : "visible";
    } catch {
      return "hidden";
    }
  });
  // Under reduced motion the frame is already "finished": full arc, every log
  // line visible, no travel. Seeding the state here rather than in an effect
  // keeps the first paint complete instead of flashing an empty ring.
  const [pct, setPct] = useState(reduced ? 100 : 0);
  const [beat, setBeat] = useState(reduced ? BEATS.length : 0);

  const dismiss = () => setPhase("leaving");

  // The arc fill. An interval rather than an animation frame loop: this drives
  // a number that turns into a stroke dash and a three-digit readout, so ~40
  // updates over two seconds is plenty and it stops itself.
  useEffect(() => {
    if (phase !== "visible" || reduced) return;
    const start = performance.now();
    const id = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - start) / RUN_MS);
      setPct(Math.round(t * 100));
      if (t >= 1) window.clearInterval(id);
    }, 55);
    return () => window.clearInterval(id);
  }, [phase, reduced]);

  // The log. Separate from the arc so a skipped frame cannot leave the two
  // out of step.
  useEffect(() => {
    if (phase !== "visible" || reduced) return;
    const timers = BEATS.map((line, index) =>
      window.setTimeout(() => setBeat(index + 1), line.at),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [phase, reduced]);

  useEffect(() => {
    if (phase !== "visible") return;
    const hold = window.setTimeout(
      () => setPhase("leaving"),
      reduced ? CALM_HOLD_MS : HOLD_MS,
    );
    return () => window.clearTimeout(hold);
  }, [phase, reduced]);

  useEffect(() => {
    if (phase !== "leaving") return;
    const done = window.setTimeout(() => {
      setPhase("hidden");
      try {
        sessionStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* private mode: the splash simply plays again next reload */
      }
    }, FADE_MS);
    return () => window.clearTimeout(done);
  }, [phase]);

  // Dismissal: any pointer press or Escape while the frame is up. Escape is
  // the one that matters for keyboard users, who would otherwise sit through
  // a 2.4s takeover on every new session.
  useEffect(() => {
    if (phase !== "visible") return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setPhase("leaving");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase]);

  if (phase === "hidden") return null;

  return (
    <div
      aria-hidden
      onClick={dismiss}
      className={`fixed inset-0 z-[120] flex flex-col items-center justify-center overflow-hidden bg-[#04060b] transition-opacity duration-500 ${
        phase === "leaving" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/* Field: two blooms for depth, a fine grid for scale, a vignette so the
          edges fall away instead of ending at a hard rectangle. */}
      <div className="jarvis-boot-field pointer-events-none absolute inset-0" />
      <div className="jarvis-boot-vignette pointer-events-none absolute inset-0" />
      <div
        aria-hidden
        className="jarvis-boot-scan pointer-events-none absolute inset-x-0 top-0 h-px"
      />

      {/* Corner readouts. Decoration for a wide screen, so they are the first
          thing to go when there is no room for them. */}
      <div className="pointer-events-none absolute inset-0 hidden sm:block">
        <span className="absolute left-8 top-8 font-mono text-[10px] uppercase tracking-[0.28em] text-white/30">
          jarvis · core boot
        </span>
        <span className="absolute right-8 top-8 font-mono text-[10px] uppercase tracking-[0.28em] text-white/25">
          build 05 / 2026
        </span>
        <span className="absolute bottom-8 left-8 font-mono text-[10px] uppercase tracking-[0.28em] text-white/25">
          engines · linked
        </span>
        <span className="absolute bottom-8 right-8 font-mono text-[10px] uppercase tracking-[0.28em] text-white/25">
          sector 07
        </span>
        {/* Corner brackets: the cheapest way to make a screen feel like a
            viewport. Four 16px corners, no images. */}
        {[
          "left-6 top-6 border-l border-t",
          "right-6 top-6 border-r border-t",
          "left-6 bottom-6 border-b border-l",
          "right-6 bottom-6 border-b border-r",
        ].map((side) => (
          <span
            key={side}
            className={`absolute size-4 border-white/15 ${side}`}
          />
        ))}
      </div>

      <div className="relative flex flex-col items-center">
        <div className="relative flex size-[300px] items-center justify-center sm:size-[420px]">
          <ReactorCore
            progress={pct / 100}
            spin={!reduced}
            className="absolute inset-0 size-full"
          />
          <div
            aria-hidden
            className="absolute size-40 rounded-full blur-3xl sm:size-52"
            style={{
              background:
                "radial-gradient(circle, rgba(99,230,255,0.26), rgba(122,92,255,0.14) 55%, transparent 72%)",
            }}
          />
          <JarvisMark
            animate
            drawIn
            className="relative size-24 sm:size-28"
            glow={false}
          />
        </div>

        <p className="jarvis-boot-word -mt-2 text-lg font-semibold text-white/90 sm:text-xl">
          JARVIS
          <span className="ml-1.5 bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500 bg-clip-text text-transparent">
            AI
          </span>
        </p>

        {/* Fixed height: the log fills in, so it must not resize the stack as
            each line lands and shove the wordmark upward. */}
        <ul className="mt-5 h-[92px] w-64 space-y-1.5 font-mono text-[10px] uppercase tracking-[0.18em] sm:w-72">
          {BEATS.map((line, index) => (
            <motion.li
              key={line.key}
              initial={false}
              animate={{
                opacity: index < beat ? 1 : 0.12,
                x: index < beat ? 0 : -4,
              }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="flex items-center gap-2 text-white/55"
            >
              <span
                className={`size-1 rounded-full transition-colors duration-300 ${
                  index < beat ? "bg-cyan-300" : "bg-white/25"
                }`}
              />
              <span className="text-white/70">{line.key}</span>
              <span className="text-white/30">·</span>
              <span>{line.value}</span>
            </motion.li>
          ))}
        </ul>

        <div className="mt-6 flex w-56 items-center gap-3 sm:w-64">
          <div className="h-px flex-1 overflow-hidden bg-white/10">
            <div
              className="h-full bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500"
              style={{
                width: `${pct}%`,
                transition: reduced ? undefined : "width 80ms linear",
              }}
            />
          </div>
          <span className="w-9 text-right font-mono text-[10px] tabular-nums text-white/40">
            {pct}%
          </span>
        </div>
      </div>

      <p className="absolute bottom-8 font-mono text-[9px] uppercase tracking-[0.3em] text-white/25">
        click to skip
      </p>
    </div>
  );
}

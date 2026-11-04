import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { JarvisMark } from "@/components/jarvis-logo";

const SEEN_KEY = "jarvis-boot-seen";
const HOLD_MS = 1500;
const FADE_MS = 450;

/**
 * The opening animation: the mark assembles over a dark field while the
 * wordmark rises and a thin line fills, then the whole thing fades away.
 *
 * Shown once per browser session. The route is already mounted behind it, so
 * this is pure paint — nothing waits on it, and a slow Convex query still
 * starts when it would have. Skipped in the embed frame, where a full-screen
 * takeover would land inside someone else's page.
 */
export function BootSplash() {
  const { pathname } = useLocation();
  const skip = pathname.startsWith("/embed");
  const [phase, setPhase] = useState<"hidden" | "visible" | "leaving">(() => {
    if (skip) return "hidden";
    try {
      return sessionStorage.getItem(SEEN_KEY) ? "hidden" : "visible";
    } catch {
      return "hidden";
    }
  });

  useEffect(() => {
    if (phase !== "visible") return;
    const hold = window.setTimeout(() => setPhase("leaving"), HOLD_MS);
    return () => window.clearTimeout(hold);
  }, [phase]);

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

  if (phase === "hidden") return null;

  return (
    <div
      aria-hidden
      className={`fixed inset-0 z-[120] flex flex-col items-center justify-center bg-[#05070c] transition-opacity duration-500 ${
        phase === "leaving" ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/* Two blooms, offset, so the field is lit rather than flat. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 45% at 50% 42%, rgba(58,140,255,0.20), transparent 70%), radial-gradient(40% 30% at 62% 62%, rgba(201,75,240,0.16), transparent 70%)",
        }}
      />

      <div className="jarvis-boot-mark relative">
        <div
          aria-hidden
          className="absolute inset-0 rounded-full blur-3xl"
          style={{
            background:
              "radial-gradient(circle, rgba(99,230,255,0.30), rgba(122,92,255,0.16) 55%, transparent 72%)",
          }}
        />
        <JarvisMark animate className="relative size-32 sm:size-36" glow={false} />
      </div>

      <p className="jarvis-boot-word mt-8 text-lg font-semibold text-white/90">
        JARVIS
        <span className="ml-1.5 bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500 bg-clip-text text-transparent">
          AI
        </span>
      </p>

      <div className="mt-7 h-px w-40 overflow-hidden bg-white/10">
        <div className="jarvis-boot-bar h-full w-full bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500" />
      </div>

      <p className="mt-4 text-[10px] font-medium uppercase tracking-[0.32em] text-white/35">
        Booting core
      </p>
    </div>
  );
}

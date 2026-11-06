/**
 * The orb, as a React component.
 *
 * Owns the Three.js scene, the optional hand tracker, and the gesture arbiter.
 * Everything expensive is created in an effect and torn down on unmount — the
 * orb must not survive the live-mode overlay closing, or a user who opens and
 * closes it a few times leaks a WebGL context each time.
 *
 * It degrades rather than fails: no WebGL, no camera permission, or a blocked
 * CDN all leave a working mouse/touch orb with no hand control.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createOrbScene, type OrbSceneApi } from "@/live/orb-scene";
import { HandTracker, type TrackerStatus } from "@/live/hand-tracker";
import {
  GestureArbiter,
  type GestureAction,
  type GestureSource,
} from "@/lib/gesture-actions";
import type { Mood } from "@/lib/voice-mood";
import { cn } from "@/lib/utils";

/**
 * Can this browser create a WebGL context at all?
 *
 * Asked before the scene is built, because the failure we care about is not an
 * exception — it is a context that is handed back and then renders nothing
 * (GPU blocklisted, software GL disabled, a preview frame that allows the call
 * but drops the drawing buffer). Probing first lets the caller show the
 * plain-HTML orb instead of a blank square with a 3D scene attached to it.
 */
function webglAvailable(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export interface UltroneOrbProps {
  /** 0..1 — mic level while listening, speech level while replying. */
  energy?: number;
  mood?: Mood | null;
  /**
   * A camera stream already open elsewhere (live mode holds one for vision).
   * Passing it avoids a second getUserMedia fighting for the same hardware.
   */
  stream?: MediaStream | null;
  /** Enable webcam hand tracking. Requires a user gesture to be useful. */
  gesturesEnabled?: boolean;
  /** Fired when a confirmed hand gesture maps to a Jarvis action. */
  onGestureAction?: (action: GestureAction) => void;
  /**
   * Called when WebGL is unavailable, so the caller can fall back to the CSS
   * sphere rather than showing nothing.
   */
  onUnavailable?: () => void;
  className?: string;
}

export function UltronOrb({
  energy = 0,
  mood = null,
  stream = null,
  gesturesEnabled = false,
  onGestureAction,
  onUnavailable,
  className,
}: UltroneOrbProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<OrbSceneApi | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const arbiterRef = useRef<GestureArbiter | null>(null);

  // Latest values, read from the tracker's frame loop without restarting it.
  // Synced in an effect rather than during render, matching the convention in
  // useLiveMode — writing a ref while rendering is unsafe under concurrent
  // rendering.
  const energyRef = useRef(energy);
  const moodRef = useRef(mood);
  const onActionRef = useRef(onGestureAction);
  const onUnavailableRef = useRef(onUnavailable);
  useEffect(() => {
    energyRef.current = energy;
    moodRef.current = mood;
    onActionRef.current = onGestureAction;
    onUnavailableRef.current = onUnavailable;
  });

  const [status, setStatus] = useState<TrackerStatus>({
    hands: 0,
    mode: "idle",
    gesture: "idle",
  });
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [internalGestures, setInternalGestures] = useState(false);

  // Uncontrolled when the caller does not pass `gesturesEnabled`, so the orb
  // can be dropped in anywhere (the landing page) and still respond to G.
  const gesturesOn = gesturesEnabled || internalGestures;
  const toggleGestures = useCallback(
    () => setInternalGestures((v) => !v),
    [],
  );

  // --- Scene lifecycle -------------------------------------------------
  useEffect(() => {
    const host = mountRef.current;
    if (!host) return;

    if (!webglAvailable()) {
      // Nothing to render into. Deferred so this reads as an external-system
      // update rather than a cascading render, and so the caller swaps in the
      // HTML orb before this mounts a scene that could never draw.
      queueMicrotask(() => onUnavailableRef.current?.());
      return;
    }

    let scene: OrbSceneApi | null = null;
    try {
      scene = createOrbScene(host);
      sceneRef.current = scene;
    } catch {
      // No WebGL context (old GPU, blocklisted driver). The HTML orb the HUD
      // renders instead stays visible, so this is survivable.
      queueMicrotask(() => onUnavailableRef.current?.());
      return;
    }

    // Reduced-motion users get a near-static scene rather than a moving one.
    if (
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      scene.setEnergy(0.15);
      scene.setMood("calm");
    }

    return () => {
      scene?.dispose();
      sceneRef.current = null;
    };
  }, []);

  // --- Push live values into the scene ---------------------------------
  useEffect(() => {
    sceneRef.current?.setEnergy(energy);
  }, [energy]);

  useEffect(() => {
    sceneRef.current?.setMood(mood);
  }, [mood]);

  // --- Hand tracking lifecycle -----------------------------------------
  useEffect(() => {
    if (!gesturesOn) {
      trackerRef.current?.stop();
      trackerRef.current = null;
      return;
    }
    const video = videoRef.current;
    if (!video) return;

    const arbiter = arbiterRef.current ?? new GestureArbiter();
    arbiterRef.current = arbiter;

    const tracker = new HandTracker(video, overlayRef.current, {
      onRotate: (dTheta, dPhi) => sceneRef.current?.rotateBy(dTheta, dPhi),
      onZoom: (factor) => sceneRef.current?.zoomBy(factor),
      onStatus: (s) => {
        setStatus(s);
        const event = arbiter.push(s.gesture, "hand" as GestureSource);
        if (event && event.action !== "none") onActionRef.current?.(event.action);
      },
      onError: () => {
        setTrackingError("Hand tracking unavailable — using mouse and touch.");
      },
    });
    trackerRef.current = tracker;

    let cancelled = false;
    void tracker.start(stream).catch(() => {
      if (!cancelled) {
        setTrackingError("Hand tracking unavailable — using mouse and touch.");
      }
    });

    return () => {
      cancelled = true;
      tracker.stop();
      trackerRef.current = null;
      arbiter.reset();
    };
  }, [gesturesOn, stream]);

  // --- Keyboard ---------------------------------------------------------
  const resetView = useCallback(() => sceneRef.current?.resetView(), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Never steal keys from something the user is typing into.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)) {
        return;
      }
      if (e.key === "g" || e.key === "G") toggleGestures();
      if (e.key === "r" || e.key === "R") resetView();
      if (e.key === "+" || e.key === "=") sceneRef.current?.zoomIn();
      if (e.key === "-" || e.key === "_") sceneRef.current?.zoomOut();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleGestures, resetView]);

  return (
    <div className={cn("relative h-full w-full", className)}>
      <div ref={mountRef} className="absolute inset-0" aria-hidden />

      {/* Camera feed + landmark overlay. Hidden: the orb is the interface,
          and a faceful of the user mid-conversation is a privacy smell. */}
      <video
        ref={videoRef}
        playsInline
        muted
        className="pointer-events-none absolute h-px w-px opacity-0"
      />
      <canvas
        ref={overlayRef}
        width={640}
        height={480}
        className="pointer-events-none absolute h-px w-px opacity-0"
      />

      {/* Status line, only while gestures are actually on. */}
      {gesturesOn ? (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-center text-[10px] tracking-[0.2em] text-[#7f88ad] uppercase">
          {trackingError ? (
            <span className="text-amber-400/80">{trackingError}</span>
          ) : status.mode !== "idle" ? (
            <span>
              {status.mode === "spin"
                ? "Pinch + move — spinning"
                : status.mode === "clap"
                  ? "Clap detected"
                  : "Open palm — move it closer or further to zoom"}
            </span>
          ) : status.hands > 0 ? (
            <span>{status.gesture.replace("_", " ")}</span>
          ) : (
            <span>Open palm to zoom · pinch to spin · clap to switch on</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

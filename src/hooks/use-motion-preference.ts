// ---------------------------------------------------------------------------
// Motion preference.
//
// The OS setting (prefers-reduced-motion) is the right default, but it is
// all-or-nothing and lives three menus away from the app. Someone who gets
// motion sick from one drifting aurora should not have to turn off every
// animation in every program to fix it. So there is an in-app switch that can
// only add restraint, never remove it: motion that the operating system has
// already suppressed stays suppressed, because a setting in an app has no
// business overruling an accessibility preference set on the machine.
//
// Two states, one attribute on <html>, and one localStorage key:
//   system  — follow the operating system (default)
//   reduced — ambient animation stops, transitions snap, and Framer Motion gets
//             `reducedMotion="always"` through MotionConfig at the root
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useState } from "react";

export type MotionPreference = "system" | "reduced";

const STORAGE_KEY = "jarvis-motion";

/** Fired on `window` when one part of the app changes the preference. */
const CHANGE_EVENT = "jarvis-motion-preference";

export const DEFAULT_MOTION: MotionPreference = "system";

function isMotionPreference(value: unknown): value is MotionPreference {
  return value === "system" || value === "reduced";
}

function readStored(): MotionPreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isMotionPreference(stored) ? stored : DEFAULT_MOTION;
  } catch {
    return DEFAULT_MOTION;
  }
}

/**
 * Apply the preference to the document.
 *
 * "system" removes the attribute rather than writing "system", so the existing
 * media queries keep doing the work and no CSS has to know this hook exists.
 */
export function applyMotionPreference(preference: MotionPreference): void {
  const root = document.documentElement;
  if (preference === "reduced") {
    root.dataset.motion = "reduced";
  } else {
    delete root.dataset.motion;
  }
}

/** Runs before React mounts, so the first paint already has the setting. */
export function applyStoredMotionPreference(): void {
  applyMotionPreference(readStored());
}

export function useMotionPreference() {
  const [preference, setPreferenceState] = useState<MotionPreference>(readStored);

  useEffect(() => {
    applyMotionPreference(preference);
  }, [preference]);

  // Another surface (the landing page, a second tab, a future settings panel)
  // may change this while this component is mounted.
  useEffect(() => {
    const sync = () => setPreferenceState(readStored());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setPreference = useCallback((next: MotionPreference) => {
    setPreferenceState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Blocked storage still gets the in-memory change.
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return { preference, setPreference };
}

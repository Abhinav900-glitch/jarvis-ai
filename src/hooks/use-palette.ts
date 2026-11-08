import { useCallback, useEffect, useState } from "react";

/** The skins the console ships with. All of them keep the same layout and
 *  density; only the colour system changes, which is why the switch is one
 *  attribute on <html> rather than a class per surface. */
export type PaletteId = "ember" | "reactor" | "futuristic";

export type Palette = {
  id: PaletteId;
  name: string;
  tagline: string;
  /** Two colours used to preview the skin before the user commits to it. */
  swatch: [string, string];
};

export const PALETTES: Palette[] = [
  {
    id: "ember",
    name: "Ember",
    tagline: "Warm graphite · brass signal",
    swatch: ["oklch(0.205 0.011 64)", "oklch(0.79 0.132 74)"],
  },
  {
    id: "reactor",
    name: "Reactor",
    tagline: "Ink navy · cyan signal",
    swatch: ["oklch(0.192 0.026 256)", "oklch(0.76 0.13 205)"],
  },
  {
    id: "futuristic",
    name: "Futuristic",
    tagline: "Deep space violet · neon aqua",
    swatch: ["oklch(0.184 0.045 290)", "oklch(0.78 0.19 302)"],
  },
];

export const DEFAULT_PALETTE: PaletteId = "ember";

const STORAGE_KEY = "jarvis-palette";

function isPaletteId(value: unknown): value is PaletteId {
  return (
    value === "ember" || value === "reactor" || value === "futuristic"
  );
}

export function applyPalette(id: PaletteId) {
  document.documentElement.dataset.palette = id;
}

/** Runs before React mounts so the first paint already wears the saved skin. */
export function applyStoredPalette() {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // storage can be blocked; the default skin is still correct
  }
  applyPalette(isPaletteId(stored) ? stored : DEFAULT_PALETTE);
}

export function usePalette() {
  const [palette, setPaletteState] = useState<PaletteId>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return isPaletteId(stored) ? stored : DEFAULT_PALETTE;
    } catch {
      return DEFAULT_PALETTE;
    }
  });

  useEffect(() => {
    applyPalette(palette);
  }, [palette]);

  const setPalette = useCallback((id: PaletteId) => {
    setPaletteState(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // ignore storage errors, the in-memory choice still applies
    }
  }, []);

  return { palette, setPalette };
}

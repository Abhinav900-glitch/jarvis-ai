import { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// How the transcript is set.
//
// Replies are long-form text, and the right typeface for them is a reading
// preference, not a brand decision — the console chrome stays as it is and only
// the prose changes. Cambria and Georgia are first in the serif stack because
// they were cut for screens: large x-height, sturdy serifs, still legible at
// 15px. Times New Roman is deliberately not the first choice — it thins out at
// interface sizes.
//
// Persisted in localStorage, because a reading preference the user has to
// re-pick on every visit is not a preference.
// ---------------------------------------------------------------------------

export type ReadingFont = "sans" | "serif" | "mono";
export type ReadingSize = "s" | "m" | "l";

export interface ReadingOption<T extends string> {
  id: T;
  name: string;
  hint: string;
  /** Short label for the menu's current-value readout. */
  label: string;
}

export const READING_FONTS: ReadingOption<ReadingFont>[] = [
  {
    id: "sans",
    name: "Sans",
    label: "Sans",
    hint: "The interface's own face — neutral, tight",
  },
  {
    id: "serif",
    name: "Serif",
    label: "Serif",
    hint: "Cambria, then Georgia — easier for long answers",
  },
  {
    id: "mono",
    name: "Monospace",
    label: "Mono",
    hint: "Fixed width — code-heavy answers line up",
  },
];

export const READING_SIZES: ReadingOption<ReadingSize>[] = [
  { id: "s", name: "Small", label: "S", hint: "More on screen at once" },
  { id: "m", name: "Default", label: "M", hint: "The shipped size" },
  { id: "l", name: "Large", label: "L", hint: "Easier on the eyes" },
];

const FONT_KEY = "jarvis-reading-font";
const SIZE_KEY = "jarvis-reading-size";

function readStored<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const saved = localStorage.getItem(key);
    return allowed.includes(saved as T) ? (saved as T) : fallback;
  } catch {
    return fallback;
  }
}

export function useReadingType() {
  const [font, setFontState] = useState<ReadingFont>(() =>
    readStored(FONT_KEY, READING_FONTS.map((f) => f.id), "sans"),
  );
  const [size, setSizeState] = useState<ReadingSize>(() =>
    readStored(SIZE_KEY, READING_SIZES.map((s) => s.id), "m"),
  );

  useEffect(() => {
    try {
      localStorage.setItem(FONT_KEY, font);
    } catch {
      /* a private window that refuses storage is not an error */
    }
  }, [font]);

  useEffect(() => {
    try {
      localStorage.setItem(SIZE_KEY, size);
    } catch {
      /* ignore */
    }
  }, [size]);

  return {
    font,
    size,
    setFont: setFontState,
    setSize: setSizeState,
    isDefault: font === "sans" && size === "m",
  };
}

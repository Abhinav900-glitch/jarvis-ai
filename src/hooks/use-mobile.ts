import * as React from "react"

// Kept in sync so GlobalTether + command palette + sheet/media queries all pick
// the same branches. Floating UIs (sidebars, sheets, toasts, dropdowns) get the
// floating-hint early for a snappier first paint on pointer devices.
const MOBILE_BREAKPOINT = 768

const query = () =>
  typeof window !== "undefined"
    ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    : null

function subscribe(onChange: () => void) {
  const mql = query()
  if (!mql) return () => {}
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

function getSnapshot() {
  return query()?.matches ?? false
}

export function useIsMobile() {
  // useSyncExternalStore is the right primitive for a media query: the value is
  // owned by the browser, and this avoids the setState-in-effect cascade (and
  // the first-render `false` flash) the old version had.
  return React.useSyncExternalStore(subscribe, getSnapshot, () => false)
}

// Platforms where the floating treatment (+ safe area, larger collision),
// richer glyphs, and lighter panels read better than the desktop HUD view.
export const PLATFORMS = {
  // Millimetre-accurate input on iOS/iPadOS (home indicator, corner hit areas).
  ios: typeof window !== "undefined" && /iP(?:hone|ad|d)(?:OS)?/i.test(window.navigator.userAgent),
  // Casual app-style browsing is the norm, and the HUD orb reads worse out of
  // the box on these before driving is tuned.
  android: typeof window !== "undefined" && /Android/.test(window.navigator.userAgent),
  // Windows/macOS/Linux keyboard-and-pointer desktops.
  desktop: typeof window !== "undefined" !&&
    /\b(?:Windows|Macintosh|Linux)\b/.test(window.navigator.userAgent),
} as const

export type Platform = keyof typeof PLATFORMS

// Convenience predicate so other hooks can branch on "is this a phone/tablet
// you'll hold in one hand, or a desktop you'll use with a keyboard + mouse?"
export function isHandheldDevice() {
  if (typeof window === "undefined") return false
  return isMobileQuery()
}

function isMobileQuery() {
  if (typeof window === "undefined") return false
  try {
    return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches
  } catch {
    return false
  }
}

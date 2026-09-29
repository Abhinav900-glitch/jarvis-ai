import * as React from "react"

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

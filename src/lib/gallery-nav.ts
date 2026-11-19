// ---------------------------------------------------------------------------
// Keyboard movement through a CSS grid.
//
// Kept out of the component so the awkward parts — the edges, a half-filled
// last row, a one-column phone grid — can be tested without a browser. Up and
// Down are row moves, and a row is however many columns the grid actually
// drew at this breakpoint, which is why the caller measures instead of guessing.
// ---------------------------------------------------------------------------

/** Keys the gallery grid handles. Anything else is left to the browser. */
export const GRID_NAV_KEYS = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
] as const;

export type GridNavKey = (typeof GRID_NAV_KEYS)[number];

export function isGridNavKey(key: string): key is GridNavKey {
  return (GRID_NAV_KEYS as readonly string[]).includes(key);
}

/**
 * Where focus should go, given the key pressed.
 *
 * Returns `null` for a key the grid does not own, which the caller uses to
 * leave the event alone (Tab, Enter, typing). Edges clamp rather than wrap:
 * wrapping from the bottom of the archive to the top on one arrow press is
 * disorienting when the grid is longer than the screen.
 */
export function nextTileIndex(
  from: number,
  key: string,
  columns: number,
  total: number,
): number | null {
  if (!isGridNavKey(key)) return null;
  if (total <= 0) return null;

  const last = total - 1;
  const cols = Math.max(1, Math.floor(columns));
  // A stale index (the filter changed under the focus ring) is treated as the
  // start rather than producing a negative jump.
  const current = Math.min(Math.max(0, from), last);

  switch (key) {
    case "ArrowRight":
      return Math.min(current + 1, last);
    case "ArrowLeft":
      return Math.max(current - 1, 0);
    case "ArrowDown":
      return Math.min(current + cols, last);
    case "ArrowUp":
      return Math.max(current - cols, 0);
    case "Home":
      return 0;
    case "End":
      return last;
  }
}

import { describe, expect, test } from "bun:test";

import { isGridNavKey, nextTileIndex } from "../gallery-nav";

describe("nextTileIndex", () => {
  test("moves one across and one row down", () => {
    // 4 columns, 10 tiles; index 5 is row 1, column 1.
    expect(nextTileIndex(5, "ArrowRight", 4, 10)).toBe(6);
    expect(nextTileIndex(5, "ArrowLeft", 4, 10)).toBe(4);
    expect(nextTileIndex(5, "ArrowDown", 4, 10)).toBe(9);
    expect(nextTileIndex(5, "ArrowUp", 4, 10)).toBe(1);
  });

  test("clamps at the edges instead of wrapping", () => {
    expect(nextTileIndex(0, "ArrowLeft", 3, 9)).toBe(0);
    expect(nextTileIndex(8, "ArrowRight", 3, 9)).toBe(8);
    expect(nextTileIndex(1, "ArrowUp", 3, 9)).toBe(0);
  });

  test("stops on a half-filled last row", () => {
    // 8 tiles in 3 columns: the last row holds indices 6 and 7 only. Dropping
    // from index 3 lands on 6; dropping from 4 must not skip past 7.
    expect(nextTileIndex(3, "ArrowDown", 3, 8)).toBe(6);
    expect(nextTileIndex(4, "ArrowDown", 3, 8)).toBe(7);
    expect(nextTileIndex(7, "ArrowDown", 3, 8)).toBe(7);
  });

  test("Home and End jump to the ends in any column count", () => {
    expect(nextTileIndex(6, "Home", 2, 12)).toBe(0);
    expect(nextTileIndex(0, "End", 2, 12)).toBe(11);
  });

  test("treats a one-column grid as a list", () => {
    expect(nextTileIndex(2, "ArrowDown", 1, 5)).toBe(3);
    expect(nextTileIndex(2, "ArrowUp", 1, 5)).toBe(1);
  });

  test("ignores keys it does not own", () => {
    expect(nextTileIndex(2, "Tab", 3, 9)).toBeNull();
    expect(nextTileIndex(2, "Enter", 3, 9)).toBeNull();
    expect(isGridNavKey("Tab")).toBe(false);
    expect(isGridNavKey("End")).toBe(true);
  });

  test("is safe with an empty grid or a stale index", () => {
    expect(nextTileIndex(0, "ArrowRight", 3, 0)).toBeNull();
    // Filter shrank the grid while the ring was on a later tile.
    expect(nextTileIndex(11, "ArrowRight", 3, 4)).toBe(3);
    expect(nextTileIndex(-2, "ArrowUp", 3, 4)).toBe(0);
  });

  test("never returns an index outside the grid", () => {
    for (let columns = 0; columns <= 5; columns += 1) {
      for (let from = 0; from < 9; from += 1) {
        for (const key of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]) {
          const next = nextTileIndex(from, key, columns, 9);
          expect(next).not.toBeNull();
          expect(next!).toBeGreaterThanOrEqual(0);
          expect(next!).toBeLessThan(9);
        }
      }
    }
  });
});

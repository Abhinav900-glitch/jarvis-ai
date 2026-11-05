// ---------------------------------------------------------------------------
// Motion vocabulary for the chat surface.
//
// One place for the springs and entrances so a reply does not slide in from a
// different direction than the message above it. Everything here degrades to a
// plain fade when the reader has asked for reduced motion — the point of the
// motion is legibility ("this is new, it came from me"), and a fade keeps that
// without the travel.
// ---------------------------------------------------------------------------

import { useMemo } from "react";
import { useReducedMotion, type Transition, type Variants } from "framer-motion";

/** Expo-out: quick launch, long settle. The house curve for entrances. */
export const EASE_OUT: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** For rows and chips that should arrive with a little weight. */
export const SPRING_SETTLE: Transition = {
  type: "spring",
  stiffness: 380,
  damping: 32,
  mass: 0.85,
};

/** For things that should feel like they were placed, not dropped (pills). */
export const SPRING_SOFT: Transition = {
  type: "spring",
  stiffness: 220,
  damping: 26,
};

/** Which edge a row arrives from. */
export type EntranceSide = "left" | "right" | "none";

function entrance(side: EntranceSide, reduced: boolean): Variants {
  if (reduced) {
    return {
      hidden: { opacity: 0 },
      visible: { opacity: 1, transition: { duration: 0.12 } },
    };
  }
  const x = side === "right" ? 14 : side === "left" ? -14 : 0;
  return {
    hidden: { opacity: 0, x, y: 12 },
    visible: { opacity: 1, x: 0, y: 0, transition: SPRING_SETTLE },
  };
}

/**
 * Message entrance variants: your prompts come in from the right, replies from
 * the left, status rows straight up. Direction is the detail that makes a
 * transcript read as a conversation instead of a stack of boxes.
 */
export function useChatRowVariants(): {
  assistant: Variants;
  user: Variants;
  notice: Variants;
} {
  const reduced = useReducedMotion() ?? false;
  return useMemo(
    () => ({
      assistant: entrance("left", reduced),
      user: entrance("right", reduced),
      notice: entrance("none", reduced),
    }),
    [reduced],
  );
}

/** A chip row's spring, with a capped stagger so long lists stay quick. */
export function chipTransition(index: number): Transition {
  return { ...SPRING_SOFT, delay: Math.min(index, 6) * 0.04 };
}

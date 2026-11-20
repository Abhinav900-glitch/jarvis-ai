// ---------------------------------------------------------------------------
// How many conversions are left on the plan.
//
// ConvertAPI counts conversions per billing period, and running out is a
// failure mode with no useful message from the conversion call itself — it
// answers 402 halfway through a click. Showing the figure next to the convert
// controls turns that into a number a person can plan around.
//
// The result is cached at module level: the cloud panel and the file viewer
// both ask, often within seconds of each other, and the plan does not change
// between those renders. A failed lookup is not cached, so reopening a panel
// retries instead of pinning an error forever.
// ---------------------------------------------------------------------------

import { useEffect, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";

export interface ConversionCredits {
  /** "246 of 250 conversions left", or null when there is no figure. */
  label: string | null;
  /** Why there is no figure, or a warning when the plan is spent. */
  hint: string | null;
}

const EMPTY: ConversionCredits = { label: null, hint: null };
let cached: ConversionCredits | null = null;

/**
 * `enabled` exists for the viewer, which is mounted with its dialog closed:
 * nothing should ask ConvertAPI for a plan figure until something is open that
 * can actually convert.
 */
export function useConversionCredits(enabled = true): ConversionCredits {
  const credits = useAction(api.convert.credits);
  const [snapshot, setSnapshot] = useState<ConversionCredits>(() => cached ?? EMPTY);
  const asked = useRef(false);

  useEffect(() => {
    if (!enabled || cached || asked.current) return;
    asked.current = true;
    let cancelled = false;

    void credits({})
      .then((result) => {
        // The live key is the number that matters; a sandbox-only answer is
        // still worth showing when the live key is missing or refused.
        const live =
          result.keys.find((key) => key.ok && typeof key.remaining === "number") ??
          result.keys.find((key) => key.ok) ??
          result.keys[0];

        const next: ConversionCredits = !live
          ? { label: null, hint: "conversion keys not configured" }
          : !live.ok
            ? { label: null, hint: live.message ?? "credits unavailable" }
            : typeof live.remaining === "number"
              ? {
                  label: `${live.remaining.toLocaleString()} of ${(live.total ?? 0).toLocaleString()} conversions left`,
                  hint:
                    live.remaining === 0
                      ? "out of conversions until the plan renews"
                      : live.active === false
                        ? "the account is not active"
                        : null,
                }
              : { label: null, hint: "no conversion limit reported" };

        if (next.label) cached = next;
        if (!cancelled) setSnapshot(next);
      })
      .catch(() => {
        if (!cancelled) setSnapshot({ label: null, hint: "credits unavailable" });
      });

    return () => {
      cancelled = true;
    };
  }, [credits, enabled]);

  return snapshot;
}

import { useId } from "react";

interface JarvisIconProps {
  className?: string;
  animate?: boolean;
}

/**
 * Jarvis mark — an instrument reticle, not a logo.
 *
 * Reads as a targeting sight: a thin outer ring with four tick marks at the
 * cardinals, a dashed inner ring, one bold arc sweeping clockwise to show the
 * scan is live, and a solid core at the centre. The ticks are what make it
 * read as technology rather than a generic circle.
 *
 * Two gradient ids are used, and they are suffixed per instance because several
 * copies of this icon render on the same page (landing header, hero badge,
 * footer). Without the suffix the browser resolves every `url(#jarvis-...)`
 * to the first matching id in the document, so the copies would all share one
 * gradient and the stops would fight each other. `useId` gives each instance a
 * stable, render-pure id that React guarantees to be unique.
 */
export function JarvisIcon({ className, animate = false }: JarvisIconProps) {
  const uid = useId().replace(/:/g, "");
  const ringGrad = `jarvis-ring-${uid}`;
  const arcGrad = `jarvis-arc-${uid}`;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={ringGrad} x1="2" y1="2" x2="22" y2="22">
          <stop offset="0%" stopColor="var(--signal-cyan)" />
          <stop offset="55%" stopColor="var(--signal-blue)" />
          <stop offset="100%" stopColor="var(--signal-violet)" />
        </linearGradient>
        <linearGradient id={arcGrad} x1="12" y1="3" x2="21" y2="21">
          <stop offset="0%" stopColor="var(--signal-cyan)" />
          <stop offset="100%" stopColor="var(--signal-blue)" />
        </linearGradient>
      </defs>

      {/* Outer ring — the lens. */}
      <circle cx="12" cy="12" r="9" strokeWidth={1} opacity={0.45} />

      {/* Dashed inner ring — the graticule. */}
      <circle
        cx="12"
        cy="12"
        r="6.4"
        strokeWidth={0.75}
        strokeDasharray="1.6 2.6"
        opacity={0.6}
      />

      {/* Cardinal ticks — the detail that makes it an instrument. */}
      <g strokeWidth={1.4} opacity={0.9}>
        <line x1="12" y1="0.9" x2="12" y2="3.6" />
        <line x1="12" y1="20.4" x2="12" y2="23.1" />
        <line x1="0.9" y1="12" x2="3.6" y2="12" />
        <line x1="20.4" y1="12" x2="23.1" y2="12" />
      </g>

      {/* The live scan arc. The only part that moves. */}
      <path
        d="M12 3a9 9 0 0 1 7.8 4.5"
        stroke={`url(#${arcGrad})`}
        strokeWidth={2.4}
        style={
          animate
            ? {
                transformOrigin: "12px 12px",
                animation: "jarvis-spin 3.4s linear infinite",
              }
            : undefined
        }
      />

      {/* Core. */}
      <circle cx="12" cy="12" r="2.4" fill={`url(#${ringGrad})`} stroke="none" />
    </svg>
  );
}
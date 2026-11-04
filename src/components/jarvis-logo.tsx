import { useId } from "react";

interface JarvisMarkProps {
  className?: string;
  /** Turn on the orbit/twinkle/breathe loops. Off by default so static chrome stays calm. */
  animate?: boolean;
  /** Soft colour bloom behind the glyph. */
  glow?: boolean;
  /** Draw the ribbon, then sweep the ring in — for the boot screen. */
  drawIn?: boolean;
}

/**
 * The Jarvis mark: a gradient ribbon "J" — leaning, with a deep hook — wrapped
 * by a tilted orbit ring with a four-point spark at its apex.
 *
 * The letterform is the point: the mark is the first letter of the name, so it
 * reads as a monogram before it reads as a shape, and the italic lean plus the
 * ring make it look like it is moving rather than sitting flat.
 *
 * Drawn as SVG rather than shipped as a PNG so one source renders correctly at
 * 16px in a tab and 140px on the boot screen, and so the parts can move
 * independently. Gradients are per-instance (`useId`) because this mark appears
 * several times on a page; a shared id would make every copy resolve to the
 * first one's gradient.
 *
 * Animation is CSS-only and driven by the `jarvis-mark-*` classes in index.css,
 * which respect `prefers-reduced-motion`.
 */
export function JarvisMark({
  className,
  animate = false,
  glow = true,
  drawIn = false,
}: JarvisMarkProps) {
  const uid = useId().replace(/:/g, "");
  const ribbonId = `jarvis-ribbon-${uid}`;
  const ringId = `jarvis-ring-${uid}`;
  const bloomId = `jarvis-bloom-${uid}`;

  // Classes rather than inline styles so the reduced-motion media query can
  // switch all three loops off in one place. The idle loops are suppressed
  // while the mark is drawing itself in: both animations would write the same
  // transform on the spark, and the boot screen is over before an idle loop
  // would be visible anyway.
  const idle = animate && !drawIn;
  const orbit = idle ? "jarvis-mark-orbit" : undefined;
  const spark = idle ? "jarvis-mark-spark" : undefined;
  const ribbon = idle ? "jarvis-mark-ribbon" : undefined;

  return (
    <svg
      viewBox="0 0 200 200"
      fill="none"
      className={className}
      role="img"
      aria-label="Jarvis"
    >
      <defs>
        {/* Cyan at the top-right, through blue and violet, into the pink and
            amber the mark ends on at the lower left. */}
        <linearGradient
          id={ribbonId}
          x1="150"
          y1="30"
          x2="50"
          y2="160"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#63E6FF" />
          <stop offset="27%" stopColor="#3A8CFF" />
          <stop offset="50%" stopColor="#7A5CFF" />
          <stop offset="72%" stopColor="#C94BF0" />
          <stop offset="89%" stopColor="#FF5F9E" />
          <stop offset="100%" stopColor="#FFA45E" />
        </linearGradient>
        <linearGradient
          id={ringId}
          x1="26"
          y1="78"
          x2="174"
          y2="122"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="45%" stopColor="#3A8CFF" />
          <stop offset="100%" stopColor="#63E6FF" />
        </linearGradient>
        <radialGradient id={bloomId} cx="50%" cy="45%" r="50%">
          <stop offset="0%" stopColor="#4A7BFF" stopOpacity="0.45" />
          <stop offset="60%" stopColor="#7A5CFF" stopOpacity="0.16" />
          <stop offset="100%" stopColor="#7A5CFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {glow ? <circle cx="100" cy="92" r="92" fill={`url(#${bloomId})`} /> : null}

      {/* Orbit ring. The far half sits behind the ribbon, the near half in
          front of it, which is what makes the mark read as a 3D loop. */}
      <g className={orbit}>
        <ellipse
          cx="100"
          cy="100"
          rx="74"
          ry="23"
          transform="rotate(-26 100 100)"
          stroke={`url(#${ringId})`}
          strokeWidth="1.8"
          opacity="0.45"
          pathLength={drawIn ? 100 : undefined}
          className={drawIn ? "jarvis-draw-ring" : undefined}
        />
      </g>

      {/* The ribbon J. Stroked rather than filled: one path carries the whole
          gradient along the glyph's spine — cyan down the stem, pink and amber
          through the hook. */}
      <path
        d="M146 34L132 112C128 148 102 166 78 154C64 147 56 132 54 116"
        stroke={`url(#${ribbonId})`}
        strokeWidth="26"
        strokeLinecap="butt"
        strokeLinejoin="round"
        pathLength={drawIn ? 100 : undefined}
        className={[ribbon, drawIn ? "jarvis-draw-glyph" : ""]
          .filter(Boolean)
          .join(" ")}
      />

      <g className={orbit}>
        {/* Near half of the ring, drawn over the ribbon. */}
        <path
          d="M26 100a74 23 0 00148 0"
          transform="rotate(-26 100 100)"
          stroke={`url(#${ringId})`}
          strokeWidth="2.4"
          strokeLinecap="round"
          pathLength={drawIn ? 100 : undefined}
          className={drawIn ? "jarvis-draw-ring-front" : undefined}
        />
      </g>

      {/* Four-point spark, clear of the stem's top end. */}
      <path
        d="M176 22c1.6 8.1 3.6 11.3 12 13.4-8.4 2.1-10.4 5.3-12 13.4-1.6-8.1-3.6-11.3-12-13.4 8.4-2.1 10.4-5.3 12-13.4Z"
        fill="#F8FBFF"
        className={[spark, drawIn ? "jarvis-draw-spark" : ""]
          .filter(Boolean)
          .join(" ")}
      />
      <circle cx="186" cy="92" r="1.6" fill="#BFE9FF" opacity="0.85" />
    </svg>
  );
}

interface JarvisLogoProps {
  className?: string;
  markClassName?: string;
  animate?: boolean;
  /** Hide the wordmark and render the mark alone. */
  markOnly?: boolean;
  /** Wordmark size. The mark is sized to sit beside it. */
  size?: "sm" | "md" | "lg";
}

const WORDMARK_SIZE = {
  sm: "text-sm",
  md: "text-base",
  lg: "text-xl",
} as const;

const MARK_SIZE = {
  sm: "size-6",
  md: "size-7",
  lg: "size-9",
} as const;

/**
 * Mark plus wordmark. "JARVIS" stays in the current text colour so it inherits
 * whatever the surface is using; "AI" keeps the brand gradient.
 */
export function JarvisLogo({
  className,
  markClassName,
  animate = false,
  markOnly = false,
  size = "sm",
}: JarvisLogoProps) {
  return (
    <span className={`inline-flex items-center gap-2 ${className ?? ""}`}>
      <JarvisMark
        animate={animate}
        className={`${MARK_SIZE[size]} shrink-0 ${markClassName ?? ""}`}
      />
      {markOnly ? null : (
        <span
          className={`${WORDMARK_SIZE[size]} font-semibold tracking-[0.18em] whitespace-nowrap`}
        >
          JARVIS
          <span className="ml-1 bg-gradient-to-r from-cyan-400 via-blue-500 to-fuchsia-500 bg-clip-text text-transparent">
            AI
          </span>
        </span>
      )}
    </span>
  );
}

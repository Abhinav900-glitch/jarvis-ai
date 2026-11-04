import { useId } from "react";

interface JarvisMarkProps {
  className?: string;
  /** Turn on the orbit/twinkle/breathe loops. Off by default so static chrome stays calm. */
  animate?: boolean;
  /** Soft colour bloom behind the glyph. */
  glow?: boolean;
}

/**
 * The Jarvis mark: a gradient ribbon "S" wrapped by a tilted orbit ring with a
 * four-point spark at its apex.
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
}: JarvisMarkProps) {
  const uid = useId().replace(/:/g, "");
  const ribbonId = `jarvis-ribbon-${uid}`;
  const ringId = `jarvis-ring-${uid}`;
  const bloomId = `jarvis-bloom-${uid}`;

  // Classes rather than inline styles so the reduced-motion media query can
  // switch all three loops off in one place.
  const orbit = animate ? "jarvis-mark-orbit" : undefined;
  const spark = animate ? "jarvis-mark-spark" : undefined;
  const ribbon = animate ? "jarvis-mark-ribbon" : undefined;

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
          x1="140"
          y1="34"
          x2="52"
          y2="164"
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
        />
      </g>

      {/* The ribbon S. Stroked rather than filled: one path carries the whole
          gradient along the glyph's spine. */}
      <path
        d="M132 46C106 32 70 42 70 72c0 30 62 26 62 58s-34 42-72 27"
        stroke={`url(#${ribbonId})`}
        strokeWidth="26"
        strokeLinecap="butt"
        strokeLinejoin="round"
        className={ribbon}
      />

      <g className={orbit}>
        {/* Near half of the ring, drawn over the ribbon. */}
        <path
          d="M26 100a74 23 0 00148 0"
          transform="rotate(-26 100 100)"
          stroke={`url(#${ringId})`}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </g>

      {/* Four-point spark, clear of the ribbon's top end. */}
      <path
        d="M170 29c1.7 8.8 3.9 12.2 13 14.5-9.1 2.3-11.3 5.7-13 14.5-1.7-8.8-3.9-12.2-13-14.5 9.1-2.3 11.3-5.7 13-14.5Z"
        fill="#F8FBFF"
        className={spark}
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

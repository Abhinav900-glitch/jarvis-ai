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
        {/* Cyan at the top, through blue and violet, into the pink and amber
            the hook ends on at the lower left. */}
        <linearGradient
          id={ribbonId}
          x1="150"
          y1="36"
          x2="52"
          y2="158"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#7DF3FF" />
          <stop offset="26%" stopColor="#3B9BFF" />
          <stop offset="52%" stopColor="#8B5CF6" />
          <stop offset="76%" stopColor="#E879F9" />
          <stop offset="100%" stopColor="#FFB86B" />
        </linearGradient>
        <linearGradient
          id={ringId}
          x1="30"
          y1="70"
          x2="170"
          y2="130"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#8B5CF6" />
          <stop offset="45%" stopColor="#3B9BFF" />
          <stop offset="100%" stopColor="#7DF3FF" />
        </linearGradient>
        {/* Rim light down the stem, fading out before the hook. */}
        <linearGradient
          id={`${ribbonId}-gloss`}
          x1="0"
          y1="42"
          x2="0"
          y2="120"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={bloomId} cx="50%" cy="44%" r="52%">
          <stop offset="0%" stopColor="#3B82F6" stopOpacity="0.42" />
          <stop offset="58%" stopColor="#7C3AED" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#7C3AED" stopOpacity="0" />
        </radialGradient>
      </defs>

      {glow ? <circle cx="100" cy="92" r="94" fill={`url(#${bloomId})`} /> : null}

      {/* Soft halo on the aperture, so the ring reads as light rather than a
          hairline at 24px. The bright stroke is drawn on top of it. */}
      <path
        d="M171.3 131.7A78 78 0 1 1 148 38.5"
        stroke={`url(#${ringId})`}
        strokeWidth="14"
        strokeLinecap="round"
        opacity="0.16"
      />

      {/* Tilted orbit behind the monogram: depth without closing the shape. */}
      <g className={orbit}>
        <ellipse
          cx="100"
          cy="100"
          rx="86"
          ry="24"
          transform="rotate(-24 100 100)"
          stroke={`url(#${ringId})`}
          strokeWidth="1.4"
          opacity="0.38"
          pathLength={drawIn ? 100 : undefined}
          className={drawIn ? "jarvis-draw-ring" : undefined}
        />
      </g>

      {/* Open aperture: one wide arc with a deliberate gap at the upper right,
          where the spark sits. Thicker than a hairline so the silhouette
          survives a 16px favicon as well as the boot screen. The frame stays
          still while the tilted orbit turns behind it — a rotating frame with
          a gap would read as a glitch. */}
      <path
        d="M171.3 131.7A78 78 0 1 1 148 38.5"
        stroke={`url(#${ringId})`}
        strokeWidth="5.5"
        strokeLinecap="round"
        opacity="0.95"
        pathLength={drawIn ? 100 : undefined}
        className={drawIn ? "jarvis-draw-ring-front" : undefined}
      />

      {/* Inner tick ring: dashed, so it reads as instrumentation rather than
          another border. */}
      <circle
        cx="100"
        cy="100"
        r="63"
        stroke="#8BE0FF"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeDasharray="1.2 9"
        opacity="0.25"
      />

      {/* The monogram J: one confident stroke, cyan at the top through violet
          into the amber hook. Stroked so a single path carries the gradient
          along the glyph's spine. A wider, faint copy underneath gives the
          letter its inner light without an SVG filter. */}
      <path
        d="M139 42V98C139 135 116 158 88 151C68 146 56 131 53 113"
        stroke={`url(#${ribbonId})`}
        strokeWidth="44"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.12"
      />
      <path
        d="M139 42V98C139 135 116 158 88 151C68 146 56 131 53 113"
        stroke={`url(#${ribbonId})`}
        strokeWidth="30"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={drawIn ? 100 : undefined}
        className={[ribbon, drawIn ? "jarvis-draw-glyph" : ""]
          .filter(Boolean)
          .join(" ")}
      />

      {/* Glass highlight down the stem's left edge. */}
      <path
        d="M130 52V94"
        stroke={`url(#${ribbonId}-gloss)`}
        strokeWidth="6"
        strokeLinecap="round"
        opacity="0.8"
      />

      {/* Terminal node at the hook: the mark's "live" point. */}
      <circle cx="53" cy="113" r="5.4" fill="#9BF6FF" />
      <circle
        cx="53"
        cy="113"
        r="11"
        stroke="#7DF3FF"
        strokeWidth="1.4"
        opacity="0.4"
      />

      {/* Four-point spark in the aperture gap. */}
      <path
        d="M174 14C176.2 25.4 180.6 29.8 192 32C180.6 34.2 176.2 38.6 174 50C171.8 38.6 167.4 34.2 156 32C167.4 29.8 171.8 25.4 174 14Z"
        fill="#F8FBFF"
        className={[spark, drawIn ? "jarvis-draw-spark" : ""]
          .filter(Boolean)
          .join(" ")}
      />

      {/* Two quiet satellites so the field feels inhabited at large sizes. */}
      <circle cx="186" cy="86" r="1.8" fill="#BFE9FF" opacity="0.8" />
      <circle cx="34" cy="66" r="1.4" fill="#9BF6FF" opacity="0.5" />
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

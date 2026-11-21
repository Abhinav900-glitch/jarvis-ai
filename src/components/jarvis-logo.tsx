import { useId } from "react";

interface JarvisMarkProps {
  className?: string;
  /** Turn on the orbit/breathe loops. Off by default so static chrome stays calm. */
  animate?: boolean;
  /** Soft colour bloom behind the glyph. */
  glow?: boolean;
  /** Draw the ribbon, then sweep the rings in — for the boot screen. */
  drawIn?: boolean;
}

/**
 * The Jarvis mark: a geometric ribbon "J" lit in electric cyan, centred on a
 * dark hexagonal core and framed by segmented HUD rings.
 *
 * The letterform is the point — it reads as a monogram first — but the icon is
 * built symmetrically around it: six-sided core, four-segment outer ring, four
 * cardinal nodes, and a pair of voice-wave arcs flanking the stem. The cyan is
 * the only saturated colour, against a matte obsidian tile, which is what keeps
 * it legible at 16px and composed at 140px.
 *
 * Drawn as SVG rather than shipped as a PNG so one source renders correctly in
 * a tab, a home screen and the boot screen, and so the parts can move
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
  const coreId = `jarvis-core-${uid}`;

  // Classes rather than inline styles so the reduced-motion media query can
  // switch the loops off in one place. The idle loops are suppressed while the
  // mark is drawing itself in: both animations would write the same transform.
  const idle = animate && !drawIn;
  const orbit = idle ? "jarvis-mark-orbit" : undefined;
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
        {/* Electric cyan, white-hot at the top of the stem and deepening as
            the hook finishes. One gradient carries the whole letterform. */}
        <linearGradient
          id={ribbonId}
          x1="124"
          y1="52"
          x2="70"
          y2="146"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#EAFFFF" />
          <stop offset="30%" stopColor="#7DF3FF" />
          <stop offset="65%" stopColor="#22C8FF" />
          <stop offset="100%" stopColor="#1B8DFF" />
        </linearGradient>
        <linearGradient
          id={ringId}
          x1="100"
          y1="8"
          x2="100"
          y2="192"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#7DF3FF" />
          <stop offset="50%" stopColor="#1B8DFF" />
          <stop offset="100%" stopColor="#7DF3FF" />
        </linearGradient>
        {/* The hex core is a surface, not a shape: just enough light to read
            as glass over the obsidian behind it. */}
        <radialGradient id={coreId} cx="50%" cy="46%" r="56%">
          <stop offset="0%" stopColor="#35D7FF" stopOpacity="0.16" />
          <stop offset="62%" stopColor="#22C8FF" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#22C8FF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={bloomId} cx="50%" cy="46%" r="54%">
          <stop offset="0%" stopColor="#22C8FF" stopOpacity="0.3" />
          <stop offset="55%" stopColor="#1B8DFF" stopOpacity="0.1" />
          <stop offset="100%" stopColor="#1B8DFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      {glow ? <circle cx="100" cy="98" r="96" fill={`url(#${bloomId})`} /> : null}

      {/* Outer HUD ring: four equal segments with deliberate gaps. */}
      <g className={orbit}>
        <circle
          cx="100"
          cy="100"
          r="86"
          stroke={`url(#${ringId})`}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="96 39"
          opacity="0.85"
          pathLength={drawIn ? 100 : undefined}
          className={drawIn ? "jarvis-draw-ring" : undefined}
        />
      </g>

      {/* Inner tick ring: instrumentation, not another border. */}
      <circle
        cx="100"
        cy="100"
        r="74"
        stroke="#7DF3FF"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeDasharray="3 10"
        opacity="0.22"
      />

      {/* Four cardinal nodes give the frame its symmetry. */}
      {[
        [100, 14],
        [186, 100],
        [100, 186],
        [14, 100],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" fill="#9BF6FF" opacity="0.85" />
      ))}

      {/* Dark hexagonal core. Pointy-top, so the top vertex sits under the
          stem and the bottom vertex under the hook. */}
      <polygon
        points="100,40 152,70 152,130 100,160 48,130 48,70"
        fill={`url(#${coreId})`}
        stroke="#7DF3FF"
        strokeWidth="1.4"
        opacity="0.9"
      />
      <polygon
        points="100,54 139.8,77 139.8,123 100,146 60.2,123 60.2,77"
        stroke="#7DF3FF"
        strokeWidth="0.8"
        opacity="0.16"
      />

      {/* Voice waves flanking the monogram: two quiet arcs each side, the
          same vocabulary as the live-voice HUD. */}
      <path
        d="M58 88C64 78 72 73 82 74"
        stroke="#7DF3FF"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M49 97C57 80 70 72 86 74"
        stroke="#7DF3FF"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.26"
      />
      <path
        d="M142 88C136 78 128 73 118 74"
        stroke="#7DF3FF"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M151 97C143 80 130 72 114 74"
        stroke="#7DF3FF"
        strokeWidth="1.4"
        strokeLinecap="round"
        opacity="0.26"
      />

      {/* An echo of the ribbon, offset behind it: the letter reads as fluid
          light rather than a flat stroke. */}
      <path
        d="M128 52V96C128 123 113 140 94 137C81 135 73 126 70 114"
        transform="translate(3.5 4.5)"
        stroke="#1B8DFF"
        strokeWidth="8"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity="0.22"
      />

      {/* The J: a single geometric ribbon with a soft hook, lit from the top. */}
      <path
        d="M128 52V96C128 123 113 140 94 137C81 135 73 126 70 114"
        stroke={`url(#${ribbonId})`}
        strokeWidth="18"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength={drawIn ? 100 : undefined}
        className={[ribbon, drawIn ? "jarvis-draw-glyph" : ""]
          .filter(Boolean)
          .join(" ")}
      />

      {/* Glass highlight down the stem. */}
      <path
        d="M122 62V92"
        stroke="#EAFFFF"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.45"
      />

      {/* Terminal node at the hook, the mark's "live" point. */}
      <circle cx="70" cy="114" r="3.6" fill="#EAFFFF" />
      <circle
        cx="70"
        cy="114"
        r="7.5"
        stroke="#7DF3FF"
        strokeWidth="1.2"
        opacity="0.5"
      />
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
          <span className="ml-1 bg-gradient-to-r from-cyan-400 via-sky-400 to-blue-500 bg-clip-text text-transparent">
            AI
          </span>
        </span>
      )}
    </span>
  );
}

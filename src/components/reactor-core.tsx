import { useId } from "react";

interface ReactorCoreProps {
  className?: string;
  /**
   * How far the outer arc has travelled, 0–1. Omit to leave the arc out
   * entirely — a ring frozen at 60% reads as broken, so the decorative use on
   * the landing page draws no arc at all.
   */
  progress?: number;
  /** Turn the rings. Off leaves a still frame for reduced-motion. */
  spin?: boolean;
}

const RADIUS = 148;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * The JARVIS core: concentric instrument rings around a lit centre.
 *
 * This is the shape the boot screen is built on — tick ring, broken orbit,
 * progress arc — and it doubles as ambient scenery, which is why it is its own
 * component instead of JSX inside the splash. Everything is SVG with CSS
 * transforms so the rings spin without React re-rendering, and the gradients
 * are per-instance because the core appears twice on one page.
 */
export function ReactorCore({
  className,
  progress,
  spin = true,
}: ReactorCoreProps) {
  const uid = useId().replace(/:/g, "");
  const arcId = `reactor-arc-${uid}`;
  const faceId = `reactor-face-${uid}`;
  const ringId = `reactor-ring-${uid}`;

  const clamped =
    progress === undefined ? null : Math.min(1, Math.max(0, progress));
  const turn = spin ? "reactor-spin" : undefined;

  return (
    <svg
      viewBox="0 0 400 400"
      fill="none"
      aria-hidden
      className={className}
    >
      <defs>
        <linearGradient
          id={arcId}
          x1="60"
          y1="60"
          x2="340"
          y2="340"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#63E6FF" />
          <stop offset="45%" stopColor="#3A8CFF" />
          <stop offset="100%" stopColor="#C94BF0" />
        </linearGradient>
        <linearGradient
          id={ringId}
          x1="200"
          y1="48"
          x2="200"
          y2="352"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.55" />
          <stop offset="50%" stopColor="#3A8CFF" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#63E6FF" stopOpacity="0.5" />
        </linearGradient>
        <radialGradient id={faceId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#4A7BFF" stopOpacity="0.35" />
          <stop offset="55%" stopColor="#7A5CFF" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#7A5CFF" stopOpacity="0" />
        </radialGradient>
      </defs>

      <circle cx="200" cy="200" r="186" fill={`url(#${faceId})`} />

      {/* Finest ring: a ruler of 1px ticks, so the core reads as an
          instrument rather than a target. */}
      <g className={turn} style={{ animationDuration: "90s" }}>
        <circle
          cx="200"
          cy="200"
          r="186"
          stroke="#8FD8FF"
          strokeOpacity="0.28"
          strokeWidth="1"
          strokeDasharray="1 7"
        />
      </g>

      {/* Broken orbit, counter-turning against the ticks. */}
      <g
        className={turn}
        style={{
          animationDuration: "46s",
          animationDirection: "reverse",
        }}
      >
        <circle
          cx="200"
          cy="200"
          r="170"
          stroke={`url(#${ringId})`}
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeDasharray="110 34 6 34"
          strokeOpacity="0.75"
        />
      </g>

      {/* Steady inner rails, no motion: the frame the arc rides on. */}
      <circle cx="200" cy="200" r={RADIUS} stroke="#BFE9FF" strokeOpacity="0.14" strokeWidth="1" />
      <circle
        cx="200"
        cy="200"
        r="118"
        stroke="#BFE9FF"
        strokeOpacity="0.10"
        strokeWidth="1"
        strokeDasharray="2 6"
      />

      {/* Four bearing marks, at the diagonals so they never collide with the
          progress arc's 12 o'clock start. */}
      {[45, 135, 225, 315].map((angle) => (
        <line
          key={angle}
          x1="200"
          y1="52"
          x2="200"
          y2="63"
          stroke="#9BE0FF"
          strokeOpacity="0.5"
          strokeWidth="1.6"
          strokeLinecap="round"
          transform={`rotate(${angle} 200 200)`}
        />
      ))}

      {clamped === null ? null : (
        <circle
          cx="200"
          cy="200"
          r={RADIUS}
          stroke={`url(#${arcId})`}
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - clamped)}
          transform="rotate(-90 200 200)"
        />
      )}

      {/* Centre bloom: what the light comes from. */}
      <circle
        cx="200"
        cy="200"
        r="46"
        fill={`url(#${faceId})`}
        className={spin ? "reactor-pulse" : undefined}
      />
    </svg>
  );
}

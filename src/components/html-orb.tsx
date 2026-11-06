/**
 * The orb, rendered as plain HTML and CSS.
 *
 * `orb-scene.ts` is the rich renderer — layered wireframes, a geodesic core,
 * text sprites, bloom. It also needs a WebGL context, a shader compile and a
 * second of setup before it shows anything, and on a device where that fails
 * (GPU blocklisted, WebGL disabled, a preview frame that refuses GL) it shows
 * nothing at all.
 *
 * This file is that missing floor: markup and gradients only, no dependencies,
 * no context to lose. It is the same CSS sphere the live HUD renders, lifted
 * into a component so the HUD, the panel and any other surface can mount an orb
 * that cannot fail. It still breathes with the conversation — the halo follows
 * the mic level and the cage speeds up while Jarvis speaks — because an orb
 * that looks identical whatever is happening is a screensaver.
 */

import { cn } from "@/lib/utils";

export interface HtmlOrbProps {
  /** Jarvis is speaking: the wireframe cage spins at full speed. */
  fast?: boolean;
  /** Manual spin boost, so the button can show its own pressed state. */
  boosting?: boolean;
  /** 0..1 mic or speech level — brightens the halo. */
  level?: number;
  /** Fired by tapping the orb. Omit for a non-interactive orb. */
  onToggleBoost?: () => void;
  className?: string;
}

export function HtmlOrb({
  fast = false,
  boosting = false,
  level = 0,
  onToggleBoost,
  className,
}: HtmlOrbProps) {
  const clamped = Math.min(1, Math.max(0, level));
  return (
    <>
      <button
        type="button"
        onClick={onToggleBoost}
        aria-pressed={onToggleBoost ? boosting : undefined}
        aria-label={
          onToggleBoost
            ? boosting
              ? "Return the sphere to its normal speed"
              : "Spin the sphere faster"
            : "Jarvis"
        }
        className={cn("sphere-button", fast && "fast", className)}
      >
        {/* The lit body. It only breathes — all rotation is in the cage,
            because in-plane rotation is what makes a sphere read flat. */}
        <span className="sphere" />
        {/* 3D wireframe cage: latitude great circles (sized to R·sinθ so they
            sit on the ball), meridian great circles, and two orbits whose
            paired dots swap in/out of view via backface-visibility. This is
            what makes the sphere read as a rotating sphere rather than a
            spinning flat disc. */}
        <span className="sphere-axis" aria-hidden="true">
          <i className="sphere-lat" style={{ transform: "rotateX(72deg)" }} />
          <i className="sphere-lat-36" style={{ transform: "rotateX(36deg)" }} />
          <i className="sphere-lat-12" style={{ transform: "rotateX(12deg)" }} />
          <i className="sphere-lat-12" style={{ transform: "rotateX(-12deg)" }} />
          <i className="sphere-lat-36" style={{ transform: "rotateX(-36deg)" }} />
          <i className="sphere-lat" style={{ transform: "rotateX(-72deg)" }} />
          <i className="sphere-mer" style={{ transform: "rotateY(0deg)" }} />
          <i className="sphere-mer" style={{ transform: "rotateY(45deg)" }} />
          <i className="sphere-mer" style={{ transform: "rotateY(90deg)" }} />
          <i className="sphere-mer" style={{ transform: "rotateY(135deg)" }} />
          <span className="sphere-orbit sphere-orbit-a">
            <i />
            <i />
          </span>
          <span className="sphere-orbit sphere-orbit-b">
            <i />
            <i />
          </span>
        </span>
      </button>
      <span
        className="sphere-glow"
        style={{ opacity: 0.6 + clamped * 0.4 }}
        aria-hidden="true"
      />
    </>
  );
}

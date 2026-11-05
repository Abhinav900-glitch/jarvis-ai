// ---------------------------------------------------------------------------
// CoreOrb — the living core drawn behind the mark.
//
// Canvas 2D, no libraries: a nucleus with orbiting particles that link to their
// neighbours, two ticked rings turning at different rates, and a slow breath
// that speeds up while the model is working. The whole thing is a few KB of
// code and one animation frame per tick, which is the point — the "wow" should
// not cost a megabyte of WebGL, a download, or a dropped frame on a laptop.
//
// It renders as a still frame under prefers-reduced-motion, pauses when the tab
// is hidden, and never throws if the colour variable is missing.
// ---------------------------------------------------------------------------

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export interface CoreOrbProps {
  /** Diameter in CSS pixels. Particles and rings scale with it. */
  size?: number;
  /** 0 = idle, 1 = the model is working. Speeds up the orbit and the breath. */
  intensity?: number;
  className?: string;
}

interface Particle {
  angle: number;
  radius: number;
  speed: number;
  size: number;
  phase: number;
}

const FALLBACK_COLOR = "#5ad1e4";

export function CoreOrb({ size = 176, intensity = 0, className }: CoreOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // A decoration must never be able to take the page down: no 2D context, a
    // locked-down canvas or an exotic WebView should cost the orb, not the app.
    const ctx = (() => {
      try {
        return canvas.getContext("2d");
      } catch {
        return null;
      }
    })();
    if (!ctx) return;

    // Takes its colour from the theme, and follows a theme switch: light and
    // dark define different signals, so a stale cyan would look painted on.
    const readColor = () =>
      getComputedStyle(document.documentElement)
        .getPropertyValue("--signal-cyan")
        .trim() || FALLBACK_COLOR;
    let color = readColor();

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    ctx.scale(dpr, dpr);

    const center = size / 2;
    const outer = size * 0.5;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
    const push = 0.55 + intensity * 1.5;

    const count = Math.round(Math.min(110, Math.max(28, size * 0.62)));
    const particles: Particle[] = Array.from({ length: count }, (_, i) => {
      const spread = 0.55 + ((i * 37) % 100) / 180;
      return {
        angle: (i / count) * Math.PI * 2,
        radius: outer * spread * 0.82,
        speed: (0.16 + ((i * 13) % 9) / 90) * push,
        size: 0.9 + ((i * 7) % 5) / 4,
        phase: ((i * 29) % 100) / 12,
      };
    });

    const draw = (time: number) => {
      ctx.clearRect(0, 0, size, size);

      // --- Halo: the light the core throws on the panel behind it.
      const halo = ctx.createRadialGradient(
        center,
        center,
        outer * 0.05,
        center,
        center,
        outer,
      );
      halo.addColorStop(0, color);
      halo.addColorStop(0.45, color);
      halo.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.16 + 0.06 * Math.sin(time * 1.1);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(center, center, outer, 0, Math.PI * 2);
      ctx.fill();

      // --- Rings: one coarse with ticks, one fine and dashed, one scan arc.
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;

      ctx.save();
      ctx.translate(center, center);
      ctx.rotate(time * 0.18 * push);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(0, 0, outer * 0.93, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 0.55;
      for (let i = 0; i < 48; i += 1) {
        const a = (i / 48) * Math.PI * 2;
        const long = i % 4 === 0;
        const r0 = outer * (long ? 0.86 : 0.885);
        ctx.globalAlpha = long ? 0.6 : 0.25;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a) * outer * 0.93, Math.sin(a) * outer * 0.93);
        ctx.stroke();
      }
      ctx.restore();

      ctx.save();
      ctx.translate(center, center);
      ctx.rotate(-time * 0.11 * push);
      ctx.setLineDash([outer * 0.04, outer * 0.09]);
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(0, 0, outer * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.save();
      ctx.translate(center, center);
      ctx.rotate(-time * 0.55 * push);
      const scan = ctx.createLinearGradient(0, 0, outer, 0);
      scan.addColorStop(0, "transparent");
      scan.addColorStop(1, color);
      ctx.strokeStyle = scan;
      ctx.globalAlpha = 0.75;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(0, 0, outer * 0.82, -0.5, 0.5);
      ctx.stroke();
      ctx.restore();

      // --- Particles on elliptical orbits, with the neighbours linked.
      const points = particles.map((p) => {
        const wobble = 1 + 0.07 * Math.sin(time * 1.7 + p.phase);
        const a = p.angle + time * p.speed;
        return {
          x: center + Math.cos(a) * p.radius * wobble,
          y: center + Math.sin(a) * p.radius * 0.62 * wobble,
          r: p.size,
        };
      });

      const linkDistance = outer * 0.3;
      ctx.lineWidth = 0.7;
      ctx.strokeStyle = color;
      for (let i = 0; i < points.length; i += 1) {
        for (let j = i + 1; j < points.length; j += 1) {
          const dx = points[i].x - points[j].x;
          const dy = points[i].y - points[j].y;
          const d = Math.hypot(dx, dy);
          if (d > linkDistance) continue;
          ctx.globalAlpha = (1 - d / linkDistance) * 0.22;
          ctx.beginPath();
          ctx.moveTo(points[i].x, points[i].y);
          ctx.lineTo(points[j].x, points[j].y);
          ctx.stroke();
        }
      }

      ctx.fillStyle = color;
      for (const point of points) {
        ctx.globalAlpha = 0.8;
        ctx.beginPath();
        ctx.arc(point.x, point.y, point.r, 0, Math.PI * 2);
        ctx.fill();
      }

      // --- Nucleus: a small over-bright core, breathing.
      const breath = 1 + 0.08 * Math.sin(time * 1.6 * push);
      const coreR = outer * 0.17 * breath;
      const core = ctx.createRadialGradient(
        center,
        center,
        0,
        center,
        center,
        coreR,
      );
      core.addColorStop(0, "#ffffff");
      core.addColorStop(0.35, color);
      core.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(center, center, coreR, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 1;
    };

    // Reduced motion gets one honest frame rather than a frozen sparkle.
    if (reduced) {
      draw(2.2);
      return;
    }

    let raf = 0;
    let start = 0;
    const loop = (now: number) => {
      if (!start) start = now;
      draw((now - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    // A hidden tab is not worth a frame budget.
    const onVisibility = () => {
      cancelAnimationFrame(raf);
      if (!document.hidden) raf = requestAnimationFrame(loop);
    };
    document.addEventListener("visibilitychange", onVisibility);

    const themeWatcher = new MutationObserver(() => {
      color = readColor();
      if (reduced) draw(2.2);
    });
    themeWatcher.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
      themeWatcher.disconnect();
    };
  }, [size, intensity]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={cn("pointer-events-none block", className)}
      style={{ width: size, height: size }}
    />
  );
}

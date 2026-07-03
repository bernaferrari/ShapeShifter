"use client";

import React from "react";
import { cn } from "@/lib/utils";

type Pts = [number, number, number, number];

interface EasingCurveProps {
  /** Cubic-bezier control points [x1, y1, x2, y2] in 0..1 (y may overshoot). */
  points: Pts;
  /** Optional 0..1 progress; draws a dot travelling along the eased curve. */
  progress?: number;
  /** When set, the two control handles become draggable and fire onChange. */
  onChange?: (points: Pts) => void;
  className?: string;
  size?: number;
}

/**
 * Compact, Figma/Framer-style easing editor. Plots the cubic-bezier timing curve
 * from (0,0) → (1,1) with its two control handles, so the chosen interpolator
 * reads as a *shape*, not just a name. When `onChange` is provided the handles
 * are draggable and emit a new custom curve.
 */
export function EasingCurve({ points, progress, onChange, className, size = 96 }: EasingCurveProps) {
  const [x1, y1, x2, y2] = points;
  const pad = 8;
  const span = size - pad * 2;
  const svgRef = React.useRef<SVGSVGElement>(null);
  const dragging = React.useRef<1 | 2 | null>(null);
  const editable = Boolean(onChange);

  // SVG y grows downward, so flip the curve vertically (1 - y).
  const px = (x: number) => pad + x * span;
  const py = (y: number) => pad + (1 - y) * span;

  const d = `M ${px(0)} ${py(0)} C ${px(x1)} ${py(y1)}, ${px(x2)} ${py(y2)}, ${px(1)} ${py(1)}`;

  // Sample the eased point for the moving dot. This is a *timing* curve, so
  // the horizontal axis is time (progress) and the dot must plot the EASED
  // value at that time. Solve bx(t*) = progress for the parametric t* via
  // binary search (like exporter ease()), then read by(t*). For LINEAR
  // points bx≡by so the dot lands exactly on the diagonal. Cosmetic only —
  // actual easing applied elsewhere is unaffected.
  let dot: { x: number; y: number } | null = null;
  if (progress != null) {
    const p = Math.max(0, Math.min(1, progress));
    let lo = 0;
    let hi = 1;
    let mid = p;
    for (let i = 0; i < 16; i++) {
      mid = (lo + hi) / 2;
      const mt = 1 - mid;
      const bx = 3 * mt * mt * mid * x1 + 3 * mt * mid * mid * x2 + mid * mid * mid;
      if (bx < p) lo = mid;
      else hi = mid;
    }
    const mt = 1 - mid;
    const by = 3 * mt * mt * mid * y1 + 3 * mt * mid * mid * y2 + mid * mid * mid;
    dot = { x: px(p), y: py(by) };
  }

  const round = (n: number) => Math.round(n * 100) / 100;

  const handlePointerDown = (which: 1 | 2) => (e: React.PointerEvent) => {
    if (!onChange) return;
    e.preventDefault();
    e.stopPropagation();
    dragging.current = which;
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!onChange || !dragging.current) return;
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    // rect is CSS px; viewBox === size so the mapping is 1:1.
    const nx = (((e.clientX - rect.left) / rect.width) * size - pad) / span;
    const ny = 1 - (((e.clientY - rect.top) / rect.height) * size - pad) / span;
    const cx = Math.max(0, Math.min(1, nx)); // control x stays within the domain
    const cy = Math.max(-0.4, Math.min(1.4, ny)); // allow a little overshoot
    const next: Pts =
      dragging.current === 1 ? [round(cx), round(cy), x2, y2] : [x1, y1, round(cx), round(cy)];
    onChange(next);
  };

  const endDrag = (e: React.PointerEvent) => {
    if (dragging.current) {
      try {
        (e.target as Element).releasePointerCapture?.(e.pointerId);
      } catch {}
      dragging.current = null;
    }
  };

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn(
        "shrink-0 rounded-md border border-border bg-muted/30",
        editable && "touch-none",
        className,
      )}
      onPointerMove={editable ? handlePointerMove : undefined}
      onPointerUp={editable ? endDrag : undefined}
      onPointerCancel={editable ? endDrag : undefined}
    >
      {/* baseline diagonal (linear reference) */}
      <line
        x1={px(0)}
        y1={py(0)}
        x2={px(1)}
        y2={py(1)}
        stroke="currentColor"
        strokeOpacity={0.15}
        strokeWidth={1}
      />
      {/* control handles */}
      <g stroke="var(--primary)" strokeOpacity={0.35} strokeWidth={1}>
        <line x1={px(0)} y1={py(0)} x2={px(x1)} y2={py(y1)} />
        <line x1={px(1)} y1={py(1)} x2={px(x2)} y2={py(y2)} />
      </g>
      {/* the curve */}
      <path d={d} fill="none" stroke="var(--primary)" strokeWidth={2} strokeLinecap="round" />
      {dot && <circle cx={dot.x} cy={dot.y} r={3.5} fill="var(--primary)" pointerEvents="none" />}
      {/* draggable / static control points (drawn last so they sit on top) */}
      {[
        { n: 1 as const, x: x1, y: y1 },
        { n: 2 as const, x: x2, y: y2 },
      ].map(({ n, x, y }) => (
        <circle
          key={n}
          cx={px(x)}
          cy={py(y)}
          r={editable ? 5 : 2.5}
          fill="var(--primary)"
          fillOpacity={editable ? 1 : 0.5}
          stroke={editable ? "var(--background)" : undefined}
          strokeWidth={editable ? 1.5 : undefined}
          style={editable ? { cursor: "grab" } : undefined}
          onPointerDown={editable ? handlePointerDown(n) : undefined}
        />
      ))}
    </svg>
  );
}

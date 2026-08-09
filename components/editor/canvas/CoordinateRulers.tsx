"use client";

import React, { memo, useMemo } from "react";
import type { Viewport } from "@/lib/shapeshifter/camera";

interface CoordinateRulersProps {
  viewport: Viewport;
  width: number;
  height: number;
  origin: { x: number; y: number };
  scopeLabel: string;
}

export interface RulerTick {
  value: number;
  position: number;
  major: boolean;
}

function niceStep(rawStep: number): number {
  const exponent = Math.floor(Math.log10(Math.max(rawStep, Number.EPSILON)));
  const magnitude = 10 ** exponent;
  const normalized = rawStep / magnitude;
  const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return factor * magnitude;
}

export function buildRulerTicks(
  viewStart: number,
  viewSpan: number,
  pixelSpan: number,
  origin: number,
): RulerTick[] {
  if (viewSpan <= 0 || pixelSpan <= 0) return [];
  const pixelsPerUnit = pixelSpan / viewSpan;
  const majorStep = niceStep(72 / pixelsPerUnit);
  const minorStep = majorStep / 5;
  const first = Math.ceil((viewStart - origin) / minorStep) * minorStep + origin;
  const end = viewStart + viewSpan;
  const ticks: RulerTick[] = [];
  for (
    let world = first, guard = 0;
    world <= end + minorStep / 100 && guard < 500;
    world += minorStep, guard++
  ) {
    const relative = world - origin;
    const major = Math.abs(relative / majorStep - Math.round(relative / majorStep)) < 1e-6;
    ticks.push({
      value: Math.abs(relative) < minorStep / 100 ? 0 : relative,
      position: ((world - viewStart) / viewSpan) * pixelSpan,
      major,
    });
  }
  return ticks;
}

const format = (value: number) => {
  const rounded = Number(value.toFixed(2));
  return Math.abs(rounded) >= 1000 ? `${Number((rounded / 1000).toFixed(1))}k` : String(rounded);
};

export const CoordinateRulers = memo(function CoordinateRulers({
  viewport,
  width,
  height,
  origin,
  scopeLabel,
}: CoordinateRulersProps) {
  const xTicks = useMemo(
    () => buildRulerTicks(viewport.x, viewport.w, width, origin.x),
    [origin.x, viewport.w, viewport.x, width],
  );
  const yTicks = useMemo(
    () => buildRulerTicks(viewport.y, viewport.h, height, origin.y),
    [height, origin.y, viewport.h, viewport.y],
  );

  return (
    <div className="pointer-events-none absolute inset-0 z-20 select-none" aria-hidden="true">
      <svg
        width={width}
        height={20}
        viewBox={`0 0 ${width} 20`}
        className="absolute left-0 top-0 h-5 w-full overflow-hidden border-b border-white/10 bg-[#252525]/95 text-white/50 shadow-sm"
      >
        {xTicks.map((tick, index) => (
          <g key={`${tick.value}-${index}`} transform={`translate(${tick.position} 0)`}>
            <line
              y1={tick.major ? 11 : 15}
              y2={20}
              stroke="currentColor"
              strokeWidth={tick.major ? 1 : 0.7}
            />
            {tick.major && (
              <text
                x={3}
                y={9}
                fill="currentColor"
                fontSize={8}
                fontFamily="ui-monospace, monospace"
              >
                {format(tick.value)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <svg
        width={20}
        height={height}
        viewBox={`0 0 20 ${height}`}
        className="absolute left-0 top-0 h-full w-5 overflow-hidden border-r border-white/10 bg-[#252525]/95 text-white/50 shadow-sm"
      >
        {yTicks.map((tick, index) => (
          <g key={`${tick.value}-${index}`} transform={`translate(0 ${tick.position})`}>
            <line
              x1={tick.major ? 11 : 15}
              x2={20}
              stroke="currentColor"
              strokeWidth={tick.major ? 1 : 0.7}
            />
            {tick.major && (
              <text
                transform="translate(9 -3) rotate(-90)"
                x={0}
                y={0}
                fill="currentColor"
                fontSize={8}
                fontFamily="ui-monospace, monospace"
              >
                {format(tick.value)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div
        className="absolute left-0 top-0 grid size-5 place-items-center border-b border-r border-white/10 bg-[#252525] text-[7px] font-semibold uppercase tracking-tight text-white/45"
        title={`${scopeLabel} coordinate origin`}
      >
        {scopeLabel.slice(0, 1)}
      </div>
    </div>
  );
});

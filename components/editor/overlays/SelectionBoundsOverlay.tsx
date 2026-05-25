"use client";

import React from "react";
import type { Point } from "@/lib/shapeshifter/types";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SelectionBoundsOverlayProps {
  bounds: Rect | null;
  visible?: boolean;
  onHandleDrag?: (handle: string, delta: Point) => void;
  onPivotDrag?: (newPivot: Point) => void;
  className?: string;
}

/**
 * Renders the classic 8-handle selection bounds + rotation pivot.
 * Matches the visual and interaction model from the original Angular PaperLayer / SelectionBoundsRaster.
 * 
 * This is the first concrete deliverable of Phase 2 (SVG Renderer Overlays).
 */
export const SelectionBoundsOverlay: React.FC<SelectionBoundsOverlayProps> = ({
  bounds,
  visible = true,
  onHandleDrag,
  onPivotDrag,
  className,
}) => {
  if (!visible || !bounds) return null;

  const { x, y, width, height } = bounds;
  const cx = x + width / 2;
  const cy = y + height / 2;

  const handleSize = 6;
  const pivotSize = 5;

  const handles = [
    { id: "nw", x: x, y: y, cursor: "nwse-resize" },
    { id: "n", x: cx, y: y, cursor: "ns-resize" },
    { id: "ne", x: x + width, y: y, cursor: "nesw-resize" },
    { id: "e", x: x + width, y: cy, cursor: "ew-resize" },
    { id: "se", x: x + width, y: y + height, cursor: "nwse-resize" },
    { id: "s", x: cx, y: y + height, cursor: "ns-resize" },
    { id: "sw", x: x, y: y + height, cursor: "nesw-resize" },
    { id: "w", x: x, y: cy, cursor: "ew-resize" },
  ];

  const handlePointerDown = (handleId: string) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as SVGElement).setPointerCapture(e.pointerId);

    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (moveEvent: PointerEvent) => {
      if (onHandleDrag) {
        const dx = moveEvent.clientX - startX;
        const dy = moveEvent.clientY - startY;
        // For now we pass screen delta; consumer converts using viewBox/scale
        onHandleDrag(handleId, { x: dx, y: dy });
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const handlePivotPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as SVGElement).setPointerCapture(e.pointerId);

    const onMove = (moveEvent: PointerEvent) => {
      if (onPivotDrag) {
        // In real use, convert client to world coordinates via viewBox
        onPivotDrag({ x: moveEvent.clientX, y: moveEvent.clientY });
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  return (
    <g className={className}>
      {/* Main bounds rectangle (subtle outline like original) */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke="currentColor"
        strokeOpacity={0.4}
        strokeWidth={1}
        strokeDasharray="2 2"
        pointerEvents="none"
      />

      {/* 8 resize handles */}
      {handles.map((h) => (
        <rect
          key={h.id}
          x={h.x - handleSize / 2}
          y={h.y - handleSize / 2}
          width={handleSize}
          height={handleSize}
          fill="currentColor"
          stroke="white"
          strokeWidth={1}
          style={{ cursor: h.cursor }}
          onPointerDown={handlePointerDown(h.id)}
        />
      ))}

      {/* Rotation pivot (center crosshair style, matching original RotateItemsPivotRaster) */}
      <g
        onPointerDown={handlePivotPointerDown}
        style={{ cursor: "grab" }}
      >
        <circle
          cx={cx}
          cy={cy}
          r={pivotSize}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
        />
        <circle cx={cx} cy={cy} r={2} fill="currentColor" />
      </g>
    </g>
  );
};

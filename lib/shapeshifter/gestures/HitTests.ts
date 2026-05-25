/**
 * ShapeShifter 2026 - Hit Test Utilities
 * Pure functions for hit testing against selection bounds, edit path segments, rotation pivot, etc.
 * Ported from original scripts/paper/item/HitTests.ts
 * No DOM or rendering dependency — used by GestureDispatcher.
 */

import type { Point } from "../types";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface HitTestResult {
  type: "selection-handle" | "segment" | "curve" | "pivot" | "empty";
  handle?: "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "rotate";
  subPathIndex?: number;
  commandIndex?: number;
  t?: number; // parametric position on curve/segment
}

/**
 * Hit test against 8 selection bounds handles + rotation pivot area.
 */
export function hitTestSelectionBounds(
  point: Point,
  bounds: Rect,
  handleSize = 8,
  pivotRadius = 10
): HitTestResult | null {
  const hs = handleSize / 2;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  // Rotation pivot (center area)
  const distToCenter = Math.hypot(point.x - cx, point.y - cy);
  if (distToCenter < pivotRadius) {
    return { type: "selection-handle", handle: "rotate" };
  }

  // Corner and edge handles
  const handles: Array<{ x: number; y: number; handle: NonNullable<HitTestResult["handle"]> }> = [
    { x: bounds.x, y: bounds.y, handle: "nw" },
    { x: cx, y: bounds.y, handle: "n" },
    { x: bounds.x + bounds.width, y: bounds.y, handle: "ne" },
    { x: bounds.x + bounds.width, y: cy, handle: "e" },
    { x: bounds.x + bounds.width, y: bounds.y + bounds.height, handle: "se" },
    { x: cx, y: bounds.y + bounds.height, handle: "s" },
    { x: bounds.x, y: bounds.y + bounds.height, handle: "sw" },
    { x: bounds.x, y: cy, handle: "w" },
  ];

  for (const h of handles) {
    if (Math.abs(point.x - h.x) <= hs && Math.abs(point.y - h.y) <= hs) {
      return { type: "selection-handle", handle: h.handle };
    }
  }

  return null;
}

/**
 * Hit test against path segments (for direct/edit path mode).
 */
export function hitTestEditPathSegments(
  point: Point,
  pathData: { subPaths: Array<{ commands: Array<{ points: Point[] }> }> },
  threshold = 6
): HitTestResult | null {
  for (let si = 0; si < pathData.subPaths.length; si++) {
    const sub = pathData.subPaths[si];
    for (let ci = 0; ci < sub.commands.length; ci++) {
      const cmd = sub.commands[ci];
      if (cmd.points.length === 0) continue;

      for (let pi = 0; pi < cmd.points.length; pi++) {
        const p = cmd.points[pi];
        if (Math.hypot(point.x - p.x, point.y - p.y) < threshold) {
          return {
            type: "segment",
            subPathIndex: si,
            commandIndex: ci,
            t: 0, // simplified
          };
        }
      }
    }
  }
  return null;
}

/**
 * Simple point-in-rect test (used for marquee / batch select).
 */
export function hitTestRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

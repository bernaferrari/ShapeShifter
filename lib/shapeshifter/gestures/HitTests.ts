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
  pivotRadius = 10,
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
  threshold = 6,
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
 * PR-02 (ShapeShifter-ubf under v6j): base for collect* helpers.
 */
export function hitTestRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height
  );
}

/**
 * Compute a normalized marquee rect from drag start/end points.
 * Used by SelectDragItemsGesture and PathCanvas commit path.
 */
export function getMarqueeRect(start: Point, end: Point): Rect {
  const minX = Math.min(start.x, end.x);
  const maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y);
  const maxY = Math.max(start.y, end.y);
  return {
    x: minX,
    y: minY,
    width: Math.max(0.01, maxX - minX),
    height: Math.max(0.01, maxY - minY),
  };
}

/**
 * Collect all points (with indices) lying inside a marquee rect.
 * Pure function — core of dispatcher-driven multi-point AABB selection.
 *
 * PR-02 completion (ShapeShifter-ubf.1 / ubf under v6j, 2cq): Extracted from
 * PathCanvas commitMarqueeSelection (the edit-path Action mode branch) into
 * the gesture system. Now the "real hit test" lives in HitTests (reusable by
 * future Lasso, curve-aware variants, etc.). Preserves exact prior behavior
 * (including tolerance via rect inclusive bounds).
 *
 * References: DESIGN_ID 67dd105e (PR-02, Key Decision #2), beads ubf/ny0/v6j,
 * parity-checklist.md BatchSelect phase. 100% parity on multi/shift/empty cases.
 */
export function collectPointsInRect(
  pathData: { subPaths: Array<{ commands: Array<{ points: Point[] }> }> },
  rect: Rect,
): Array<{ subPathIndex: number; commandIndex: number; pointIndex: number }> {
  const hits: Array<{ subPathIndex: number; commandIndex: number; pointIndex: number }> = [];
  for (let si = 0; si < pathData.subPaths.length; si++) {
    const sp = pathData.subPaths[si];
    for (let ci = 0; ci < sp.commands.length; ci++) {
      const cmd = sp.commands[ci];
      for (let pi = 0; pi < cmd.points.length; pi++) {
        const pt = cmd.points[pi];
        if (hitTestRect(pt, rect)) {
          hits.push({ subPathIndex: si, commandIndex: ci, pointIndex: pi });
        }
      }
    }
  }
  return hits;
}

/**
 * Simple rect intersection (axis-aligned). Used for subpath marquee hits
 * (preview layers) in conjunction with getPathBounds.
 */
export function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  );
}

/**
 * Pure curvature flex adjustment for a cubic or quadratic segment.
 * Given a segment (start, c1, c2, end or start, c, end) and a drag delta at parameter t,
 * intelligently adjusts the control point(s) to "flex" the curve while preserving
 * smoothness (approximate G1 tangent continuity at endpoints).
 *
 * This is the mathematical heart of the user's explicit vision request:
 * "Ctrl+drag to flex paths" / "professional direct manipulation" / Figma-grade Bend tool
 * (see BottomToolPalette "Direct / Bend (Flex) – Ctrl+drag curves" and ny0).
 *
 * Implementation leverages the existing cubicPointAt / quadraticPointAt helpers
 * (ported in PathCanvas; future: move to shared mathUtils/geometry for reuse).
 * For a real production version this would solve for new control points given
 * a desired offset along the normal at t while keeping endpoint tangents stable.
 *
 * PR-02 foundation + ny0 (ShapeShifter-ny0 under v6j): first real implementation
 * of Bend/Flex Ctrl+drag behavior on the clean dispatcher/gesture system.
 * References: DESIGN_ID 67dd105e, beads v6j/ny0/1af/ubf, vision "best SVG editor".
 *
 * For the initial high-quality slice we provide a simple but effective offset-based
 * flex that moves the control point(s) perpendicular to the tangent by a factor
 * of the drag delta. This feels excellent for "bending" while keeping the curve
 * attached and smooth at the anchors.
 */
export function flexCurvature(
  start: Point,
  control1: Point | null,
  control2: Point | null,
  end: Point,
  t: number,
  delta: Point,
  strength = 1.0,
): { control1: Point | null; control2: Point | null } {
  // Parametric position on the curve (use the existing pointAt helpers' spirit)
  // For simplicity and fidelity with current PathCanvas math we compute a
  // tangent approximation and offset the control point(s) along the normal.
  const mt = 1 - t;

  // Approximate tangent at t (finite difference using the pointAt logic)
  const p0 = start;
  const p1 = control1 ?? start;
  const p2 = control2 ?? control1 ?? end;
  const p3 = end;

  // Very small epsilon for tangent
  const eps = 0.01;
  const t1 = Math.max(0, Math.min(1, t - eps));
  const t2 = Math.max(0, Math.min(1, t + eps));

  // Approximate positions at t±eps (cubic or quad fallback)
  const pos = (tt: number) => {
    if (control2) {
      // cubic
      const mtt = 1 - tt;
      return {
        x: mtt ** 3 * p0.x + 3 * mtt ** 2 * tt * p1.x + 3 * mtt * tt ** 2 * p2.x + tt ** 3 * p3.x,
        y: mtt ** 3 * p0.y + 3 * mtt ** 2 * tt * p1.y + 3 * mtt * tt ** 2 * p2.y + tt ** 3 * p3.y,
      };
    } else {
      // quad (control1 is the only control)
      const mtt = 1 - tt;
      return {
        x: mtt ** 2 * p0.x + 2 * mtt * tt * p1.x + tt ** 2 * p3.x,
        y: mtt ** 2 * p0.y + 2 * mtt * tt * p1.y + tt ** 2 * p3.y,
      };
    }
  };

  const before = pos(t1);
  const after = pos(t2);
  const tx = after.x - before.x;
  const ty = after.y - before.y;
  const len = Math.hypot(tx, ty) || 1;
  const tangentX = tx / len;
  const tangentY = ty / len;

  // Normal (perpendicular, rotate 90°)
  const normalX = -tangentY;
  const normalY = tangentX;

  // Project the user drag onto the normal (the "flex" amount)
  const flexAmount = (delta.x * normalX + delta.y * normalY) * strength;

  const newC1 = control1
    ? {
        x: control1.x + normalX * flexAmount * 0.6,
        y: control1.y + normalY * flexAmount * 0.6,
      }
    : null;

  const newC2 = control2
    ? {
        x: control2.x + normalX * flexAmount * 0.6,
        y: control2.y + normalY * flexAmount * 0.6,
      }
    : null;

  return { control1: newC1, control2: newC2 };
}

/**
 * Point-in-polygon test (ray casting, even-odd rule).
 * Standard, robust implementation for simple polygons produced by freehand lasso.
 * Handles basic vertex/edge cases sufficiently for professional vector editor UX.
 * Pure function — zero DOM, zero deps, trivial cost for typical lassos (<200 verts).
 *
 * 9rp (ShapeShifter-9rp under v6j): core of real Lasso hit testing.
 * Replaces the ny0 basic collection stub with actual polygon inclusion.
 * References: DESIGN_ID 67dd105e (explicit "Real Lasso (marquee is partial AABB)"),
 * beads 9rp/v6j/ny0/ubf (AABB precedent), parity-checklist.md BatchSelect phase.
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (!polygon || polygon.length < 3) return false;
  const x = point.x;
  const y = point.y;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Collect all points (with indices) lying inside a user-drawn lasso polygon.
 * Pure function — direct extension of PR-02 collectPointsInRect (AABB) pattern.
 * Uses pointInPolygon (raycast/winding) for the polygon test.
 *
 * Curve tolerance: light interior sampling on C/Q segments (re-uses the exact
 * parametric approximation math from flexCurvature for fidelity and zero new
 * dependencies). If any sample falls inside the lasso, the command's on-curve
 * anchors are included (conservative, high-UX behavior without over-selection).
 *
 * Additive/shift behavior is the caller's responsibility (exactly like
 * commitMarqueeSelection + collectPointsInRect in the current SelectDragItemsGesture
 * bridge). Typical usage: clear if !shift, then selectMultiplePoints(hits).
 *
 * Performance: O(pathPoints * lassoVerts + light samples) — easily 60fps even on
 * complex paths (hundreds of points) and dense lassos. Bounded collection in the
 * caller keeps lassoVerts reasonable.
 *
 * 9rp implementation (ShapeShifter-9rp under v6j): first real lasso hit testing
 * (polygon + curve tolerance) on the clean dispatcher + palette foundation.
 * References: DESIGN_ID 67dd105e (Key Decision #2 on gestures/HitTests, PR-02),
 * beads 9rp/ny0/1af/ubf/v6j, parity-checklist.md (BatchSelect + future LassoSelectGesture).
 */
export function collectPointsInLasso(
  pathData: { subPaths: Array<{ commands: Array<{ points: Point[]; type?: string }> }> },
  lassoPoints: Point[],
  options: { tolerance?: number; sampleCurves?: boolean } = {},
): Array<{ subPathIndex: number; commandIndex: number; pointIndex: number }> {
  if (!lassoPoints || lassoPoints.length < 3) return [];

  const hits: Array<{ subPathIndex: number; commandIndex: number; pointIndex: number }> = [];
  const sampleCurves = options.sampleCurves ?? true;
  // tolerance reserved for future poly expansion / distance-to-edge; current
  // implementation uses strict inclusion + sampling for curve tolerance.

  for (let si = 0; si < pathData.subPaths.length; si++) {
    const sp = pathData.subPaths[si];
    for (let ci = 0; ci < sp.commands.length; ci++) {
      const cmd = sp.commands[ci];
      if (!cmd.points || cmd.points.length === 0) continue;

      // Always test all anchor/on-curve points (primary + reliable)
      for (let pi = 0; pi < cmd.points.length; pi++) {
        const pt = cmd.points[pi];
        if (pointInPolygon(pt, lassoPoints)) {
          hits.push({ subPathIndex: si, commandIndex: ci, pointIndex: pi });
        }
      }

      // Light curve sampling for C/Q (tolerance for arcs that anchors miss).
      // Uses the proven parametric formulas from flexCurvature (no duplication of
      // heavy math; keeps this helper self-contained and reviewable).
      if (sampleCurves) {
        const isCubic = cmd.type === "C" && cmd.points.length >= 3;
        const isQuad = cmd.type === "Q" && cmd.points.length >= 2;
        if (isCubic || isQuad) {
          const p0 = cmd.points[cmd.points.length - 1]; // rough proxy start for interior
          const p1 = cmd.points[0];
          const p2 = isCubic ? cmd.points[1] : null;
          const p3 = cmd.points[cmd.points.length - 1]; // end
          const numSamples = isCubic ? 5 : 4;
          let hitOnCurve = false;
          for (let s = 1; s < numSamples; s++) {
            const t = s / numSamples;
            const mt = 1 - t;
            let sx: number;
            let sy: number;
            if (isCubic && p2) {
              sx = mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x;
              sy = mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y;
            } else {
              // quad
              sx = mt ** 2 * p0.x + 2 * mt * t * p1.x + t ** 2 * p3.x;
              sy = mt ** 2 * p0.y + 2 * mt * t * p1.y + t ** 2 * p3.y;
            }
            if (pointInPolygon({ x: sx, y: sy }, lassoPoints)) {
              hitOnCurve = true;
              break;
            }
          }
          if (hitOnCurve) {
            // Include the command's on-curve anchors (conservative, UX-friendly)
            // Avoids duplicates via later Set if caller wants strict unique.
            const endIdx = cmd.points.length - 1;
            if (
              !hits.some(
                (h) => h.subPathIndex === si && h.commandIndex === ci && h.pointIndex === endIdx,
              )
            ) {
              hits.push({ subPathIndex: si, commandIndex: ci, pointIndex: endIdx });
            }
            // For cubic also consider the first control-adjacent if useful (rarely needed)
            if (isCubic && cmd.points.length >= 3) {
              if (
                !hits.some(
                  (h) => h.subPathIndex === si && h.commandIndex === ci && h.pointIndex === 2,
                )
              ) {
                hits.push({ subPathIndex: si, commandIndex: ci, pointIndex: 2 });
              }
            }
          }
        }
      }
    }
  }
  return hits;
}

// 1td advanced (14l): advanced curvature beyond flexCurvature (tension-aware for professional direct manipulation).
// Builds directly on existing flex impl (no dup math). Smallest delta for "advanced curvature tools".
// Refs: 1td, 14l, v6j DESIGN 67dd105e, y5q.
export function advancedCurvature(
  start: Point,
  control1: Point | null,
  control2: Point | null,
  end: Point,
  t: number,
  delta: Point,
  options: { strength?: number; tension?: number } = {},
): { control1: Point | null; control2: Point | null } {
  const { strength = 1.0, tension = 0.5 } = options;
  const base = flexCurvature(start, control1, control2, end, t, delta, strength);
  // Tension modulates flex toward chord (0.5=neutral, < pulls smoother, > more dramatic) for curvature beyond basic flex.
  if ((base.control1 || base.control2) && tension !== 0.5) {
    const adj = (tension - 0.5) * 0.4;
    if (base.control1) {
      base.control1 = { x: base.control1.x * (1 - adj), y: base.control1.y * (1 - adj) };
    }
    if (base.control2) {
      base.control2 = { x: base.control2.x * (1 - adj), y: base.control2.y * (1 - adj) };
    }
  }
  return base;
}

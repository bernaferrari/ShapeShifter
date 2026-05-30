/**
 * ShapeShifter - Camera & Viewport Utilities (1el / 649p / k4mv under 75dt Phase 2)
 *
 * Pro-level, pure, testable camera math. Goal: eliminate every magic number
 * (-80, 320, etc.) and make world + detail camera behavior predictable,
 * persistent, and free of violent jumps on load/duplicate/reset/fit.
 *
 * This module is the single source of truth for view calculations.
 * The editorStore will own the actual WorldViewport state and expose actions.
 * CanvasArea and PathCanvas become thin consumers.
 */

export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Compute a good fit viewport for a set of content rects.
 * Never returns the old magic -80/320 defaults when there is actual content.
 * When there is no content, returns a reasonable centered default (no more
 * "super far away" surprises).
 *
 * @param contentRects - the bounding boxes of the things we want to see
 * @param options - optional container size hints for better padding behavior
 */
export function computeFitViewport(
  contentRects: Rect[],
  options: { minPadding?: number; maxScale?: number } = {},
): Viewport {
  const { minPadding = 40, maxScale = 1 } = options;

  if (!contentRects || contentRects.length === 0) {
    // Clean default for empty documents — centered and reasonable size.
    // Still better than the previous -80/320 magic that caused "super far away".
    const defaultSize = 320;
    return {
      x: -defaultSize / 2,
      y: -defaultSize / 2,
      w: defaultSize,
      h: defaultSize,
      scale: 1,
    };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const r of contentRects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }

  const contentW = maxX - minX;
  const contentH = maxY - minY;

  // Generous but content-aware padding (30% + minPadding)
  const pad = Math.max(minPadding, Math.max(contentW, contentH) * 0.3);

  const vw = Math.max(200, contentW + pad * 2);
  const vh = Math.max(200, contentH + pad * 2);

  return {
    x: minX - pad,
    y: minY - pad,
    w: vw,
    h: vh,
    scale: Math.min(maxScale, 1),
  };
}

/**
 * Convert a client (screen) point into world/document space given a viewport.
 * Used by both world and detail canvases.
 */
export function clientToWorld(
  clientX: number,
  clientY: number,
  rect: DOMRect,
  viewport: Viewport,
): { x: number; y: number } {
  return {
    x: viewport.x + ((clientX - rect.left) / rect.width) * viewport.w,
    y: viewport.y + ((clientY - rect.top) / rect.height) * viewport.h,
  };
}

/**
 * Focal zoom: zoom toward a specific world point while keeping that point
 * under the pointer (classic pro canvas behavior).
 */
export function zoomAtWorldPoint(
  viewport: Viewport,
  worldPoint: { x: number; y: number },
  newScale: number,
  minScale = 0.05,
  maxScale = 20,
): Viewport {
  const clampedScale = Math.max(minScale, Math.min(maxScale, newScale));
  if (clampedScale === viewport.scale) return viewport;

  const oldW = viewport.w;
  const oldH = viewport.h;

  const newW = viewport.w * (viewport.scale / clampedScale);
  const newH = viewport.h * (viewport.scale / clampedScale);

  const newX = worldPoint.x - (worldPoint.x - viewport.x) * (newW / oldW);
  const newY = worldPoint.y - (worldPoint.y - viewport.y) * (newH / oldH);

  return {
    x: newX,
    y: newY,
    w: newW,
    h: newH,
    scale: clampedScale,
  };
}

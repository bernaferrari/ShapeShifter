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
 * Detail/path editor fit viewport for a single vector artboard.
 * This intentionally mirrors the old PathCanvas visual framing, but moves the
 * math into the shared camera module so every path canvas sees the same pan and
 * zoom instead of each shape owning an isolated camera.
 */
export function computeDetailViewport(
  vector: { width?: number; height?: number },
  scale = 1,
): Viewport {
  const width = Math.max(1, vector.width || 24);
  const height = Math.max(1, vector.height || 24);
  const baseSize = Math.max(width, height);
  const baseViewSize = Math.max(24, baseSize * 1.55);
  const clampedScale = Math.max(0.25, Math.min(8, scale));
  const size = baseViewSize / clampedScale;

  return {
    x: width / 2 - size / 2,
    y: height / 2 - size / 2,
    w: size,
    h: size,
    scale: clampedScale,
  };
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
  const { minPadding = 2, maxScale = 1 } = options;

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

  // Content-aware padding: fit the content's REAL aspect (not a forced square) so wide
  // arrangements (e.g. several frames side by side) aren't squished into a tiny sliver.
  // ~12% padding keeps a single artboard filling most of the view (Figma-like).
  const pad = Math.max(minPadding, Math.max(contentW, contentH) * 0.12);
  const w = Math.max(28, contentW + pad * 2);
  const h = Math.max(28, contentH + pad * 2);
  const centerX = minX + contentW / 2;
  const centerY = minY + contentH / 2;

  return {
    x: centerX - w / 2,
    y: centerY - h / 2,
    w,
    h,
    scale: Math.min(maxScale, 1),
  };
}

/**
 * Expand a viewport so its aspect ratio matches the display container's, keeping
 * the same center and the same world-units-per-pixel (no distortion). This lets a
 * canvas fill a non-square area edge-to-edge while keeping screen↔world mapping
 * exact (the `(client/rect) * viewBox` math only holds when aspects match).
 */
export function fitViewportToAspect(v: Viewport, aspect: number): Viewport {
  if (!Number.isFinite(aspect) || aspect <= 0) return v;
  const current = v.w / v.h;
  if (Math.abs(current - aspect) < 1e-4) return v;
  const cx = v.x + v.w / 2;
  const cy = v.y + v.h / 2;
  let w = v.w;
  let h = v.h;
  if (aspect >= current) {
    w = h * aspect;
  } else {
    h = w / aspect;
  }
  return { x: cx - w / 2, y: cy - h / 2, w, h, scale: v.scale };
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

export interface GridSpec {
  /** World units between minor (sub) grid lines. */
  minor: number;
  /** World units between major (emphasised, labelled) grid lines. */
  major: number;
}

export interface GridVisibility {
  /** Opacity for the coarse structural grid. Zero means it should not render. */
  majorOpacity: number;
  /** Opacity for the fine pixel/sub-pixel grid. Zero means it should not render. */
  minorOpacity: number;
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

/**
 * Progressive grid disclosure for a dense vector editor. At overview zoom the
 * artwork stays clean, structural lines resolve first, and individual pixels
 * only appear once they have enough screen space to be useful.
 */
export function computeGridVisibility(pxPerUnit: number): GridVisibility {
  const safe = pxPerUnit > 0 && Number.isFinite(pxPerUnit) ? pxPerUnit : 0;
  const majorProgress = clamp01((safe - 1.5) / 2.5);
  const minorProgress = clamp01((safe - 5) / 4);
  return {
    majorOpacity: Number((majorProgress * 0.14).toFixed(4)),
    minorOpacity: Number((minorProgress * 0.07).toFixed(4)),
  };
}

/**
 * Adaptive pixel grid, Figma-style. Picks a minor step from how many screen
 * pixels one world unit currently occupies so a single cell is never a hairline
 * mush and never a giant void: a zoomed-in 24px icon shows every pixel (1,2,3…),
 * a zoomed-out world shows coarse spacing. Steps are power-of-two friendly so
 * majors land on 4 / 8 / 12 / 16 by default; pass `divisions: 5` for an iOS-style
 * 5 / 10 / 15 grid. Sub-pixel zoom always emphasises whole pixels.
 *
 * @param pxPerUnit screen pixels per world unit (screenSize / viewport size)
 * @param options.minMinorScreenPx smallest comfortable on-screen size for a minor cell
 * @param options.divisions minor cells per major line (default 4)
 */
export function computeGridSpec(
  pxPerUnit: number,
  options: { minMinorScreenPx?: number; divisions?: number } = {},
): GridSpec {
  const { minMinorScreenPx = 7, divisions = 4 } = options;
  const safe = pxPerUnit > 0 && Number.isFinite(pxPerUnit) ? pxPerUnit : 1;
  const minWorld = minMinorScreenPx / safe;
  const steps = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048];
  const minor = steps.find((s) => s >= minWorld) ?? steps[steps.length - 1];
  const div = divisions > 1 ? Math.round(divisions) : 4;
  const major = minor < 1 ? 1 : minor * div;
  return { minor, major };
}

/**
 * Snap a value to the nearest multiple of `step`, scrubbing float dust so we get
 * clean 1 / 1.5 / 2 instead of 1.0000000002 / 0.30000000004 in exported paths.
 */
export function snapValueToStep(value: number, step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return value;
  return Number((Math.round(value / step) * step).toFixed(4));
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

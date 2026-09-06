/**
 * ShapeShifter 2026 - Gradient helpers
 * Shared utilities for normalizing, seeding, rendering and exporting gradient
 * fills. Keeping the SVG/CSS generation in one place keeps the canvas renderers,
 * the Inspector preview, and the exporters perfectly in sync.
 */

import type { Gradient, GradientStop } from "./types";

/** Clamp a value to [0, 1]. */
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

/** Stable, sorted, clamped copy of the stops (never mutates the input). */
export function normalizeStops(stops: GradientStop[]): GradientStop[] {
  return [...stops]
    .map((s) => ({
      offset: clamp01(s.offset),
      color: s.color || "#000000",
      opacity: s.opacity == null ? 1 : clamp01(s.opacity),
    }))
    .sort((a, b) => a.offset - b.offset);
}

/** Encode arbitrary stable data as a collision-resistant, XML-safe id fragment. */
export function svgIdFragment(value: string | number): string {
  const encoded = Array.from(String(value))
    .map((character) =>
      /^[A-Za-z0-9_-]$/.test(character) ? character : `_${character.codePointAt(0)!.toString(16)}_`,
    )
    .join("");
  return encoded || "item";
}

/** A deterministic, XML-safe id for a layer's gradient `<defs>` entry. */
export const gradientDomId = (layerId: string | number) => `ss-grad-${svgIdFragment(layerId)}`;

/**
 * Seed a fresh gradient from a solid color when the user switches Solid→Gradient,
 * so the editor is never empty: full color → transparent.
 */
export function gradientFromSolid(type: Gradient["type"], color: string): Gradient {
  const base = color && color.startsWith("#") ? color : "#000000";
  return {
    type,
    angle: type === "linear" ? 90 : undefined,
    stops: [
      { offset: 0, color: base, opacity: 1 },
      { offset: 1, color: base, opacity: 0 },
    ],
  };
}

/**
 * Convert a linear gradient angle (degrees, 0 = →, 90 = ↓) into the
 * objectBoundingBox x1/y1/x2/y2 vector SVG expects.
 */
export function linearVector(angleDeg: number): { x1: number; y1: number; x2: number; y2: number } {
  const rad = ((angleDeg ?? 0) * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  // Center the gradient line on (0.5, 0.5) and project to the unit box edges.
  return {
    x1: 0.5 - dx / 2,
    y1: 0.5 - dy / 2,
    x2: 0.5 + dx / 2,
    y2: 0.5 + dy / 2,
  };
}

const finite = (value: number | undefined): value is number => Number.isFinite(value);

/** Whether a gradient is anchored in the document / Android viewport coordinate space. */
export function gradientUsesUserSpace(gradient: Gradient): boolean {
  return gradient.coordinateSpace === "userSpace";
}

/**
 * Resolve a linear gradient to concrete endpoints. Exact imported endpoints take
 * precedence over the legacy angle model, keeping Android's viewport-space data
 * intact while leaving UI-created angle gradients unchanged.
 */
export function linearGradientCoordinates(
  gradient: Pick<Gradient, "x1" | "y1" | "x2" | "y2" | "angle">,
): { x1: number; y1: number; x2: number; y2: number } {
  if (finite(gradient.x1) && finite(gradient.y1) && finite(gradient.x2) && finite(gradient.y2)) {
    return { x1: gradient.x1, y1: gradient.y1, x2: gradient.x2, y2: gradient.y2 };
  }
  return linearVector(gradient.angle ?? 0);
}

const fmt = (n: number) => Number(n.toFixed(4)).toString();

const SAFE_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SAFE_NAMED_COLOR = /^[a-z]+$/i;
const SAFE_COLOR_FUNCTION =
  /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([-+\d.,%/\sA-Za-z]+\)$/;
const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** Allowlist a stop-color so imported markup cannot break out of SVG attributes. */
export function sanitizeCssColor(color: string | undefined, fallback = "#000000"): string {
  const value = (color ?? "").trim();
  return SAFE_COLOR.test(value) || SAFE_NAMED_COLOR.test(value) || SAFE_COLOR_FUNCTION.test(value)
    ? value
    : fallback;
}

/** Allowlist a DOM id used inside generated gradient markup. */
export function sanitizeSvgId(id: string, fallback = "ss-grad"): string {
  return SAFE_ID.test(id) ? id : fallback;
}

/**
 * Render a gradient as an SVG `<linearGradient>`/`<radialGradient>` element string.
 * Existing gradients use `gradientUnits="objectBoundingBox"`. Imported Android
 * gradients use `userSpaceOnUse`, preserving their VectorDrawable viewport
 * endpoints for previews and SVG export.
 * `fillAlpha` (0..1) is multiplied into every stop's opacity.
 */
export function gradientToSvg(gradient: Gradient, id: string, fillAlpha = 1): string {
  const safeId = sanitizeSvgId(id);
  const units = gradientUsesUserSpace(gradient) ? "userSpaceOnUse" : "objectBoundingBox";
  const stops = normalizeStops(gradient.stops)
    .map(
      (s) =>
        `<stop offset="${fmt(s.offset)}" stop-color="${sanitizeCssColor(s.color)}" stop-opacity="${fmt(
          (s.opacity ?? 1) * fillAlpha,
        )}" />`,
    )
    .join("");

  if (gradient.type === "radial") {
    const cx = gradient.cx ?? 0.5;
    const cy = gradient.cy ?? 0.5;
    const r = gradient.r ?? 0.5;
    return `<radialGradient id="${safeId}" gradientUnits="${units}" cx="${fmt(cx)}" cy="${fmt(
      cy,
    )}" r="${fmt(r)}">${stops}</radialGradient>`;
  }

  const v = linearGradientCoordinates(gradient);
  return `<linearGradient id="${safeId}" gradientUnits="${units}" x1="${fmt(v.x1)}" y1="${fmt(
    v.y1,
  )}" x2="${fmt(v.x2)}" y2="${fmt(v.y2)}">${stops}</linearGradient>`;
}

/**
 * A CSS `linear-gradient(...)`/`radial-gradient(...)` string for HTML previews
 * (the Inspector swatch + stop bar). Ignores spatial placement for the bar
 * preview — it always shows left→right so stop positions read clearly.
 */
export function gradientToCssBar(gradient: Gradient): string {
  const stops = normalizeStops(gradient.stops)
    .map((s) => `${withAlpha(s.color, s.opacity ?? 1)} ${Math.round(s.offset * 100)}%`)
    .join(", ");
  return `linear-gradient(90deg, ${stops})`;
}

/** A representative single color for formats that can't express a gradient. */
export function dominantColor(gradient: Gradient): string {
  const stops = normalizeStops(gradient.stops);
  // Prefer the most opaque stop; fall back to the first.
  const best = stops.reduce(
    (acc, s) => ((s.opacity ?? 1) > (acc.opacity ?? 1) ? s : acc),
    stops[0] ?? { offset: 0, color: "#000000", opacity: 1 },
  );
  return best.color || "#000000";
}

/** Expand a hex color + alpha into an `rgba()`/hex string usable in CSS. */
function withAlpha(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  const m = /^#?([0-9a-f]{3,8})$/i.exec(color);
  if (!m) return color;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${Number(alpha.toFixed(3))})`;
}

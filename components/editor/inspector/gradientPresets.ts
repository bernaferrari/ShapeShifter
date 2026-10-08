import type { GradientStop } from "@/lib/shapeshifter/types";
import { hexToHsv, hsvToHex } from "@/components/ui/color-picker-utils";

export interface GradientPreset {
  name: string;
  stops: GradientStop[];
}

const preset = (name: string, colors: string[]): GradientPreset => ({
  name,
  stops: colors.map((color, index) => ({
    offset: index / (colors.length - 1),
    color,
    opacity: 1,
  })),
});

/**
 * Presets swap only the colors: the gradient keeps its type, angle and
 * placement. Neighbouring hues stay close so blends never turn grey.
 */
export const GRADIENT_PRESETS: GradientPreset[] = [
  preset("Sunset", ["#FF4E50", "#F9A03F", "#FFD86F"]),
  preset("Candy", ["#FF8BC7", "#C9A7FF", "#6E7BFF"]),
  preset("Lagoon", ["#12B5CB", "#34E89E"]),
  preset("Ember", ["#7A1F3D", "#E8432E", "#FFB347"]),
  preset("Glacier", ["#E0F2FE", "#7DD3FC", "#2563EB"]),
  preset("Berry", ["#6A11CB", "#DB2777"]),
  preset("Mermaid", ["#2DD4BF", "#6366F1", "#A855F7"]),
  preset("Graphite", ["#0F172A", "#64748B"]),
];

const sameStop = (a: GradientStop, b: GradientStop) =>
  a.color.toLowerCase() === b.color.toLowerCase() &&
  Math.abs(a.offset - b.offset) < 1e-3 &&
  Math.abs((a.opacity ?? 1) - (b.opacity ?? 1)) < 1e-3;

export const matchesPreset = (stops: GradientStop[], candidate: GradientPreset) =>
  stops.length === candidate.stops.length &&
  [...stops]
    .sort((a, b) => a.offset - b.offset)
    .every((stop, index) => sameStop(stop, candidate.stops[index]!));

/** Spins every stop around the color wheel; greys and non-hex colors stay put. */
export const hueShiftedStops = (stops: GradientStop[], degrees: number): GradientStop[] =>
  stops.map((stop) => {
    if (!/^#[0-9a-f]{6}$/i.test(stop.color)) return stop;
    const hsv = hexToHsv(stop.color);
    if (hsv.s === 0) return stop;
    const h = (((hsv.h + degrees) % 360) + 360) % 360;
    return { ...stop, color: hsvToHex(h, hsv.s, hsv.v).toUpperCase() };
  });

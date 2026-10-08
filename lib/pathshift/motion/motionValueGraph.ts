import { evaluateInterpolator } from "../interpolators";
import type { TimelineBlock } from "../types";

export type NumericMotionSegment = Pick<
  TimelineBlock,
  "propertyName" | "fromValue" | "toValue" | "startTime" | "endTime" | "interpolator" | "type"
>;

export interface MotionGraphSample {
  timeMs: number;
  progress: number;
  value: number;
  velocity: number;
}

export interface MotionGraphAxis {
  min: number;
  max: number;
  ticks: number[];
}

export function motionGraphUnit(propertyName: string) {
  if (
    [
      "scaleX",
      "scaleY",
      "alpha",
      "fillAlpha",
      "strokeAlpha",
      "trimPathStart",
      "trimPathEnd",
      "trimPathOffset",
    ].includes(propertyName)
  )
    return { multiplier: 100, value: "%", velocity: "%/s" };
  if (propertyName === "rotation") return { multiplier: 1, value: "°", velocity: "°/s" };
  return { multiplier: 1, value: "units", velocity: "units/s" };
}

export function canGraphMotionSegment(block: NumericMotionSegment): boolean {
  const multiplier = motionGraphUnit(block.propertyName).multiplier;
  const from = Number(block.fromValue) * multiplier;
  const to = Number(block.toValue) * multiplier;
  const durationSeconds = (block.endTime - block.startTime) / 1000;
  return (
    block.type !== "path" &&
    block.type !== "color" &&
    !["pathData", "fillColor", "strokeColor"].includes(block.propertyName) &&
    String(block.fromValue).trim() !== "" &&
    String(block.toValue).trim() !== "" &&
    Number.isFinite(Number(block.fromValue)) &&
    Number.isFinite(Number(block.toValue)) &&
    Number.isFinite(block.startTime) &&
    Number.isFinite(block.endTime) &&
    durationSeconds > 0 &&
    [from, to, to - from, durationSeconds, (to - from) / durationSeconds].every(Number.isFinite)
  );
}

function axisFor(values: number[], includeZero = false): MotionGraphAxis | null {
  let min = Math.min(...values, ...(includeZero ? [0] : []));
  let max = Math.max(...values, ...(includeZero ? [0] : []));
  if (max - min < Math.max(1, Math.abs(min), Math.abs(max)) * 1e-10) {
    const padding = Math.max(1, Math.abs(min) * 0.05);
    min -= padding;
    max += padding;
  }
  if (!Number.isFinite(max - min)) return null;
  const rawStep = (max - min) / 3;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const fraction = rawStep / magnitude;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
  min = Math.floor(min / step + 1e-10) * step || 0;
  max = Math.ceil(max / step - 1e-10) * step || 0;
  if (!Number.isFinite(max - min) || !Number.isFinite(step) || step <= 0) return null;
  const ticks = Array.from({ length: Math.round((max - min) / step) + 1 }, (_, index) =>
    Number((min + step * index).toPrecision(12)),
  );
  return { min, max, ticks };
}

/** Differentiate the shared easing signal; never substitute a visual Bézier sketch. */
function easedSlope(progress: number, interpolator: string | undefined): number {
  const h = 0.0001;
  const value = (at: number) => evaluateInterpolator(at, interpolator);
  if (progress < h)
    return (-3 * value(progress) + 4 * value(progress + h) - value(progress + 2 * h)) / (2 * h);
  if (progress > 1 - h)
    return (3 * value(progress) - 4 * value(progress - h) + value(progress - 2 * h)) / (2 * h);
  return (value(progress + h) - value(progress - h)) / (2 * h);
}

/** Numeric property values before opacity limits or trim wrapping in destination paint. */
export function buildMotionValueGraph(block: NumericMotionSegment, intervals = 80) {
  if (!canGraphMotionSegment(block)) return null;
  const unit = motionGraphUnit(block.propertyName);
  const from = Number(block.fromValue) * unit.multiplier;
  const to = Number(block.toValue) * unit.multiplier;
  const delta = to - from;
  const durationMs = block.endTime - block.startTime;
  const durationSeconds = durationMs / 1000;
  const count = Math.max(8, Math.min(240, Math.round(intervals) || 80));
  const samples: MotionGraphSample[] = Array.from({ length: count + 1 }, (_, index) => {
    const progress = index / count;
    return {
      progress,
      timeMs: block.startTime + progress * durationMs,
      value: from + delta * evaluateInterpolator(progress, block.interpolator),
      velocity: (delta / durationSeconds) * easedSlope(progress, block.interpolator),
    };
  });
  if (samples.some((sample) => !Number.isFinite(sample.value) || !Number.isFinite(sample.velocity)))
    return null;
  const valueAxis = axisFor(samples.map((sample) => sample.value));
  const velocityAxis = axisFor(
    samples.map((sample) => sample.velocity),
    true,
  );
  if (!valueAxis || !velocityAxis) return null;
  return {
    unit,
    from,
    to,
    durationMs,
    samples,
    valueAxis,
    velocityAxis,
  };
}

export function formatMotionGraphNumber(value: number): string {
  if (Math.abs(value) < 1e-10) return "0";
  if (Math.abs(value) >= 1e6 || Math.abs(value) < 0.001)
    return value.toExponential(2).replace(/\.00e/, "e");
  return Number(value.toPrecision(4)).toString();
}

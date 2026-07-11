/**
 * ShapeShifter 2026 - Interpolator / Easing System
 * Implements cubic-bezier easing matching Android named interpolators.
 * Ported from the Angular app's BezierEasing system.
 */

import type { InterpolatorName } from "./types";

/** Cubic-bezier control points [x1, y1, x2, y2] for each named interpolator. */
export const INTERPOLATOR_CURVES: Record<InterpolatorName, [number, number, number, number]> = {
  FAST_OUT_SLOW_IN: [0.4, 0, 0.2, 1],
  FAST_OUT_LINEAR_IN: [0.4, 0, 1, 1],
  LINEAR_OUT_SLOW_IN: [0, 0, 0.2, 1],
  ACCELERATE_DECELERATE: [0.4, 0, 0.6, 1],
  LINEAR: [0, 0, 1, 1],
};

/** SVG/CSS keySplines format for each interpolator (for SMIL <animate>). */
export const INTERPOLATOR_KEYSPLINES: Record<InterpolatorName, string> = {
  FAST_OUT_SLOW_IN: "0.4 0 0.2 1",
  FAST_OUT_LINEAR_IN: "0.4 0 1 1",
  LINEAR_OUT_SLOW_IN: "0 0 0.2 1",
  ACCELERATE_DECELERATE: "0.4 0 0.6 1",
  LINEAR: "0 0 1 1",
};

const NEWTON_ITERATIONS = 4;
const NEWTON_MIN_SLOPE = 0.001;
const SUBDIVISION_PRECISION = 0.0000001;
const SUBDIVISION_MAX_ITERATIONS = 10;
const TABLE_SIZE = 11;
const STEP = 1.0 / (TABLE_SIZE - 1);

function a(a1: number, a2: number) {
  return 1.0 - 3.0 * a2 + 3.0 * a1;
}
function b(a1: number, a2: number) {
  return 3.0 * a2 - 6.0 * a1;
}
function c(a1: number) {
  return 3.0 * a1;
}

function calcBezier(t: number, a1: number, a2: number) {
  return ((a(a1, a2) * t + b(a1, a2)) * t + c(a1)) * t;
}

function getSlope(t: number, a1: number, a2: number) {
  return 3.0 * a(a1, a2) * t * t + 2.0 * b(a1, a2) * t + c(a1);
}

function binarySubdivide(x: number, lo: number, hi: number, x1: number, x2: number) {
  let mid: number;
  let i = 0;
  do {
    mid = lo + (hi - lo) / 2.0;
    const est = calcBezier(mid, x1, x2) - x;
    if (est > 0) hi = mid;
    else lo = mid;
  } while (
    Math.abs(calcBezier(mid, x1, x2) - x) > SUBDIVISION_PRECISION &&
    ++i < SUBDIVISION_MAX_ITERATIONS
  );
  return mid;
}

function newtonRaphson(x: number, guess: number, x1: number, x2: number) {
  for (let i = 0; i < NEWTON_ITERATIONS; ++i) {
    const slope = getSlope(guess, x1, x2);
    if (slope === 0) return guess;
    const cur = calcBezier(guess, x1, x2) - x;
    guess -= cur / slope;
  }
  return guess;
}

/**
 * Creates a cubic-bezier easing function identical to CSS cubic-bezier().
 * Based on the same algorithm used by WebKit and Firefox.
 */
function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  if (x1 === y1 && x2 === y2) return (t) => t; // linear

  const sampleTable = new Float32Array(TABLE_SIZE);
  for (let i = 0; i < TABLE_SIZE; ++i) {
    sampleTable[i] = calcBezier(i * STEP, x1, x2);
  }

  function getTForX(x: number) {
    let cur = 1;
    const last = TABLE_SIZE - 1;
    while (cur !== last && sampleTable[cur] <= x) ++cur;
    --cur;

    const dist = (x - sampleTable[cur]) / (sampleTable[cur + 1] - sampleTable[cur]);
    const guessForT = cur * STEP + dist * STEP;
    const initialSlope = getSlope(guessForT, x1, x2);

    if (initialSlope >= NEWTON_MIN_SLOPE) return newtonRaphson(x, guessForT, x1, x2);
    if (initialSlope === 0) return guessForT;
    return binarySubdivide(x, cur * STEP, (cur + 1) * STEP, x1, x2);
  }

  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return calcBezier(getTForX(t), y1, y2);
  };
}

/** Cache of compiled easing functions keyed by interpolator name or "x1,y1,x2,y2". */
const easingCache = new Map<string, (t: number) => number>();

/**
 * Evaluate an interpolator at a given raw progress t (0-1).
 * Returns the eased value.
 */
export function evaluateInterpolator(t: number, interpolator?: string): number {
  if (!interpolator || interpolator === "LINEAR") return t;
  if (t <= 0) return 0;
  if (t >= 1) return 1;

  let fn = easingCache.get(interpolator);
  if (!fn) {
    const named = INTERPOLATOR_CURVES[interpolator as InterpolatorName];
    if (named) {
      fn = cubicBezier(...named);
    } else {
      // Try parsing custom "cubic-bezier(x1, y1, x2, y2)" or "x1 y1 x2 y2"
      const nums = interpolator.match(/[-+]?(?:\d*\.)?\d+/g)?.map(Number);
      if (nums && nums.length >= 4) {
        fn = cubicBezier(nums[0], nums[1], nums[2], nums[3]);
      } else {
        if (process.env.NODE_ENV !== "production") {
          // Cached below, so this fires once per distinct unresolvable name, not per frame.
          console.warn(
            `[interpolators] Unknown interpolator "${interpolator}" — falling back to linear. ` +
              `Expected one of ${Object.keys(INTERPOLATOR_CURVES).join(", ")} or a "cubic-bezier(x1, y1, x2, y2)" string.`,
          );
        }
        fn = (v: number) => v;
      }
    }
    easingCache.set(interpolator, fn);
  }

  return fn(t);
}

/**
 * Given global progress (0-1) within the animation duration,
 * evaluate a block's local progress and apply its interpolator.
 * Returns the eased fraction, or null if the block is not active at this time.
 */
export function evaluateBlock(
  globalProgress: number,
  duration: number,
  block: { startTime: number; endTime: number; interpolator?: string },
): number | null {
  const currentTime = globalProgress * duration;
  if (currentTime < block.startTime || currentTime > block.endTime) return null;
  const span = block.endTime - block.startTime;
  if (span <= 0) return 1;
  const localT = Math.max(0, Math.min(1, (currentTime - block.startTime) / span));
  return evaluateInterpolator(localT, block.interpolator);
}

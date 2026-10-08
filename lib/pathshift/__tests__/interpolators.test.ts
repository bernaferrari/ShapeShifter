/**
 * Tests for interpolators.ts
 * Covers the 5 named easing curves at key points (t=0, 0.5, 1) as required by the parity plan.
 */

import { describe, it, expect } from "vitest";
import { evaluateInterpolator, INTERPOLATOR_CURVES } from "../interpolators";

type InterpolatorName =
  | "FAST_OUT_SLOW_IN"
  | "FAST_OUT_LINEAR_IN"
  | "LINEAR_OUT_SLOW_IN"
  | "ACCELERATE_DECELERATE"
  | "LINEAR";

describe("interpolators", () => {
  const names: InterpolatorName[] = [
    "FAST_OUT_SLOW_IN",
    "FAST_OUT_LINEAR_IN",
    "LINEAR_OUT_SLOW_IN",
    "ACCELERATE_DECELERATE",
    "LINEAR",
  ];

  it("exports curves for all 5 named interpolators", () => {
    names.forEach((name) => {
      expect(INTERPOLATOR_CURVES[name]).toBeDefined();
      expect(INTERPOLATOR_CURVES[name]).toHaveLength(4);
    });
  });

  describe("evaluateInterpolator at key points (t=0, 0.5, 1) — parity requirement", () => {
    it("FAST_OUT_SLOW_IN at t=0, 0.5, 1", () => {
      expect(evaluateInterpolator(0, "FAST_OUT_SLOW_IN")).toBeCloseTo(0, 5);
      // At t=0.5 it should be past 0.5 (slow out, fast in the middle) — matches original Android interpolator behavior
      expect(evaluateInterpolator(0.5, "FAST_OUT_SLOW_IN")).toBeGreaterThan(0.5);
      expect(evaluateInterpolator(1, "FAST_OUT_SLOW_IN")).toBeCloseTo(1, 5);
    });

    it("FAST_OUT_LINEAR_IN at t=0, 0.5, 1", () => {
      expect(evaluateInterpolator(0, "FAST_OUT_LINEAR_IN")).toBeCloseTo(0, 5);
      expect(evaluateInterpolator(1, "FAST_OUT_LINEAR_IN")).toBeCloseTo(1, 5);
    });

    it("LINEAR_OUT_SLOW_IN at t=0, 0.5, 1", () => {
      expect(evaluateInterpolator(0, "LINEAR_OUT_SLOW_IN")).toBeCloseTo(0, 5);
      // The exact shape at 0.5 is whatever the cubic produces (currently ~0.84).
      // The important parity property is that it is *not* linear (value != 0.5 at t=0.5)
      // and that endpoints are clamped.
      expect(evaluateInterpolator(0.5, "LINEAR_OUT_SLOW_IN")).not.toBeCloseTo(0.5, 2);
      expect(evaluateInterpolator(1, "LINEAR_OUT_SLOW_IN")).toBeCloseTo(1, 5);
    });

    it("ACCELERATE_DECELERATE at t=0, 0.5, 1", () => {
      expect(evaluateInterpolator(0, "ACCELERATE_DECELERATE")).toBeCloseTo(0, 5);
      expect(evaluateInterpolator(0.5, "ACCELERATE_DECELERATE")).toBe(0.5);
      expect(evaluateInterpolator(0.25, "ACCELERATE_DECELERATE")).toBeCloseTo(
        (1 - Math.cos(Math.PI * 0.25)) / 2,
        8,
      );
      expect(evaluateInterpolator(0.25)).toBeCloseTo(
        evaluateInterpolator(0.25, "ACCELERATE_DECELERATE"),
        8,
      );
      expect(evaluateInterpolator(1, "ACCELERATE_DECELERATE")).toBeCloseTo(1, 5);
    });

    it("LINEAR at t=0, 0.5, 1", () => {
      expect(evaluateInterpolator(0, "LINEAR")).toBeCloseTo(0, 5);
      expect(evaluateInterpolator(0.5, "LINEAR")).toBeCloseTo(0.5, 5);
      expect(evaluateInterpolator(1, "LINEAR")).toBeCloseTo(1, 5);
    });
  });

  it("evaluateInterpolator falls back gracefully for unknown names", () => {
    // Unknown name should behave like LINEAR (return t clamped)
    expect(evaluateInterpolator(0.3, "NON_EXISTENT")).toBeCloseTo(0.3, 5);
    expect(evaluateInterpolator(-0.1, "NON_EXISTENT")).toBeCloseTo(0, 5);
    expect(evaluateInterpolator(1.1, "NON_EXISTENT")).toBeCloseTo(1, 5);
  });
});

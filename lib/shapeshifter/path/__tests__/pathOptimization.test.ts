/**
 * Regression tests for simplifyPath / optimizePath.
 *
 * Pins the curve-aware simplification contract: simplification operates on
 * de Casteljau-flattened on-curve samples (Ramer–Douglas–Peucker) and rebuilds
 * M/L(/Z) commands — it must NEVER treat Bézier control points as polyline
 * vertices. The old implementation mapped each command's raw points array and
 * dropped interior points closer than tolerance to the last kept point, which
 * deleted cp2 from every cubic ("M0 20 C5 0 15 0 20 20" + simplify(12) became
 * "M0 20 C5 0 20 20" and its flattened sample count collapsed 11 → 2).
 */

import { describe, expect, it } from "vitest";
import { parsePath, pathToString } from "../pathDataIO";
import { flattenPathData } from "../pathGeometry";
import { optimizePath, simplifyPath } from "../pathOptimization";

describe("simplifyPath", () => {
  it("never drops control points of a cubic — geometry survives simplification", () => {
    const hump = parsePath("M0 20 C5 0 15 0 20 20");
    const simplified = parsePath(pathToString(simplifyPath(hump, 12)));

    // The hump must remain a hump: a sample well inside the curve stays

    const afterSamples = flattenPathData(simplified)[0].points.length;
    expect(afterSamples).toBeGreaterThan(2);

    // Curve apex (~x=10) must stay near y≈5, not fall to the chord (y≈20).
    const apex = flattenPathData(simplified)[0].points.find((p) => p.x > 8 && p.x < 12)!;
    expect(apex.y).toBeLessThan(12);
  });

  it("reduces collinear/dense polylines to the minimal M/L pair", () => {
    const line = parsePath("M0 0 L5 1 L10 2 L15 3");
    expect(pathToString(simplifyPath(line, 0.5))).toBe("M0 0 L15 3");
  });

  it("shrinks a dense noisy closed path while preserving closure and shape", () => {
    let d = "M50 10";
    const count = 60;
    for (let i = 1; i <= count; i++) {
      const angle = ((i - 1) / count) * Math.PI * 2;
      d += ` L${(50 + Math.cos(angle) * 40).toFixed(3)} ${(50 + Math.sin(angle) * 40).toFixed(3)}`;
    }
    d += " Z";
    const dense = parsePath(d);

    const simplified = simplifyPath(dense, 1);
    const commands = simplified.subPaths[0].commands;
    expect(commands.length).toBeLessThan(dense.subPaths[0].commands.length);
    expect(commands.at(-1)?.type).toBe("Z");

    // Shape fidelity: all surviving vertices stay on/near the original circle.
    for (const command of commands) {
      const [p] = command.points;
      if (!p) continue;
      const radius = Math.hypot(p.x - 50, p.y - 50);
      if (radius > 0.001) expect(Math.abs(radius - 40)).toBeLessThanOrEqual(2);
    }
  });

  it("preserves arcs through simplification (A commands flatten via arcParams)", () => {
    const circle = parsePath("M12 2 A10 10 0 1 1 11.99 2 Z");
    const simplified = simplifyPath(circle, 0.75);
    // The simplified outline must still enclose the center.
    const bounds = flattenPathData(simplified)[0].points;
    const xs = bounds.map((p) => p.x);
    const ys = bounds.map((p) => p.y);
    expect(Math.min(...xs)).toBeLessThanOrEqual(3);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(21);
    expect(Math.min(...ys)).toBeLessThanOrEqual(3);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(21);
  });

  it("leaves already-minimal paths untouched", () => {
    const triangle = parsePath("M0 0 L10 0 L10 10");
    expect(pathToString(simplifyPath(triangle, 0.25))).toBe("M0 0 L10 0 L10 10");
  });
});

describe("optimizePath", () => {
  it("smooths without resurrecting the control-point deletion bug", () => {
    const hump = parsePath("M0 20 C5 0 15 0 20 20");
    const optimized = parsePath(pathToString(optimizePath(hump, 12)));
    const apex = flattenPathData(optimized)[0].points.find((p) => p.x > 8 && p.x < 12)!;
    expect(apex.y).toBeLessThan(15);
  });
});

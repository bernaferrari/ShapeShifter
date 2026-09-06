/**
 * Regression tests for the paint/fill pipeline (pathToPolygons /
 * isPointInFillRegion / booleanCombine).
 *
 * Pins arc awareness: imported icons keep arcs as first-class A commands with
 * their real geometry in `arcParams` (see pathDataIO), and circles are routinely
 * arc-based. The old pathToPolygons fell into a generic else branch that pushed
 * only the endpoint for A, degenerating every circular region toward its chord
 * so paint-bucket clicks well inside a visible circle classified as outside.
 */

import { describe, expect, it } from "vitest";
import { parsePath } from "../pathDataIO";
import { booleanCombine, isPointInFillRegion, pathToPolygons } from "../booleanOperations";

describe("pathToPolygons", () => {
  it("flattens A commands via arcParams instead of pushing only the endpoint", () => {
    // Circle centered at (12,12), radius 10, drawn as two arcs.
    const circle = parsePath("M12 2 A10 10 0 1 1 11.99 2 Z");
    const [polygon] = pathToPolygons(circle);

    expect(polygon.length).toBeGreaterThan(8);
    const xs = polygon.map((p) => p.x);
    const ys = polygon.map((p) => p.y);
    expect(Math.min(...xs)).toBeLessThanOrEqual(2.5);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(21.5);
    expect(Math.min(...ys)).toBeLessThanOrEqual(2.5);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(21.5);
  });

  it("still handles line-only subpaths (L/H/V) unchanged", () => {
    const square = parsePath("M0 0 L10 0 L10 10 L0 10 Z");
    const [polygon] = pathToPolygons(square);
    expect(polygon).toHaveLength(4);
  });
});

describe("isPointInFillRegion (paint bucket)", () => {
  it("classifies points inside an arc-drawn circle as inside the fill region", () => {
    const circle = parsePath("M12 2 A10 10 0 1 1 11.99 2 Z");
    expect(isPointInFillRegion({ x: 12, y: 12 }, circle)).toBe(true);
    expect(isPointInFillRegion({ x: 6, y: 12 }, circle)).toBe(true);
    expect(isPointInFillRegion({ x: 18, y: 12 }, circle)).toBe(true);
    expect(isPointInFillRegion({ x: 25, y: 25 }, circle)).toBe(false);
    expect(isPointInFillRegion({ x: -1, y: -1 }, circle)).toBe(false);
  });

  it("keeps hole parity for mixed arc/line subpaths", () => {
    // Outer square + circular hole centered at (17,12) (two half arcs).
    const plate = parsePath("M0 0 L24 0 L24 24 L0 24 Z M12 12 A5 5 0 1 1 22 12 A5 5 0 1 1 12 12 Z");
    expect(isPointInFillRegion({ x: 3, y: 3 }, plate)).toBe(true); // ring
    expect(isPointInFillRegion({ x: 17, y: 12 }, plate)).toBe(false); // hole center
    expect(isPointInFillRegion({ x: 30, y: 30 }, plate)).toBe(false);
  });
});

describe("booleanCombine", () => {
  it("detects containment of an arc circle inside a square for subtract", () => {
    const square = parsePath("M-5 -5 L29 -5 L29 29 L-5 29 Z");
    const circle = parsePath("M12 2 A10 10 0 1 1 11.99 2 Z");
    const result = booleanCombine("subtract", square, circle);
    // Square minus centered circle → two subpaths (outer + reversed hole).
    expect(result.subPaths).toHaveLength(2);
    // The hole boundary must be sampled around the full circle, not a chord.
    const holeCommands = result.subPaths[1].commands.length;
    expect(holeCommands).toBeGreaterThan(4);
  });

  it("unions disjoint shapes exactly", () => {
    const first = parsePath("M0 0 L10 0 L10 10 L0 10 Z");
    const second = parsePath("M20 20 L30 20 L30 30 L20 30 Z");
    const result = booleanCombine("union", first, second);
    expect(result.subPaths).toHaveLength(2);
  });

  it("returns empty for a disjoint intersection instead of the first operand", () => {
    const first = parsePath("M0 0 L10 0 L10 10 L0 10 Z");
    const second = parsePath("M20 20 L30 20 L30 30 L20 30 Z");
    const result = booleanCombine("intersect", first, second);
    expect(result.subPaths).toHaveLength(0);
  });

  it("returns empty when subtracting a containing shape from a contained shape", () => {
    const inner = parsePath("M5 5 L10 5 L10 10 L5 10 Z");
    const outer = parsePath("M0 0 L20 0 L20 20 L0 20 Z");
    const result = booleanCombine("subtract", inner, outer);
    expect(result.subPaths).toHaveLength(0);
  });
});

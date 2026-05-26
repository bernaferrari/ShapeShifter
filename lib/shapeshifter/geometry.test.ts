import { describe, it, expect } from "vitest";
import { isSubPathClockwise, getPoleOfInaccessibility, getCommandArea, arcToBeziers } from "./geometry";
import { parsePath } from "./pathUtils";

describe("geometry winding (isSubPathClockwise)", () => {
  it("detects clockwise circle / square winding", () => {
    // Clockwise square
    const path = parsePath("M 0 0 L 10 0 L 10 10 L 0 10 Z");
    const subPath = path.subPaths[0];
    expect(subPath).toBeDefined();
    expect(isSubPathClockwise(subPath)).toBe(true);
  });

  it("detects counter-clockwise square winding", () => {
    // Counter-clockwise square
    const path = parsePath("M 0 0 L 0 10 L 10 10 L 10 0 Z");
    const subPath = path.subPaths[0];
    expect(subPath).toBeDefined();
    expect(isSubPathClockwise(subPath)).toBe(false);
  });

  it("handles empty / M paths safely", () => {
    const path = parsePath("M 0 0");
    const subPath = path.subPaths[0];
    expect(subPath).toBeDefined();
    expect(isSubPathClockwise(subPath)).toBe(true);
  });
});

describe("geometry centroid (getPoleOfInaccessibility)", () => {
  it("finds the center of an axis-aligned square", () => {
    const path = parsePath("M 0 0 L 10 0 L 10 10 L 0 10 Z");
    const subPath = path.subPaths[0];
    const pole = getPoleOfInaccessibility(subPath, 0.1);
    expect(pole.x).toBeCloseTo(5, 0);
    expect(pole.y).toBeCloseTo(5, 0);
  });

  it("safely handles open paths", () => {
    const path = parsePath("M 0 0 L 10 10");
    const subPath = path.subPaths[0];
    const pole = getPoleOfInaccessibility(subPath, 0.1);
    expect(pole).toBeDefined();
    expect(Number.isFinite(pole.x)).toBe(true);
    expect(Number.isFinite(pole.y)).toBe(true);
  });
});

describe("arcToBeziers conversion", () => {
  it("converts a standard arc into cubic Bezier segments", () => {
    const beziers = arcToBeziers(0, 0, 5, 5, 0, false, true, 5, 5);
    expect(beziers.length).toBeGreaterThan(0);
    
    // The final segment's endpoint must equal the target coordinate
    const last = beziers.at(-1)!;
    expect(last.to.x).toBeCloseTo(5, 1);
    expect(last.to.y).toBeCloseTo(5, 1);
  });

  it("safely approximates zero-radius arcs as straight cubic lines", () => {
    const beziers = arcToBeziers(0, 0, 0, 0, 0, false, true, 6, 6);
    expect(beziers.length).toBe(1);
    expect(beziers[0].to.x).toBe(6);
    expect(beziers[0].to.y).toBe(6);
  });
});

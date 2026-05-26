import { describe, it, expect } from "vitest";
import { isSubPathClockwise, getPoleOfInaccessibility, getCommandArea } from "./geometry";
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

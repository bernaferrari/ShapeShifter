import { describe, expect, it } from "vitest";
import { normalizePathData, parsePath, pathLength, pathToString } from "../../pathUtils";
import type { PathData, Point } from "../../types";
import { trimPathData } from "../pathTrim";

function expectPoint(actual: Point | undefined, x: number, y: number, precision = 7) {
  expect(actual).toBeDefined();
  expect(actual!.x).toBeCloseTo(x, precision);
  expect(actual!.y).toBeCloseTo(y, precision);
}

function freezeGeometry(path: PathData) {
  for (const subPath of path.subPaths) {
    for (const command of subPath.commands) {
      for (const point of command.points) Object.freeze(point);
      Object.freeze(command.points);
      if (command.arcParams) Object.freeze(command.arcParams);
      Object.freeze(command);
    }
    Object.freeze(subPath.commands);
    Object.freeze(subPath);
  }
  Object.freeze(path.subPaths);
  Object.freeze(path);
  return path;
}

describe("Android path trim geometry", () => {
  it("extracts a line by measured length without mutating the source", () => {
    const source = freezeGeometry(parsePath("M0 0 L10 0"));
    const before = structuredClone(source);
    const result = trimPathData(source, 0.2, 0.8);
    expect(pathToString(result)).toBe("M2 0 L8 0");
    expect(source).toEqual(before);
  });

  it("includes the closing edge in length but leaves extracted stroke geometry open", () => {
    const source = parsePath("M0 0 L10 0 L10 10 L0 10 Z");
    const result = trimPathData(source, 0, 0.875);
    expect(pathToString(result)).toBe("M0 0 L10 0 L10 10 L0 10 L0 5");
    expect(result.subPaths[0]!.commands.some((command) => command.type === "Z")).toBe(false);
    expect(pathLength(result)).toBe(35);
  });

  it.each([0, 0.25, -0.25, 2.25])(
    "retains the whole original path for full range with offset %s",
    (offset) => {
      const source = parsePath("M0 0 L10 0 Z M20 0 L30 0");
      expect(trimPathData(source, 0, 1, offset)).toBe(source);
    },
  );

  it.each([0, 0.5, 1])("returns no geometry for equal endpoints %s", (value) => {
    const source = parsePath("M0 0 L10 0 L10 10 Z");
    expect(trimPathData(source, value, value, 0.25).subPaths).toEqual([]);
  });

  it("does not paint a zero-length contour or an empty path", () => {
    expect(trimPathData(parsePath("M5 5 L5 5 Z"), 0.2, 0.8).subPaths).toEqual([]);
    expect(trimPathData({ subPaths: [] }, 0.2, 0.8).subPaths).toEqual([]);
  });

  it("starts wrapped tail and head ranges with separate moves without a connector", () => {
    const source = parsePath("M0 0 L10 0 L10 10 L0 10 Z");
    const result = trimPathData(source, 0.75, 0.25);
    expect(result.subPaths).toHaveLength(2);
    expect(result.subPaths.map((subPath) => subPath.commands[0]!.type)).toEqual(["M", "M"]);
    expect(pathToString(result)).toBe("M0 10 L0 0 M0 0 L10 0");
    expect(pathLength(result)).toBe(20);
  });

  it("trims only the first measurable contour while a full range retains all contours", () => {
    const source = parsePath("M0 0 L10 0 M100 0 L200 0");
    expect(pathToString(trimPathData(source, 0.2, 0.8))).toBe("M2 0 L8 0");
    expect(trimPathData(source)).toBe(source);
    expect(trimPathData(source).subPaths).toHaveLength(2);
  });

  it("skips leading empty and zero-length contours like native PathMeasure", () => {
    const source = parsePath("M0 0 M5 5 L5 5 Z M10 0 L20 0 M100 0 L200 0");
    expect(pathToString(trimPathData(source, 0.2, 0.8))).toBe("M12 0 L18 0");
  });

  it("ends the measured contour at close even if another command follows in that SubPath", () => {
    const source = parsePath("M0 0 L10 0 Z L20 0");
    expect(source.subPaths).toHaveLength(1);
    expect(pathToString(trimPathData(source, 0, 0.75))).toBe("M0 0 L10 0 L5 0");
  });

  it("ends the measured contour at an internal move after drawn geometry", () => {
    const first = parsePath("M0 0 L10 0").subPaths[0]!;
    const second = parsePath("M100 0 L200 0").subPaths[0]!;
    const source: PathData = { subPaths: [{ commands: [...first.commands, ...second.commands] }] };
    expect(pathToString(trimPathData(source, 0.2, 0.8))).toBe("M2 0 L8 0");
  });

  it("uses signed remainder then segment clipping for negative offsets", () => {
    const source = parsePath("M0 0 L10 0");
    const result = trimPathData(source, 0.2, 0.8, -0.5);
    expect(result.subPaths).toHaveLength(1);
    expectPoint(result.subPaths[0]!.commands[0]!.points[0], 0, 0);
    expectPoint(result.subPaths[0]!.commands[1]!.points[0], 3, 0);
    expect(trimPathData(source, 0.2, 0.4, -0.5).subPaths).toEqual([]);
  });

  it("splits a symmetric cubic at half its length while preserving cubic handles", () => {
    const source = parsePath("M0 0 C0 10 10 10 10 0");
    const prefix = trimPathData(source, 0, 0.5).subPaths[0]!.commands;
    expect(prefix.map((command) => command.type)).toEqual(["M", "C"]);
    expectPoint(prefix[1]!.points[0], 0, 5);
    expectPoint(prefix[1]!.points[1], 2.5, 7.5);
    expectPoint(prefix[1]!.points[2], 5, 7.5);
    const suffix = trimPathData(source, 0.5, 1).subPaths[0]!.commands;
    expectPoint(suffix[0]!.points[0], 5, 7.5);
    expectPoint(suffix[1]!.points[0], 7.5, 7.5);
    expectPoint(suffix[1]!.points[1], 10, 5);
    expectPoint(suffix[1]!.points[2], 10, 0);
  });

  it("splits a quadratic without replacing it with line segments", () => {
    const source = parsePath("M0 0 Q5 10 10 0");
    const prefix = trimPathData(source, 0, 0.5).subPaths[0]!.commands;
    expect(prefix.map((command) => command.type)).toEqual(["M", "Q"]);
    expectPoint(prefix[1]!.points[0], 2.5, 5);
    expectPoint(prefix[1]!.points[1], 5, 5);
  });

  it("uses length fractions rather than parameter fractions for uneven cubic speed", () => {
    // x(t)=10t³: half length lands at x=5, whereas t=.5 would land at x=1.25.
    const source = parsePath("M0 0 C0 0 0 0 10 0");
    const prefix = trimPathData(source, 0, 0.5);
    expect(prefix.subPaths[0]!.commands[1]!.type).toBe("C");
    expectPoint(prefix.subPaths[0]!.commands[1]!.points[2], 5, 0);
    expect(pathLength(prefix)).toBeCloseTo(5, 7);
  });

  it("retains arc curvature through the shared cubic normalization", () => {
    const source = parsePath("M0 0 A10 10 0 0 1 10 10");
    const normalized = normalizePathData(source);
    const result = trimPathData(source, 0, 0.5);
    expect(result.subPaths[0]!.commands.some((command) => command.type === "C")).toBe(true);
    expect(result.subPaths[0]!.commands.some((command) => command.type === "A")).toBe(false);
    expect(pathToString(result)).toBe(pathToString(trimPathData(normalized, 0, 0.5)));
    expect(pathLength(result, 0.0001) / pathLength(normalized, 0.0001)).toBeCloseTo(0.5, 5);
  });

  it("reuses an unchanged immutable input and recalculates after replacement geometry", () => {
    const source = parsePath("M0 0 L10 0");
    const result = trimPathData(source, 0.2, 0.8);
    expect(trimPathData(source, 0.2, 0.8)).toBe(result);
    const edited = structuredClone(source);
    edited.subPaths[0]!.commands[1]!.points[0]!.x = 20;
    expect(pathToString(trimPathData(edited, 0.2, 0.8))).toBe("M4 0 L16 0");
    expect(pathToString(result)).toBe("M2 0 L8 0");
    expect(pathToString(trimPathData(source, 0.1, 0.9))).toBe("M1 0 L9 0");
  });

  it("rejects nonfinite derived measurements from extreme finite imported controls", () => {
    const source = parsePath("M0 0 C1e308 0 -1e308 0 1e308 0");
    expect(source.subPaths[0]!.commands[1]!.points.every((point) => Number.isFinite(point.x))).toBe(
      true,
    );
    expect(trimPathData(source, 0.2, 0.8).subPaths).toEqual([]);
  });

  it("rejects an overflowing total contour length even when each segment length is finite", () => {
    const source = parsePath("M0 0 L1e308 0 L0 0 L1e308 0");
    expect(trimPathData(source, 0, 0.8).subPaths).toEqual([]);
  });

  it("rejects overflowing derived trim positions rather than emitting invalid geometry", () => {
    const source = parsePath("M0 0 C0 10 10 10 10 0");
    expect(trimPathData(source, 1e308, 0.8, 1e308).subPaths).toEqual([]);
  });
});

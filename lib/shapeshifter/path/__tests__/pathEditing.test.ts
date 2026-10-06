/**
 * Regression tests for changeCommandType.
 *
 * Pins the H/V contract: the old implementation fabricated malformed commands
 * (points [{x:endX, y:0}] / [{x:0, y:endY}]). pathToString emits both
 * coordinates for any non-Z/A command and parsePath has no native H/V form, so
 * those fabrications serialized as e.g. "M10 10 H30 0 L30 30" — which reparsed
 * with a phantom segment back to x=0, corrupting saved data, winding sums, and
 * bounds. Every type conversion must now round-trip stably through
 * parsePath(pathToString(cmd)) and preserve the segment endpoint.
 */

import { describe, expect, it } from "vitest";
import {
  changeCommandType,
  translatePathPoints,
  splitPointNear,
  updateCommandPoint,
  splitCommandAt,
  deleteCommand,
} from "../pathEditing";
import { shiftPath, getAccuratePathBounds, pathLength } from "../../pathUtils";
import { parsePath, pathToString } from "../pathDataIO";

const roundTrip = (d: string) => pathToString(parsePath(d));

describe("changeCommandType", () => {
  it("L → H produces well-formed data that round-trips without a phantom segment", () => {
    const triangle = parsePath("M 10 10 L 30 10 L 30 30");
    const converted = changeCommandType(triangle, 0, 1, "H");

    const d = pathToString(converted);
    expect(d).not.toMatch(/H\d+ 0/); // the old fabricated "H30 0"
    expect(roundTrip(d)).toBe(d);

    // Geometry preserved: same three endpoints, no extra command.
    const reparsed = parsePath(d);
    const points = reparsed.subPaths[0].commands.map((c) => c.points.at(-1));
    expect(points).toEqual([
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
    ]);
  });

  it("L → V resolves against the pen position, not y=0", () => {
    const path = parsePath("M 10 10 L 30 25");
    const converted = changeCommandType(path, 0, 1, "V");

    const d = pathToString(converted);
    expect(d).not.toMatch(/V0 \d/); // no fabricated {x:0, ...} leaking into "V"
    expect(roundTrip(d)).toBe(d);

    // Vertical line from the pen (10,10): x stays at pen x.
    const [point] = converted.subPaths[0].commands[1].points;
    expect(point.x).toBe(10);
    expect(point.y).toBe(25);
  });

  it("C → H keeps only the endpoint (control points are not vertices)", () => {
    const curve = parsePath("M 0 0 C 5 5 10 5 15 0");
    const converted = changeCommandType(curve, 0, 1, "H");

    const d = pathToString(converted);
    expect(roundTrip(d)).toBe(d);
    const [point] = converted.subPaths[0].commands[1].points;
    expect(point).toEqual({ x: 15, y: 0 });
  });

  it("H → C creates a valid gentle cubic that round-trips", () => {
    const path = parsePath("M 0 0 L 20 0");
    const converted = changeCommandType(path, 0, 1, "C");

    const d = pathToString(converted);
    expect(converted.subPaths[0].commands[1].type).toBe("C");
    expect(roundTrip(d)).toBe(d);

    const [, cp1, cp2, end] = [null, ...converted.subPaths[0].commands[1].points];
    expect(end).toEqual({ x: 20, y: 0 });
    expect(cp1.y).toBe(0);
    expect(cp2.y).toBe(0);
  });

  it("every convertible type survives the serialize/parse round trip", () => {
    const base = parsePath("M 5 8 L 24 26");
    for (const type of ["L", "C", "Q", "S", "T", "A", "H", "V"] as const) {
      const d = pathToString(changeCommandType(base, 0, 1, type));
      if (!d.includes(type)) continue; // e.g. normalized-away shorthands
      expect(roundTrip(d), `type ${type}`).toBe(d);
      const end = parsePath(d).subPaths[0].commands[1].points.at(-1)!;
      expect(end, `type ${type} endpoint`).toEqual({ x: 24, y: 26 });
    }
  });
});

describe("anchor and tangent translation", () => {
  const point = (commandIndex: number, pointIndex: number) => ({
    subPathIndex: 0,
    commandIndex,
    pointIndex,
  });
  const curve = () => parsePath("M0 0 C3 0 7 0 10 0 C13 0 17 0 20 0");
  it("moves both attached cubic handles while preserving unselected tangent offsets", () => {
    const source = curve();
    const moved = translatePathPoints(source, [point(1, 2)], 2, 3);
    expect(moved.subPaths[0].commands[1].points).toEqual([
      { x: 3, y: 0 },
      { x: 9, y: 3 },
      { x: 12, y: 3 },
    ]);
    expect(moved.subPaths[0].commands[2].points).toEqual([
      { x: 15, y: 3 },
      { x: 17, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(source.subPaths[0].commands[1].points[2]).toEqual({ x: 10, y: 0 });
  });
  it("moves the first anchor's outgoing handle and leaves direct handle editing independent", () => {
    const first = translatePathPoints(curve(), [point(0, 0)], 2, 3);
    expect(first.subPaths[0].commands[1].points).toEqual([
      { x: 5, y: 3 },
      { x: 7, y: 0 },
      { x: 10, y: 0 },
    ]);
    const control = translatePathPoints(curve(), [point(1, 0)], 2, 3);
    expect(control.subPaths[0].commands[0].points[0]).toEqual({ x: 0, y: 0 });
    expect(control.subPaths[0].commands[1].points).toEqual([
      { x: 5, y: 3 },
      { x: 7, y: 0 },
      { x: 10, y: 0 },
    ]);
  });
  it("deduplicates handles explicitly selected alongside their anchors and neighboring anchors", () => {
    const moved = translatePathPoints(
      curve(),
      [point(0, 0), point(1, 2), point(1, 0), point(1, 1), point(2, 0), point(1, 2)],
      2,
      3,
    );
    expect(moved.subPaths[0].commands[1].points).toEqual([
      { x: 5, y: 3 },
      { x: 9, y: 3 },
      { x: 12, y: 3 },
    ]);
    expect(moved.subPaths[0].commands[2].points[0]).toEqual({ x: 15, y: 3 });
  });
  it.each([0, 2])(
    "keeps both copies of a closed curve's seam anchor and its handles together from command %s",
    (index) => {
      const closed = parsePath("M0 0 C3 0 7 0 10 0 C7 5 3 5 0 0 Z");
      const moved = translatePathPoints(closed, [point(index, index === 0 ? 0 : 2)], 2, 3);
      expect(moved.subPaths[0].commands[0].points[0]).toEqual({ x: 2, y: 3 });
      expect(moved.subPaths[0].commands[1].points[0]).toEqual({ x: 5, y: 3 });
      expect(moved.subPaths[0].commands[2].points[1]).toEqual({ x: 5, y: 8 });
      expect(moved.subPaths[0].commands[2].points[2]).toEqual({ x: 2, y: 3 });
    },
  );
  it("keeps a plain Z edge's previous anchor independent", () => {
    const closed = parsePath("M0 0 C3 0 7 0 10 0 Z");
    const moved = translatePathPoints(closed, [point(0, 0)], 2, 3);
    expect(moved.subPaths[0].commands[1].points[1]).toEqual({ x: 7, y: 0 });
    expect(moved.subPaths[0].commands[1].points[2]).toEqual({ x: 10, y: 0 });
  });
  it("translates a shared quadratic handle once when both endpoints are selected", () => {
    const source = parsePath("M0 0 Q5 5 10 0");
    const moved = translatePathPoints(source, [point(0, 0), point(1, 1)], 2, 3);
    expect(moved.subPaths[0].commands[1].points).toEqual([
      { x: 7, y: 8 },
      { x: 12, y: 3 },
    ]);
  });
});

describe("safe point insertion", () => {
  it("adds a fourth and fifth anchor to a triangle's closing edge without changing its outline", () => {
    const triangle = parsePath("M0 0 L10 0 L10 10 Z");
    const fourth = splitPointNear(triangle, { x: 7.5, y: 7.5 })!;
    expect(fourth).not.toBeNull();
    expect(fourth.subPaths[0].commands).toHaveLength(5);
    expect(fourth.subPaths[0].commands[3].points[0]).toEqual({ x: 7.5, y: 7.5 });
    const fifth = splitPointNear(fourth, { x: 2.5, y: 2.5 })!;
    expect(fifth.subPaths[0].commands).toHaveLength(6);
    expect(fifth.subPaths[0].commands.at(-1)?.type).toBe("Z");
  });
  it("inserts at the clicked position rather than the midpoint or a phantom origin-to-M edge", () => {
    const line = parsePath("M100 100 L200 100");
    const result = splitPointNear(line, { x: 125, y: 100 })!;
    expect(result.subPaths[0].commands[1].points[0]).toEqual({ x: 125, y: 100 });
  });
  it("ignores stale point indices and non-finite coordinate drafts without throwing or mutating geometry", () => {
    const path = parsePath("M0 0 L10 0");
    expect(updateCommandPoint(path, 3, 8, 2, { x: 10, y: 10 })).toBe(path);
    expect(updateCommandPoint(path, 0, 1, 0, { x: NaN, y: 10 })).toBe(path);
  });
});

describe("appearance preserving point remapping", () => {
  it("shifts anchors with their curves rather than rotating control points into anchors", () => {
    const path = parsePath("M0 0 C2 12 8 12 10 0 L10 10 Z");
    const shifted = shiftPath(path, 1);
    expect(getAccuratePathBounds(shifted)).toEqual(getAccuratePathBounds(path));
    expect(pathLength(shifted, 0.001)).toBeCloseTo(pathLength(path, 0.001), 6);
  });
});

describe("curves, duplicate anchors and degenerate editing", () => {
  it.each([0.2, 0.5, 0.8])(
    "subdivides chained smooth curves at %s without changing adjacent geometry",
    (t) => {
      for (const source of [
        "M0 0 C2 10 8 10 10 0 S18 -10 20 0 S28 10 30 0",
        "M0 0 Q5 10 10 0 T20 0 T30 0",
      ]) {
        const path = parsePath(source);
        const split = splitCommandAt(path, 0, 2, t);
        expect(getAccuratePathBounds(split)).toEqual(getAccuratePathBounds(path));
        expect(pathLength(split, 0.0001)).toBeCloseTo(pathLength(path, 0.0001), 4);
      }
    },
  );
  it("allows coincident line anchors to move independently for later morph poses", () => {
    const path = parsePath("M0 0 L10 0 L0 0 Z");
    const moved = translatePathPoints(
      path,
      [{ subPathIndex: 0, commandIndex: 2, pointIndex: 0 }],
      0,
      5,
    );
    expect(moved.subPaths[0].commands[0].points[0]).toEqual({ x: 0, y: 0 });
    expect(moved.subPaths[0].commands[2].points[0]).toEqual({ x: 0, y: 5 });
  });
  it("deletes the start anchor by promoting the next vertex, and safely empties a single-point path", () => {
    expect(pathToString(deleteCommand(parsePath("M0 0 L10 0 L10 10 Z"), 0, 0))).toBe(
      "M10 0 L10 10 Z",
    );
    expect(deleteCommand(parsePath("M0 0 Z"), 0, 0).subPaths).toEqual([]);
  });
  it("elevates a quadratic to a cubic with the same outline", () => {
    const path = parsePath("M0 0 Q5 10 10 0");
    const cubic = changeCommandType(path, 0, 1, "C");
    expect(getAccuratePathBounds(cubic)).toEqual(getAccuratePathBounds(path));
    expect(pathLength(cubic, 0.0001)).toBeCloseTo(pathLength(path, 0.0001), 4);
  });
});

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
import { changeCommandType, translatePathPoints } from "../pathEditing";
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

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
import { changeCommandType } from "../pathEditing";
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

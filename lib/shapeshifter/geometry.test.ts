import { describe, it, expect } from "vitest";
import { isSubPathClockwise, getCommandArea, getPoleOfInaccessibility, arcToBeziers } from "./geometry";
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

  it("detects clockwise square offset from the origin (Z closes to subpath start, not origin)", () => {
    // Regression: Z's endpoint used to resolve to {0,0}, making winding
    // detection position-dependent (this exact input reported CCW).
    const path = parsePath("M 100 100 L 140 100 L 140 140 L 100 140 Z");
    const subPath = path.subPaths[0];
    expect(subPath).toBeDefined();
    expect(isSubPathClockwise(subPath)).toBe(true);
  });

  it("detects counter-clockwise square offset from the origin", () => {
    const path = parsePath("M 100 100 L 100 140 L 140 140 L 140 100 Z");
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

  it("winding is translation-invariant for open subpaths", () => {
    for (const dx of [-500, 0, 500]) {
      for (const dy of [-500, 0, 500]) {
        const d = `M ${5 + dx} ${-7 + dy} L ${15 + dx} ${-7 + dy} L ${15 + dx} ${3 + dy} L ${5 + dx} ${3 + dy}`;
        expect(isSubPathClockwise(parsePath(d).subPaths[0])).toBe(true);
      }
    }
  });

  it("uses the exact Green integral for cubic curves, not a chord approximation", () => {
    // M 0 0 C -4 -4 4 -4 5 5 dips below its chord: the exact un-halved
    // Green integral is +33.6 (CW). A chord/trapezoid approximation can
    // misreport this shape's winding.
    const loop = parsePath("M 0 0 C -4 -4 4 -4 5 5").subPaths[0];
    expect(isSubPathClockwise(loop)).toBe(true);

    // Mirror image across the x-axis: exact integral -33.6 (CCW).
    const mirrored = parsePath("M 0 0 C -4 4 4 4 5 -5").subPaths[0];
    expect(isSubPathClockwise(mirrored)).toBe(false);
  });

  it("mixed-command subpaths sum consistently: pure-L matches C-decomposed edges", () => {
    // The same closed square expressed with straight lines vs. each edge
    // rewritten as a degenerate (collinear-control) cubic must produce the
    // same winding: every segment type shares one exact ∮(x dy − y dx)
    // convention. Under the old mixed normalization the L edges used the
    // trapezoid form while curves used the full integral.
    const asLines = parsePath("M 2 1 L 12 1 L 12 11 L 2 11 Z").subPaths[0];
    const asCubics = parsePath(
      "M 2 1 C 5.3333333 1 8.6666667 1 12 1 C 12 4.3333333 12 7.6666667 12 11 C 8.6666667 11 5.3333333 11 2 11 C 2 7.6666667 2 4.3333333 2 1 Z",
    ).subPaths[0];
    expect(isSubPathClockwise(asLines)).toBe(true);
    expect(isSubPathClockwise(asCubics)).toBe(true);

    // Counter-clockwise variants agree too.
    const ccwLines = parsePath("M 2 1 L 2 11 L 12 11 L 12 1 Z").subPaths[0];
    const ccwCubics = parsePath(
      "M 2 1 C 2 4.3333333 2 7.6666667 2 11 C 5.3333333 11 8.6666667 11 12 11 C 12 7.6666667 12 4.3333333 12 1 C 8.6666667 1 5.3333333 1 2 1 Z",
    ).subPaths[0];
    expect(isSubPathClockwise(ccwLines)).toBe(false);
    expect(isSubPathClockwise(ccwCubics)).toBe(false);
  });

  it("L edges and the implicit closing edge use the exact line-segment Green term", () => {
    // Regression: straight edges used the trapezoid form (x0+x3)(y3-y0),
    // which differs from the exact x0*y3 - x3*y0 term by x3*y3 - x0*y0
    // per edge. For M 0 0 C -30 10 40 15 8 24 L 10 32 Z that error
    // (-104 across the L + closing edges) flips the winding:
    // exact total = +25 (CW) but trapezoid total = -79 (CCW).
    const path = parsePath("M 0 0 C -30 10 40 15 8 24 L 10 32 Z").subPaths[0];
    expect(isSubPathClockwise(path)).toBe(true);

    // Mirror across the x-axis flips the sign of every term.
    const mirrored = parsePath("M 0 0 C -30 -10 40 -15 8 -24 L 10 -32 Z").subPaths[0];
    expect(isSubPathClockwise(mirrored)).toBe(false);
  });

  it("mixed-command signed-area magnitudes agree between pure-L and C-decomposed edges", () => {
    // Beyond winding sign: the total ∮(x dy − y dx) over the closed square
    // must be identical (within float tolerance) whether each straight edge
    // is an L command or an equivalent degenerate cubic with controls at
    // thirds — including the implicit closing edge.
    const sumArea = (d: string) => {
      const sub = parsePath(d).subPaths[0];
      let current = sub.commands[0].points[0];
      let total = 0;
      sub.commands.forEach((cmd) => {
        total += getCommandArea(cmd, current);
        if (cmd.points.length > 0) current = cmd.points[cmd.points.length - 1];
      });
      // Closing edge back to start, same term as isSubPathClockwise.
      const first = sub.commands[0].points[0];
      total += current.x * first.y - first.x * current.y;
      return total;
    };
    const asLines = sumArea("M 2 1 L 12 1 L 12 11 L 2 11 Z");
    const asCubics = sumArea(
      "M 2 1 C 5.3333333 1 8.6666667 1 12 1 C 12 4.3333333 12 7.6666667 12 11 C 8.6666667 11 5.3333333 11 2 11 C 2 7.6666667 2 4.3333333 2 1 Z",
    );
    expect(asLines).toBeCloseTo(200, 4); // exact shoelace value of the square
    expect(asCubics).toBeCloseTo(asLines, 4);

    // Mixed commands inside one subpath: two L edges + one degenerate cubic
    // decomposing the fourth edge still reproduce the same total.
    const mixed = sumArea(
      "M 2 1 L 12 1 L 12 11 C 8.6666667 11 5.3333333 11 2 11 Z",
    );
    expect(mixed).toBeCloseTo(200, 4);
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

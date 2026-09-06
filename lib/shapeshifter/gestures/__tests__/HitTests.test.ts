import { describe, expect, it } from "vitest";
import { collectPointsInLasso, pointInPolygon } from "../HitTests";
import type { Point } from "../../types";

/**
 * Regression coverage for collectPointsInLasso curve sampling.
 *
 * C commands store [cp1, cp2, end] and Q commands [cp, end] — the segment start is
 * never part of the command. The sampler previously fabricated the start by reusing
 * the command's own endpoint (p0 = p3 = end), sampling a degenerate loop instead of
 * the actual segment. Both failure directions are pinned below:
 *  - a real curve crossing the lasso while both anchors sit outside was missed;
 *  - a curve wholly outside the lasso could produce spurious hits via its
 *    control-point hull region.
 */

const lasso: Point[] = [
  { x: -50, y: -10 },
  { x: 50, y: -10 },
  { x: 50, y: 40 },
  { x: -50, y: 40 },
];

function cubicPath(start: Point, cp1: Point, cp2: Point, end: Point) {
  return {
    subPaths: [
      {
        commands: [
          { type: "M", points: [start] },
          { type: "C", points: [cp1, cp2, end] },
        ],
      },
    ],
  };
}

describe("collectPointsInLasso curve sampling", () => {
  it("selects a cubic whose body crosses the lasso while both anchors sit outside", () => {
    // True curve dips to y≈28.8 inside the box (anchors at y=0, x=±70 stay outside);
    // the old degenerate sampling (p0 = p3) never produced an interior point, so this
    // selection was missed.
    const path = cubicPath({ x: -70, y: 0 }, { x: -20, y: 40 }, { x: 20, y: 40 }, { x: 70, y: 0 });

    const hits = collectPointsInLasso(path, lasso, { sampleCurves: true });

    expect(hits).toContainEqual({ subPathIndex: 0, commandIndex: 1, pointIndex: 2 });
  });

  it("does not select a cubic wholly outside the lasso whose degenerate hull would", () => {
    // Real curve stays far above/right of the lasso; the old p0=p3 loop swung left
    // through the control points and probed the box interior, producing a hit.
    const path = cubicPath(
      { x: 200, y: 150 },
      { x: 100, y: -80 },
      { x: -100, y: 80 },
      { x: 0, y: 0 },
    );
    const probeLasso: Point[] = [
      { x: 10, y: -24 },
      { x: 34, y: -24 },
      { x: 34, y: -8 },
      { x: 10, y: -8 },
    ];

    const hits = collectPointsInLasso(path, probeLasso, { sampleCurves: true });

    expect(hits).toEqual([]);
  });

  it("samples quadratic segments from the previous command's endpoint too", () => {
    // Q body bulges into the box (samples at t=2/4,3/4 land inside); all anchors stay
    // outside. Old degenerate sampling (p0 = end) probed a different loop entirely
    // and missed it.
    const quadBox: Point[] = [
      { x: -25, y: 30 },
      { x: 25, y: 30 },
      { x: 25, y: 60 },
      { x: -25, y: 60 },
    ];
    const path = {
      subPaths: [
        {
          commands: [
            { type: "M", points: [{ x: -60, y: -60 }] },
            {
              type: "Q",
              points: [
                { x: -60, y: 150 },
                { x: 80, y: -20 },
              ],
            },
          ],
        },
      ],
    };

    const hits = collectPointsInLasso(path, quadBox, { sampleCurves: true });

    // hitOnCurve pushes the command's on-curve endpoint (pointIndex = last).
    expect(hits).toContainEqual({ subPathIndex: 0, commandIndex: 1, pointIndex: 1 });
  });

  it("skips curve sampling for a leading C with no previous endpoint but still matches anchors", () => {
    // No previous command exists — there is no defensible start point, so interior
    // samples are skipped rather than fabricated.
    const path = {
      subPaths: [
        {
          commands: [
            {
              type: "C",
              points: [
                { x: 0, y: 0 },
                { x: 10, y: 10 },
                { x: 20, y: 0 },
              ],
            },
          ],
        },
      ],
    };

    // All three stored points lie inside the box and are collected by the anchor
    // pass; no interior samples are added on top.
    expect(collectPointsInLasso(path, lasso, { sampleCurves: true })).toEqual([
      { subPathIndex: 0, commandIndex: 0, pointIndex: 0 },
      { subPathIndex: 0, commandIndex: 0, pointIndex: 1 },
      { subPathIndex: 0, commandIndex: 0, pointIndex: 2 },
    ]);
  });

  it("anchor-only collection is unchanged when sampleCurves is false", () => {
    const path = cubicPath({ x: -50, y: 0 }, { x: -20, y: 40 }, { x: 20, y: 40 }, { x: 50, y: 0 });

    // Only the M anchor sits inside; curve sampling disabled means no endpoint push.
    expect(collectPointsInLasso(path, lasso, { sampleCurves: false })).toEqual([
      { subPathIndex: 0, commandIndex: 0, pointIndex: 0 },
    ]);
  });
});

describe("pointInPolygon", () => {
  it("classifies boundary-adjacent probe points used by the sampler fixtures", () => {
    expect(pointInPolygon({ x: 0, y: 15 }, lasso)).toBe(true);
    expect(pointInPolygon({ x: 0, y: 100 }, lasso)).toBe(false);
  });
});

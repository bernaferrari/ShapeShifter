import { describe, expect, it } from "vitest";
import { parsePath } from "../pathUtils";
import type { Layer } from "../types";
import {
  collectOwnedLayersInRect,
  getOwnedLayerBounds,
  unionOwnedLayerBounds,
  type SceneOwner,
} from "../scene/selection";

const staticLayer = (id: string, overrides: Partial<Layer> = {}): Layer =>
  ({
    id,
    name: id,
    type: "path",
    visible: true,
    locked: false,
    ...overrides,
  }) as Layer;

describe("getOwnedLayerBounds uses analytic Bézier bounds", () => {
  it("captures curve extremes between flatten samples that flattening misses", () => {
    // A cubic whose true extremum (y=1.5 at t=0.5) lies between flatten
    // samples: an adaptively flattened polyline approximates it only within
    // the 0.05 tolerance, while analytic bounds capture it exactly.
    const layer = staticLayer("bulge", {
      from: parsePath("M 0 0 C 1 2, -1 2, 0.0000000001 0 Z"),
    });
    const bounds = getOwnedLayerBounds({
      ownerId: "frame",
      origin: { x: 0, y: 0 },
      layers: [layer],
    });
    expect(bounds).toHaveLength(1);
    // Exact cubic extrema: dy/dt = 6t(t-1), extreme y at t=0.5 → y=1.5.
    expect(bounds[0].bounds.y).toBeCloseTo(0);
    expect(bounds[0].bounds.h).toBeCloseTo(1.5, 5);
  });

  it("matches the analytic bounds under a large magnifying transform where flattening error scales up", () => {
    // The same bulging curve scaled 100×: flattening tolerance (0.05 local units)
    // would miss up to ~5 world units; analytic bounds stay exact.
    const layer = staticLayer("zoomed", {
      scaleX: 100,
      scaleY: 100,
      from: parsePath("M 0 0 C 1 2, -1 2, 0.0000000001 0 Z"),
    });
    const bounds = getOwnedLayerBounds({
      ownerId: "frame",
      origin: { x: 0, y: 0 },
      layers: [layer],
    })[0].bounds;
    expect(bounds.h).toBeCloseTo(150, 3);
  });

  it("transforms the four local AABB corners under rotation instead of transforming samples", () => {
    // Unit square rotated 90° about the origin occupies x∈[-10,0], y∈[0,10].
    const layer = staticLayer("rotated", {
      rotation: 90,
      from: parsePath("M 0 0 L 10 0 L 10 10 L 0 10 Z"),
    });
    const bounds = unionOwnedLayerBounds(
      [{ ownerId: "frame", origin: { x: 0, y: 0 }, layers: [layer] }],
      [{ ownerId: "frame", layerId: "rotated" }],
    );
    expect(bounds?.x).toBeCloseTo(-10);
    expect(bounds?.y).toBeCloseTo(0);
    expect(bounds?.w).toBeCloseTo(10);
    expect(bounds?.h).toBeCloseTo(10);
  });
  it("keeps axis-aligned semantics identical to the previous flattening path for straight-line geometry", () => {
    const layer = staticLayer("square", {
      from: parsePath("M 0 0 L 10 0 L 10 10 L 0 10 Z"),
      strokeColor: "#000",
      strokeWidth: 4,
    });
    const bounds = getOwnedLayerBounds({
      ownerId: "frame",
      origin: { x: 5, y: 7 },
      layers: [layer],
    })[0].bounds;
    expect(bounds.x).toBeCloseTo(3); // origin 5 + local 0 - inset (4/2)
    expect(bounds.y).toBeCloseTo(5);
    expect(bounds.w).toBeCloseTo(14); // 10 + inset*2
    expect(bounds.h).toBeCloseTo(14);
  });

  it("skips nodes whose accurate bounds are empty so marquee collection is unaffected", () => {
    const empty = staticLayer("empty", { from: parsePath("") as Layer["from"] });
    const filled = staticLayer("filled", {
      from: parsePath("M 0 0 L 10 10 L 20 0 Z"),
    });
    const hits = collectOwnedLayersInRect(
      [{ ownerId: "frame", origin: { x: 0, y: 0 }, layers: [empty, filled] }],
      { x: 0, y: 0, w: 30, h: 15 },
    );
    expect(hits).toEqual([{ ownerId: "frame", layerId: "filled" }]);
  });

  it("evaluates base geometry when no timeline blocks drive the layer", () => {
    // With an empty animation the evaluator holds base geometry (`from`);
    // this pins that contract rather than assuming interpolation.
    const layer = staticLayer("morph", {
      from: parsePath("M 0 0 L 10 0 L 10 10 Z"),
      to: parsePath("M 40 40 L 50 40 L 50 50 Z"),
    });
    const owner: SceneOwner = {
      ownerId: "frame",
      origin: { x: 0, y: 0 },
      layers: [layer],
      progress: 1,
      usePlayhead: false,
    };
    expect(unionOwnedLayerBounds([owner], [{ ownerId: "frame", layerId: "morph" }])).toEqual({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
    });
  });
});

describe("unionOwnedLayerBounds skips owners that hold no selection", () => {
  it("does not evaluate scenes for owners with no selected refs", () => {
    const selectedLayer = staticLayer("picked", {
      from: parsePath("M 0 0 L 10 10 L 20 0 Z"),
    });
    const unselectedOwner = {
      ownerId: "idle-frame",
      origin: { x: 0, y: 0 },
      // Invalid geometry would make a full scene evaluation throw; skipping the
      // owner must keep the union working.
      layers: [staticLayer("broken", { from: null as unknown as Layer["from"] })],
    };
    const bounds = unionOwnedLayerBounds(
      [
        unselectedOwner,
        { ownerId: "active-frame", origin: { x: 1, y: 2 }, layers: [selectedLayer] },
      ],
      [{ ownerId: "active-frame", layerId: "picked" }],
    );
    expect(bounds).toEqual({ x: 1, y: 2, w: 20, h: 10 });
  });
});

import { describe, expect, it } from "vitest";
import { getPathDataBounds, parsePath } from "../pathUtils";
import { evaluateAndroidScene } from "../scene/evaluate";
import { hitTestOwnedLayers } from "../scene/hitTest";
import type { Layer } from "../types";

const square = (id: string, parentId?: string): Layer => ({
  id,
  name: id,
  type: "path",
  parentId,
  from: parsePath("M0 0 L10 0 L10 10 L0 10 Z"),
  pathData: parsePath("M0 0 L10 0 L10 10 L0 10 Z"),
  fillColor: "#000000",
  visible: true,
  locked: false,
});

const animation = { id: "motion", name: "Motion", duration: 1000, blocks: [] };

describe("Android scene evaluation", () => {
  it("composes nested group transforms and applies preceding clip paths", () => {
    const clip: Layer = {
      ...square("clip", "group"),
      type: "clipPath",
      from: parsePath("M0 0 L6 0 L6 10 L0 10 Z"),
      pathData: parsePath("M0 0 L6 0 L6 10 L0 10 Z"),
    };
    const layers: Layer[] = [
      {
        id: "group",
        name: "group",
        type: "group",
        from: parsePath(""),
        visible: true,
        locked: false,
        translateX: 20,
        rotation: 0,
      },
      clip,
      square("art", "group"),
    ];
    const scene = evaluateAndroidScene(layers, animation, 0, true);
    const art = scene.nodesById.get("art")!;
    expect(art.worldMatrix.e).toBe(20);
    expect(art.clipNodeIds).toEqual(["clip"]);

    const owners = [{ ownerId: "frame", origin: { x: 0, y: 0 }, layers, animation, progress: 0, usePlayhead: true }];
    expect(hitTestOwnedLayers(owners, { x: 24, y: 5 }, 0.1)).toEqual({ ownerId: "frame", layerId: "art" });
    expect(hitTestOwnedLayers(owners, { x: 28, y: 5 }, 0.1)).toBeNull();
  });

  it("hit-tests the evaluated playhead transform rather than the base position", () => {
    const layer = square("moving");
    const owners = [
      {
        ownerId: "frame",
        origin: { x: 0, y: 0 },
        layers: [layer],
        animation: {
          ...animation,
          blocks: [
            {
              id: "move",
              layerId: "moving",
              propertyName: "translateX",
              type: "number" as const,
              fromValue: 0,
              toValue: 20,
              startTime: 0,
              endTime: 1000,
              interpolator: "LINEAR",
            },
          ],
        },
        progress: 0.5,
        usePlayhead: true,
      },
    ];
    expect(hitTestOwnedLayers(owners, { x: 15, y: 5 }, 0.1)).toEqual({ ownerId: "frame", layerId: "moving" });
    expect(hitTestOwnedLayers(owners, { x: 5, y: 5 }, 0.1)).toBeNull();
  });

  it("uses rendered curve extrema rather than control-polygon bounds", () => {
    const bounds = getPathDataBounds(parsePath("M0 0 C0 100 10 100 10 0"))!;
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.h).toBeCloseTo(75, 0);
  });
});

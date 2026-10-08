import { describe, expect, it, vi } from "vitest";
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

    const owners = [
      {
        ownerId: "frame",
        origin: { x: 0, y: 0 },
        layers,
        animation,
        progress: 0,
        usePlayhead: true,
      },
    ];
    expect(hitTestOwnedLayers(owners, { x: 24, y: 5 }, 0.1)).toEqual({
      ownerId: "frame",
      layerId: "art",
    });
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
    expect(hitTestOwnedLayers(owners, { x: 15, y: 5 }, 0.1)).toEqual({
      ownerId: "frame",
      layerId: "moving",
    });
    expect(hitTestOwnedLayers(owners, { x: 5, y: 5 }, 0.1)).toBeNull();
  });

  it("busts the scene cache when the same Layer[] gets new block values", () => {
    const layer = square("moving");
    const layers = [layer];
    const first = {
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
    };
    const firstScene = evaluateAndroidScene(layers, first, 0.5, true);
    expect(firstScene.nodesById.get("moving")!.transform.translateX).toBe(10);

    const second = {
      ...first,
      blocks: [{ ...first.blocks[0]!, toValue: 40 }],
    };
    const secondScene = evaluateAndroidScene(layers, second, 0.5, true);
    expect(secondScene.nodesById.get("moving")!.transform.translateX).toBe(20);
    expect(secondScene).not.toBe(firstScene);
  });

  it("uses rendered curve extrema rather than control-polygon bounds", () => {
    const bounds = getPathDataBounds(parsePath("M0 0 C0 100 10 100 10 0"))!;
    expect(bounds.y).toBeCloseTo(0);
    expect(bounds.h).toBeCloseTo(75, 0);
  });

  it("captures true Bezier extrema between samples, not just flattened points", () => {
    // Apex of this cubic sits at t≈0.352, y≈42.3164 — strictly above every
    // adaptively flattened sample (old impl reported h≈42.3038).
    const bounds = getPathDataBounds(parsePath("M 0 0 C 20 90 80 10 100 0"))!;
    expect(bounds.h).toBeCloseTo(42.31639838222847, 6);
    // Quadratic apex at t=0.6 is exactly y=7.2; flattening undershoots (7.1875).
    const quad = getPathDataBounds(parsePath("M 0 0 Q 12 12 16 4"))!;
    expect(quad.h).toBeCloseTo(7.2, 6);
  });

  it("promotes children of cyclic parent chains to roots instead of dropping them", () => {
    // a -> b -> a cycle: both entries' parent chains loop, so neither would
    // attach to roots and the whole scene would render blank.
    const layers: Layer[] = [square("a", "b"), square("b", "a"), square("c")];
    const scene = evaluateAndroidScene(layers, animation, 0, true);
    expect(new Set(scene.roots.map(String))).toEqual(new Set(["a", "b", "c"]));
    expect(scene.nodes).toHaveLength(3);
    for (const node of scene.nodes) expect(node.parentId).toBeNull();
  });

  it("breaks self-referencing parents deterministically with a dev-only warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const layers: Layer[] = [square("self", "self")];
    const scene = evaluateAndroidScene(layers, animation, 0, true);
    expect(scene.roots).toEqual(["self"]);
    expect(scene.nodes).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("self");
    warn.mockRestore();
  });

  it("keeps valid hierarchies untouched when no cycle exists", () => {
    const layers: Layer[] = [square("parent"), square("child", "parent")];
    const scene = evaluateAndroidScene(layers, animation, 0, true);
    expect(scene.roots).toEqual(["parent"]);
    const child = scene.nodesById.get("child")!;
    expect(child.parentId).toBe("parent");
    expect(scene.nodesById.get("parent")!.childIds).toEqual(["child"]);
  });
});

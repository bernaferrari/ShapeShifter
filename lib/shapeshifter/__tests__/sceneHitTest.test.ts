import { describe, expect, it } from "vitest";
import { parsePath } from "../pathUtils";
import { hitTestOwnedLayers } from "../scene/hitTest";
import type { SceneOwner } from "../scene/selection";
import type { Layer } from "../types";

const filled = (id: string, translateX = 0): Layer =>
  ({
    id,
    name: id,
    type: "path",
    from: parsePath("M0 0 L10 0 L10 10 L0 10 Z"),
    to: parsePath("M0 0 L10 0 L10 10 L0 10 Z"),
    fillColor: "#000000",
    translateX,
    translateY: 0,
  }) as Layer;

describe("owner scene hit testing", () => {
  it("respects owner and layer paint order", () => {
    const owners: SceneOwner[] = [
      { ownerId: "top", origin: { x: 0, y: 0 }, layers: [filled("top-layer")] },
      { ownerId: "bottom", origin: { x: 0, y: 0 }, layers: [filled("bottom-layer")] },
    ];
    expect(hitTestOwnedLayers(owners, { x: 5, y: 5 }, 1)).toEqual({
      ownerId: "top",
      layerId: "top-layer",
    });
  });

  it("applies owner and layer translations", () => {
    const owners: SceneOwner[] = [
      { ownerId: "frame", origin: { x: 100, y: 20 }, layers: [filled("shape", 5)] },
    ];
    expect(hitTestOwnedLayers(owners, { x: 110, y: 25 }, 1)).toEqual({
      ownerId: "frame",
      layerId: "shape",
    });
    expect(hitTestOwnedLayers(owners, { x: 102, y: 25 }, 1)).toBeNull();
  });

  it("inverts layer scale, rotation, and pivot before path hit testing", () => {
    const transformed = {
      ...filled("shape"),
      translateX: 20,
      pivotX: 5,
      pivotY: 5,
      rotation: 90,
      scaleX: 2,
      scaleY: 1,
    };
    const owners: SceneOwner[] = [
      { ownerId: "frame", origin: { x: 100, y: 20 }, layers: [transformed] },
    ];
    expect(hitTestOwnedLayers(owners, { x: 125, y: 25 }, 1)).toEqual({
      ownerId: "frame",
      layerId: "shape",
    });
    expect(hitTestOwnedLayers(owners, { x: 110, y: 25 }, 1)).toBeNull();
  });

  it("does not hit locked or hidden layers", () => {
    const owners: SceneOwner[] = [
      {
        ownerId: "frame",
        origin: { x: 0, y: 0 },
        layers: [
          { ...filled("hidden"), visible: false },
          { ...filled("locked"), locked: true },
        ],
      },
    ];
    expect(hitTestOwnedLayers(owners, { x: 5, y: 5 }, 1)).toBeNull();
  });
});

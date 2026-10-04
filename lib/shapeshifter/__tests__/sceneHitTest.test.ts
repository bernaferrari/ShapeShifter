import { describe, expect, it } from "vitest";
import { parsePath } from "../pathUtils";
import { hitTestOwnedLayers } from "../scene/hitTest";
import type { SceneOwner } from "../scene/selection";
import type { AnimationState, Layer } from "../types";

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
  it("lets clicks pass through an even-odd clip hole with contours wound in the same direction", () => {
    const clip: Layer = {
      ...filled("clip"),
      type: "clipPath",
      from: parsePath("M0 0L10 0L10 10L0 10Z M3 3L7 3L7 7L3 7Z"),
      to: undefined,
      fillType: "evenOdd",
    };
    const owner: SceneOwner = {
      ownerId: "frame",
      origin: { x: 100, y: 20 },
      layers: [filled("behind"), clip, filled("clipped")],
    };
    expect(hitTestOwnedLayers([owner], { x: 105, y: 25 }, 0)).toEqual({
      ownerId: "frame",
      layerId: "behind",
    });
    expect(hitTestOwnedLayers([owner], { x: 101, y: 21 }, 0)).toEqual({
      ownerId: "frame",
      layerId: "clipped",
    });
    expect(
      hitTestOwnedLayers([{ ...owner, layers: owner.layers.slice(1) }], { x: 105, y: 25 }, 0),
    ).toBeNull();
    const nonZero = {
      ...owner,
      layers: [owner.layers[0]!, { ...clip, fillType: "nonZero" as const }, owner.layers[2]!],
    };
    expect(hitTestOwnedLayers([nonZero], { x: 105, y: 25 }, 0)).toEqual({
      ownerId: "frame",
      layerId: "clipped",
    });
  });
  it("hits only the visible root-clipped region at the evaluated playhead", () => {
    const animation: AnimationState = {
      id: "clip-motion",
      name: "Clip motion",
      duration: 1000,
      blocks: [
        {
          id: "clip-translation",
          layerId: "clip",
          propertyName: "translateX",
          fromValue: 0,
          toValue: 10,
          startTime: 0,
          endTime: 1000,
          interpolator: "LINEAR",
        },
      ],
    };
    const owner: SceneOwner = {
      ownerId: "frame",
      origin: { x: 100, y: 20 },
      animation,
      progress: 0.5,
      usePlayhead: true,
      layers: [
        filled("before"),
        {
          ...filled("clip"),
          type: "clipPath",
          from: parsePath("M0 0 L4 0 L4 10 L0 10 Z"),
          to: undefined,
        },
        filled("after"),
      ],
    };
    expect(hitTestOwnedLayers([owner], { x: 107, y: 25 }, 1)).toEqual({
      ownerId: "frame",
      layerId: "after",
    });
    expect(hitTestOwnedLayers([owner], { x: 102, y: 25 }, 1)).toEqual({
      ownerId: "frame",
      layerId: "before",
    });
    expect(
      hitTestOwnedLayers([{ ...owner, layers: owner.layers.slice(1) }], { x: 102, y: 25 }, 1),
    ).toBeNull();
    expect(hitTestOwnedLayers([{ ...owner, progress: 0 }], { x: 107, y: 25 }, 1)).toEqual({
      ownerId: "frame",
      layerId: "before",
    });
  });

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

  it.each([
    { scale: 2, insideY: 3.9, outsideY: 4.1 },
    { scale: 0.5, insideY: 0.9, outsideY: 1.1 },
  ])("keeps the local stroke radius correct at scale $scale", ({ scale, insideY, outsideY }) => {
    const line: Layer = {
      ...filled("stroke"),
      from: parsePath("M0 0L10 0"),
      to: undefined,
      fillColor: "none",
      strokeColor: "#000000",
      strokeWidth: 4,
      scaleX: scale,
      scaleY: scale,
    };
    const owner: SceneOwner = { ownerId: "frame", origin: { x: 0, y: 0 }, layers: [line] };
    expect(hitTestOwnedLayers([owner], { x: 5 * scale, y: insideY }, 0)).toEqual({
      ownerId: "frame",
      layerId: "stroke",
    });
    expect(hitTestOwnedLayers([owner], { x: 5 * scale, y: outsideY }, 0)).toBeNull();
    // Pointer forgiveness remains in world units, independent of local stroke width.
    expect(hitTestOwnedLayers([owner], { x: 5 * scale, y: outsideY }, 0.2)).toEqual({
      ownerId: "frame",
      layerId: "stroke",
    });
  });
});

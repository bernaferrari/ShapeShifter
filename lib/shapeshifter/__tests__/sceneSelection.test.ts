import { describe, expect, it } from "vitest";
import { parsePath } from "../pathUtils";
import type { Layer } from "../types";
import {
  collectOwnedLayersInRect,
  unionOwnedLayerBounds,
  type SceneOwner,
} from "../scene/selection";

const layer = (id: string, x = 0): Layer =>
  ({
    id,
    name: id,
    type: "path",
    from: parsePath("M0 0 L10 0 L10 10 L0 10 Z"),
    to: parsePath("M0 0 L10 0 L10 10 L0 10 Z"),
    translateX: x,
    translateY: 0,
  }) as Layer;

const owners: SceneOwner[] = [
  { ownerId: "frame-a", origin: { x: 0, y: 0 }, layers: [layer("a")] },
  { ownerId: "frame-b", origin: { x: 100, y: 0 }, layers: [layer("b", 5)] },
];

describe("document-wide scene selection", () => {
  it("collects intersecting layers across different owners", () => {
    expect(collectOwnedLayersInRect(owners, { x: 5, y: -1, w: 105, h: 12 })).toEqual([
      { ownerId: "frame-a", layerId: "a" },
      { ownerId: "frame-b", layerId: "b" },
    ]);
  });

  it("returns a world-space union for cross-owner selection chrome", () => {
    expect(
      unionOwnedLayerBounds(owners, [
        { ownerId: "frame-a", layerId: "a" },
        { ownerId: "frame-b", layerId: "b" },
      ]),
    ).toEqual({ x: 0, y: 0, w: 115, h: 10 });
  });

  it("includes scale and rotation in selection bounds", () => {
    const transformedOwners: SceneOwner[] = [
      {
        ownerId: "frame",
        origin: { x: 20, y: 10 },
        layers: [{ ...layer("shape"), scaleX: 2, scaleY: 0.5 }],
      },
    ];
    expect(
      unionOwnedLayerBounds(transformedOwners, [{ ownerId: "frame", layerId: "shape" }]),
    ).toEqual({ x: 20, y: 10, w: 20, h: 5 });
  });

  it("ignores locked and hidden objects", () => {
    const hiddenOwners: SceneOwner[] = [
      {
        ownerId: "frame-a",
        origin: { x: 0, y: 0 },
        layers: [
          { ...layer("locked"), locked: true },
          { ...layer("hidden"), visible: false },
        ],
      },
    ];
    expect(collectOwnedLayersInRect(hiddenOwners, { x: -1, y: -1, w: 20, h: 20 })).toEqual([]);
  });
});

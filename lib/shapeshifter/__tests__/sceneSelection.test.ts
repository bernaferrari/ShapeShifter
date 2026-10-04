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

  it("bounds selected groups by visible transformed descendants without duplicating marquee hits", () => {
    const group = {
      ...layer("group"),
      type: "group" as const,
      translateX: 20,
      scaleX: 2,
      scaleY: 3,
      from: { subPaths: [] },
    };
    const child = { ...layer("child", 5), parentId: group.id };
    const owner = { ownerId: "frame", origin: { x: 100, y: 50 }, layers: [group, child] };
    expect(unionOwnedLayerBounds([owner], [{ ownerId: "frame", layerId: "group" }])).toEqual({
      x: 130,
      y: 50,
      w: 20,
      h: 30,
    });
    expect(collectOwnedLayersInRect([owner], { x: 129, y: 49, w: 22, h: 32 })).toEqual([
      { ownerId: "frame", layerId: "child" },
    ]);
  });

  it("keeps children of locked groups out of marquee while still bounding an explicit selection", () => {
    const group = {
      ...layer("group"),
      type: "group" as const,
      locked: true,
      from: { subPaths: [] },
    };
    const child = { ...layer("child"), parentId: group.id };
    const owner = { ownerId: "frame", origin: { x: 0, y: 0 }, layers: [group, child] };
    expect(collectOwnedLayersInRect([owner], { x: -1, y: -1, w: 12, h: 12 })).toEqual([]);
    expect(unionOwnedLayerBounds([owner], [{ ownerId: "frame", layerId: child.id }])).toEqual({
      x: 0,
      y: 0,
      w: 10,
      h: 10,
    });
  });

  it("bounds native strokes along each axis under an anisotropic rotated hierarchy", () => {
    const group = {
      ...layer("group"),
      type: "group" as const,
      scaleX: 2,
      scaleY: 1,
      from: { subPaths: [] },
    };
    const child = {
      ...layer("child"),
      parentId: group.id,
      rotation: 45,
      strokeColor: "#000000",
      strokeWidth: 2,
      strokeLinejoin: "round" as const,
    };
    const owner = { ownerId: "frame", origin: { x: 0, y: 0 }, layers: [group, child] };
    const bounds = unionOwnedLayerBounds([owner], [{ ownerId: "frame", layerId: child.id }])!;
    expect(bounds.x).toBeCloseTo(-10 * Math.SQRT2 - 2);
    expect(bounds.y).toBeCloseTo(-1);
    expect(bounds.w).toBeCloseTo(20 * Math.SQRT2 + 4);
    expect(bounds.h).toBeCloseTo(10 * Math.SQRT2 + 2);
  });
});

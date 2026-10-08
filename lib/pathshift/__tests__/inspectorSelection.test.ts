import { describe, expect, it } from "vitest";
import type { Layer } from "../types";
import {
  getInspectorSelectionBounds,
  resolveOwnedLayers,
  sharedValue,
} from "../scene/inspectorSelection";

const path = {
  subPaths: [
    {
      commands: [
        { id: "move", type: "M" as const, points: [{ x: 2, y: 3 }] },
        { id: "line", type: "L" as const, points: [{ x: 12, y: 13 }] },
      ],
    },
  ],
};

function layer(id: string, translateX = 0, fillColor = "#000000"): Layer {
  return {
    id,
    name: id,
    type: "path",
    visible: true,
    locked: false,
    from: path,
    pathData: path,
    translateX,
    fillColor,
  };
}

describe("inspector selection helpers", () => {
  const owners = [
    { ownerId: "a", origin: { x: 100, y: 40 }, layers: [layer("one", 5)] },
    { ownerId: "b", origin: { x: 300, y: 80 }, layers: [layer("two", 0, "#ffffff")] },
  ];

  it("resolves layers in selection order across owners", () => {
    expect(
      resolveOwnedLayers(owners, [
        { ownerId: "b", layerId: "two" },
        { ownerId: "a", layerId: "one" },
      ]).map((item) => item.id),
    ).toEqual(["two", "one"]);
  });

  it("reports shared and mixed values without substituting the primary value", () => {
    expect(sharedValue([layer("a"), layer("b")], (item) => item.fillColor, "")).toEqual({
      value: "#000000",
      mixed: false,
    });
    expect(
      sharedValue([layer("a"), layer("b", 0, "#ffffff")], (item) => item.fillColor, ""),
    ).toMatchObject({ mixed: true });
  });

  it("uses owner-local coordinates for one owner and world coordinates across owners", () => {
    expect(getInspectorSelectionBounds(owners, [{ ownerId: "a", layerId: "one" }])).toEqual({
      x: 7,
      y: 3,
      w: 10,
      h: 10,
      coordinateSpace: "owner",
    });
    expect(
      getInspectorSelectionBounds(owners, [
        { ownerId: "a", layerId: "one" },
        { ownerId: "b", layerId: "two" },
      ]),
    ).toEqual({ x: 107, y: 43, w: 205, h: 50, coordinateSpace: "world" });
  });
});

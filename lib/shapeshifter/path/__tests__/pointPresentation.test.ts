import { describe, expect, it } from "vitest";
import { parsePath } from "../pathDataIO";
import { edgePresentation, pathAnchors, pointPresentation } from "../pointPresentation";

describe("point identities in the editor", () => {
  it("groups cubic controls under the anchors they affect, independently of SVG ordering", () => {
    const path = parsePath("M0 0 C3 0 7 0 10 0 C13 0 17 0 20 0");
    const anchors = pathAnchors(path, 0);
    expect(anchors.map((point) => point.controls.map((control) => control.label))).toEqual([
      ["Outgoing"],
      ["Incoming", "Outgoing"],
      ["Incoming"],
    ]);
    const label = (commandIndex: number, pointIndex: number) =>
      pointPresentation(path, { subPathIndex: 0, commandIndex, pointIndex })?.label;
    expect(label(1, 0)).toBe("Point 1 · outgoing");
    expect(label(1, 1)).toBe("Point 2 · incoming");
    expect(label(1, 2)).toBe("Point 2");
    expect(label(2, 0)).toBe("Point 2 · outgoing");
    expect(label(2, 1)).toBe("Point 3 · incoming");
  });

  it("keeps coincident morph anchors distinct and identifies the closing edge", () => {
    const path = parsePath("M0 0 L10 0 L10 0 L0 10 Z");
    expect(pathAnchors(path, 0).map((point) => point.number)).toEqual([1, 2, 3, 4]);
    expect(edgePresentation(path, 0, 2)?.label).toBe("Points 2 → 3");
    expect(edgePresentation(path, 0, 4)?.label).toBe("Points 4 → 1");
    expect(edgePresentation(path, 0, 0)).toBeNull();
    expect(pointPresentation(path, { subPathIndex: 0, commandIndex: 9, pointIndex: 0 })).toBeNull();
  });

  it("names quadratic shared controls and smooth cubic controls without inventing handles", () => {
    const path = parsePath("M0 0 Q5 5 10 0 S15 5 20 0");
    expect(
      pathAnchors(path, 0).map((point) => point.controls.map((control) => control.label)),
    ).toEqual([["Shared control"], ["Shared control"], ["Incoming"]]);
  });

  it("numbers each shape independently", () => {
    const path = parsePath("M0 0 L10 0 M20 0 L30 0");
    expect(pathAnchors(path, 1).map((point) => point.number)).toEqual([1, 2]);
    expect(edgePresentation(path, 1, 1)?.start.subPathIndex).toBe(1);
    expect(pathAnchors(path, 99)).toEqual([]);
  });
});

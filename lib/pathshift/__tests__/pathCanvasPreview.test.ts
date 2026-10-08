import { describe, expect, it } from "vitest";
import { getPreviewLayers } from "../../../components/editor/canvas/pathCanvasPreview";
import { evaluateAndroidScene } from "../scene/evaluate";
import { parsePath } from "../pathUtils";
import type { Layer } from "../types";

const square: Layer = {
  id: "moving",
  name: "moving",
  type: "path",
  from: parsePath("M0 0 L10 0 L10 10 L0 10 Z"),
  pathData: parsePath("M0 0 L10 0 L10 10 L0 10 Z"),
  fillColor: "#000000",
  visible: true,
  locked: false,
};

describe("getPreviewLayers", () => {
  it("matches evaluateAndroidScene playhead transforms", () => {
    const blocks = [
      {
        id: "move",
        layerId: "moving",
        propertyName: "translateX",
        fromValue: 0,
        toValue: 20,
        startTime: 0,
        endTime: 1000,
        interpolator: "LINEAR",
      },
    ];
    const preview = getPreviewLayers([square], blocks, 1000, 0.5);
    const scene = evaluateAndroidScene(
      [square],
      { id: "motion", name: "Motion", duration: 1000, blocks },
      0.5,
      true,
    );
    expect(preview[0]?.d).toBe(scene.nodesById.get("moving")!.d);
    expect(preview[0]?.transform).toContain("10");
  });
});

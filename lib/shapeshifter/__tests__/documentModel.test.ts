import { describe, expect, it } from "vitest";
import { parsePath, pathToString } from "../pathUtils";
import {
  createDocumentV2FromLegacy,
  legacySnapshotFromDocumentV2,
  validateDocumentV2,
  type LegacyDocumentSnapshot,
} from "../documentModel";
import type { Layer } from "../types";

const path = (id: string, parentId: string | null = null): Layer => ({
  id,
  name: id,
  type: "path",
  from: parsePath("M0 0 L10 10"),
  pathData: parsePath("M0 0 L10 10"),
  visible: true,
  locked: false,
  parentId,
  fillColor: "#ff0000",
});

const snapshot = (): LegacyDocumentSnapshot => ({
  id: "document",
  name: "Android motion",
  rootLayers: [path("page-path")],
  rootVector: { id: "page", name: "Page vector", width: 48, height: 48, alpha: 1 },
  rootAnimation: { id: "page-motion", name: "Page motion", duration: 800, blocks: [] },
  rootHiddenLayerIds: [],
  frames: [
    {
      id: "frame-1",
      name: "Icon / 24",
      x: 120,
      y: 80,
      vector: { id: "frame-1", name: "Icon / 24", width: 24, height: 24, alpha: 0.9 },
      layers: [{ ...path("group"), type: "group", from: parsePath("") }, path("glyph", "group")],
      hiddenLayerIds: [],
      animation: {
        id: "icon-motion",
        name: "Enter",
        duration: 600,
        blocks: [
          {
            id: "move-x",
            layerId: "glyph",
            propertyName: "translateX",
            fromValue: 0,
            toValue: 12,
            startTime: 100,
            endTime: 500,
            interpolator: "FAST_OUT_SLOW_IN",
            type: "number",
          },
        ],
      },
    },
  ],
});

describe("DocumentV2 migration adapter", () => {
  it("normalizes page, artboards, hierarchy, geometry and animation tracks", () => {
    const document = createDocumentV2FromLegacy(snapshot());

    expect(document.version).toBe(2);
    expect(document.frameIds).toEqual(["frame-1"]);
    expect(document.frames["frame-1"]?.width).toBe(24);
    expect(document.rootNodeIds).toHaveLength(1);
    expect(document.frames["frame-1"]?.childrenNodeIds).toHaveLength(1);
    expect(Object.values(document.nodes).find((node) => node.name === "glyph")?.parentId).toContain(
      "group",
    );
    expect(
      Object.values(document.geometryVersions).some(
        (geometry) => pathToString(geometry.pathData) === "M0 0 L10 10",
      ),
    ).toBe(true);
    expect(Object.values(document.tracks)[0]?.target.property).toBe("translateX");
    expect(Object.values(document.keyframes).map((keyframe) => keyframe.time)).toEqual([100, 500]);
    expect(validateDocumentV2(document)).toEqual([]);
  });

  it("round-trips disjoint legacy block identity and frame placement", () => {
    const original = snapshot();
    const restored = legacySnapshotFromDocumentV2(createDocumentV2FromLegacy(original));

    expect(restored.frames[0]).toMatchObject({ id: "frame-1", x: 120, y: 80 });
    expect(restored.frames[0]?.layers.find((layer) => layer.id === "glyph")?.parentId).toBe(
      "group",
    );
    expect(restored.frames[0]?.animation.blocks[0]).toMatchObject({
      id: "move-x",
      layerId: "glyph",
      fromValue: 0,
      toValue: 12,
      startTime: 100,
      endTime: 500,
    });
  });

  it("reports broken graph references before persistence", () => {
    const document = createDocumentV2FromLegacy(snapshot());
    document.frames["frame-1"]!.childrenNodeIds.push("missing");
    expect(validateDocumentV2(document)).toContain(
      "Frame frame-1 references missing node missing.",
    );
  });
});

import { describe, expect, it } from "vitest";
import { parsePath, pathToString } from "../pathUtils";
import {
  createDocumentV2FromLegacy,
  legacyProjectionIssues,
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

  it("preserves Android metadata, stable target names, and independent morph endpoints", () => {
    const original = snapshot();
    const glyph = original.frames[0]!.layers.find((layer) => layer.id === "glyph")!;
    glyph.androidName = "animated_glyph";
    glyph.to = parsePath("M0 0 L20 20");
    original.frames[0]!.vector = {
      ...original.frames[0]!.vector,
      viewportWidth: 48,
      viewportHeight: 32,
      widthUnit: "px",
      heightUnit: "dp",
      tint: "#ff000080",
      tintMode: "src_in",
      autoMirrored: true,
      minSdk: 24,
    };

    const document = createDocumentV2FromLegacy(original);
    const node = Object.values(document.nodes).find(
      (candidate) => candidate.androidName === "animated_glyph",
    );
    expect(node?.fromGeometryVersionId).toBeTruthy();
    expect(node?.toGeometryVersionId).toBeTruthy();
    expect(node?.fromGeometryVersionId).not.toBe(node?.toGeometryVersionId);
    expect(Object.values(document.morphMappings)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fromGeometryId: node?.fromGeometryVersionId }),
      ]),
    );

    const restored = legacySnapshotFromDocumentV2(document);
    const restoredGlyph = restored.frames[0]!.layers.find((layer) => layer.id === "glyph")!;
    expect(pathToString(restoredGlyph.from)).toBe("M0 0 L10 10");
    expect(pathToString(restoredGlyph.to!)).toBe("M0 0 L20 20");
    expect(restoredGlyph.androidName).toBe("animated_glyph");
    expect(restored.frames[0]!.vector).toMatchObject({
      viewportWidth: 48,
      viewportHeight: 32,
      widthUnit: "px",
      tint: "#ff000080",
      autoMirrored: true,
      minSdk: 24,
    });
  });

  it("reports broken graph references before persistence", () => {
    const document = createDocumentV2FromLegacy(snapshot());
    document.frames["frame-1"]!.childrenNodeIds.push("missing");
    expect(validateDocumentV2(document)).toContain(
      "Frame frame-1 references missing node missing.",
    );
  });

  it("reports a missing page animation clip instead of projecting an empty fallback", () => {
    const document = createDocumentV2FromLegacy(snapshot());
    document.rootClipIds.push("missing-page-motion");
    expect(validateDocumentV2(document)).toContain(
      "Page references missing clip missing-page-motion.",
    );
  });

  it("rejects orphaned scene and timeline records before projection can drop them", () => {
    const document = createDocumentV2FromLegacy(snapshot());
    const pageNodeId = document.rootNodeIds[0]!;
    const frame = document.frames["frame-1"]!;
    const frameClipId = frame.clipIds[0]!;
    const trackId = document.clips[frameClipId]!.trackIds[0]!;
    const keyframeId = document.tracks[trackId]!.keyframeIds[0]!;

    document.rootNodeIds = [];
    frame.clipIds = [];

    expect(validateDocumentV2(document)).toEqual(
      expect.arrayContaining([
        `Node ${pageNodeId} is not reachable from page or frame roots.`,
        `Clip ${frameClipId} is not reachable from page or frame clip lists.`,
        `Track ${trackId} is not reachable from an animation clip.`,
        `Keyframe ${keyframeId} is not reachable from an animation track.`,
      ]),
    );
  });

  it("identifies valid native V2 data that the legacy projection would lose", () => {
    const document = createDocumentV2FromLegacy(snapshot());
    document.components = { button: { id: "button" } };
    const nativeTrack = Object.values(document.tracks)[0]!;
    const extraKeyframe = {
      ...document.keyframes[nativeTrack.keyframeIds[1]!]!,
      id: "native-midpoint",
      time: 300,
      legacyBlockId: undefined,
    };
    document.keyframes[extraKeyframe.id] = extraKeyframe;
    nativeTrack.keyframeIds = [
      nativeTrack.keyframeIds[0]!,
      extraKeyframe.id,
      nativeTrack.keyframeIds[1]!,
    ];

    expect(validateDocumentV2(document)).toEqual([]);
    expect(legacyProjectionIssues(document)).toEqual(
      expect.arrayContaining([
        "reusable components",
        `native keyframe sequence on track ${nativeTrack.id}`,
      ]),
    );
  });
});

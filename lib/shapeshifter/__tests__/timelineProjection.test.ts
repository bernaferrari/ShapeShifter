import { describe, expect, it } from "vitest";
import { parsePath } from "@/lib/shapeshifter/pathUtils";
import type { AnimationState, Layer } from "@/lib/shapeshifter/types";
import type { CanvasFrame } from "@/lib/store/editorStore";
import { buildTimelineProjection } from "@/components/editor/timeline/timelineProjection";

const layer: Layer = {
  id: "shape",
  name: "Shape",
  type: "path",
  visible: true,
  locked: false,
  from: parsePath("M0 0 L10 10"),
};
const animation: AnimationState = {
  id: "motion",
  name: "Motion",
  duration: 1000,
  blocks: [
    { id: "path", layerId: "shape", propertyName: "pathData", fromValue: "", toValue: "", startTime: 0, endTime: 1000, type: "path" },
    { id: "x", layerId: "shape", propertyName: "translateX", fromValue: 0, toValue: 10, startTime: 0, endTime: 1000, type: "number" },
    { id: "y", layerId: "shape", propertyName: "translateY", fromValue: 0, toValue: 10, startTime: 0, endTime: 1000, type: "number" },
  ],
};
const frame = {
  id: "frame",
  name: "Frame",
  x: 0,
  y: 0,
  layers: [layer],
  vector: { id: "vector", name: "Frame", width: 24, height: 24, alpha: 1 },
  animation,
  hiddenLayerIds: [],
} satisfies CanvasFrame;

describe("timeline projection", () => {
  it("shows only the active frame and de-duplicates the Position property", () => {
    const projection = buildTimelineProjection({
      frames: [frame, { ...frame, id: "other", name: "Other" }],
      selectedFrameId: frame.id,
      activeLayers: frame.layers,
      activeAnimation: animation,
      collapsedFrameIds: new Set(),
      collapsedGroupKeys: new Set(),
    });
    expect(projection.rows.map((row) => row.key)).toEqual([
      "frame-frame",
      "object-frame-shape",
      "prop-frame-shape-translateX",
    ]);
    expect(projection.blocksForLayer("frame", "shape")).toHaveLength(3);
  });

  it("keeps a collapsed frame to one row", () => {
    const projection = buildTimelineProjection({
      frames: [frame],
      selectedFrameId: frame.id,
      activeLayers: frame.layers,
      activeAnimation: animation,
      collapsedFrameIds: new Set([frame.id]),
      collapsedGroupKeys: new Set(),
    });
    expect(projection.rows).toHaveLength(1);
    expect(projection.rows[0]?.kind).toBe("frame");
  });
});


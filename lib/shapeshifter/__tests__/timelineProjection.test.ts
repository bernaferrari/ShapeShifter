import { describe, expect, it } from "vitest";
import { parsePath } from "@/lib/shapeshifter/pathUtils";
import type { AnimationState, Layer } from "@/lib/shapeshifter/types";
import type { CanvasFrame } from "@/lib/store/editorStore";
import {
  buildTimelineProjection,
  mapPropertyNameToTrackCapability,
} from "@/components/editor/timeline/timelineProjection";
import { CAPABILITY_MATRIX } from "@/lib/shapeshifter/formatCapabilities";

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
    {
      id: "path",
      layerId: "shape",
      propertyName: "pathData",
      fromValue: "",
      toValue: "",
      startTime: 0,
      endTime: 1000,
      type: "path",
    },
    {
      id: "x",
      layerId: "shape",
      propertyName: "translateX",
      fromValue: 0,
      toValue: 10,
      startTime: 0,
      endTime: 1000,
      type: "number",
    },
    {
      id: "y",
      layerId: "shape",
      propertyName: "translateY",
      fromValue: 0,
      toValue: 10,
      startTime: 0,
      endTime: 1000,
      type: "number",
    },
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
  it("shows the active frame with Path, Position X, and Position Y property rows", () => {
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
      "prop-frame-shape-pathData",
      "prop-frame-shape-translateX",
      "prop-frame-shape-translateY",
    ]);
    expect(projection.blocksForLayer("frame", "shape")).toHaveLength(3);
  });

  it("keeps translateY blocks selectable on their own row while translateX is animated", () => {
    const projection = buildTimelineProjection({
      frames: [frame],
      selectedFrameId: frame.id,
      activeLayers: frame.layers,
      activeAnimation: animation,
      collapsedFrameIds: new Set(),
      collapsedGroupKeys: new Set(),
    });
    const propertyRows = projection.rows.filter((row) => row.kind === "property");
    expect(propertyRows.map((row) => row.propertyName)).toEqual([
      "pathData",
      "translateX",
      "translateY",
    ]);
    expect(projection.blocksForProperty("frame", "shape", "translateX")).toEqual([
      animation.blocks[1],
    ]);
    expect(projection.blocksForProperty("frame", "shape", "translateY")).toEqual([
      animation.blocks[2],
    ]);
  });

  it("gives a standalone translateY track its own row", () => {
    const yOnlyAnimation: AnimationState = {
      ...animation,
      blocks: [animation.blocks.find((block) => block.id === "y")!],
    };
    const projection = buildTimelineProjection({
      frames: [{ ...frame, animation: yOnlyAnimation }],
      selectedFrameId: frame.id,
      activeLayers: frame.layers,
      activeAnimation: yOnlyAnimation,
      collapsedFrameIds: new Set(),
      collapsedGroupKeys: new Set(),
    });
    expect(projection.rows.map((row) => row.key)).toEqual([
      "frame-frame",
      "object-frame-shape",
      "prop-frame-shape-translateY",
    ]);
    expect(projection.blocksForProperty("frame", "shape", "translateY")).toHaveLength(1);
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

  it("annotates unsupported property rows when a format profile is passed", () => {
    const projection = buildTimelineProjection({
      frames: [frame],
      selectedFrameId: frame.id,
      activeLayers: frame.layers,
      activeAnimation: animation,
      collapsedFrameIds: new Set(),
      collapsedGroupKeys: new Set(),
      formatProfile: CAPABILITY_MATRIX.vector,
    });
    const propertyRows = projection.rows.filter((row) => row.kind === "property");
    expect(propertyRows.length).toBeGreaterThan(0);
    for (const row of propertyRows) {
      expect(row.capabilityNote).toBeTruthy();
    }
  });

  it("does not annotate property rows without a format profile", () => {
    const projection = buildTimelineProjection({
      frames: [frame],
      selectedFrameId: frame.id,
      activeLayers: frame.layers,
      activeAnimation: animation,
      collapsedFrameIds: new Set(),
      collapsedGroupKeys: new Set(),
    });
    const propertyRows = projection.rows.filter((row) => row.kind === "property");
    expect(propertyRows.length).toBeGreaterThan(0);
    for (const row of propertyRows) {
      expect(row.capabilityNote).toBeUndefined();
    }
  });

  it("shows children of a group linked only by flat parentId (grouped layers stay reachable)", () => {
    // Mirrors groupSelectedLayers output: parentId set, children array left empty.
    const childA: Layer = { ...layer, id: "child-a", name: "Child A", parentId: "grp" };
    const childB: Layer = {
      ...layer,
      id: "child-b",
      name: "Child B",
      type: "path",
      from: parsePath("M20 20 L30 30"),
      parentId: "grp",
    };
    const group: Layer = {
      id: "grp",
      name: "Group",
      type: "group",
      visible: true,
      locked: false,
      from: parsePath("M0 0 L10 10"),
      children: [],
    };
    const groupedFrame: CanvasFrame = {
      ...frame,
      layers: [group, childA, childB],
    };
    const projection = buildTimelineProjection({
      frames: [groupedFrame],
      selectedFrameId: groupedFrame.id,
      activeLayers: groupedFrame.layers,
      activeAnimation: {
        ...animation,
        blocks: [
          ...animation.blocks,
          {
            id: "a-x",
            layerId: "child-a",
            propertyName: "translateX",
            fromValue: 0,
            toValue: 10,
            startTime: 0,
            endTime: 1000,
            type: "number",
          },
        ],
      },
      collapsedFrameIds: new Set(),
      collapsedGroupKeys: new Set(),
    });
    expect(projection.rows.map((row) => row.key)).toEqual([
      `frame-${groupedFrame.id}`,
      "object-frame-grp",
      "object-frame-child-a",
      "prop-frame-child-a-translateX",
      "object-frame-child-b",
    ]);
    expect(projection.rows.find((row) => row.key === "object-frame-grp")).toMatchObject({
      expandable: true,
      expanded: true,
    });
  });

  it("maps timeline property names to track capabilities and rejects unknown names", () => {
    expect(mapPropertyNameToTrackCapability("pathData")).toBe("pathMorph");
    expect(mapPropertyNameToTrackCapability("fillColor")).toBe("color");
    expect(mapPropertyNameToTrackCapability("strokeColor")).toBe("color");
    expect(mapPropertyNameToTrackCapability("fillAlpha")).toBe("color");
    expect(mapPropertyNameToTrackCapability("strokeAlpha")).toBe("color");
    expect(mapPropertyNameToTrackCapability("alpha")).toBe("alpha");
    expect(mapPropertyNameToTrackCapability("trimPathStart")).toBe("trimPath");
    expect(mapPropertyNameToTrackCapability("trimPathEnd")).toBe("trimPath");
    expect(mapPropertyNameToTrackCapability("trimPathOffset")).toBe("trimPath");
    expect(mapPropertyNameToTrackCapability("translateX")).toBe("translation");
    expect(mapPropertyNameToTrackCapability("translateY")).toBe("translation");
    expect(mapPropertyNameToTrackCapability("rotation")).toBe("rotation");
    expect(mapPropertyNameToTrackCapability("scaleX")).toBe("scale");
    expect(mapPropertyNameToTrackCapability("scaleY")).toBe("scale");
    expect(mapPropertyNameToTrackCapability("pivotX")).toBeNull();
    expect(mapPropertyNameToTrackCapability("strokeWidth")).toBeNull();
    expect(mapPropertyNameToTrackCapability("somethingElse")).toBeNull();
  });

  it("collapses a flat-parentId group so its children disappear from the rows", () => {
    const child: Layer = {
      id: "child",
      name: "Child",
      type: "path",
      visible: true,
      locked: false,
      parentId: "group",
      from: parsePath("M0 0 L10 10"),
    };
    const group: Layer = {
      id: "group",
      name: "Group",
      type: "group",
      visible: true,
      locked: false,
      from: parsePath("M0 0 L10 10"),
    };
    const projection = buildTimelineProjection({
      frames: [{ ...frame, layers: [group, child] }],
      selectedFrameId: frame.id,
      activeLayers: [group, child],
      activeAnimation: animation,
      collapsedFrameIds: new Set(),
      collapsedGroupKeys: new Set(["object-frame-group"]),
    });
    expect(
      projection.rows.filter((row) => row.kind === "object").map((row) => row.layer.id),
    ).toEqual(["group"]);
  });

  it("keeps grouped layers reachable when hierarchy is flat parentId links", () => {
    const child: Layer = {
      id: "child",
      name: "Child",
      type: "path",
      visible: true,
      locked: false,
      parentId: "group",
      from: parsePath("M0 0 L10 10"),
    };
    const group: Layer = {
      id: "group",
      name: "Group",
      type: "group",
      visible: true,
      locked: false,
      from: parsePath("M0 0 L10 10"),
    };
    const projection = buildTimelineProjection({
      frames: [{ ...frame, layers: [group, child] }],
      selectedFrameId: frame.id,
      activeLayers: [group, child],
      activeAnimation: {
        ...animation,
        blocks: [
          {
            id: "child-x",
            layerId: "child",
            propertyName: "translateX",
            fromValue: 0,
            toValue: 10,
            startTime: 0,
            endTime: 1000,
            type: "number",
          },
        ],
      },
      collapsedFrameIds: new Set(),
      collapsedGroupKeys: new Set(),
    });
    expect(projection.rows.map((row) => row.key)).toEqual([
      "frame-frame",
      "object-frame-group",
      "object-frame-child",
      "prop-frame-child-translateX",
    ]);
  });

  it("projects the page root as a first-class owner when it is selected", () => {
    const rootLayer: Layer = { ...layer, id: "page-shape", name: "Page shape" };
    const rootAnimation: AnimationState = {
      ...animation,
      blocks: [
        {
          id: "root-x",
          layerId: "page-shape",
          propertyName: "translateX",
          fromValue: 0,
          toValue: 5,
          startTime: 0,
          endTime: 1000,
          type: "number" as const,
        },
      ],
    };
    const projection = buildTimelineProjection({
      frames: [frame],
      selectedFrameId: "__page_root__",
      activeLayers: [rootLayer],
      activeAnimation: rootAnimation,
      collapsedFrameIds: new Set(),
      collapsedGroupKeys: new Set(),
    });
    expect(projection.rows.map((row) => row.key)).toEqual([
      "frame-__page_root__",
      "object-__page_root__-page-shape",
      "prop-__page_root__-page-shape-translateX",
    ]);
    expect(projection.rows[1]!.frameId).toBe("__page_root__");
    expect(projection.blocksForLayer("__page_root__", "page-shape")).toHaveLength(1);
    expect(
      projection.blocksForProperty("__page_root__", "page-shape", "translateX"),
    ).toEqual([rootAnimation.blocks[0]]);
    expect(projection.contentForFrame("__page_root__")).toEqual({
      layers: [rootLayer],
      animation: rootAnimation,
    });
  });

  it("does not expose page-root content when a regular frame is selected", () => {
    const projection = buildTimelineProjection({
      frames: [frame],
      selectedFrameId: frame.id,
      activeLayers: frame.layers,
      activeAnimation: animation,
      collapsedFrameIds: new Set(),
      collapsedGroupKeys: new Set(),
    });
    expect(projection.rows.some((row) => row.frameId === "__page_root__")).toBe(false);
    expect(projection.contentForFrame("__page_root__")).toBeNull();
  });
});

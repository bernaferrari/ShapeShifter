import type { CanvasFrame } from "@/lib/store/editorStore";
import type { AnimationState, Layer, TimelineBlock } from "@/lib/shapeshifter/types";

export type TimelineRow =
  | {
      kind: "frame";
      frameId: string;
      name: string;
      depth: number;
      key: string;
      expanded: boolean;
    }
  | {
      kind: "object";
      frameId: string;
      layer: Layer;
      name: string;
      depth: number;
      key: string;
      expandable?: boolean;
      expanded?: boolean;
    }
  | {
      kind: "property";
      frameId: string;
      layer: Layer;
      propertyName: string;
      depth: number;
      key: string;
    };

interface TimelineProjectionOptions {
  frames: CanvasFrame[];
  selectedFrameId: string;
  activeLayers: Layer[];
  activeAnimation: AnimationState;
  collapsedFrameIds: Set<string>;
  collapsedGroupKeys: Set<string>;
}

export interface TimelineProjection {
  rows: TimelineRow[];
  contentForFrame: (frameId: string) => { layers: Layer[]; animation: AnimationState };
  blocksForLayer: (frameId: string, layerId: string | number) => TimelineBlock[];
  blocksForProperty: (
    frameId: string,
    layerId: string | number,
    propertyName: string,
  ) => TimelineBlock[];
}

function propertyNames(animation: AnimationState, layerId: string | number): string[] {
  const names = Array.from(
    new Set(
      animation.blocks
        .filter((block) => String(block.layerId) === String(layerId))
        .map((block) => block.propertyName)
    ),
  );
  const hasX = names.includes("translateX");
  const rank = (name: string) =>
    name === "pathData"
      ? 0
      : name === "translateX" || name === "translateY"
        ? 1
        : name === "rotation"
          ? 2
          : name.startsWith("scale")
            ? 3
            : 4;
  return names
    .filter((name) => !(name === "translateY" && hasX))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function buildTimelineProjection({
  frames,
  selectedFrameId,
  activeLayers,
  activeAnimation,
  collapsedFrameIds,
  collapsedGroupKeys,
}: TimelineProjectionOptions): TimelineProjection {
  const activeFrameExists = frames.some((frame) => frame.id === selectedFrameId);
  const contentForFrame = (frameId: string) => {
    if (frameId === selectedFrameId) {
      return { layers: activeLayers, animation: activeAnimation };
    }
    const frame = frames.find((candidate) => candidate.id === frameId);
    return {
      layers: frame?.layers ?? [],
      animation:
        frame?.animation ??
        ({ id: "", name: "", duration: 1000, blocks: [] } satisfies AnimationState),
    };
  };
  const blocksForLayer = (frameId: string, layerId: string | number) =>
    contentForFrame(frameId).animation.blocks.filter(
      (block) => String(block.layerId) === String(layerId),
    );
  const blocksForProperty = (frameId: string, layerId: string | number, propertyName: string) =>
    blocksForLayer(frameId, layerId).filter((block) => block.propertyName === propertyName);

  const rows: TimelineRow[] = [];
  const pushLayers = (frameId: string, layerList: Layer[], depth: number) => {
    for (const layer of layerList) {
      if (layer.type === "vector") continue;
      const key = `object-${frameId}-${layer.id}`;
      const children = layer.children?.filter(Boolean) ?? [];
      const expanded = !collapsedGroupKeys.has(key);
      rows.push({
        kind: "object",
        frameId,
        layer,
        name: layer.name || "Layer",
        depth,
        key,
        expandable: children.length > 0 || layer.type === "group",
        expanded: children.length > 0 ? expanded : undefined,
      });
      for (const propertyName of propertyNames(contentForFrame(frameId).animation, layer.id)) {
        rows.push({
          kind: "property",
          frameId,
          layer,
          propertyName,
          depth: depth + 1,
          key: `prop-${frameId}-${layer.id}-${propertyName}`,
        });
      }
      if (children.length > 0 && expanded) pushLayers(frameId, children, depth + 1);
    }
  };

  const framesToShow = activeFrameExists
    ? frames.filter((frame) => frame.id === selectedFrameId)
    : frames;
  for (const frame of framesToShow) {
    const content = contentForFrame(frame.id);
    const roots = content.layers.filter(
      (layer) =>
        layer.parentId == null ||
        layer.parentId === "" ||
        !content.layers.some((parent) => String(parent.id) === String(layer.parentId)),
    );
    const expanded = !collapsedFrameIds.has(frame.id);
    rows.push({
      kind: "frame",
      frameId: frame.id,
      name: frame.name,
      depth: 0,
      key: `frame-${frame.id}`,
      expanded,
    });
    if (expanded) pushLayers(frame.id, roots.length ? roots : content.layers, 1);
  }

  return { rows, contentForFrame, blocksForLayer, blocksForProperty };
}

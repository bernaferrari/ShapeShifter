import type { CanvasFrame } from "@/lib/store/editorStore";
import { createLayerTreeModel, type LayerTreeModel } from "@/lib/shapeshifter/scene/layerHierarchy";
import { PAGE_ROOT_ID } from "@/lib/shapeshifter/scene/owners";
import type { AnimationState, Layer, TimelineBlock } from "@/lib/shapeshifter/types";
import {
  capabilityFor,
  type FormatProfile,
  type TrackCapability,
} from "@/lib/shapeshifter/formatCapabilities";

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
      /** Set when the selected export format does not support this track kind. */
      capabilityNote?: string;
    };

interface TimelineProjectionOptions {
  frames: CanvasFrame[];
  selectedFrameId: string;
  activeLayers: Layer[];
  activeAnimation: AnimationState;
  collapsedFrameIds: Set<string>;
  collapsedGroupKeys: Set<string>;
  /** When set, property rows for unsupported track kinds gain a capabilityNote. */
  formatProfile?: FormatProfile;
}

export interface TimelineProjection {
  rows: TimelineRow[];
  contentForFrame: (frameId: string) => { layers: Layer[]; animation: AnimationState } | null;
  blocksForLayer: (frameId: string, layerId: string | number) => TimelineBlock[];
  blocksForProperty: (
    frameId: string,
    layerId: string | number,
    propertyName: string,
  ) => TimelineBlock[];
}

/**
 * Maps a timeline property name to the export-track capability it exercises.
 * Returns null for names with no capability mapping (e.g. pivotX, strokeWidth)
 * so callers skip annotation instead of guessing.
 */
export function mapPropertyNameToTrackCapability(propertyName: string): TrackCapability | null {
  if (propertyName === "pathData") return "pathMorph";
  if (
    propertyName === "fillColor" ||
    propertyName === "strokeColor" ||
    propertyName === "fillAlpha" ||
    propertyName === "strokeAlpha"
  ) {
    return "color";
  }
  switch (propertyName) {
    case "alpha":
      return "alpha";
    case "trimPathStart":
    case "trimPathEnd":
    case "trimPathOffset":
      return "trimPath";
    case "translateX":
    case "translateY":
      return "translation";
    case "rotation":
      return "rotation";
    case "scaleX":
    case "scaleY":
      return "scale";
    default:
      return null;
  }
}

function propertyNames(animation: AnimationState, layerId: string | number): string[] {
  return Array.from(
    new Set(
      animation.blocks
        .filter((block) => String(block.layerId) === String(layerId))
        .map((block) => block.propertyName),
    ),
  ).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

function rank(name: string): number {
  return name === "pathData"
    ? 0
    : name === "translateX" || name === "translateY"
      ? 1
      : name === "rotation"
        ? 2
        : name.startsWith("scale")
          ? 3
          : 4;
}

export function buildTimelineProjection({
  frames,
  selectedFrameId,
  activeLayers,
  activeAnimation,
  collapsedFrameIds,
  collapsedGroupKeys,
  formatProfile,
}: TimelineProjectionOptions): TimelineProjection {
  const activeFrameExists = frames.some((frame) => frame.id === selectedFrameId);
  // The page root ("__page_root__") owns vectors placed outside every artboard
  // frame. The store keeps its content in the live projection (layers /
  // animation) whenever it is selected — see selectRootLayer / saveActiveRoot —
  // so it must project as a first-class owner instead of falling through the
  // frame lookup below, which used to leave the timeline empty.
  const activeIsPageRoot = selectedFrameId === PAGE_ROOT_ID;
  const emptyAnimation = { id: "", name: "", duration: 1000, blocks: [] } satisfies AnimationState;
  const contentForFrame = (frameId: string) => {
    if (frameId === selectedFrameId) {
      return { layers: activeLayers, animation: activeAnimation };
    }
    // The page root is never a frame; it is only addressable while active,
    // since its content lives in the live projection rather than `frames`.
    if (frameId === PAGE_ROOT_ID && frameId !== selectedFrameId) return null;
    const frame = frames.find((candidate) => candidate.id === frameId);
    return {
      layers: frame?.layers ?? [],
      animation: frame?.animation ?? emptyAnimation,
    };
  };
  const blocksForLayer = (frameId: string, layerId: string | number) =>
    (contentForFrame(frameId)?.animation.blocks ?? []).filter(
      (block) => String(block.layerId) === String(layerId),
    );
  const blocksForProperty = (frameId: string, layerId: string | number, propertyName: string) =>
    blocksForLayer(frameId, layerId).filter((block) => block.propertyName === propertyName);

  const rows: TimelineRow[] = [];
  /**
   * Emits one object row plus its property rows, then recurses into visible
   * children. `animation` is the owner's track source so property rows resolve
   * against whichever owner (frame or page root) the object belongs to.
   */
  const pushLayer = (
    frameId: string,
    tree: LayerTreeModel,
    layer: Layer,
    depth: number,
    animation: AnimationState,
  ): void => {
    if (layer.type === "vector") return;
    const key = `object-${frameId}-${layer.id}`;
    const children = tree.childrenOf(layer);
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
    for (const propertyName of propertyNames(animation, layer.id)) {
      const trackCapability = mapPropertyNameToTrackCapability(propertyName);
      const capability =
        formatProfile && trackCapability
          ? capabilityFor(formatProfile.id, trackCapability)
          : undefined;
      rows.push({
        kind: "property",
        frameId,
        layer,
        propertyName,
        depth: depth + 1,
        key: `prop-${frameId}-${layer.id}-${propertyName}`,
        ...(capability && !capability.supported ? { capabilityNote: capability.note } : {}),
      });
    }
    if (children.length > 0 && expanded) {
      for (const child of children) pushLayer(frameId, tree, child, depth + 1, animation);
    }
  };
  const pushOwnerRows = (
    frameId: string,
    name: string,
    content: { layers: Layer[]; animation: AnimationState },
  ) => {
    // Normalize flat parentId links and embedded children into one tree so
    // grouped layers (parentId-only via groupSelectedLayers) stay reachable.
    const tree = createLayerTreeModel(content.layers);
    const expanded = !collapsedFrameIds.has(frameId);
    rows.push({
      kind: "frame",
      frameId,
      name,
      depth: 0,
      key: `frame-${frameId}`,
      expanded,
    });
    if (!expanded) return;
    for (const layer of tree.roots) pushLayer(frameId, tree, layer, 1, content.animation);
  };
  const ownersToRender: Array<{ id: string; name: string }> = activeIsPageRoot
    ? [{ id: PAGE_ROOT_ID, name: "Page" }]
    : activeFrameExists
      ? frames
          .filter((frame) => frame.id === selectedFrameId)
          .map((frame) => ({ id: frame.id, name: frame.name }))
      : frames.map((frame) => ({ id: frame.id, name: frame.name }));
  for (const owner of ownersToRender) {
    pushOwnerRows(
      owner.id,
      owner.name,
      contentForFrame(owner.id) ?? { layers: [], animation: emptyAnimation },
    );
  }

  return { rows, contentForFrame, blocksForLayer, blocksForProperty };
}

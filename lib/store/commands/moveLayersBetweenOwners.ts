import type { CanvasFrame } from "../defaultWorkspace";
import type { AnimationState, Layer, VectorMetadata } from "../../shapeshifter/types";
import {
  collectLayerSubtreeIds,
  placeLayerSubtree,
  type LayerPlacement,
} from "../../shapeshifter/scene/layerHierarchy";
import { PAGE_ROOT_ID } from "../../shapeshifter/scene/owners";

export interface RootOwnerDocument {
  layers: Layer[];
  vector: VectorMetadata;
  animation: AnimationState;
  hiddenLayerIds: string[];
}

export interface MoveLayersBetweenOwnersInput {
  frames: CanvasFrame[];
  root: RootOwnerDocument;
  sourceOwnerId: string;
  targetOwnerId: string;
  selectedIds: Array<string | number>;
  placement?: LayerPlacement;
}

export interface MoveLayersBetweenOwnersResult {
  frames: CanvasFrame[];
  root: RootOwnerDocument;
  target: CanvasFrame;
  selectedIds: Array<string | number>;
  primaryId: string | number;
}

function rootAsFrame(root: RootOwnerDocument): CanvasFrame {
  return {
    id: PAGE_ROOT_ID,
    name: root.vector.name,
    x: 0,
    y: 0,
    layers: root.layers,
    vector: structuredClone(root.vector),
    animation: root.animation,
    hiddenLayerIds: root.hiddenLayerIds,
  };
}

function removeMovedContent(owner: CanvasFrame, movedIds: Set<string>): CanvasFrame {
  return {
    ...owner,
    layers: owner.layers.filter((layer) => !movedIds.has(String(layer.id))),
    animation: {
      ...owner.animation,
      blocks: owner.animation.blocks.filter((block) => !movedIds.has(String(block.layerId))),
    },
    hiddenLayerIds: owner.hiddenLayerIds.filter((id) => !movedIds.has(String(id))),
  };
}

/**
 * Pure document command for frame↔frame, frame↔page, and page↔frame moves.
 * It preserves world transforms, animation values, visibility, hierarchy, and selection.
 */
export function moveLayersBetweenOwners({
  frames,
  root,
  sourceOwnerId,
  targetOwnerId,
  selectedIds,
  placement,
}: MoveLayersBetweenOwnersInput): MoveLayersBetweenOwnersResult | null {
  if (sourceOwnerId === targetOwnerId || selectedIds.length === 0) return null;
  const rootFrame = rootAsFrame(root);
  const source =
    sourceOwnerId === PAGE_ROOT_ID ? rootFrame : frames.find((frame) => frame.id === sourceOwnerId);
  const target =
    targetOwnerId === PAGE_ROOT_ID ? rootFrame : frames.find((frame) => frame.id === targetOwnerId);
  if (!source || !target) return null;

  const requestedIds = new Set(selectedIds.map(String));
  const movedIds = new Set<string>();
  for (const layer of source.layers) {
    // A locked selection root cannot be moved directly. Once an unlocked parent
    // moves, however, its entire subtree must stay intact—including locked
    // descendants—just as it does in Figma.
    if (!requestedIds.has(String(layer.id)) || layer.locked) continue;
    for (const id of collectLayerSubtreeIds(source.layers, layer.id)) movedIds.add(id);
  }
  const moving = source.layers.filter((layer) => movedIds.has(String(layer.id)));
  if (moving.length === 0) return null;
  const actualMovedIds = new Set(moving.map((layer) => String(layer.id)));
  if (target.layers.some((layer) => actualMovedIds.has(String(layer.id)))) return null;

  const offsetX = source.x - target.x;
  const offsetY = source.y - target.y;
  const movedLayers = moving.map((layer) => ({
    ...structuredClone(layer),
    translateX: (Number(layer.translateX) || 0) + offsetX,
    translateY: (Number(layer.translateY) || 0) + offsetY,
    parentId:
      layer.parentId != null && actualMovedIds.has(String(layer.parentId)) ? layer.parentId : null,
  }));
  const movedBlocks = source.animation.blocks
    .filter((block) => actualMovedIds.has(String(block.layerId)))
    .map((block) => {
      const axisOffset =
        block.propertyName === "translateX"
          ? offsetX
          : block.propertyName === "translateY"
            ? offsetY
            : 0;
      return {
        ...structuredClone(block),
        fromValue:
          typeof block.fromValue === "number" ? block.fromValue + axisOffset : block.fromValue,
        toValue: typeof block.toValue === "number" ? block.toValue + axisOffset : block.toValue,
      };
    });
  const movedBlockIds = new Set(movedBlocks.map((block) => block.id));
  if (target.animation.blocks.some((block) => movedBlockIds.has(block.id))) return null;

  const placementLayerId =
    [...selectedIds].reverse().find((id) => actualMovedIds.has(String(id))) ??
    movedLayers.at(-1)!.id;
  const appendedLayers = [...target.layers, ...movedLayers];
  const targetLayers = placement
    ? (placeLayerSubtree(appendedLayers, placementLayerId, placement) ?? appendedLayers)
    : appendedLayers;
  const targetAnimation: AnimationState = {
    ...structuredClone(target.animation),
    duration: Math.max(target.animation.duration, ...movedBlocks.map((block) => block.endTime), 1),
    blocks: [...target.animation.blocks, ...movedBlocks],
  };
  const sourceHiddenIds = new Set(source.hiddenLayerIds.map(String));
  const movedHiddenIds = moving
    .filter((layer) => sourceHiddenIds.has(String(layer.id)))
    .map((layer) => String(layer.id));
  const targetHiddenLayerIds = Array.from(
    new Set([...target.hiddenLayerIds.map(String), ...movedHiddenIds]),
  );
  const nextTarget: CanvasFrame = {
    ...target,
    layers: structuredClone(targetLayers),
    animation: structuredClone(targetAnimation),
    hiddenLayerIds: targetHiddenLayerIds,
  };

  const nextFrames = frames.map((frame) => {
    if (frame.id === source.id) return removeMovedContent(frame, actualMovedIds);
    if (frame.id === target.id) return nextTarget;
    return frame;
  });
  const nextRootFrame =
    source.id === PAGE_ROOT_ID
      ? removeMovedContent(rootFrame, actualMovedIds)
      : target.id === PAGE_ROOT_ID
        ? nextTarget
        : rootFrame;
  const retainedSelectionIds = selectedIds.filter((id) => actualMovedIds.has(String(id)));
  const primaryId = retainedSelectionIds.at(-1) ?? movedLayers.at(-1)!.id;

  return {
    frames: nextFrames,
    root: {
      layers: structuredClone(nextRootFrame.layers),
      vector: structuredClone(nextRootFrame.vector),
      animation: structuredClone(nextRootFrame.animation),
      hiddenLayerIds: [...nextRootFrame.hiddenLayerIds],
    },
    target: nextTarget,
    selectedIds: retainedSelectionIds.length ? retainedSelectionIds : [primaryId],
    primaryId,
  };
}

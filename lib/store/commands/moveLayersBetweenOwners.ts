import type { CanvasFrame } from "../defaultWorkspace";
import type { AnimationState, Layer, VectorMetadata } from "../../shapeshifter/types";
import {
  collectLayerSubtreeIds,
  createLayerTreeModel,
  placeLayerSubtree,
  type LayerTreeModel,
  type LayerPlacement,
} from "../../shapeshifter/scene/layerHierarchy";
import { PAGE_ROOT_ID } from "../../shapeshifter/scene/owners";
import { generateId } from "../../shapeshifter/ids";
import { layerTransformToMatrix } from "../../shapeshifter/scene/layerTransform";

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

function moveRoots(tree: LayerTreeModel, selectedIds: Array<string | number>) {
  const requested = new Set(selectedIds.map(String));
  const candidates = tree.allLayers.filter(
    (layer) =>
      requested.has(String(layer.id)) &&
      !layer.locked &&
      !tree.ancestorsOf(layer.id).some((ancestor) => ancestor.locked),
  );
  const roots = new Set(candidates.map((layer) => String(layer.id)));
  return candidates.filter(
    (layer) => !tree.ancestorsOf(layer.id).some((ancestor) => roots.has(String(ancestor.id))),
  );
}

/** Active sibling masks for each preserved ancestor container, from the owner inward. */
function inheritedContainers(tree: LayerTreeModel, layer: Layer) {
  const ancestors = tree.ancestorsOf(layer.id).reverse();
  return [null, ...ancestors].map((ancestor, index) => {
    const child = ancestors[index] ?? layer;
    const siblings = ancestor ? tree.childrenOf(ancestor) : tree.roots;
    const clips = siblings
      .slice(
        0,
        siblings.findIndex((sibling) => String(sibling.id) === String(child.id)),
      )
      .filter((sibling) => sibling.type === "clipPath" && sibling.visible !== false);
    return { ancestor, clips };
  });
}

/** A cross-owner preview is safe only while detached ancestor transforms and masks are static. */
export function canMoveLayerRootsBetweenOwners(
  layers: Layer[],
  animation: AnimationState,
  selectedIds: Array<string | number>,
): boolean {
  const tree = createLayerTreeModel(layers);
  const roots = moveRoots(tree, selectedIds);
  if (!roots.length) return false;
  const animated = new Set(animation.blocks.map((block) => String(block.layerId)));
  return roots.every((layer) =>
    inheritedContainers(tree, layer).every(
      ({ ancestor, clips }) =>
        (!ancestor || !animated.has(String(ancestor.id))) &&
        clips.every((clip) => !animated.has(String(clip.id))),
    ),
  );
}

function flatLayers(tree: LayerTreeModel): Layer[] {
  return tree.allLayers.map(({ children: _children, ...layer }) => ({
    ...layer,
    parentId: tree.ancestorsOf(layer.id)[0]?.id ?? null,
  }));
}

/** Retain static ancestry as editable groups when a root leaves its container. */
export function preserveLayerRootContainers(
  tree: LayerTreeModel,
  roots: Layer[],
  hiddenLayerIds: string[],
  offsetX = 0,
  offsetY = 0,
) {
  const wrapperLayers: Layer[] = [];
  const placementRoots: Array<string | number> = [];
  const wrappedParents = new Map<string, string>();
  for (const layer of roots) {
    const containers = inheritedContainers(tree, layer);
    if (containers.length === 1 && !containers[0]!.clips.length) {
      placementRoots.push(layer.id);
      continue;
    }
    let parentId: string | null = null;
    for (const { ancestor, clips } of containers) {
      if (!ancestor && !clips.length) continue;
      if (
        ancestor &&
        !clips.length &&
        ancestor.visible !== false &&
        !hiddenLayerIds.includes(String(ancestor.id)) &&
        (ancestor.alpha ?? 1) === 1
      ) {
        const matrix = layerTransformToMatrix(ancestor);
        if (
          Math.abs(matrix.a - 1) <= 1e-9 &&
          Math.abs(matrix.d - 1) <= 1e-9 &&
          Math.abs(matrix.b) <= 1e-9 &&
          Math.abs(matrix.c) <= 1e-9 &&
          Math.abs(matrix.e) <= 1e-9 &&
          Math.abs(matrix.f) <= 1e-9
        )
          continue;
      }
      const id = generateId();
      wrapperLayers.push({
        id,
        name: ancestor?.name ?? "Mask group",
        type: "group",
        from: { subPaths: [] },
        visible:
          ancestor?.visible !== false &&
          (!ancestor || !hiddenLayerIds.includes(String(ancestor.id))),
        locked: false,
        parentId,
        translateX: (ancestor?.translateX ?? 0) + (parentId == null ? offsetX : 0),
        translateY: (ancestor?.translateY ?? 0) + (parentId == null ? offsetY : 0),
        rotation: ancestor?.rotation,
        scaleX: ancestor?.scaleX,
        scaleY: ancestor?.scaleY,
        pivotX: ancestor?.pivotX,
        pivotY: ancestor?.pivotY,
        alpha: ancestor?.alpha,
      });
      if (parentId == null) placementRoots.push(id);
      for (const clip of clips)
        wrapperLayers.push({
          ...structuredClone(clip),
          id: generateId(),
          parentId: id,
          children: undefined,
          visible: clip.visible !== false && !hiddenLayerIds.includes(String(clip.id)),
        });
      parentId = id;
    }
    if (parentId != null) wrappedParents.set(String(layer.id), parentId);
    else placementRoots.push(layer.id);
  }
  return { wrapperLayers, placementRoots, wrappedParents };
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
  const sourceOwner =
    sourceOwnerId === PAGE_ROOT_ID ? rootFrame : frames.find((frame) => frame.id === sourceOwnerId);
  const targetOwner =
    targetOwnerId === PAGE_ROOT_ID ? rootFrame : frames.find((frame) => frame.id === targetOwnerId);
  if (!sourceOwner || !targetOwner) return null;
  const sourceTree = createLayerTreeModel(sourceOwner.layers);
  const targetTree = createLayerTreeModel(targetOwner.layers);
  const source = { ...sourceOwner, layers: flatLayers(sourceTree) };
  const target = { ...targetOwner, layers: flatLayers(targetTree) };
  if (!canMoveLayerRootsBetweenOwners(source.layers, source.animation, selectedIds)) return null;
  const roots = moveRoots(sourceTree, selectedIds);
  if (placement?.parentId != null) {
    const parent = target.layers.find((layer) => String(layer.id) === String(placement.parentId));
    if (!parent || parent.type !== "group") return null;
    const ancestry = [parent, ...targetTree.ancestorsOf(parent.id)];
    // Reparenting into a transformed/animated destination needs an inverse
    // transform across its complete timeline. Keep the original owner until
    // that can be represented, instead of changing the artwork on drop.
    if (
      ancestry.some((layer) => {
        const matrix = layerTransformToMatrix(layer);
        return (
          layer.locked ||
          layer.visible === false ||
          (layer.alpha ?? 1) !== 1 ||
          Math.abs(matrix.a - 1) > 1e-9 ||
          Math.abs(matrix.d - 1) > 1e-9 ||
          Math.abs(matrix.b) > 1e-9 ||
          Math.abs(matrix.c) > 1e-9 ||
          Math.abs(matrix.e) > 1e-9 ||
          Math.abs(matrix.f) > 1e-9 ||
          target.animation.blocks.some((block) => String(block.layerId) === String(layer.id))
        );
      })
    )
      return null;
  }

  const movedIds = new Set<string>();
  for (const layer of roots) {
    // A locked selection root cannot be moved directly. Once an unlocked parent
    // moves, however, its entire subtree must stay intact—including locked
    // descendants—just as it does in Figma.
    for (const id of collectLayerSubtreeIds(source.layers, layer.id)) movedIds.add(id);
  }
  const moving = source.layers.filter((layer) => movedIds.has(String(layer.id)));
  if (moving.length === 0) return null;
  const actualMovedIds = new Set(moving.map((layer) => String(layer.id)));
  if (target.layers.some((layer) => actualMovedIds.has(String(layer.id)))) return null;

  const offsetX = source.x - target.x;
  const offsetY = source.y - target.y;
  const { wrapperLayers, placementRoots, wrappedParents } = preserveLayerRootContainers(
    sourceTree,
    roots,
    source.hiddenLayerIds,
    offsetX,
    offsetY,
  );
  const offsetRoots = new Set(
    roots.filter((layer) => !wrappedParents.has(String(layer.id))).map((layer) => String(layer.id)),
  );
  const movedLayers = moving.map((layer) => ({
    ...structuredClone(layer),
    ...(offsetRoots.has(String(layer.id))
      ? {
          translateX: (Number(layer.translateX) || 0) + offsetX,
          translateY: (Number(layer.translateY) || 0) + offsetY,
        }
      : {}),
    parentId:
      wrappedParents.get(String(layer.id)) ??
      (layer.parentId != null && actualMovedIds.has(String(layer.parentId))
        ? layer.parentId
        : null),
  }));
  const movedBlocks = source.animation.blocks
    .filter((block) => actualMovedIds.has(String(block.layerId)))
    .map((block) => {
      const axisOffset = offsetRoots.has(String(block.layerId))
        ? block.propertyName === "translateX"
          ? offsetX
          : block.propertyName === "translateY"
            ? offsetY
            : 0
        : 0;
      return {
        ...structuredClone(block),
        fromValue: axisOffset ? Number(block.fromValue) + axisOffset : block.fromValue,
        toValue: axisOffset ? Number(block.toValue) + axisOffset : block.toValue,
      };
    });
  const movedBlockIds = new Set(movedBlocks.map((block) => block.id));
  if (target.animation.blocks.some((block) => movedBlockIds.has(block.id))) return null;

  let targetLayers = [...target.layers, ...wrapperLayers, ...movedLayers];
  if (placement)
    for (const rootId of placement.afterId != null
      ? [...placementRoots].reverse()
      : placementRoots) {
      const placed = placeLayerSubtree(targetLayers, rootId, placement);
      if (!placed) return null;
      targetLayers = placed;
    }
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
    if (frame.id === source.id) return removeMovedContent(source, actualMovedIds);
    if (frame.id === target.id) return nextTarget;
    return frame;
  });
  const nextRootFrame =
    source.id === PAGE_ROOT_ID
      ? removeMovedContent(source, actualMovedIds)
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

import type { AnimationState, Layer } from "../../shapeshifter/types";
import {
  collectLayerSubtreeIds,
  createLayerTreeModel,
  placeLayerSubtree,
  type LayerPlacement,
} from "../../shapeshifter/scene/layerHierarchy";
import { layerTransformToMatrix } from "../../shapeshifter/scene/layerTransform";
import {
  canMoveLayerRootsBetweenOwners,
  preserveLayerRootContainers,
} from "./moveLayersBetweenOwners";

/** Explain a refused hierarchy change before committing any document state. */
export function layerReparentIssue(
  layers: Layer[],
  animation: AnimationState,
  hiddenLayerIds: string[],
  id: string | number,
  placement: LayerPlacement,
): string | null {
  const tree = createLayerTreeModel(layers);
  const root = tree.allLayers.find((layer) => String(layer.id) === String(id));
  if (!root) return "This layer no longer exists.";
  if (root.locked || tree.ancestorsOf(id).some((layer) => layer.locked))
    return "Unlock the layer and its containing groups before moving it.";
  const descendants = new Set([String(id)]);
  for (const layer of tree.allLayers)
    if (tree.ancestorsOf(layer.id).some((ancestor) => String(ancestor.id) === String(id)))
      descendants.add(String(layer.id));
  if (
    [placement.parentId, placement.beforeId, placement.afterId].some(
      (target) => target != null && descendants.has(String(target)),
    )
  )
    return "A layer cannot be moved inside its own contents.";
  const parentId = tree.ancestorsOf(id)[0]?.id ?? null;
  if (String(parentId ?? "") === String(placement.parentId ?? "")) return null;
  if (!canMoveLayerRootsBetweenOwners(layers, animation, [id]))
    return "This layer inherits animated groups or masks. Move the containing group to preserve its motion.";
  if (placement.parentId != null) {
    const parent = tree.allLayers.find((layer) => String(layer.id) === String(placement.parentId));
    if (!parent || parent.type !== "group") return "Move layers into a group or onto the frame.";
    const ancestry = [parent, ...tree.ancestorsOf(parent.id)];
    if (
      ancestry.some((layer) => {
        const matrix = layerTransformToMatrix(layer);
        return (
          layer.locked ||
          layer.visible === false ||
          hiddenLayerIds.includes(String(layer.id)) ||
          (layer.alpha ?? 1) !== 1 ||
          Math.abs(matrix.a - 1) > 1e-9 ||
          Math.abs(matrix.d - 1) > 1e-9 ||
          Math.abs(matrix.b) > 1e-9 ||
          Math.abs(matrix.c) > 1e-9 ||
          Math.abs(matrix.e) > 1e-9 ||
          Math.abs(matrix.f) > 1e-9 ||
          animation.blocks.some((block) => String(block.layerId) === String(layer.id)) ||
          (layer.timeline?.length ?? 0) > 0
        );
      })
    )
      return "This destination group has transforms, opacity, visibility, or motion. Move onto the frame to preserve the artwork.";
    if (
      ancestry.some((layer) =>
        tree
          .childrenOf(layer)
          .some((child) => child.type === "clipPath" && child.visible !== false),
      )
    )
      return "This destination group contains masks that would change the artwork. Move onto the frame instead.";
  }
  return null;
}

/** Preserve static inherited transforms/masks, keeping authored child IDs and motion unchanged. */
export function reparentLayerPreservingAppearance(
  layers: Layer[],
  animation: AnimationState,
  hiddenLayerIds: string[],
  id: string | number,
  placement: LayerPlacement,
): Layer[] | null {
  if (layerReparentIssue(layers, animation, hiddenLayerIds, id, placement)) return null;
  const tree = createLayerTreeModel(layers);
  const root = tree.allLayers.find((layer) => String(layer.id) === String(id))!;
  const flat = tree.allLayers.map(({ children: _children, ...layer }) => ({
    ...layer,
    parentId: tree.ancestorsOf(layer.id)[0]?.id ?? null,
  }));
  const currentParent = tree.ancestorsOf(id)[0]?.id ?? null;
  if (String(currentParent ?? "") === String(placement.parentId ?? ""))
    return placeLayerSubtree(flat, id, placement);
  const movedIds = collectLayerSubtreeIds(flat, id);
  const { wrapperLayers, placementRoots, wrappedParents } = preserveLayerRootContainers(
    tree,
    [root],
    hiddenLayerIds,
  );
  const moving = flat
    .filter((layer) => movedIds.has(String(layer.id)))
    .map((layer) => ({
      ...layer,
      ...(String(layer.id) === String(id)
        ? { parentId: wrappedParents.get(String(id)) ?? null }
        : {}),
    }));
  const next = [
    ...flat.filter((layer) => !movedIds.has(String(layer.id))),
    ...wrapperLayers,
    ...moving,
  ];
  return placeLayerSubtree(next, placementRoots[0]!, placement) ?? next;
}

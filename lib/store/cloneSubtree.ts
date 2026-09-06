import { collectLayerSubtreeIds } from "../shapeshifter/scene/layerHierarchy";
import { PAGE_ROOT_ID } from "../shapeshifter/scene/owners";
import type { AnimationState, Layer, TimelineBlock } from "../shapeshifter/types";
import type { EditorState } from "./editorStore";

export interface CollectedSubtree {
  layers: Layer[];
  blocks: TimelineBlock[];
  rootIds: string[];
}

export interface RemapCloneOptions {
  prefix: string;
  offsetX?: number;
  offsetY?: number;
  rename?: "copy" | "none";
  /** When a parent is not in the clone set, drop the link (paste) or keep it (duplicate). */
  unmatchedParent?: "drop" | "keep";
}

function randomSuffix() {
  return Math.random().toString(36).slice(2, 6);
}

/** Live layers + animation for a page or artboard owner, including the active projection. */
export function resolveOwnerDocument(state: EditorState, ownerId: string): {
  layers: Layer[];
  animation: AnimationState;
} {
  if (ownerId === PAGE_ROOT_ID) {
    return state.selectedFrameId === PAGE_ROOT_ID
      ? { layers: state.layers, animation: state.animation }
      : { layers: state.rootLayers, animation: state.rootAnimation };
  }
  if (ownerId === state.selectedFrameId) {
    return { layers: state.layers, animation: state.animation };
  }
  const frame = state.frames.find((candidate) => candidate.id === ownerId);
  return {
    layers: frame?.layers ?? [],
    animation: frame?.animation ?? { id: ownerId, name: "Motion", duration: 1, blocks: [] },
  };
}

/** Drop ids that are descendants of another requested root so a group is cloned once. */
export function uniqueSubtreeRoots(layers: Layer[], rootIds: Iterable<string | number>): string[] {
  const requested = [...rootIds].map(String);
  const idSet = new Set(requested);
  const byId = new Map(layers.map((layer) => [String(layer.id), layer]));
  return requested.filter((id) => {
    if (!byId.has(id)) return false;
    let parentId = byId.get(id)?.parentId;
    while (parentId != null && parentId !== "") {
      if (idSet.has(String(parentId))) return false;
      parentId = byId.get(String(parentId))?.parentId;
    }
    return true;
  });
}

/** Collect selected subtrees plus the animation blocks that target them. */
export function collectSubtreeWithAnimation(
  layers: Layer[],
  blocks: readonly TimelineBlock[],
  rootIds: Iterable<string | number>,
): CollectedSubtree {
  const roots = uniqueSubtreeRoots(layers, rootIds);
  const subtreeIds = new Set<string>();
  for (const id of roots) {
    for (const descendant of collectLayerSubtreeIds(layers, id)) subtreeIds.add(descendant);
  }
  return {
    layers: layers
      .filter((layer) => subtreeIds.has(String(layer.id)))
      .map((layer) => ({ ...structuredClone(layer), timeline: [] })),
    blocks: structuredClone(blocks.filter((block) => subtreeIds.has(String(block.layerId)))),
    rootIds: roots,
  };
}

/** Allocate new identities and remap parent / animation targets as one clone. */
export function remapClonedSubtree(
  collected: CollectedSubtree,
  options: RemapCloneOptions,
): { layers: Layer[]; blocks: TimelineBlock[]; idRemap: Map<string, string> } {
  const idRemap = new Map<string, string>();
  collected.layers.forEach((layer, index) => {
    idRemap.set(String(layer.id), `${options.prefix}-${index}-${randomSuffix()}`);
  });
  const rootSet = new Set(collected.rootIds.map(String));
  const blocks = collected.blocks.map((block, index) => ({
    ...structuredClone(block),
    id: `${block.id}-${options.prefix}-${index}-${randomSuffix()}`,
    layerId: idRemap.get(String(block.layerId))!,
  }));
  const layers = collected.layers.map((layer) => {
    const id = idRemap.get(String(layer.id))!;
    const isRoot = rootSet.has(String(layer.id));
    const remappedParent =
      layer.parentId != null ? idRemap.get(String(layer.parentId)) : undefined;
    const parentId =
      remappedParent ??
      (options.unmatchedParent === "keep" ? layer.parentId : undefined);
    return {
      ...structuredClone(layer),
      id,
      name: options.rename === "copy" && isRoot ? `${layer.name} copy` : layer.name,
      parentId,
      translateX: isRoot ? (layer.translateX ?? 0) + (options.offsetX ?? 0) : layer.translateX,
      translateY: isRoot ? (layer.translateY ?? 0) + (options.offsetY ?? 0) : layer.translateY,
      timeline: blocks.filter((block) => String(block.layerId) === String(id)),
    } satisfies Layer;
  });
  return { layers, blocks, idRemap };
}

/** Copy-time snapshot from every owner that holds a requested layer. */
export function collectClipboardFromOwners(
  state: EditorState,
  layerIds: Array<string | number>,
): CollectedSubtree {
  const requested = new Set(layerIds.map(String));
  const matchingRefs = state.selectedLayerRefs.filter((ref) => requested.has(String(ref.layerId)));
  const refs =
    matchingRefs.length > 0
      ? matchingRefs
      : layerIds.map((layerId) => ({ ownerId: state.selectedFrameId, layerId }));

  const layers: Layer[] = [];
  const blocks: TimelineBlock[] = [];
  const rootIds: string[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const owner = resolveOwnerDocument(state, ref.ownerId);
    const collected = collectSubtreeWithAnimation(owner.layers, owner.animation.blocks, [
      ref.layerId,
    ]);
    for (const layer of collected.layers) {
      const id = String(layer.id);
      if (seen.has(id)) continue;
      seen.add(id);
      layers.push(layer);
    }
    for (const block of collected.blocks) {
      if (seen.has(`block:${block.id}`)) continue;
      seen.add(`block:${block.id}`);
      blocks.push(block);
    }
    rootIds.push(...collected.rootIds);
  }
  return { layers, blocks, rootIds };
}

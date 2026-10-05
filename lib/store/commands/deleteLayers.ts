import { collectLayerSubtreeIds } from "../../shapeshifter/scene/layerHierarchy";
import { PAGE_ROOT_ID, type LayerSelectionRef } from "../../shapeshifter/scene/owners";
import type { EditorState } from "../editorStore";
import { saveActiveFrame, saveActiveRoot } from "../workspaceState";
import { flatHierarchy, structuralLockIssue } from "./structuralLayers";

export function planLayerDeletion(
  state: EditorState,
  refs: LayerSelectionRef[],
): { ok: true; patch: Partial<EditorState> } | { ok: false; message: string } {
  if (refs.length === 0) return { ok: false, message: "Select layers to delete." };
  const idsByOwner = new Map<string, Set<string>>();
  for (const ref of refs) {
    const ids = idsByOwner.get(ref.ownerId) ?? new Set<string>();
    ids.add(String(ref.layerId));
    idsByOwner.set(ref.ownerId, ids);
  }
  const savedFrames = saveActiveFrame(state);
  const savedRoot = saveActiveRoot(state);
  for (const [ownerId, ids] of idsByOwner) {
    const owner =
      ownerId === PAGE_ROOT_ID ? savedRoot : savedFrames.find((frame) => frame.id === ownerId);
    if (
      !owner ||
      [...ids].some((id) => !flatHierarchy(owner.layers).some((layer) => String(layer.id) === id))
    )
      return { ok: false, message: "A selected layer no longer exists. Select it again." };
    const issue = structuralLockIssue(owner.layers, ids);
    if (issue) return { ok: false, message: issue };
  }
  const nextFrames = savedFrames.map((frame) => {
    const selectedIds = idsByOwner.get(frame.id);
    if (!selectedIds) return frame;
    const ids = new Set<string>();
    for (const layer of flatHierarchy(frame.layers)) {
      if (selectedIds.has(String(layer.id)) && !layer.locked) {
        for (const descendant of collectLayerSubtreeIds(flatHierarchy(frame.layers), layer.id)) {
          ids.add(descendant);
        }
      }
    }
    return {
      ...frame,
      layers: flatHierarchy(frame.layers).filter((layer) => !ids.has(String(layer.id))),
      animation: {
        ...frame.animation,
        blocks: frame.animation.blocks.filter((block) => !ids.has(String(block.layerId))),
      },
      hiddenLayerIds: frame.hiddenLayerIds.filter((id) => !ids.has(String(id))),
    };
  });
  const selectedRootIds = idsByOwner.get(PAGE_ROOT_ID);
  const rootIds = selectedRootIds
    ? (() => {
        const ids = new Set<string>();
        for (const layer of flatHierarchy(savedRoot.layers)) {
          if (selectedRootIds.has(String(layer.id)) && !layer.locked) {
            for (const descendant of collectLayerSubtreeIds(
              flatHierarchy(savedRoot.layers),
              layer.id,
            )) {
              ids.add(descendant);
            }
          }
        }
        return ids;
      })()
    : undefined;
  const nextRootLayers = rootIds
    ? flatHierarchy(savedRoot.layers).filter((layer) => !rootIds.has(String(layer.id)))
    : savedRoot.layers;
  const nextRootAnimation = rootIds
    ? {
        ...savedRoot.animation,
        blocks: savedRoot.animation.blocks.filter((block) => !rootIds.has(String(block.layerId))),
      }
    : savedRoot.animation;
  const nextRootHidden = rootIds
    ? savedRoot.hiddenLayerIds.filter((id) => !rootIds.has(String(id)))
    : savedRoot.hiddenLayerIds;
  const activeFrame = nextFrames.find((frame) => frame.id === state.selectedFrameId);
  const nextLayers =
    state.selectedFrameId === PAGE_ROOT_ID ? nextRootLayers : (activeFrame?.layers ?? state.layers);
  return {
    ok: true,
    patch: {
      frames: nextFrames,
      rootLayers: nextRootLayers,
      rootAnimation: nextRootAnimation,
      rootHiddenLayerIds: nextRootHidden,
      layers: nextLayers,
      ...(state.selectedFrameId === PAGE_ROOT_ID
        ? { animation: nextRootAnimation, hiddenLayerIds: nextRootHidden }
        : activeFrame
          ? { animation: activeFrame.animation, hiddenLayerIds: activeFrame.hiddenLayerIds }
          : {}),
      selectedLayerId: nextLayers[0]?.id ?? 0,
      selectedBlockIds: state.selectedBlockIds.filter((id) =>
        (state.selectedFrameId === PAGE_ROOT_ID
          ? nextRootAnimation
          : (activeFrame?.animation ?? state.animation)
        ).blocks.some((block) => block.id === id),
      ),
      selectedLayerIds: [],
      selectedLayerRefs: [],
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
      hasCanvasSelection: false,
      selectionKind: "none",
      selectedFrameIds: [],
    },
  };
}

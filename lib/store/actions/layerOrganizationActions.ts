import { parsePath } from "../../shapeshifter/pathUtils";
import { placeLayerSubtree } from "../../shapeshifter/scene/layerHierarchy";
import { PAGE_ROOT_ID, type LayerSelectionRef } from "../../shapeshifter/scene/owners";
import type { Layer } from "../../shapeshifter/types";
import { createPathLayer } from "../defaultWorkspace";
import type { EditorState } from "../editorStore";
import { saveActiveFrame, saveActiveRoot, updateOwnedLayers } from "../workspaceState";

type LayerOrganizationActionKey =
  | "deleteSelectedLayers"
  | "toggleLayerLock"
  | "toggleOwnedLayerLock"
  | "renameOwnedLayer"
  | "reorderLayer"
  | "reorderOwnedLayer"
  | "reparentOwnedLayer"
  | "nudgeLayerZOrder"
  | "groupSelectedLayers"
  | "ungroupSelectedLayer"
  | "duplicateSelectedLayersOffset";

type SetEditorState = (
  update: Partial<EditorState> | ((state: EditorState) => Partial<EditorState> | EditorState),
) => void;

export function createLayerOrganizationActions(
  set: SetEditorState,
  get: () => EditorState,
): Pick<EditorState, LayerOrganizationActionKey> {
  return {
    deleteSelectedLayers: () => {
      const state = get();
      const refs =
        state.selectedLayerRefs.length > 0
          ? state.selectedLayerRefs
          : state.selectedLayerIds.map((layerId) => ({
              ownerId: state.selectedFrameId,
              layerId,
            }));
      if (refs.length === 0) return;
      const idsByOwner = new Map<string, Set<string>>();
      for (const ref of refs) {
        const ids = idsByOwner.get(ref.ownerId) ?? new Set<string>();
        ids.add(String(ref.layerId));
        idsByOwner.set(ref.ownerId, ids);
      }
      const savedFrames = saveActiveFrame(state);
      const savedRoot = saveActiveRoot(state);
      const nextFrames = savedFrames.map((frame) => {
        const selectedIds = idsByOwner.get(frame.id);
        if (!selectedIds) return frame;
        const ids = new Set(
          frame.layers
            .filter((layer) => selectedIds.has(String(layer.id)) && !layer.locked)
            .map((layer) => String(layer.id)),
        );
        return {
          ...frame,
          layers: frame.layers.filter((layer) => !ids.has(String(layer.id)) || layer.locked),
          animation: {
            ...frame.animation,
            blocks: frame.animation.blocks.filter((block) => !ids.has(String(block.layerId))),
          },
          hiddenLayerIds: frame.hiddenLayerIds.filter((id) => !ids.has(String(id))),
        };
      });
      const selectedRootIds = idsByOwner.get(PAGE_ROOT_ID);
      const rootIds = selectedRootIds
        ? new Set(
            savedRoot.layers
              .filter((layer) => selectedRootIds.has(String(layer.id)) && !layer.locked)
              .map((layer) => String(layer.id)),
          )
        : undefined;
      const nextRootLayers = rootIds
        ? savedRoot.layers.filter((layer) => !rootIds.has(String(layer.id)) || layer.locked)
        : savedRoot.layers;
      const nextRootAnimation = rootIds
        ? {
            ...savedRoot.animation,
            blocks: savedRoot.animation.blocks.filter(
              (block) => !rootIds.has(String(block.layerId)),
            ),
          }
        : savedRoot.animation;
      const nextRootHidden = rootIds
        ? savedRoot.hiddenLayerIds.filter((id) => !rootIds.has(String(id)))
        : savedRoot.hiddenLayerIds;
      const activeFrame = nextFrames.find((frame) => frame.id === state.selectedFrameId);
      const nextLayers =
        state.selectedFrameId === PAGE_ROOT_ID
          ? nextRootLayers
          : (activeFrame?.layers ?? state.layers);
      get().pushHistory();
      set({
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
        selectedLayerIds: [],
        selectedLayerRefs: [],
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        hasCanvasSelection: false,
        selectionKind: "none",
        selectedFrameIds: [],
      });
    },

    toggleLayerLock: (id) => {
      get().toggleOwnedLayerLock(get().selectedFrameId, id);
    },
    toggleOwnedLayerLock: (ownerId, id) => {
      const state = get();
      get().pushHistory();
      set(
        updateOwnedLayers(state, ownerId, (layers) =>
          layers.map((layer) =>
            String(layer.id) === String(id) ? { ...layer, locked: !layer.locked } : layer,
          ),
        ),
      );
    },

    renameOwnedLayer: (ownerId, id, name) => {
      const nextName = name.trim();
      if (!nextName) return;
      const state = get();
      const ownerLayers =
        ownerId === PAGE_ROOT_ID
          ? saveActiveRoot(state).layers
          : saveActiveFrame(state).find((frame) => frame.id === ownerId)?.layers;
      const current = ownerLayers?.find((layer) => String(layer.id) === String(id));
      if (!current || current.name === nextName) return;
      get().pushHistory();
      set(
        updateOwnedLayers(state, ownerId, (layers) =>
          layers.map((layer) =>
            String(layer.id) === String(id) ? { ...layer, name: nextName } : layer,
          ),
        ),
      );
    },

    reorderLayer: (id, toIndex) => {
      const { layers } = get();
      const fromIndex = layers.findIndex((l) => String(l.id) === String(id));
      if (fromIndex === -1) return;
      const clamped = Math.max(0, Math.min(layers.length - 1, toIndex));
      if (clamped === fromIndex) return;
      const next = [...layers];
      const [item] = next.splice(fromIndex, 1);
      next.splice(clamped, 0, item!);
      get().pushHistory();
      set({ layers: next });
    },

    reorderOwnedLayer: (ownerId, id, toIndex) => {
      const state = get();
      const ownerLayers =
        ownerId === PAGE_ROOT_ID
          ? saveActiveRoot(state).layers
          : saveActiveFrame(state).find((frame) => frame.id === ownerId)?.layers;
      if (!ownerLayers) return;
      const fromIndex = ownerLayers.findIndex((layer) => String(layer.id) === String(id));
      if (fromIndex === -1) return;
      const clamped = Math.max(0, Math.min(ownerLayers.length - 1, toIndex));
      if (clamped === fromIndex) return;
      get().pushHistory();
      set(
        updateOwnedLayers(state, ownerId, (layers) => {
          const next = [...layers];
          const [item] = next.splice(fromIndex, 1);
          next.splice(clamped, 0, item!);
          return next;
        }),
      );
    },

    reparentOwnedLayer: (ownerId, id, target, options) => {
      const state = get();
      const ownerLayers =
        ownerId === PAGE_ROOT_ID
          ? saveActiveRoot(state).layers
          : saveActiveFrame(state).find((frame) => frame.id === ownerId)?.layers;
      if (!ownerLayers) return false;
      const next = placeLayerSubtree(ownerLayers, id, target);
      if (!next) return false;
      if (options?.recordHistory !== false) get().pushHistory();
      set(updateOwnedLayers(state, ownerId, () => next));
      return true;
    },

    nudgeLayerZOrder: (id, delta) => {
      const { layers } = get();
      const fromIndex = layers.findIndex((l) => String(l.id) === String(id));
      if (fromIndex === -1 || !delta) return;
      get().reorderLayer(id, fromIndex + delta);
    },

    groupSelectedLayers: () => {
      const { layers, selectedLayerIds, selectedLayerId } = get();
      const ids =
        selectedLayerIds.length > 0
          ? selectedLayerIds
          : selectedLayerId != null
            ? [selectedLayerId]
            : [];
      if (ids.length < 1) return;
      const idSet = new Set(ids.map(String));
      const groupId = `group-${Date.now()}`;
      const groupLayer: Layer = createPathLayer({
        id: groupId,
        name: "Group",
        type: "group",
        from: parsePath("M 0 0 Z"),
        visible: true,
        locked: false,
        expanded: true,
      });
      const reparented = layers.map((l) =>
        idSet.has(String(l.id)) ? { ...l, parentId: groupId } : l,
      );
      // Insert group before first selected
      const firstIdx = reparented.findIndex((l) => idSet.has(String(l.id)));
      const next = [...reparented];
      next.splice(Math.max(0, firstIdx), 0, groupLayer);
      get().pushHistory();
      set({
        layers: next,
        selectedLayerId: groupId,
        selectedLayerIds: [groupId],
        selectedLayerRefs: [{ ownerId: get().selectedFrameId, layerId: groupId }],
        hasCanvasSelection: true,
        selectionKind: "layer",
        selectedFrameIds: [],
      });
    },

    ungroupSelectedLayer: () => {
      const { layers, selectedLayerId } = get();
      const group = layers.find((l) => String(l.id) === String(selectedLayerId));
      if (!group || group.type !== "group") return;
      const gid = String(group.id);
      const children = layers.filter((l) => String(l.parentId) === gid);
      const childIds = children.map((c) => c.id);
      const next = layers
        .filter((l) => String(l.id) !== gid)
        .map((l) =>
          String(l.parentId) === gid ? { ...l, parentId: group.parentId ?? undefined } : l,
        );
      get().pushHistory();
      set({
        layers: next,
        selectedLayerId: childIds[0] ?? next[0]?.id ?? 0,
        selectedLayerIds: childIds.length ? childIds : next[0] ? [next[0].id] : [],
        selectedLayerRefs: (childIds.length ? childIds : next[0] ? [next[0].id] : []).map(
          (layerId) => ({ ownerId: get().selectedFrameId, layerId }),
        ),
        hasCanvasSelection: true,
        selectionKind: "layer",
        selectedFrameIds: [],
      });
    },

    duplicateSelectedLayersOffset: (dx, dy, options) => {
      const state = get();
      const refs =
        state.selectedLayerRefs.length > 0
          ? state.selectedLayerRefs
          : (state.selectedLayerIds.length > 0
              ? state.selectedLayerIds
              : state.selectedLayerId != null
                ? [state.selectedLayerId]
                : []
            ).map((layerId) => ({ ownerId: state.selectedFrameId, layerId }));
      if (refs.length === 0) return;
      const savedFrames = saveActiveFrame(state);
      const savedRoot = saveActiveRoot(state);
      const layersForOwner = (ownerId: string) =>
        ownerId === PAGE_ROOT_ID
          ? savedRoot.layers
          : (savedFrames.find((frame) => frame.id === ownerId)?.layers ?? []);
      const timestamp = Date.now();
      const clonesByOwner = new Map<string, Layer[]>();
      const cloneRefs: LayerSelectionRef[] = [];
      for (const ref of refs) {
        const layer = layersForOwner(ref.ownerId).find(
          (candidate) => String(candidate.id) === String(ref.layerId),
        );
        if (!layer || layer.locked) continue;
        const clone: Layer = {
          ...structuredClone(layer),
          id: `${layer.id}-dup-${timestamp}-${Math.random().toString(36).slice(2, 6)}`,
          name: `${layer.name} copy`,
          translateX: (layer.translateX ?? 0) + dx,
          translateY: (layer.translateY ?? 0) + dy,
        };
        clonesByOwner.set(ref.ownerId, [...(clonesByOwner.get(ref.ownerId) ?? []), clone]);
        cloneRefs.push({ ownerId: ref.ownerId, layerId: clone.id });
      }
      if (cloneRefs.length === 0) return;
      const nextFrames = savedFrames.map((frame) => ({
        ...frame,
        layers: [...frame.layers, ...(clonesByOwner.get(frame.id) ?? [])],
      }));
      const nextRootLayers = [...savedRoot.layers, ...(clonesByOwner.get(PAGE_ROOT_ID) ?? [])];
      const activeClones = cloneRefs
        .filter((ref) => ref.ownerId === state.selectedFrameId)
        .map((ref) => ref.layerId);
      const nextLayers =
        state.selectedFrameId === PAGE_ROOT_ID
          ? nextRootLayers
          : (nextFrames.find((frame) => frame.id === state.selectedFrameId)?.layers ??
            state.layers);
      if (options?.recordHistory !== false) get().pushHistory();
      set({
        frames: nextFrames,
        rootLayers: nextRootLayers,
        layers: nextLayers,
        selectedLayerId: activeClones.at(-1) ?? cloneRefs.at(-1)!.layerId,
        selectedLayerIds: activeClones,
        selectedLayerRefs: cloneRefs,
        hasCanvasSelection: true,
        selectionKind: "layer",
        selectedFrameIds: [],
      });
    },
  };
}

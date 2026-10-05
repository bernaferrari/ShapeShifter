import { planLayerDeletion } from "../commands/deleteLayers";
import { toast } from "sonner";
import { collectLayerSubtreeIds } from "../../shapeshifter/scene/layerHierarchy";
import { PAGE_ROOT_ID, type LayerSelectionRef } from "../../shapeshifter/scene/owners";
import type { Layer, TimelineBlock } from "../../shapeshifter/types";
import {
  collectSubtreeWithAnimation,
  remapClonedSubtree,
  uniqueSubtreeRoots,
} from "../cloneSubtree";
import {
  flatHierarchy,
  groupLayers,
  ungroupLayer,
  structuralLockIssue,
} from "../commands/structuralLayers";
import type { EditorState } from "../editorStore";
import { saveActiveFrame, saveActiveRoot, updateOwnedLayers } from "../workspaceState";
import { reparentLayerPreservingAppearance } from "../commands/reparentLayer";

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
      const refs = state.selectedLayerRefs.length
        ? state.selectedLayerRefs
        : state.selectedLayerIds.map((layerId) => ({ ownerId: state.selectedFrameId, layerId }));
      const result = planLayerDeletion(state, refs);
      if (!result.ok) {
        toast.error("Cannot delete selection", { description: result.message });
        return;
      }
      state.pushHistory();
      set(result.patch);
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
      const owner =
        ownerId === PAGE_ROOT_ID
          ? saveActiveRoot(state)
          : saveActiveFrame(state).find((frame) => frame.id === ownerId);
      if (!owner) return false;
      const next = reparentLayerPreservingAppearance(
        owner.layers,
        owner.animation,
        owner.hiddenLayerIds,
        id,
        target,
      );
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
      const state = get();
      if (!state.hasCanvasSelection || state.selectionKind !== "layer") return;
      if (state.selectedLayerRefs.some((ref) => ref.ownerId !== state.selectedFrameId)) {
        toast.error("Cannot group selection", {
          description: "Select layers in one artboard or on the page.",
        });
        return;
      }
      const result = groupLayers(
        state.layers,
        state.selectedLayerIds.length ? state.selectedLayerIds : [state.selectedLayerId],
      );
      if (!result.ok) {
        toast.error("Cannot group selection", { description: result.message });
        return;
      }
      state.pushHistory();
      set({
        layers: result.layers,
        selectedLayerId: result.selectedIds[0]!,
        selectedLayerIds: result.selectedIds,
        selectedLayerRefs: result.selectedIds.map((layerId) => ({
          ownerId: state.selectedFrameId,
          layerId,
        })),
        selectedBlockIds: [],
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        hasCanvasSelection: true,
        selectionKind: "layer",
        selectedFrameIds: [],
      });
    },

    ungroupSelectedLayer: () => {
      const state = get();
      if (!state.hasCanvasSelection || state.selectionKind !== "layer") return;
      const result = ungroupLayer(
        state.layers,
        state.animation,
        state.hiddenLayerIds,
        state.selectedLayerId,
      );
      if (!result.ok) {
        toast.error("Cannot ungroup", { description: result.message });
        return;
      }
      state.pushHistory();
      set({
        layers: result.layers,
        selectedLayerId: result.selectedIds[0] ?? 0,
        selectedLayerIds: result.selectedIds,
        selectedLayerRefs: result.selectedIds.map((layerId) => ({
          ownerId: state.selectedFrameId,
          layerId,
        })),
        hiddenLayerIds: state.hiddenLayerIds.filter(
          (id) => String(id) !== String(state.selectedLayerId),
        ),
        selectedBlockIds: [],
        hasCanvasSelection: result.selectedIds.length > 0,
        selectionKind: result.selectedIds.length ? "layer" : "none",
        selectedFrameIds: [],
      });
    },

    duplicateSelectedLayersOffset: (dx, dy, options) => {
      const state = get();
      if (!state.hasCanvasSelection || state.selectionKind !== "layer") return;
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
      const blocksByOwner = new Map<string, TimelineBlock[]>();
      const cloneRefs: LayerSelectionRef[] = [];
      const sourceByClone = new Map<string, string>();
      const processedRoots = new Set<string>();
      for (const ref of refs) {
        const rootKey = `${ref.ownerId}\0${String(ref.layerId)}`;
        if (processedRoots.has(rootKey)) continue;
        processedRoots.add(rootKey);
        const ownerLayers = flatHierarchy(layersForOwner(ref.ownerId));
        if (
          !uniqueSubtreeRoots(
            ownerLayers,
            refs.filter((r) => r.ownerId === ref.ownerId).map((r) => r.layerId),
          ).includes(String(ref.layerId))
        )
          continue;
        const layer = ownerLayers.find((candidate) => String(candidate.id) === String(ref.layerId));
        if (!layer || structuralLockIssue(ownerLayers, [layer.id], false)) continue;
        const ownerAnimation =
          ref.ownerId === PAGE_ROOT_ID
            ? savedRoot.animation
            : savedFrames.find((frame) => frame.id === ref.ownerId)?.animation;
        const remapped = remapClonedSubtree(
          collectSubtreeWithAnimation(
            ownerLayers.map((item) => {
              const hidden =
                ref.ownerId === PAGE_ROOT_ID
                  ? savedRoot.hiddenLayerIds
                  : (savedFrames.find((frame) => frame.id === ref.ownerId)?.hiddenLayerIds ?? []);
              return hidden.includes(String(item.id)) ? { ...item, visible: false } : item;
            }),
            ownerAnimation?.blocks ?? [],
            [layer.id],
          ),
          {
            prefix: `dup-${timestamp}`,
            offsetX: dx,
            offsetY: dy,
            rename: "copy",
            unmatchedParent: "keep",
          },
        );
        clonesByOwner.set(ref.ownerId, [
          ...(clonesByOwner.get(ref.ownerId) ?? []),
          ...remapped.layers,
        ]);
        blocksByOwner.set(ref.ownerId, [
          ...(blocksByOwner.get(ref.ownerId) ?? []),
          ...remapped.blocks,
        ]);
        sourceByClone.set(remapped.idRemap.get(String(layer.id))!, String(layer.id));
        cloneRefs.push({
          ownerId: ref.ownerId,
          layerId: remapped.idRemap.get(String(layer.id))!,
        });
      }
      if (cloneRefs.length === 0) return;
      const insertClones = (ownerId: string, original: Layer[]) => {
        let next = flatHierarchy(original);
        for (const ref of cloneRefs.filter((ref) => ref.ownerId === ownerId)) {
          const sourceIds = collectLayerSubtreeIds(next, sourceByClone.get(String(ref.layerId))!);
          const index =
            next.reduce((last, layer, i) => (sourceIds.has(String(layer.id)) ? i : last), -1) + 1;
          const allClones = clonesByOwner.get(ownerId) ?? [];
          const ids = collectLayerSubtreeIds(allClones, ref.layerId);
          next = [
            ...next.slice(0, index),
            ...allClones.filter((layer) => ids.has(String(layer.id))),
            ...next.slice(index),
          ];
        }
        return next;
      };
      const nextFrames = savedFrames.map((frame) => {
        const clones = clonesByOwner.get(frame.id);
        const blocks = blocksByOwner.get(frame.id);
        if (!clones && !blocks) return frame;
        return {
          ...frame,
          layers: insertClones(frame.id, frame.layers),
          ...(blocks
            ? { animation: { ...frame.animation, blocks: [...frame.animation.blocks, ...blocks] } }
            : {}),
        };
      });
      const nextRootLayers = insertClones(PAGE_ROOT_ID, savedRoot.layers);
      const rootBlocks = blocksByOwner.get(PAGE_ROOT_ID);
      const nextRootAnimation = rootBlocks
        ? { ...savedRoot.animation, blocks: [...savedRoot.animation.blocks, ...rootBlocks] }
        : savedRoot.animation;
      const activeFrame = nextFrames.find((frame) => frame.id === state.selectedFrameId);
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
        rootAnimation: nextRootAnimation,
        layers: nextLayers,
        ...(state.selectedFrameId === PAGE_ROOT_ID
          ? { animation: nextRootAnimation }
          : activeFrame
            ? { animation: activeFrame.animation }
            : {}),
        selectedLayerId: activeClones.at(-1) ?? cloneRefs.at(-1)!.layerId,
        selectedLayerIds: activeClones,
        selectedLayerRefs: cloneRefs,
        selectedBlockIds: [],
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        hasCanvasSelection: true,
        selectionKind: "layer",
        selectedFrameIds: [],
      });
    },
  };
}

import { autoFixPathPair } from "../../shapeshifter/pathUtils";
import { getDemoProject } from "../../shapeshifter/demoProjects";
import { PAGE_ROOT_ID } from "../../shapeshifter/scene/owners";
import type { AnimationState, Layer } from "../../shapeshifter/types";
import type { EditorState } from "../editorStore";
import {
  buildLoadedDocumentState,
  buildLoadedProjectState,
  normalizeLayers,
  saveActiveFrame,
  saveActiveRoot,
} from "../workspaceState";

type LayerDataActionKey =
  | "autoFixSelectedLayer"
  | "loadSample"
  | "setLayers"
  | "importLayers"
  | "loadProject"
  | "loadDocument"
  | "replaceSelectedLayerPaths"
  | "updateSelectedLayer"
  | "updateSelectedLayers";

type SetEditorState = (
  update: Partial<EditorState> | ((state: EditorState) => Partial<EditorState> | EditorState),
) => void;

export function createLayerDataActions(
  set: SetEditorState,
  get: () => EditorState,
  initialRootAnimation: AnimationState,
): Pick<EditorState, LayerDataActionKey> {
  return {
    autoFixSelectedLayer: () => {
      const { layers, selectedLayerId } = get();
      const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
      if (layerIndex === -1) return false;
      const layer = layers[layerIndex];
      if (layer.locked) return false;

      if (!layer.to) return false; // static layer — nothing to auto-fix.
      const [from, to] = autoFixPathPair(layer.from, layer.to);

      const newLayers = [...layers];
      newLayers[layerIndex] = { ...layer, from, to, pathData: from };
      get().pushHistory();
      set({ layers: newLayers });
      return true;
    },

    loadSample: (index: number) => {
      const { project } = getDemoProject(index);
      get().pushHistory();
      set(buildLoadedProjectState(project, initialRootAnimation, "Sample"));
    },
    setLayers: (layers) => {
      const normalized = normalizeLayers(layers);
      const selectedLayerId = normalized[0]?.id ?? 0;
      get().pushHistory();
      set({
        layers: normalized,
        selectedLayerId,
        selectedLayerIds: normalized[0] ? [selectedLayerId] : [],
        selectedLayerRefs: normalized[0]
          ? [{ ownerId: get().selectedFrameId, layerId: selectedLayerId }]
          : [],
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        selectedBlockIds: [],
        hasCanvasSelection: normalized.length > 0,
        selectionKind: normalized.length > 0 ? "layer" : "none",
        selectedFrameIds: [],
        progress: 0,
      });
    },
    importLayers: (incomingLayers) => {
      if (!incomingLayers.length) return;
      const { layers } = get();
      const normalizedIncoming = normalizeLayers(incomingLayers);
      const selectedLayerId = normalizedIncoming[0]?.id ?? layers[0]?.id ?? 0;
      get().pushHistory();
      set({
        layers: [...layers, ...normalizedIncoming],
        selectedLayerId,
        selectedLayerIds: [selectedLayerId],
        selectedLayerRefs: [{ ownerId: get().selectedFrameId, layerId: selectedLayerId }],
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        selectedBlockIds: [],
        hasCanvasSelection: true,
        selectionKind: "layer",
        selectedFrameIds: [],
      });
    },
    loadProject: (project) => {
      get().pushHistory();
      set(buildLoadedProjectState(project, initialRootAnimation, "Imported frame"));
    },
    loadDocument: (snapshot) => {
      get().pushHistory();
      set(buildLoadedDocumentState(snapshot));
    },
    replaceSelectedLayerPaths: (paths) => {
      const { layers, selectedLayerId } = get();
      const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
      if (layerIndex === -1) return;

      const newLayers = [...layers];
      newLayers[layerIndex] = {
        ...newLayers[layerIndex],
        ...paths,
        pathData: paths.from ?? newLayers[layerIndex].pathData,
      };
      get().pushHistory();
      set({ layers: newLayers });
    },
    updateSelectedLayer: (patch, options) => {
      const state = get();
      const ids = state.selectedLayerIds;
      // Path geometry must never be batch-copied onto multi-select (corrupts siblings).
      const isPathPatch = patch.from != null || patch.to != null || patch.pathData != null;
      if ((ids.length > 1 || state.selectedLayerRefs.length > 1) && !isPathPatch) {
        // Shared style/transform props → all selected (Figma batch).
        get().updateSelectedLayers(patch, options);
        return;
      }
      const { layers, selectedLayerId } = get();
      const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
      if (layerIndex === -1) return;
      if (layers[layerIndex]?.locked) return;

      const newLayers = [...layers];
      newLayers[layerIndex] = { ...newLayers[layerIndex], ...patch };
      if (options?.recordHistory !== false) {
        get().pushHistory();
      }
      set({ layers: newLayers });
    },

    updateSelectedLayers: (patch, options) => {
      const state = get();
      const refs = options?.ids
        ? options.ids.map((layerId) => ({ ownerId: state.selectedFrameId, layerId }))
        : state.selectedLayerRefs.length > 0
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
      const updateOwner = (ownerId: string, ownerLayers: Layer[]) => {
        const ids = idsByOwner.get(ownerId);
        if (!ids) return ownerLayers;
        return ownerLayers.map((layer) =>
          !ids.has(String(layer.id)) || layer.locked ? layer : { ...layer, ...patch },
        );
      };
      const savedFrames = saveActiveFrame(state);
      const savedRoot = saveActiveRoot(state);
      const nextFrames = savedFrames.map((frame) => ({
        ...frame,
        layers: updateOwner(frame.id, frame.layers),
      }));
      const nextRootLayers = updateOwner(PAGE_ROOT_ID, savedRoot.layers);
      const nextLayers =
        state.selectedFrameId === PAGE_ROOT_ID
          ? nextRootLayers
          : (nextFrames.find((frame) => frame.id === state.selectedFrameId)?.layers ??
            state.layers);
      if (options?.recordHistory !== false) {
        get().pushHistory();
      }
      set({ frames: nextFrames, rootLayers: nextRootLayers, layers: nextLayers });
    },
  };
}

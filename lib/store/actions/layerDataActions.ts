import {
  workspaceFromDocument,
  validateEditorDocument,
  documentEditingIssues,
} from "../../shapeshifter/documentModel";
import { pathToString } from "../../shapeshifter/pathUtils";
import { toast } from "sonner";
import { structuralLockIssue } from "../commands/structuralLayers";
import {
  commitPathTopology,
  pathPoseSourceSignature,
  preparePathPoseFamily,
} from "../commands/pathTopology";
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
  | "previewPrepareForMorph"
  | "commitMorphPreview"
  | "cancelMorphPreview"
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
    previewPrepareForMorph: () => {
      const state = get();
      const layer = state.layers.find(
        (candidate) => String(candidate.id) === String(state.selectedLayerId),
      );
      if (!layer || !layer.to) return false;
      const issue = structuralLockIssue(state.layers, [layer.id], false);
      if (issue) {
        toast.error(issue);
        return false;
      }
      try {
        const prepared = preparePathPoseFamily(state, layer);
        const preparedPathValues = Object.fromEntries(
          prepared.values.map((value, index) => [value, prepared.paths[index]]),
        );
        set({
          morphPreview: {
            layerId: layer.id,
            sourceSignature: pathPoseSourceSignature(state, layer),
            preparedPathValues,
            originalFrom: structuredClone(layer.from),
            originalTo: structuredClone(layer.to),
            preparedFrom: preparedPathValues[pathToString(layer.from)],
            preparedTo: preparedPathValues[pathToString(layer.to)],
            mapping: prepared.mapping,
          },
        });
        return true;
      } catch (cause) {
        toast.error(
          cause instanceof Error
            ? cause.message
            : "The points could not be matched. Your artwork has been preserved.",
        );
        return false;
      }
    },

    commitMorphPreview: () => {
      const state = get();
      const preview = state.morphPreview;
      if (!preview) return false;
      const layer = state.layers.find(
        (candidate) => String(candidate.id) === String(preview.layerId),
      );
      if (!layer || pathPoseSourceSignature(state, layer) !== preview.sourceSignature) {
        set({ morphPreview: null });
        toast.error("The animation changed. Match points again to preview the current artwork.");
        return false;
      }
      return commitPathTopology(
        set,
        get,
        layer.id,
        (path) => preview.preparedPathValues[pathToString(path)] ?? path,
        { mapping: preview.mapping },
      );
    },

    cancelMorphPreview: () => {
      set({ morphPreview: null });
    },

    autoFixSelectedLayer: () => {
      if (!get().previewPrepareForMorph()) return false;
      return get().commitMorphPreview();
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
    loadDocument: (document) => {
      const invalid = validateEditorDocument(document);
      if (invalid.length) throw new Error(`Cannot open this project: ${invalid[0]}`);
      const unsupported = documentEditingIssues(document);
      if (unsupported.length) throw new Error(`Cannot open this project: ${unsupported[0]}`);
      const snapshot = workspaceFromDocument(document);
      get().pushHistory();
      set({ ...buildLoadedDocumentState(snapshot), document: structuredClone(document) });
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

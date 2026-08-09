import { computeDetailViewport } from "../../shapeshifter/camera";
import { PAGE_ROOT_ID, type LayerSelectionRef } from "../../shapeshifter/scene/owners";
import type { AnimationState, Layer, VectorMetadata } from "../../shapeshifter/types";
import type { CanvasFrame } from "../defaultWorkspace";
import { moveLayersBetweenOwners } from "../commands/moveLayersBetweenOwners";
import {
  cloneFrame,
  cloneLayers,
  getFirstEditableLayerId,
  saveActiveFrame,
  saveActiveRoot,
} from "../workspaceState";
import type { EditorState, MoveLayerOptions } from "../editorStore";

type SetEditorState = (
  next: Partial<EditorState> | ((state: EditorState) => Partial<EditorState> | EditorState),
) => void;
type GetEditorState = () => EditorState;

type FrameActionKeys =
  | "addFrame"
  | "duplicateFrame"
  | "renameFrame"
  | "deleteFrame"
  | "selectFrame"
  | "selectFrames"
  | "setSelectedFrameIds"
  | "selectRootLayer"
  | "moveFrame"
  | "moveFrames"
  | "moveSelectedLayersToFrame"
  | "moveSelectedLayersToRoot";

interface FrameActionDefaults {
  layers: Layer[];
  vector: VectorMetadata;
  animation: AnimationState;
}

const vectorViewport = (vector: VectorMetadata) => computeDetailViewport(vector);

function buildOwnerMoveState(
  state: EditorState,
  targetOwnerId: string,
  options?: MoveLayerOptions,
) {
  const selectedIds =
    state.selectedLayerIds.length > 0
      ? state.selectedLayerIds
      : state.selectedLayerId != null
        ? [state.selectedLayerId]
        : [];
  if (selectedIds.length === 0) return null;
  const result = moveLayersBetweenOwners({
    frames: saveActiveFrame(state),
    root: saveActiveRoot(state),
    sourceOwnerId: state.selectedFrameId,
    targetOwnerId,
    selectedIds,
    placement: options?.placement,
  });
  if (!result) return null;
  return {
    frames: result.frames,
    rootLayers: result.root.layers,
    rootAnimation: result.root.animation,
    rootHiddenLayerIds: result.root.hiddenLayerIds,
    selectedFrameId: result.target.id,
    layers: result.target.layers,
    vector: result.target.vector,
    animation: result.target.animation,
    hiddenLayerIds: result.target.hiddenLayerIds,
    selectedLayerId: result.primaryId,
    selectedLayerIds: result.selectedIds,
    selectedLayerRefs: result.selectedIds.map((layerId) => ({
      ownerId: result.target.id,
      layerId,
    })),
    selection: null,
    selectedPoints: [],
    selectedSubPaths: [],
    selectedBlockIds: [],
    hasCanvasSelection: true,
    selectionKind: "layer" as const,
    selectedFrameIds: [],
    toolMode: "select" as const,
    ...(result.target.id === PAGE_ROOT_ID
      ? {}
      : { detailViewport: vectorViewport(result.target.vector) }),
  };
}

export function createFrameActions(
  set: SetEditorState,
  get: GetEditorState,
  defaults: FrameActionDefaults,
): Pick<EditorState, FrameActionKeys> {
  return {
    addFrame: () => {
      const state = get();
      const savedFrames = saveActiveFrame(state);
      const name = `Frame ${savedFrames.length + 1}`;
      const gap = 24;
      const rightEdge = savedFrames.reduce(
        (max, frame) => Math.max(max, (frame.x ?? 0) + (frame.vector?.width ?? 48)),
        0,
      );
      const topEdge = savedFrames.length
        ? Math.min(...savedFrames.map((frame) => frame.y ?? 0))
        : 40;
      const frame: CanvasFrame = {
        id: `frame-${Date.now()}`,
        name,
        x: savedFrames.length ? rightEdge + gap : 40,
        y: topEdge,
        layers: cloneLayers(defaults.layers),
        vector: { ...defaults.vector, id: `vector-${Date.now()}`, name },
        animation: { ...defaults.animation, id: `anim-${Date.now()}` },
        hiddenLayerIds: [],
      };
      state.pushHistory();
      set({
        frames: [...savedFrames, frame],
        selectedFrameId: frame.id,
        selectedFrameIds: [frame.id],
        detailViewport: vectorViewport(frame.vector),
        zoom: 1,
        layers: cloneLayers(frame.layers),
        vector: structuredClone(frame.vector),
        animation: structuredClone(frame.animation),
        hiddenLayerIds: [],
        selectedLayerId: getFirstEditableLayerId(frame.layers),
        selectedLayerIds: [],
        selectedLayerRefs: [],
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        selectedBlockIds: [],
        hasCanvasSelection: true,
        selectionKind: "frame",
        progress: 0,
        isPlaying: false,
      });
    },

    duplicateFrame: () => {
      const state = get();
      const savedFrames = saveActiveFrame(state);
      const activeFrame = savedFrames.find((frame) => frame.id === state.selectedFrameId);
      if (!activeFrame) return;
      const frame = cloneFrame({
        ...activeFrame,
        id: `frame-${Date.now()}`,
        name: `${activeFrame.name} copy`,
        x: activeFrame.x + (activeFrame.vector?.width ?? 48) + 24,
        y: activeFrame.y,
        vector: {
          ...activeFrame.vector,
          id: `vector-${Date.now()}`,
          name: `${activeFrame.name} copy`,
        },
        animation: { ...activeFrame.animation, id: `anim-${Date.now()}` },
      });
      state.pushHistory();
      set({
        frames: [...savedFrames, frame],
        selectedFrameId: frame.id,
        selectedFrameIds: [frame.id],
        detailViewport: vectorViewport(frame.vector),
        zoom: 1,
        layers: cloneLayers(frame.layers),
        vector: structuredClone(frame.vector),
        animation: structuredClone(frame.animation),
        hiddenLayerIds: [...frame.hiddenLayerIds],
        selectedLayerId: getFirstEditableLayerId(frame.layers),
        selectedLayerIds: [],
        selectedLayerRefs: [],
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        selectedBlockIds: [],
        hasCanvasSelection: true,
        selectionKind: "frame",
        progress: 0,
        isPlaying: false,
      });
    },

    renameFrame: (id, name) => {
      const trimmedName = name.trim() || "Frame";
      const state = get();
      const current = saveActiveFrame(state).find((frame) => frame.id === id);
      if (!current || current.name === trimmedName) return;
      state.pushHistory();
      const frames = saveActiveFrame(get()).map((frame) =>
        frame.id === id
          ? { ...frame, name: trimmedName, vector: { ...frame.vector, name: trimmedName } }
          : frame,
      );
      set(
        id === state.selectedFrameId
          ? { frames, vector: { ...state.vector, name: trimmedName } }
          : { frames },
      );
    },

    deleteFrame: (id) => {
      const state = get();
      const savedFrames = saveActiveFrame(state);
      if (savedFrames.length <= 1) return;
      const frameIndex = savedFrames.findIndex((frame) => frame.id === id);
      if (frameIndex === -1) return;
      const nextFrames = savedFrames.filter((frame) => frame.id !== id);
      const fallbackFrame = nextFrames[Math.max(0, frameIndex - 1)] ?? nextFrames[0];
      if (!fallbackFrame) return;
      state.pushHistory();
      if (id !== state.selectedFrameId) {
        set({
          frames: nextFrames,
          selectedFrameIds: state.selectedFrameIds.filter((frameId) => frameId !== id),
        });
        return;
      }
      set({
        frames: nextFrames,
        selectedFrameId: fallbackFrame.id,
        selectedFrameIds: [fallbackFrame.id],
        detailViewport: vectorViewport(fallbackFrame.vector),
        zoom: 1,
        layers: cloneLayers(fallbackFrame.layers),
        vector: structuredClone(fallbackFrame.vector),
        animation: structuredClone(fallbackFrame.animation),
        hiddenLayerIds: [...fallbackFrame.hiddenLayerIds],
        selectedLayerId: getFirstEditableLayerId(fallbackFrame.layers),
        selectedLayerIds: [],
        selectedLayerRefs: [],
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        selectedBlockIds: [],
        hasCanvasSelection: true,
        selectionKind: "frame",
        toolMode: "select",
        progress: 0,
        isPlaying: false,
      });
    },

    selectFrame: (id) => {
      const state = get();
      const clearChildSelection = {
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        selectedBlockIds: [],
        selectedLayerIds: [],
        selectedLayerRefs: [] as LayerSelectionRef[],
        hasCanvasSelection: true,
        selectionKind: "frame" as const,
        selectedFrameIds: [id],
        toolMode: "select" as const,
      };
      if (id === state.selectedFrameId) {
        set(clearChildSelection);
        return;
      }
      const savedFrames = saveActiveFrame(state);
      const savedRoot = saveActiveRoot(state);
      const frame = savedFrames.find((candidate) => candidate.id === id);
      if (!frame) return;
      set({
        frames: savedFrames,
        rootLayers: savedRoot.layers,
        rootAnimation: savedRoot.animation,
        rootHiddenLayerIds: savedRoot.hiddenLayerIds,
        selectedFrameId: frame.id,
        detailViewport: vectorViewport(frame.vector),
        zoom: 1,
        layers: cloneLayers(frame.layers),
        vector: structuredClone(frame.vector),
        animation: structuredClone(frame.animation),
        hiddenLayerIds: [...frame.hiddenLayerIds],
        selectedLayerId: getFirstEditableLayerId(frame.layers),
        ...clearChildSelection,
      });
    },

    setSelectedFrameIds: (ids) => {
      const validIds = new Set(saveActiveFrame(get()).map((frame) => frame.id));
      set({ selectedFrameIds: Array.from(new Set(ids.filter((id) => validIds.has(id)))) });
    },

    selectFrames: (ids, primaryId) => {
      const validIds = new Set(saveActiveFrame(get()).map((frame) => frame.id));
      const normalized = Array.from(new Set(ids.filter((id) => validIds.has(id))));
      if (normalized.length === 0) {
        get().deselectAll();
        return;
      }
      const primary = primaryId && normalized.includes(primaryId) ? primaryId : normalized.at(-1)!;
      get().selectFrame(primary);
      set({ selectedFrameIds: normalized });
    },

    selectRootLayer: (id) => {
      const state = get();
      const savedFrames = saveActiveFrame(state);
      const savedRoot = saveActiveRoot(state);
      if (!savedRoot.layers.some((layer) => String(layer.id) === String(id))) return;
      set({
        frames: savedFrames,
        rootLayers: cloneLayers(savedRoot.layers),
        rootAnimation: structuredClone(savedRoot.animation),
        rootHiddenLayerIds: [...savedRoot.hiddenLayerIds],
        selectedFrameId: PAGE_ROOT_ID,
        selectedFrameIds: [],
        layers: cloneLayers(savedRoot.layers),
        vector: { id: PAGE_ROOT_ID, name: "Page", width: 1, height: 1, alpha: 1 },
        animation: structuredClone(savedRoot.animation),
        hiddenLayerIds: [...savedRoot.hiddenLayerIds],
        selectedLayerId: id,
        selectedLayerIds: [id],
        selectedLayerRefs: [{ ownerId: PAGE_ROOT_ID, layerId: id }],
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
        selectedBlockIds: [],
        hasCanvasSelection: true,
        selectionKind: "layer",
      });
    },

    moveFrame: (id, dx, dy) => {
      if (dx === 0 && dy === 0) return;
      set((state) => ({
        frames: state.frames.map((frame) =>
          frame.id === id ? { ...frame, x: frame.x + dx, y: frame.y + dy } : frame,
        ),
      }));
    },

    moveFrames: (ids, dx, dy) => {
      if (!ids.length || (dx === 0 && dy === 0)) return;
      const idSet = new Set(ids);
      set((state) => ({
        frames: state.frames.map((frame) =>
          idSet.has(frame.id) ? { ...frame, x: frame.x + dx, y: frame.y + dy } : frame,
        ),
      }));
    },

    moveSelectedLayersToFrame: (targetFrameId, options) => {
      const next = buildOwnerMoveState(get(), targetFrameId, options);
      if (!next) return false;
      if (options?.recordHistory !== false) get().pushHistory();
      set(next);
      return true;
    },

    moveSelectedLayersToRoot: (options) => {
      const next = buildOwnerMoveState(get(), PAGE_ROOT_ID, options);
      if (!next) return false;
      if (options?.recordHistory !== false) get().pushHistory();
      set(next);
      return true;
    },
  };
}

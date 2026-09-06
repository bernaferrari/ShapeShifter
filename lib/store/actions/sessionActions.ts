import { zoomAtWorldPoint } from "../../shapeshifter/camera";
import { PAGE_ROOT_ID } from "../../shapeshifter/scene/owners";
import {
  collectClipboardFromOwners,
  collectSubtreeWithAnimation,
  remapClonedSubtree,
  resolveOwnerDocument,
} from "../cloneSubtree";
import type { EditorState } from "../editorStore";

type SessionAction =
  | "togglePlayback"
  | "setProgress"
  | "setSpeed"
  | "toggleSlowMotion"
  | "toggleRepeating"
  | "setZoom"
  | "toggleSnap"
  | "setGridDivisions"
  | "selectBlocks"
  | "toggleBlockSelection"
  | "clearBlockSelection"
  | "toggleLayerCollapsed"
  | "setTimelineZoom"
  | "setTimelineScroll"
  | "toggleTimelineCollapsed"
  | "setTimelineCollapsed"
  | "setToolMode"
  | "setCursorType"
  | "setHoveredItem"
  | "startDrag"
  | "updateDrag"
  | "endDrag"
  | "copyLayers"
  | "pasteLayers"
  | "cutLayers";

type SessionActions = Pick<EditorState, SessionAction>;
type SetEditorState = (
  update: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>),
) => void;

function uniqueClipboardRoots(layers: EditorState["layers"]): string[] {
  const ids = new Set(layers.map((layer) => String(layer.id)));
  return layers
    .filter((layer) => layer.parentId == null || !ids.has(String(layer.parentId)))
    .map((layer) => String(layer.id));
}

function removeRequestedSubtrees(
  state: EditorState,
  layerIds: Array<string | number>,
): Partial<EditorState> {
  const requested = new Set(layerIds.map(String));
  const matchingRefs = state.selectedLayerRefs.filter((ref) => requested.has(String(ref.layerId)));
  const refs =
    matchingRefs.length > 0
      ? matchingRefs
      : layerIds.map((layerId) => ({ ownerId: state.selectedFrameId, layerId }));

  const idsByOwner = new Map<string, Set<string>>();
  for (const ref of refs) {
    const owner = resolveOwnerDocument(state, ref.ownerId);
    const collected = collectSubtreeWithAnimation(owner.layers, owner.animation.blocks, [
      ref.layerId,
    ]);
    const ids = idsByOwner.get(ref.ownerId) ?? new Set<string>();
    for (const layer of collected.layers) ids.add(String(layer.id));
    idsByOwner.set(ref.ownerId, ids);
  }

  const strip = (
    layers: EditorState["layers"],
    animation: EditorState["animation"],
    ids?: Set<string>,
  ) => {
    if (!ids) return { layers, animation };
    return {
      layers: layers.filter((layer) => !ids.has(String(layer.id))),
      animation: {
        ...animation,
        blocks: animation.blocks.filter((block) => !ids.has(String(block.layerId))),
      },
    };
  };

  const nextFrames = state.frames.map((frame) => {
    const ids = idsByOwner.get(frame.id);
    if (!ids) return frame;
    const ownerLayers = frame.id === state.selectedFrameId ? state.layers : frame.layers;
    const ownerAnimation = frame.id === state.selectedFrameId ? state.animation : frame.animation;
    const next = strip(ownerLayers, ownerAnimation, ids);
    return {
      ...frame,
      layers: next.layers,
      animation: next.animation,
      hiddenLayerIds: frame.hiddenLayerIds.filter((id) => !ids.has(String(id))),
    };
  });
  const rootIds = idsByOwner.get(PAGE_ROOT_ID);
  const rootSource =
    state.selectedFrameId === PAGE_ROOT_ID
      ? { layers: state.layers, animation: state.animation }
      : { layers: state.rootLayers, animation: state.rootAnimation };
  const nextRoot = strip(rootSource.layers, rootSource.animation, rootIds);
  const nextRootHidden = rootIds
    ? (state.selectedFrameId === PAGE_ROOT_ID
        ? state.hiddenLayerIds
        : state.rootHiddenLayerIds
      ).filter((id) => !rootIds.has(String(id)))
    : state.selectedFrameId === PAGE_ROOT_ID
      ? state.hiddenLayerIds
      : state.rootHiddenLayerIds;
  const activeFrame = nextFrames.find((frame) => frame.id === state.selectedFrameId);
  const nextLayers =
    state.selectedFrameId === PAGE_ROOT_ID ? nextRoot.layers : (activeFrame?.layers ?? state.layers);
  const nextAnimation =
    state.selectedFrameId === PAGE_ROOT_ID
      ? nextRoot.animation
      : (activeFrame?.animation ?? state.animation);
  const nextHidden =
    state.selectedFrameId === PAGE_ROOT_ID
      ? nextRootHidden
      : (activeFrame?.hiddenLayerIds ?? state.hiddenLayerIds);
  return {
    frames: nextFrames,
    rootLayers: nextRoot.layers,
    rootAnimation: nextRoot.animation,
    rootHiddenLayerIds:
      state.selectedFrameId === PAGE_ROOT_ID ? state.rootHiddenLayerIds : nextRootHidden,
    layers: nextLayers,
    animation: nextAnimation,
    hiddenLayerIds: nextHidden,
    selectedBlockIds: state.selectedBlockIds.filter((blockId) =>
      nextAnimation.blocks.some((block) => block.id === blockId),
    ),
    selectedLayerId: nextLayers[0]?.id ?? 0,
    selectedLayerIds: nextLayers[0] ? [nextLayers[0].id] : [],
    selectedLayerRefs: nextLayers[0]
      ? [{ ownerId: state.selectedFrameId, layerId: nextLayers[0].id }]
      : [],
    hasCanvasSelection: nextLayers.length > 0,
    selectionKind: nextLayers.length > 0 ? "layer" : "none",
    selection: null,
    selectedPoints: [],
    selectedSubPaths: [],
  };
}

function zoomDetailAtCenter(state: EditorState, scale: number) {
  const viewport = state.detailViewport;
  return zoomAtWorldPoint(
    viewport,
    { x: viewport.x + viewport.w / 2, y: viewport.y + viewport.h / 2 },
    scale,
    0.25,
    8,
  );
}

export function createSessionActions(set: SetEditorState, get: () => EditorState): SessionActions {
  return {
    togglePlayback: () =>
      set((state) => {
        const atEnd = state.progress >= 0.999;
        return !state.isPlaying && atEnd
          ? { isPlaying: true, progress: 0 }
          : { isPlaying: !state.isPlaying };
      }),
    setProgress: (progress) => set({ progress: Math.max(0, Math.min(1, progress)) }),
    setSpeed: (speed) => set({ speed }),
    toggleSlowMotion: () => set((state) => ({ isSlowMotion: !state.isSlowMotion })),
    toggleRepeating: () => set((state) => ({ isRepeating: !state.isRepeating })),
    setZoom: (zoom) =>
      set((state) => {
        const detailViewport = zoomDetailAtCenter(state, zoom);
        return { zoom: detailViewport.scale, detailViewport };
      }),
    toggleSnap: () => set((state) => ({ snapToGrid: !state.snapToGrid })),
    setGridDivisions: (divisions) =>
      set({ gridDivisions: divisions > 1 ? Math.round(divisions) : 4 }),
    selectBlocks: (selectedBlockIds) => set({ selectedBlockIds }),
    toggleBlockSelection: (blockId) =>
      set((state) => ({
        selectedBlockIds: state.selectedBlockIds.includes(blockId)
          ? state.selectedBlockIds.filter((id) => id !== blockId)
          : [...state.selectedBlockIds, blockId],
      })),
    clearBlockSelection: () => set({ selectedBlockIds: [] }),
    toggleLayerCollapsed: (layerId) =>
      set((state) => ({
        collapsedLayerIds: state.collapsedLayerIds.includes(layerId)
          ? state.collapsedLayerIds.filter((id) => id !== layerId)
          : [...state.collapsedLayerIds, layerId],
      })),
    setTimelineZoom: (timelineZoom) =>
      set({ timelineZoom: Math.max(0.1, Math.min(10, timelineZoom)) }),
    setTimelineScroll: (timelineScrollX, timelineScrollY) =>
      set({ timelineScrollX, timelineScrollY }),
    toggleTimelineCollapsed: () =>
      set((state) => ({ timelineCollapsed: !state.timelineCollapsed })),
    setTimelineCollapsed: (timelineCollapsed) => set({ timelineCollapsed }),
    setToolMode: (toolMode) => set({ toolMode }),
    setCursorType: (cursorType) => set({ cursorType }),
    setHoveredItem: (hoveredItem) => set({ hoveredItem }),
    startDrag: (type, startX, startY) =>
      set({ dragState: { type, startX, startY, currentX: startX, currentY: startY } }),
    updateDrag: (currentX, currentY) =>
      set((state) =>
        state.dragState
          ? { dragState: { ...state.dragState, currentX, currentY } }
          : { dragState: null },
      ),
    endDrag: () => set({ dragState: null }),
    copyLayers: (layerIds) => {
      const collected = collectClipboardFromOwners(get(), layerIds);
      if (collected.layers.length === 0) return;
      set({
        clipboard: {
          layers: collected.layers,
          blocks: collected.blocks,
          timestamp: Date.now(),
        },
      });
    },
    pasteLayers: () => {
      const state = get();
      if (!state.clipboard?.layers.length) return;
      const offset = 8 / (state.detailViewport.scale || 1);
      const remapped = remapClonedSubtree(
        {
          layers: state.clipboard.layers,
          blocks: state.clipboard.blocks ?? [],
          rootIds: uniqueClipboardRoots(state.clipboard.layers),
        },
        {
          prefix: `paste-${Date.now()}`,
          offsetX: offset,
          offsetY: offset,
          rename: "copy",
          unmatchedParent: "drop",
        },
      );
      const nextAnimation =
        remapped.blocks.length > 0
          ? {
              ...state.animation,
              duration: Math.max(
                state.animation.duration,
                ...remapped.blocks.map((block) => block.endTime),
                1,
              ),
              blocks: [...state.animation.blocks, ...remapped.blocks],
            }
          : state.animation;
      state.pushHistory();
      set({
        layers: [...state.layers, ...remapped.layers],
        animation: nextAnimation,
        selectedLayerId: remapped.layers.at(-1)?.id ?? state.layers[0]?.id ?? 0,
        selectedLayerIds: remapped.layers.map((layer) => layer.id),
        selectedLayerRefs: remapped.layers.map((layer) => ({
          ownerId: state.selectedFrameId,
          layerId: layer.id,
        })),
        hasCanvasSelection: true,
        selectionKind: "layer",
        selectedFrameIds: [],
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
      });
    },
    cutLayers: (layerIds) => {
      const state = get();
      const requested = new Set(layerIds.map(String));
      const activeRequested = state.layers.filter((layer) => requested.has(String(layer.id)));
      // Refuse emptying the active owner when every live layer is explicitly requested.
      if (activeRequested.length > 0 && activeRequested.length >= state.layers.length) return;
      state.copyLayers(layerIds);
      const afterCopy = get();
      afterCopy.pushHistory();
      set(removeRequestedSubtrees(afterCopy, layerIds));
    },
  };
}

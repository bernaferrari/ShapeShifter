import { zoomAtWorldPoint } from "../../shapeshifter/camera";
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
      const idSet = new Set(layerIds.map(String));
      const copied = get().layers.filter((layer) => idSet.has(String(layer.id)));
      if (copied.length === 0) return;
      set({ clipboard: { layers: structuredClone(copied), timestamp: Date.now() } });
    },
    pasteLayers: () => {
      const state = get();
      if (!state.clipboard?.layers.length) return;
      const pasted = state.clipboard.layers.map((layer, index) => ({
        ...structuredClone(layer),
        id: `paste-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
        name: `${layer.name} copy`,
        translateX: (layer.translateX ?? 0) + 8,
        translateY: (layer.translateY ?? 0) + 8,
      }));
      state.pushHistory();
      set({
        layers: [...state.layers, ...pasted],
        selectedLayerId: pasted.at(-1)?.id ?? state.layers[0]?.id ?? 0,
        selectedLayerIds: pasted.map((layer) => layer.id),
        selectedLayerRefs: pasted.map((layer) => ({
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
      const idSet = new Set(layerIds.map(String));
      if (state.layers.length <= idSet.size) return;
      state.copyLayers(layerIds);
      const remaining = state.layers.filter((layer) => !idSet.has(String(layer.id)));
      state.pushHistory();
      set({
        layers: remaining,
        selectedLayerId: remaining[0]?.id ?? 0,
        selectedLayerIds: remaining[0] ? [remaining[0].id] : [],
        selectedLayerRefs: remaining[0]
          ? [{ ownerId: state.selectedFrameId, layerId: remaining[0].id }]
          : [],
        hasCanvasSelection: remaining.length > 0,
        selectionKind: remaining.length > 0 ? "layer" : "none",
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [],
      });
    },
  };
}

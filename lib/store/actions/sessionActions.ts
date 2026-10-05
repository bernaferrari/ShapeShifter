import { toast } from "sonner";
import { planLayerDeletion } from "../commands/deleteLayers";
import { zoomAtWorldPoint } from "../../shapeshifter/camera";
import { collectClipboardFromOwners, remapClonedSubtree } from "../cloneSubtree";
import type { EditorState } from "../editorStore";

type SessionAction =
  | "togglePlayback"
  | "setProgress"
  | "setSpeed"
  | "toggleSlowMotion"
  | "toggleRepeating"
  | "setPlaybackMode"
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
const WORLD_GEOMETRY_TOOLS = new Set(["direct", "pen", "knife", "paint", "pencil"]);
type SetEditorState = (
  update: Partial<EditorState> | ((state: EditorState) => Partial<EditorState>),
) => void;

function uniqueClipboardRoots(layers: EditorState["layers"]): string[] {
  const ids = new Set(layers.map((layer) => String(layer.id)));
  return layers
    .filter((layer) => layer.parentId == null || !ids.has(String(layer.parentId)))
    .map((layer) => String(layer.id));
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
        if (!state.isPlaying && state.progress === 0) {
          return { isPlaying: true, playbackDirection: 1 };
        }
        const atEnd = state.progress >= 0.999;
        return !state.isPlaying && atEnd && state.playbackMode === "forward"
          ? { isPlaying: true, progress: 0 }
          : { isPlaying: !state.isPlaying };
      }),
    setProgress: (progress) => {
      if (!Number.isFinite(progress)) return;
      // Point tools stay active while scrubbing: they edit the shape at the playhead.
      set({ progress: Math.max(0, Math.min(1, progress)), playbackDirection: 1 });
    },
    setSpeed: (speed) => set({ speed }),
    toggleSlowMotion: () => set((state) => ({ isSlowMotion: !state.isSlowMotion })),
    toggleRepeating: () => set((state) => ({ isRepeating: !state.isRepeating })),
    setPlaybackMode: (playbackMode) => set({ playbackMode, playbackDirection: 1 }),
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
    setToolMode: (toolMode) =>
      set((state) => ({
        toolMode,
        ...(!state.isActionMode && WORLD_GEOMETRY_TOOLS.has(toolMode)
          ? {
              isPlaying: false,
              editingSide: "from" as const,
              ...(state.editingSide === "to"
                ? { selectedPoints: [], selectedSubPaths: [], selection: null }
                : {}),
            }
          : {}),
        ...(!state.isActionMode && toolMode === "select"
          ? { selection: null, selectedPoints: [], selectedSubPaths: [] }
          : {}),
      })),
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
      const selectedRefs = state.selectedLayerRefs.filter((ref) =>
        requested.has(String(ref.layerId)),
      );
      const refs = [
        ...selectedRefs,
        ...layerIds
          .filter((layerId) => !selectedRefs.some((ref) => String(ref.layerId) === String(layerId)))
          .map((layerId) => ({ ownerId: state.selectedFrameId, layerId })),
      ];
      const result = planLayerDeletion(state, refs);
      if (!result.ok) {
        toast.error("Cannot cut selection", { description: result.message });
        return;
      }
      state.copyLayers(layerIds);
      get().pushHistory();
      set(result.patch);
    },
  };
}

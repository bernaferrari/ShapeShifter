import { create } from "zustand";

/**
 * ShapeShifter 2026 - Editor Store
 * Central state management using Zustand.
 * Single source of truth for layers, selection, playback, and path mutations.
 */

import {
  reversePath,
  shiftPath,
  arePathsStructurallyCompatible,
  countPathPoints,
  booleanCombine,
  simplifyPath,
  getTaperedStrokeWidth,
} from "../shapeshifter/pathUtils";
import type { Viewport } from "../shapeshifter/camera";
import type {
  AnimationState,
  Layer,
  LayerType,
  PathData,
  Selection,
  Point,
  VectorMetadata,
} from "../shapeshifter/types";
import type { ToolMode, CursorType } from "../shapeshifter/toolModes";
import type { LayerPlacement } from "../shapeshifter/scene/layerHierarchy";
import type { LayerSelectionRef } from "../shapeshifter/scene/owners";
import type { LegacyDocumentSnapshot } from "../shapeshifter/documentModel";
import { createDefaultWorkspace, type CanvasFrame } from "./defaultWorkspace";
import { createFrameActions } from "./actions/frameActions";
import { createSessionActions } from "./actions/sessionActions";
import { createVectorPathActions } from "./actions/vectorPathActions";
import { createDocumentActions } from "./actions/documentActions";
import {
  computeFramesViewport,
  computeVectorViewport,
  createCameraActions,
} from "./actions/cameraActions";
import { cloneFrame, cloneLayers, getFirstEditableLayerId } from "./workspaceState";
import { createHistoryActions } from "./actions/historyActions";
import { createSelectionActions } from "./actions/selectionActions";
import { createLayerOrganizationActions } from "./actions/layerOrganizationActions";
import { createLayerDataActions } from "./actions/layerDataActions";
import { createTransformActions } from "./actions/transformActions";

export type { CanvasFrame } from "./defaultWorkspace";
export { PAGE_ROOT_ID, type LayerSelectionRef } from "../shapeshifter/scene/owners";

export interface HoveredItem {
  type: "point" | "command" | "layer" | "block";
  id: string | number;
  subPathIndex?: number;
  commandIndex?: number;
  pointIndex?: number;
}

export interface DragState {
  type: string;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface ClipboardData {
  layers: Layer[];
  timestamp: number;
}

export interface MoveLayerOptions {
  recordHistory?: boolean;
  placement?: LayerPlacement;
}

export interface SubPathSelection {
  layerId: string | number;
  side: "from" | "to";
  subPathIndex: number;
}

export interface SegmentSelection {
  layerId: string | number;
  side: "from" | "to";
  subPathIndex: number;
  commandIndex: number;
}

/** Full editable-state snapshot for trustworthy undo/redo (C7). */
export interface HistoryEntry {
  frames: CanvasFrame[];
  selectedFrameId: string;
  selectedFrameIds: string[];
  rootLayers: Layer[];
  rootAnimation: AnimationState;
  rootHiddenLayerIds: string[];
  layers: Layer[];
  vector: VectorMetadata;
  animation: AnimationState;
  hiddenLayerIds: string[];
  selectedLayerId: string | number;
  selectedLayerIds: Array<string | number>;
  selectedLayerRefs: LayerSelectionRef[];
  selection: Selection | null;
  selectedPoints: Selection[];
  selectedSubPaths: SubPathSelection[];
  editingSide: "from" | "to";
  hasCanvasSelection: boolean;
  selectionKind: "none" | "frame" | "layer";
}
export interface EditorState {
  // Workspace frames
  frames: CanvasFrame[];
  selectedFrameId: string;
  /** Selected artboards; selectedFrameId is the primary/active document projection. */
  selectedFrameIds: string[];
  /** Vectors owned by the page rather than clipped inside a frame. */
  rootLayers: Layer[];
  rootAnimation: AnimationState;
  rootHiddenLayerIds: string[];

  // Layers
  layers: Layer[];
  selectedLayerId: string | number;
  vector: VectorMetadata;
  animation: AnimationState;
  hiddenLayerIds: string[];

  // Editing mode
  editingSide: "from" | "to";
  isActionMode: boolean;

  // Selection
  selection: Selection | null;
  // Multi-point selection support for batch direct manipulation
  // (faithful port of original paper.js BatchSelectItemsGesture + multi segment selection in edit path mode)
  selectedPoints: Selection[];
  selectedSubPaths: SubPathSelection[];
  /**
   * Figma: objects can be fully deselected (click empty canvas / Esc) while the
   * active frame's document slice stays loaded for editing context.
   * When false, no blue selection chrome on frames/layers.
   */
  hasCanvasSelection: boolean;
  /**
   * Figma selection scope — mutually exclusive:
   *  - none: nothing selected
   *  - frame: the artboard is selected (children are NOT selected)
   *  - layer: a child object is selected (parent frame is not “the” selection)
   */
  selectionKind: "none" | "frame" | "layer";
  /** Figma multi-select: one or more layers (primary = selectedLayerId). */
  selectedLayerIds: (string | number)[];
  /** Document-wide selection; selectedLayerIds is the active-owner projection. */
  selectedLayerRefs: LayerSelectionRef[];

  // Playback
  isPlaying: boolean;
  progress: number; // 0-1
  speed: number;
  isSlowMotion: boolean;
  isRepeating: boolean;

  // UI
  zoom: number;
  snapToGrid: boolean;
  /** Minor grid cells per major line (4 = 4/8/12/16, 5 = iOS-style 5/10/15). */
  gridDivisions: number;
  setGridDivisions: (divisions: number) => void;

  // Timeline
  selectedBlockIds: string[];
  collapsedLayerIds: (string | number)[];
  timelineZoom: number;
  timelineScrollX: number;
  timelineScrollY: number;
  timelineCollapsed: boolean;

  // Action Mode / Gestures (now using shared enums from Phase 1)
  toolMode: ToolMode;
  cursorType: CursorType;
  hoveredItem: HoveredItem | null;
  dragState: DragState | null;

  // Clipboard
  clipboard: ClipboardData | null;

  // History for undo/redo (professional 2026 tool feel)
  // Full editable-state snapshot so undo restores selection + animation too (C7 fix).
  history: HistoryEntry[];
  future: HistoryEntry[];
  /** Oldest entry displaced by the latest capped push, recoverable if that push is cancelled. */
  historyOverflow: HistoryEntry | null;
  canUndo: boolean;
  canRedo: boolean;

  // History actions
  undo: () => void;
  redo: () => void;
  pushHistory: () => void; // internal
  /** Restore and discard the latest snapshot for a cancelled in-flight gesture. */
  cancelLastHistoryTransaction: () => void;
  /** Persist the live active-owner projection back into its page/frame document. */
  syncActiveOwner: (options?: { includeAnimation?: boolean }) => void;

  // Workspace frame actions
  addFrame: () => void;
  duplicateFrame: () => void;
  renameFrame: (id: string, name: string) => void;
  deleteFrame: (id: string) => void;
  selectFrame: (id: string) => void;
  selectFrames: (ids: string[], primaryId?: string) => void;
  setSelectedFrameIds: (ids: string[]) => void;
  moveFrame: (id: string, dx: number, dy: number) => void;
  moveFrames: (ids: string[], dx: number, dy: number) => void;
  /** Reparent selected objects to another frame without changing world position. */
  moveSelectedLayersToFrame: (targetFrameId: string, options?: MoveLayerOptions) => boolean;
  moveSelectedLayersToRoot: (options?: MoveLayerOptions) => boolean;
  selectRootLayer: (id: string | number) => void;

  // World camera (1el / k4mv Phase 2) — first-class store citizen
  worldViewport: Viewport;
  setWorldViewport: (v: Partial<Viewport>) => void;
  fitWorldToFrames: (frameIds?: string[]) => void;
  bringFrameIntoView: (frameId: string, options?: { animate?: boolean }) => void;
  bringLayerIntoView: (
    ownerId: string,
    layerId: string | number,
    options?: { animate?: boolean; fit?: boolean },
  ) => void;

  // Detail/path camera shared by all action-mode canvases.
  detailViewport: Viewport;
  setDetailViewport: (v: Viewport | ((current: Viewport) => Viewport)) => void;
  fitDetailToVector: (scale?: number) => void;

  // Actions
  setLayers: (layers: Layer[]) => void;
  importLayers: (layers: Layer[]) => void;
  loadProject: (project: {
    layers: Layer[];
    vector: VectorMetadata;
    animation: AnimationState;
    hiddenLayerIds: string[];
  }) => void;
  loadDocument: (snapshot: LegacyDocumentSnapshot) => void;
  replaceSelectedLayerPaths: (paths: Partial<Pick<Layer, "from" | "to" | "name">>) => void;
  updateSelectedLayer: (patch: Partial<Layer>, options?: { recordHistory?: boolean }) => void;
  /** Apply patch to every id in selectedLayerIds (or explicit ids). */
  updateSelectedLayers: (
    patch: Partial<Layer>,
    options?: { recordHistory?: boolean; ids?: (string | number)[] },
  ) => void;
  selectLayer: (id: string | number) => void;
  /** Figma marquee / shift-multi: select several layers at once. */
  selectLayers: (ids: (string | number)[]) => void;
  /** Select objects across page/frame owners, loading the last ref as inspector primary. */
  selectLayerRefs: (refs: LayerSelectionRef[]) => void;
  deleteSelectedLayers: () => void;
  toggleLayerLock: (id: string | number) => void;
  toggleOwnedLayerLock: (ownerId: string, id: string | number) => void;
  renameOwnedLayer: (ownerId: string, id: string | number, name: string) => void;
  reorderLayer: (id: string | number, toIndex: number) => void;
  reorderOwnedLayer: (ownerId: string, id: string | number, toIndex: number) => void;
  /** Move one layer subtree to an exact sibling/group position inside an owner. */
  reparentOwnedLayer: (
    ownerId: string,
    id: string | number,
    target: LayerPlacement,
    options?: { recordHistory?: boolean },
  ) => boolean;
  /** Z-order: +1 bring forward, -1 send backward (Figma ] / [ style). */
  nudgeLayerZOrder: (id: string | number, delta: number) => void;
  groupSelectedLayers: () => void;
  ungroupSelectedLayer: () => void;
  /** Space-hold temporary pan (Figma hand); keyup without pan = play/pause. */
  spacePanActive: boolean;
  setSpacePanActive: (active: boolean) => void;
  /** Alt-drag duplicate: clone selected layers offset by dx/dy and select clones. */
  duplicateSelectedLayersOffset: (
    dx: number,
    dy: number,
    options?: { recordHistory?: boolean },
  ) => void;
  setEditingSide: (side: "from" | "to") => void;
  startActionMode: () => void;
  closeActionMode: () => void;

  // Path manipulation (the heart of ShapeShifter)
  updateSelectedPoint: (newPoint: Point, options?: { recordHistory?: boolean }) => void;
  addPointOnPath: (clickX: number, clickY: number) => void;
  splitSelectedLayerSegment: (segment: SegmentSelection) => void;
  bendSelectedLayerSegment: (
    segment: SegmentSelection,
    point: Point,
    options?: { recordHistory?: boolean },
  ) => void;
  /**
   * Flex curvature on a segment using the pure flexCurvature helper (normal-offset control point adjustment).
   * Wired for direct tool + Ctrl+drag (ny0 under v6j, DESIGN_ID 67dd105e).
   * Caller (PathCanvas) computes viewBox-aware delta from pointer move and chooses t (0.5 for segment mid, or handle-derived).
   * Store owns the lookup + mutation so both from/to sides stay in sync.
   */
  flexSelectedLayerSegment: (
    segment: SegmentSelection,
    delta: Point,
    t?: number,
    options?: { recordHistory?: boolean },
  ) => void;
  deleteSelectedPoint: () => void;
  deleteSelectedSubPath: () => void;
  extractSelectedSubPathToNewLayer: () => void;
  splitSelectedCommand: () => void;
  setSelectedCommandAsFirst: () => void;

  // Batch direct manipulation (for multi point selection drag parity)
  translateSelectedPoints: (dx: number, dy: number, options?: { recordHistory?: boolean }) => void;
  translateSelectedSubPaths: (
    dx: number,
    dy: number,
    options?: { recordHistory?: boolean },
  ) => void;
  translateSelectedLayer: (dx: number, dy: number, options?: { recordHistory?: boolean }) => void;
  /**
   * Figma motion: after moving a layer, register/update translateX/Y timeline tracks
   * at the current playhead so the move appears under the layer in the timeline.
   * Multi-keyframe: mid-timeline inserts a split (two segments) instead of only rewriting toValue.
   */
  recordLayerTranslationAtPlayhead: () => void;
  resizeSelectedLayer: (
    fromBounds: { x: number; y: number; width: number; height: number },
    toBounds: { x: number; y: number; width: number; height: number },
    options?: { recordHistory?: boolean },
  ) => void;
  /** Rotate primary (or all multi-selected) layers by delta degrees around each bounds center. */
  rotateSelectedLayers: (deltaDeg: number, options?: { recordHistory?: boolean }) => void;

  // Playback
  togglePlayback: () => void;
  setProgress: (progress: number) => void;
  setSpeed: (speed: number) => void;
  toggleSlowMotion: () => void;
  toggleRepeating: () => void;

  // UI
  setZoom: (zoom: number) => void;
  toggleSnap: () => void;

  // Timeline
  selectBlocks: (blockIds: string[]) => void;
  toggleBlockSelection: (blockId: string) => void;
  updateTimelineBlock: (
    blockId: string,
    patch: Partial<{ startTime: number; endTime: number; interpolator: string }>,
    options?: { recordHistory?: boolean },
  ) => void;
  removeTimelineBlocks: (blockIds: string[]) => void;
  removeTimelineProperty: (layerId: string | number, propertyName: string) => void;
  removeTimelineKeyframe: (blockId: string, edge: "start" | "end") => void;
  clearBlockSelection: () => void;
  toggleLayerCollapsed: (layerId: string | number) => void;
  setTimelineZoom: (zoom: number) => void;
  setTimelineScroll: (x: number, y: number) => void;
  toggleTimelineCollapsed: () => void;
  setTimelineCollapsed: (collapsed: boolean) => void;

  // Action Mode / Gestures (Phase 1)
  setToolMode: (mode: ToolMode) => void;
  setCursorType: (cursor: CursorType) => void;
  setHoveredItem: (item: HoveredItem | null) => void;
  startDrag: (type: string, x: number, y: number) => void;
  updateDrag: (x: number, y: number) => void;
  endDrag: () => void;

  // Clipboard
  copyLayers: (layerIds: (string | number)[]) => void;
  pasteLayers: () => void;
  cutLayers: (layerIds: (string | number)[]) => void;

  // Magic tools (ported & enhanced from 2017 original)
  reverseSelectedLayer: () => void;
  shiftSelectedLayer: (steps?: number) => boolean;
  autoFixSelectedLayer: () => boolean;
  booleanCombine: (op: "union" | "subtract" | "intersect" | "exclude") => void;
  loadSample: (index: number) => void;
  // 1td advanced (14l) smallest wiring: simplify/optimize + dash + taper primitives now available in UI flows.
  simplifySelectedLayer: (tolerance?: number) => void;
  setSelectedDashPattern: (dash: string) => void;
  applyTaperToSelected: (taper?: number) => void;

  // Layer management
  addLayer: (type?: LayerType) => void;
  deleteLayer: (id: string | number) => void;
  toggleLayerVisibility: (id: string | number) => void;
  toggleOwnedLayerVisibility: (ownerId: string, id: string | number) => void;
  toggleLayerExpanded: (id: string | number) => void;
  convertLayerType: (id: string | number, type: Extract<LayerType, "path" | "clipPath">) => void;
  addTimelineBlock: (layerId: string | number, propertyName: string) => void;

  // Selection (single primary + multi batch for direct manipulation parity)
  selectPoint: (selection: Selection | null, addToMulti?: boolean) => void;
  selectSubPath: (selection: SubPathSelection | null, addToMulti?: boolean) => void;
  clearSelection: () => void;
  /** Figma: clear object selection (empty canvas click / Esc). Keeps active frame data loaded. */
  deselectAll: () => void;
  selectMultiplePoints: (points: Selection[]) => void;
  selectMultipleSubPaths: (subPaths: SubPathSelection[]) => void;

  // Vector metadata + animation
  updateVector: (patch: Partial<VectorMetadata>) => void;
  setAnimationDuration: (ms: number, options?: { recordHistory?: boolean }) => void;

  // Project
  resetProject: () => void;

  // Helpers
  getCurrentSelectedPoint: () => Point | null;
  getCompatibilityStatus: () => {
    compatible: boolean;
    fromPoints: number;
    toPoints: number;
    warning: string;
  };
}

const {
  initialFrames,
  initialFrame,
  initialLayers,
  initialVector,
  initialAnimation,
  initialRootAnimation,
} = createDefaultWorkspace();

/** Resolve end geometry, falling back to start for static layers. */
const endOf = (layer: Layer): PathData => layer.to ?? layer.from;

export const useEditorStore = create<EditorState>((set, get) => ({
  frames: initialFrames.map(cloneFrame),
  selectedFrameId: initialFrame.id,
  selectedFrameIds: [],
  rootLayers: [],
  rootAnimation: structuredClone(initialRootAnimation),
  rootHiddenLayerIds: [],
  layers: cloneLayers(initialLayers),
  vector: structuredClone(initialVector),
  animation: structuredClone(initialAnimation),
  hiddenLayerIds: [],
  history: [],
  future: [],
  historyOverflow: null,
  canUndo: false,
  canRedo: false,
  selectedLayerId: getFirstEditableLayerId(initialLayers),
  selectedLayerIds: [getFirstEditableLayerId(initialLayers)],
  selectedLayerRefs: [
    { ownerId: initialFrame.id, layerId: getFirstEditableLayerId(initialLayers) },
  ],
  editingSide: "from",
  isActionMode: false,
  selection: null,
  selectedPoints: [],
  selectedSubPaths: [],
  hasCanvasSelection: true,
  selectionKind: "layer",
  isPlaying: false,
  progress: 0,
  speed: 1,
  isSlowMotion: false,
  isRepeating: true,
  zoom: 1,
  snapToGrid: true,
  gridDivisions: 4,
  selectedBlockIds: [],
  collapsedLayerIds: [],
  timelineZoom: 1,
  timelineScrollX: 0,
  timelineScrollY: 0,
  timelineCollapsed: false,

  // World camera (1el Phase 2 foundation)
  worldViewport: computeFramesViewport(initialFrames),
  detailViewport: computeVectorViewport(initialVector),
  // Figma default: Move tool (vector via A / double-click).
  toolMode: "select",
  cursorType: "default",
  hoveredItem: null,
  dragState: null,
  clipboard: null,
  spacePanActive: false,

  ...createHistoryActions(set, get),

  ...createFrameActions(set, get, {
    layers: initialLayers,
    vector: initialVector,
    animation: initialAnimation,
  }),
  ...createCameraActions(set, get),

  ...createLayerDataActions(set, get, initialRootAnimation),

  ...createSelectionActions(set, get),

  ...createTransformActions(set, get),

  ...createLayerOrganizationActions(set, get),

  ...createVectorPathActions(set, get),
  ...createSessionActions(set, get),
  ...createDocumentActions(set, get),
  // === MAGIC TOOL: Reverse (core 2017 feature, now real) ===
  reverseSelectedLayer: () => {
    const { layers, selectedLayerId, editingSide } = get();
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    if (layer.locked) return;
    const targetPath = editingSide === "from" ? layer.from : endOf(layer);

    const updatedPath = reversePath(targetPath);

    const newLayers = [...layers];
    if (editingSide === "from") {
      newLayers[layerIndex] = { ...layer, from: updatedPath, pathData: updatedPath };
    } else {
      newLayers[layerIndex] = { ...layer, to: updatedPath };
    }

    get().pushHistory();
    set({ layers: newLayers });
  },

  shiftSelectedLayer: (steps: number = 1) => {
    const { layers, selectedLayerId, editingSide } = get();
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return false;

    const layer = layers[layerIndex];
    if (layer.locked) return false;
    const targetPath = editingSide === "from" ? layer.from : endOf(layer);

    const updatedPath = shiftPath(targetPath, steps);

    const newLayers = [...layers];
    if (editingSide === "from") {
      newLayers[layerIndex] = { ...layer, from: updatedPath, pathData: updatedPath };
    } else {
      newLayers[layerIndex] = { ...layer, to: updatedPath };
    }

    get().pushHistory();
    set({ layers: newLayers });
    return true; // for toast feedback
  },

  booleanCombine: (op) => {
    const { layers, selectedLayerId, selectedLayerIds } = get();
    if (layers.length < 2) return;
    // Prefer first two multi-selected path layers; else primary + next.
    let layerA =
      selectedLayerIds.length >= 2
        ? layers.find((l) => String(l.id) === String(selectedLayerIds[0]))
        : layers.find((l) => l.id === selectedLayerId);
    let layerB =
      selectedLayerIds.length >= 2
        ? layers.find((l) => String(l.id) === String(selectedLayerIds[1]))
        : undefined;
    const idxA = layerA
      ? layers.findIndex((l) => String(l.id) === String(layerA!.id))
      : layers.findIndex((l) => l.id === selectedLayerId);
    if (idxA === -1) return;
    layerA = layers[idxA]!;
    let idxB = layerB ? layers.findIndex((l) => String(l.id) === String(layerB!.id)) : -1;
    if (idxB === -1 || idxB === idxA) {
      idxB = (idxA + 1) % layers.length;
    }
    if (idxB === idxA) return;
    layerB = layers[idxB]!;
    const combined = booleanCombine(op, layerA.from, layerB.from);
    const resultLayer = {
      ...layerA,
      from: combined,
      to: combined,
      pathData: combined,
      name: `${layerA.name} ${op}`,
    };
    let newLayers = [...layers];
    newLayers[idxA] = resultLayer;
    newLayers = newLayers.filter((_, i) => i !== idxB);
    get().pushHistory();
    set({
      layers: newLayers,
      selectedLayerId: resultLayer.id,
      selectedLayerIds: [resultLayer.id],
      selectedLayerRefs: [{ ownerId: get().selectedFrameId, layerId: resultLayer.id }],
      hasCanvasSelection: true,
      selectionKind: "layer",
      selectedFrameIds: [],
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
    });
  },

  selectPoint: (selection, addToMulti = false) => {
    if (!selection) {
      set({ selection: null, selectedPoints: [], selectedSubPaths: [] });
      return;
    }
    set((state) => {
      if (addToMulti) {
        const exists = state.selectedPoints.some(
          (p) =>
            p.subPathIndex === selection.subPathIndex &&
            p.commandIndex === selection.commandIndex &&
            p.pointIndex === selection.pointIndex &&
            p.layerId === selection.layerId &&
            p.side === selection.side,
        );
        const newSelected = exists
          ? state.selectedPoints.filter(
              (p) =>
                !(
                  p.subPathIndex === selection.subPathIndex &&
                  p.commandIndex === selection.commandIndex &&
                  p.pointIndex === selection.pointIndex &&
                  p.layerId === selection.layerId &&
                  p.side === selection.side
                ),
            )
          : [...state.selectedPoints, selection];
        return {
          selection,
          selectedPoints: newSelected.length > 0 ? newSelected : [selection],
          selectedSubPaths: [],
          selectedBlockIds: [],
        };
      }
      return { selection, selectedPoints: [selection], selectedSubPaths: [], selectedBlockIds: [] };
    });
  },
  selectSubPath: (selection, addToMulti = false) => {
    if (!selection) {
      set({ selectedSubPaths: [] });
      return;
    }
    set((state) => {
      if (addToMulti) {
        const exists = state.selectedSubPaths.some(
          (item) =>
            item.layerId === selection.layerId &&
            item.side === selection.side &&
            item.subPathIndex === selection.subPathIndex,
        );
        const selectedSubPaths = exists
          ? state.selectedSubPaths.filter(
              (item) =>
                !(
                  item.layerId === selection.layerId &&
                  item.side === selection.side &&
                  item.subPathIndex === selection.subPathIndex
                ),
            )
          : [...state.selectedSubPaths, selection];
        return {
          selectedLayerId: selection.layerId,
          editingSide: selection.side,
          selection: null,
          selectedPoints: [],
          selectedSubPaths: selectedSubPaths.length > 0 ? selectedSubPaths : [selection],
          selectedBlockIds: [],
        };
      }
      return {
        selectedLayerId: selection.layerId,
        editingSide: selection.side,
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [selection],
        selectedBlockIds: [],
      };
    });
  },
  selectMultiplePoints: (points: Selection[]) =>
    set({
      selectedPoints: points,
      selection: points[0] || null,
      selectedSubPaths: [],
      selectedBlockIds: [],
    }),
  selectMultipleSubPaths: (subPaths: SubPathSelection[]) =>
    set({
      selectedSubPaths: subPaths,
      selectedLayerId: subPaths[0]?.layerId ?? get().selectedLayerId,
      editingSide: subPaths[0]?.side ?? get().editingSide,
      selection: null,
      selectedPoints: [],
      selectedBlockIds: [],
    }),
  clearSelection: () => set({ selection: null, selectedPoints: [], selectedSubPaths: [] }),

  deselectAll: () =>
    set({
      hasCanvasSelection: false,
      selectionKind: "none",
      selectedFrameIds: [],
      selectedLayerIds: [],
      selectedLayerRefs: [],
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
      selectedBlockIds: [],
    }),

  getCurrentSelectedPoint: () => {
    const state = get();
    if (!state.selection) return null;
    const layer = state.layers.find((l) => l.id === state.selection?.layerId);
    if (!layer) return null;
    const path = state.editingSide === "from" ? layer.from : endOf(layer);
    const cmd = path.subPaths[state.selection.subPathIndex]?.commands[state.selection.commandIndex];
    return cmd?.points[state.selection.pointIndex] || null;
  },

  // === Project reset ===
  resetProject: () => {
    get().pushHistory();
    const frames = initialFrames.map(cloneFrame);
    const active = frames[0];
    set({
      frames,
      selectedFrameId: active.id,
      rootLayers: [],
      rootAnimation: structuredClone(initialRootAnimation),
      rootHiddenLayerIds: [],
      worldViewport: computeFramesViewport(frames),
      detailViewport: computeVectorViewport(active.vector),
      layers: cloneLayers(active.layers),
      selectedLayerId: getFirstEditableLayerId(active.layers),
      selectedLayerIds: [getFirstEditableLayerId(active.layers)],
      selectedLayerRefs: [{ ownerId: active.id, layerId: getFirstEditableLayerId(active.layers) }],
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
      progress: 0,
      speed: 1,
      zoom: 1,
      isSlowMotion: false,
      isRepeating: true,
      isPlaying: false,
      isActionMode: false,
      editingSide: "from",
      vector: structuredClone(active.vector),
      animation: structuredClone(active.animation),
      hiddenLayerIds: [],
      selectedBlockIds: [],
      collapsedLayerIds: [],
      timelineZoom: 1,
      timelineScrollX: 0,
      timelineScrollY: 0,
      timelineCollapsed: false,
      hasCanvasSelection: true,
      selectionKind: "layer",
      selectedFrameIds: [],
      toolMode: "select",
      cursorType: "default",
      hoveredItem: null,
      dragState: null,
      clipboard: null,
    });
  },

  // 1td advanced (14l) impls (smallest, mirrors reverse/boolean patterns exactly, respects editingSide where relevant).
  simplifySelectedLayer: (tolerance = 0.5) => {
    const { layers, selectedLayerId, editingSide } = get();
    const li = layers.findIndex((l) => l.id === selectedLayerId);
    if (li === -1) return;
    const lay = layers[li];
    const target = editingSide === "from" ? lay.from : endOf(lay);
    const simplified = simplifyPath(target, tolerance);
    const newLayers = [...layers];
    if (editingSide === "from") {
      newLayers[li] = { ...lay, from: simplified, pathData: simplified };
    } else {
      newLayers[li] = { ...lay, to: simplified };
    }
    get().pushHistory();
    set({ layers: newLayers });
  },
  setSelectedDashPattern: (dash) => {
    get().updateSelectedLayer({ strokeDasharray: dash || undefined });
  },
  applyTaperToSelected: (taper = 0.6) => {
    // Applies simple taper profile via style for now (full var-width path approx future; getTaperedStrokeWidth primitive ready for renderers).
    const { layers, selectedLayerId } = get();
    const lay = layers.find((l) => l.id === selectedLayerId);
    if (!lay) return;
    const w = lay.strokeWidth ?? 2;
    const tapered = getTaperedStrokeWidth(0.5, w, taper);
    get().updateSelectedLayer({ strokeWidth: tapered });
  },

  // === Compatibility helper (for UI warnings) ===
  getCompatibilityStatus: () => {
    const { layers, selectedLayerId } = get();
    const layer = layers.find((l) => l.id === selectedLayerId);
    if (!layer) return { compatible: true, fromPoints: 0, toPoints: 0, warning: "" };

    const fromCount = countPathPoints(layer.from);
    const toCount = countPathPoints(endOf(layer));
    const ratio = Math.max(fromCount, toCount) / Math.max(1, Math.min(fromCount, toCount));
    const compatible = arePathsStructurallyCompatible(layer.from, endOf(layer));

    let warning = "";
    if (!compatible) {
      if (ratio > 1.5) {
        warning = "Paths have very different structure — use Auto Fix";
      } else {
        warning = "Path commands differ — use Auto Fix";
      }
    }

    return {
      compatible,
      fromPoints: fromCount,
      toPoints: toCount,
      warning,
    };
  },
}));

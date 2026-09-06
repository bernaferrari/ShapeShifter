import { create } from "zustand";

/**
 * ShapeShifter 2026 - Editor Store
 * Central state management using Zustand.
 * Single source of truth for layers, selection, playback, and path mutations.
 */

import {
  reversePath,
  shiftPath,
  areAndroidPathsMorphCompatible,
  countPathPoints,
  BOOLEAN_OPERATIONS_ENABLED,
  booleanCombine,
  simplifyPath,
  getTaperedStrokeWidth,
} from "../shapeshifter/pathUtils";
import type { Viewport } from "../shapeshifter/camera";
import type {
  AnimationState,
  DocumentV2,
  Layer,
  LayerType,
  MorphMapping,
  PathData,
  TimelineBlock,
  Point,
  Selection,
  VectorMetadata,
} from "../shapeshifter/types";
import type { ToolMode, CursorType } from "../shapeshifter/toolModes";
import type { LayerPlacement } from "../shapeshifter/scene/layerHierarchy";
import type { LayerSelectionRef } from "../shapeshifter/scene/owners";
import {
  createDocumentV2FromLegacy,
  type LegacyDocumentSnapshot,
} from "../shapeshifter/documentModel";
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
import { commitDocumentV2 } from "./documentRuntime";
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
  /**
   * Subtree TimelineBlocks snapshotted alongside the layers at copy time.
   * Authoring writes only animation.blocks (the per-layer .timeline mirror is
   * stale-prone), so pasteLayers re-emits these with remapped layerIds — the
   * same treatment duplicateSelectedLayersOffset gives Alt-drag clones.
   */
  blocks?: TimelineBlock[];
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

/** Session chrome stored beside the DocumentV2 graph in undo history. */
export interface HistorySession {
  selectedFrameId: string;
  selectedFrameIds: string[];
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

/** Undo records the live DocumentV2 plus session chrome — not a second Layer[] clone. */
export interface HistoryEntry {
  documentV2: DocumentV2;
  session: HistorySession;
}

export interface MorphPreview {
  layerId: string | number;
  originalFrom: PathData;
  originalTo: PathData;
  preparedFrom: PathData;
  preparedTo: PathData;
  mapping: MorphMapping;
}
export interface EditorState {
  /** Live document graph. Undo, export, and persist commit this object. */
  documentV2: DocumentV2;
  morphPreview: MorphPreview | null;
  previewPrepareForMorph: () => boolean;
  commitMorphPreview: () => boolean;
  cancelMorphPreview: () => void;
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

  /** Last export format the user picked; a session preference, not document state. */
  preferredExportFormat:
    | "svg"
    | "css"
    | "lottie"
    | "vector"
    | "avd"
    | "spritesheet"
    | "json"
    | "pdf"
    | "static";
  setPreferredExportFormat: (
    format: "svg" | "css" | "lottie" | "vector" | "avd" | "spritesheet" | "json" | "pdf" | "static",
  ) => void;

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
  /** Redo branch captured at the latest push so a cancelled gesture can restore it. */
  historyCancelFuture: HistoryEntry[] | null;
  /** Numeric/pointer gesture coalesces every mutator push into one undo step. */
  historyGestureActive: boolean;
  historyGesturePushed: boolean;
  canUndo: boolean;
  canRedo: boolean;

  // History actions
  undo: () => void;
  redo: () => void;
  pushHistory: () => void; // internal
  beginHistoryGesture: () => void;
  endHistoryGesture: () => void;
  /** Restore the latest snapshot and the redo branch that existed before the gesture. */
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
  moveFrame: (id: string, dx: number, dy: number, options?: { recordHistory?: boolean }) => void;
  moveFrames: (
    ids: string[],
    dx: number,
    dy: number,
    options?: { recordHistory?: boolean },
  ) => void;
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
  updateVector: (patch: Partial<VectorMetadata>, options?: { recordHistory?: boolean }) => void;
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

const initialDocumentV2 = createDocumentV2FromLegacy({
  id: "document",
  name: "ShapeShifter",
  frames: initialFrames.map((frame) => ({
    id: frame.id,
    name: frame.name,
    x: frame.x,
    y: frame.y,
    layers: frame.layers,
    vector: frame.vector,
    animation: frame.animation,
    hiddenLayerIds: frame.hiddenLayerIds,
  })),
  rootLayers: [],
  rootVector: { id: "page", name: "Page", width: 24, height: 24, alpha: 1 },
  rootAnimation: initialRootAnimation,
  rootHiddenLayerIds: [],
});

/** Resolve end geometry, falling back to start for static layers. */
const endOf = (layer: Layer): PathData => layer.to ?? layer.from;

type SetEditorState = (
  update: Partial<EditorState> | ((state: EditorState) => Partial<EditorState> | EditorState),
) => void;

/**
 * Projection slices that define document content. When a write changes any of these
 * (by reference), the live DocumentV2 graph is scheduled for rebuild from the
 * flushed workspace. Freshness is enforced by the store itself — no call site has
 * to remember to flush, including external `useEditorStore.setState` gesture writes.
 */
const CONTENT_KEYS = [
  "layers",
  "frames",
  "rootLayers",
  "vector",
  "animation",
  "hiddenLayerIds",
  "selectedFrameId",
  "rootAnimation",
  "rootHiddenLayerIds",
] as const;

function contentChanged(prev: EditorState, patch: Partial<EditorState>): boolean {
  for (const key of CONTENT_KEYS) {
    if (key in patch && patch[key] !== prev[key]) return true;
  }
  return false;
}

/**
 * Rebuilding DocumentV2 walks every frame/layer/node/track, so doing it per write
 * makes each drag tick pay O(document) twice (barrier + syncActiveOwner). Instead
 * the commit is scheduled once per microtask checkpoint: burst writes within one
 * task collapse into a single rebuild that lands before React renders or the next
 * input event. Synchronous readers are protected because every read path that
 * needs a fresh live graph (serialize/export via flushLiveExportDocument,
 * undo/redo snapshots, load/reset flows) passes a patch carrying `documentV2`,
 * which supersedes — and cancels — any pending commit.
 */
let commitScheduled = false;

/**
 * Write barrier for document content. A patch that carries `documentV2` wins
 * (load/reset/undo flows replacing the graph wholesale) and supersedes anything
 * pending. Full-state replacement (`replace`) never routes through here — the
 * caller forwards it to zustand untouched, because wrapping a replacement in an
 * updater function would silently downgrade it to a merge.
 */
function setDocumentState(
  set: SetEditorState,
  update: Partial<EditorState> | ((state: EditorState) => Partial<EditorState> | EditorState),
) {
  set((state) => {
    const patch = typeof update === "function" ? update(state) : update;
    if ("documentV2" in patch) {
      // A wholesale replacement supersedes anything pending.
      commitScheduled = false;
      return patch;
    }
    if (!contentChanged(state, patch)) return patch;
    if (!commitScheduled) {
      commitScheduled = true;
      queueMicrotask(() => {
        // A `documentV2`-bearing write may have superseded this commit meanwhile.
        if (!commitScheduled) return;
        commitScheduled = false;
        useEditorStore.setState({
          documentV2: commitDocumentV2(useEditorStore.getState()),
        });
      });
    }
    return patch;
  });
}

export const useEditorStore = create<EditorState>((rawSet, get) => {
  /** Every content write routes through the freshness barrier — see setDocumentState. */
  const set: SetEditorState = (update) => setDocumentState(rawSet, update);

  return {
    documentV2: initialDocumentV2,
    morphPreview: null,
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
    historyCancelFuture: null,
    historyGestureActive: false,
    historyGesturePushed: false,
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
    preferredExportFormat: "avd",

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

    ...createSessionActions(set, get),
    ...createVectorPathActions(set, get),

    setPreferredExportFormat: (format) => set({ preferredExportFormat: format }),

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
      setDocumentState(set, { layers: newLayers });
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
      setDocumentState(set, { layers: newLayers });
      return true; // for toast feedback
    },

    booleanCombine: (op) => {
      if (!BOOLEAN_OPERATIONS_ENABLED) return;
      const { layers, selectedLayerIds } = get();
      // Exactly two operands must be chosen up front — no invisible fallback partner.
      if (selectedLayerIds.length < 2) return;
      const idxA = layers.findIndex((l) => String(l.id) === String(selectedLayerIds[0]));
      const idxB = layers.findIndex((l) => String(l.id) === String(selectedLayerIds[1]));
      if (idxA === -1 || idxB === -1 || idxA === idxB) return;
      const layerA = layers[idxA]!;
      const layerB = layers[idxB]!;
      // Same lock discipline as reverseSelectedLayer / shiftSelectedLayer: a locked
      // layer must never be consumed or deleted by a boolean op.
      if (layerA.locked || layerB.locked) return;
      const combined = booleanCombine(op, layerA.from, layerB.from);
      const resultLayer: Layer = {
        ...layerA,
        from: combined,
        // A morphable layer stays morphable: clone the combined geometry into `to`
        // instead of aliasing it, and never invent `to` on a static layer.
        ...(layerA.to !== undefined ? { to: structuredClone(combined) } : {}),
        pathData: combined,
        name: `${layerA.name} ${op}`,
      };
      let newLayers = [...layers];
      newLayers[idxA] = resultLayer;
      newLayers = newLayers.filter((_, i) => i !== idxB);
      // Deleting layerB orphans its animation blocks — same pruning as deleteLayer.
      const animationBlocks = get().animation.blocks.filter(
        (block) =>
          String(block.layerId) !== String(layerA.id) &&
          String(block.layerId) !== String(layerB.id),
      );
      get().pushHistory();
      setDocumentState(set, {
        layers: newLayers,
        animation: { ...get().animation, blocks: animationBlocks },
        selectedBlockIds: get().selectedBlockIds.filter((blockId) =>
          animationBlocks.some((block) => block.id === blockId),
        ),
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
        return {
          selection,
          selectedPoints: [selection],
          selectedSubPaths: [],
          selectedBlockIds: [],
        };
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
      const cmd =
        path.subPaths[state.selection.subPathIndex]?.commands[state.selection.commandIndex];
      return cmd?.points[state.selection.pointIndex] || null;
    },

    // === Project reset ===
    resetProject: () => {
      get().pushHistory();
      const frames = initialFrames.map(cloneFrame);
      const active = frames[0]!;
      const layers = cloneLayers(active.layers);
      const vector = structuredClone(active.vector);
      const animation = structuredClone(active.animation);
      // Load/reset flows replace the graph wholesale, so this patch carries a
      // fresh documentV2 (see setDocumentState): same-task readers must never
      // observe the previous project through it.
      const documentV2 = commitDocumentV2({
        ...get(),
        frames,
        rootLayers: [],
        rootAnimation: structuredClone(initialRootAnimation),
        rootHiddenLayerIds: [],
        layers,
        vector,
        animation,
        hiddenLayerIds: [],
        selectedFrameId: active.id,
      } as EditorState);
      setDocumentState(set, {
        frames,
        selectedFrameId: active.id,
        rootLayers: [],
        rootAnimation: structuredClone(initialRootAnimation),
        rootHiddenLayerIds: [],
        worldViewport: computeFramesViewport(frames),
        detailViewport: computeVectorViewport(active.vector),
        layers,
        selectedLayerId: getFirstEditableLayerId(active.layers),
        selectedLayerIds: [getFirstEditableLayerId(active.layers)],
        selectedLayerRefs: [
          { ownerId: active.id, layerId: getFirstEditableLayerId(active.layers) },
        ],
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
        morphPreview: null,
        editingSide: "from",
        vector,
        animation,
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
        documentV2,
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
      setDocumentState(set, { layers: newLayers });
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
      const compatible = areAndroidPathsMorphCompatible(layer.from, endOf(layer));

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
  };
});

/**
 * Gesture hooks and tests write projections via `useEditorStore.setState` directly;
 * route those through the same freshness barrier as internal actions. Zustand's
 * second `replace` argument must survive the shim: two-arg callers (test baselines)
 * mean full-state replacement, and dropping it — or wrapping it in an updater,
 * which zustand would treat as a merge — silently lies about the API. A
 * replacement is itself a content write and keeps the old synchronous commit.
 */
const rawSetState = useEditorStore.setState.bind(useEditorStore) as (
  update: Partial<EditorState> | ((state: EditorState) => Partial<EditorState> | EditorState),
  replace?: boolean,
) => void;

useEditorStore.setState = ((
  update: Partial<EditorState> | ((state: EditorState) => Partial<EditorState> | EditorState),
  replace?: boolean,
) => {
  if (replace) {
    commitScheduled = false;
    return rawSetState(update as EditorState, true);
  }
  setDocumentState(rawSetState as SetEditorState, update);
}) as typeof useEditorStore.setState;

import { create } from "zustand";

/**
 * ShapeShifter 2026 - Editor Store
 * Central state management using Zustand.
 * Single source of truth for layers, selection, playback, and path mutations.
 */

import {
  parsePath,
  pathToString,
  updatePoint,
  scalePathToBounds,
  getPathDataBounds,
  deleteCommand,
  deleteSubPath,
  extractSubPath,
  splitCommandInHalf,
  setCommandAsFirst,
  splitPointNear,
  reversePath,
  shiftPath,
  autoFixPathPair,
  arePathsStructurallyCompatible,
  countPathPoints,
  booleanCombine,
  simplifyPath,
  getTaperedStrokeWidth,
  ensureStableCommandIds,
} from "../shapeshifter/pathUtils";
import type { Viewport } from "../shapeshifter/camera";
import { computeDetailViewport, computeFitViewport, zoomAtWorldPoint } from "../shapeshifter/camera";
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
import { getDemoProject } from "../shapeshifter/demoProjects";
import { flexCurvature } from "../shapeshifter/gestures/HitTests";

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

export interface CanvasFrame {
  id: string;
  name: string;
  x: number;
  y: number;
  layers: Layer[];
  vector: VectorMetadata;
  animation: AnimationState;
  hiddenLayerIds: string[];
}

/** Stable owner id for vectors placed directly on the infinite page. */
export const PAGE_ROOT_ID = "__page_root__";

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

const PATH_STYLE_DEFAULTS = {
  fillColor: "",
  fillAlpha: 1,
  strokeColor: "",
  strokeAlpha: 1,
  strokeWidth: 0,
  strokeLinecap: "butt" as const,
  strokeLinejoin: "miter" as const,
  strokeMiterLimit: 4,
  trimPathStart: 0,
  trimPathEnd: 1,
  trimPathOffset: 0,
  fillType: "nonZero" as const,
};

function createPathLayer(layer: Omit<Layer, "type"> & Partial<Pick<Layer, "type">>): Layer {
  return {
    ...PATH_STYLE_DEFAULTS,
    pathData: layer.from,
    alpha: 1,
    translateX: 0,
    translateY: 0,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    pivotX: 0,
    pivotY: 0,
    timeline: [],
    ...layer,
    type: layer.type ?? "path",
  };
}

/** Full editable-state snapshot for trustworthy undo/redo (C7). */
interface HistoryEntry {
  frames: CanvasFrame[];
  selectedFrameId: string;
  rootLayers: Layer[];
  rootAnimation: AnimationState;
  rootHiddenLayerIds: string[];
  layers: Layer[];
  vector: VectorMetadata;
  animation: AnimationState;
  hiddenLayerIds: string[];
  selectedLayerId: string | number;
  selectedLayerIds: Array<string | number>;
  selection: Selection | null;
  selectedPoints: Selection[];
  selectedSubPaths: SubPathSelection[];
  editingSide: "from" | "to";
  hasCanvasSelection: boolean;
  selectionKind: "none" | "frame" | "layer";
}
interface EditorState {
  // Workspace frames
  frames: CanvasFrame[];
  selectedFrameId: string;
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
  canUndo: boolean;
  canRedo: boolean;

  // History actions
  undo: () => void;
  redo: () => void;
  pushHistory: () => void; // internal

  // Workspace frame actions
  addFrame: () => void;
  duplicateFrame: () => void;
  renameFrame: (id: string, name: string) => void;
  deleteFrame: (id: string) => void;
  selectFrame: (id: string) => void;
  moveFrame: (id: string, dx: number, dy: number) => void;
  moveFrames: (ids: string[], dx: number, dy: number) => void;
  /** Reparent selected objects to another frame without changing world position. */
  moveSelectedLayersToFrame: (
    targetFrameId: string,
    options?: { recordHistory?: boolean },
  ) => boolean;
  moveSelectedLayersToRoot: (options?: { recordHistory?: boolean }) => boolean;
  selectRootLayer: (id: string | number) => void;

  // World camera (1el / k4mv Phase 2) — first-class store citizen
  worldViewport: Viewport;
  setWorldViewport: (v: Partial<Viewport>) => void;
  fitWorldToFrames: (frameIds?: string[]) => void;
  bringFrameIntoView: (frameId: string, options?: { animate?: boolean }) => void;

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
  deleteSelectedLayers: () => void;
  toggleLayerLock: (id: string | number) => void;
  reorderLayer: (id: string | number, toIndex: number) => void;
  /** Z-order: +1 bring forward, -1 send backward (Figma ] / [ style). */
  nudgeLayerZOrder: (id: string | number, delta: number) => void;
  groupSelectedLayers: () => void;
  ungroupSelectedLayer: () => void;
  /** Space-hold temporary pan (Figma hand); keyup without pan = play/pause. */
  spacePanActive: boolean;
  setSpacePanActive: (active: boolean) => void;
  /** Alt-drag duplicate: clone selected layers offset by dx/dy and select clones. */
  duplicateSelectedLayersOffset: (dx: number, dy: number) => void;
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
  ) => void;
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
  setAnimationDuration: (ms: number) => void;

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

/**
 * Default workspace = three artboards. Shapes that are *visually* separate pieces
 * are real layers (Figma model) — not one compound path with fake names.
 *
 *  Play → Pause: 2 layers (upper / lower triangle → pause bars)
 *  Menu → Close: 3 layers (top / mid / bottom bar → X arms + collapse)
 *  Heart → Star: 1 layer (single silhouette morph)
 */
const DEFAULT_DURATION_MS = 1000;

type MorphPart = {
  id: string;
  name: string;
  from: string;
  to: string;
};

function makeMorphFrame(opts: {
  id: string;
  name: string;
  x: number;
  y: number;
  stroke?: boolean;
  fill?: boolean;
  /** One timeline object + pathData block per part */
  parts: MorphPart[];
}): CanvasFrame {
  const stroke = opts.stroke !== false;
  const fill = !!opts.fill;
  const layers = opts.parts.map((part) => {
    const from = parsePath(part.from);
    const to = parsePath(part.to);
    return createPathLayer({
      id: part.id,
      name: part.name,
      from,
      to,
      pathData: from,
      visible: true,
      locked: false,
      strokeColor: stroke ? "#000000" : "",
      strokeWidth: stroke ? 2.4 : 0,
      fillColor: fill ? "#000000" : "",
    });
  });
  const animation: AnimationState = {
    id: `anim-${opts.id}`,
    name: opts.name,
    duration: DEFAULT_DURATION_MS,
    blocks: opts.parts.map((part, i) => {
      const layer = layers[i]!;
      return {
        id: `block-${opts.id}-${part.id}`,
        layerId: layer.id,
        propertyName: "pathData",
        fromValue: pathToString(layer.from),
        toValue: pathToString(layer.to ?? layer.from),
        startTime: 0,
        endTime: DEFAULT_DURATION_MS,
        interpolator: "FAST_OUT_SLOW_IN" as const,
        type: "path" as const,
      };
    }),
  };
  return {
    id: opts.id,
    name: opts.name,
    x: opts.x,
    y: opts.y,
    layers,
    vector: {
      id: `vector-${opts.id}`,
      name: opts.name,
      width: 24,
      height: 24,
      alpha: 1,
    },
    animation,
    hiddenLayerIds: [],
  };
}

/**
 * Default morph frames. Paths designed for linear point interpolation
 * (matching topology + vertex order — wrong order causes mid-morph flips).
 */
const initialFrames: CanvasFrame[] = [
  makeMorphFrame({
    id: "frame-play-pause",
    // Frame name = artboard label only (Figma). Morph intent lives on animation.name.
    name: "Play icon",
    x: 0,
    y: 0,
    stroke: false,
    fill: true,
    // Classic two-piece play icon → two pause bars (each piece is its own layer)
    parts: [
      {
        id: "layer-play-upper",
        name: "Upper",
        from: "M 8 5 L 8 12 L 19 12 L 19 12 L 8 5",
        to: "M 5 6 L 5 10 L 19 10 L 19 6 L 5 6",
      },
      {
        id: "layer-play-lower",
        name: "Lower",
        from: "M 8 12 L 8 19 L 19 12 L 19 12 L 8 12",
        to: "M 5 14 L 5 18 L 19 18 L 19 14 L 5 14",
      },
    ],
  }),
  makeMorphFrame({
    id: "frame-menu-close",
    name: "Menu icon",
    x: 48,
    y: 0,
    stroke: false,
    fill: true,
    // Each hamburger line is a layer (Figma: three rectangles, not one compound path).
    // Vertex order TL→TR→BR→BL on every bar so they rotate without flipping.
    parts: [
      {
        id: "layer-menu-top",
        name: "Top bar",
        from: "M 3 5 L 21 5 L 21 7.5 L 3 7.5 Z",
        to: "M 6.45 4.55 L 19.45 17.55 L 17.55 19.45 L 4.55 6.45 Z",
      },
      {
        id: "layer-menu-mid",
        name: "Middle bar",
        from: "M 3 10.75 L 21 10.75 L 21 13.25 L 3 13.25 Z",
        to: "M 12 12 L 12 12 L 12 12 L 12 12 Z",
      },
      {
        id: "layer-menu-bottom",
        name: "Bottom bar",
        from: "M 3 16.5 L 21 16.5 L 21 19 L 3 19 Z",
        to: "M 4.55 17.55 L 17.55 4.55 L 19.45 6.45 L 6.45 19.45 Z",
      },
    ],
  }),
  makeMorphFrame({
    id: "frame-heart-star",
    name: "Heart icon",
    x: 96,
    y: 0,
    stroke: false,
    fill: true,
    // One continuous silhouette — truly a single layer
    parts: [
      {
        id: "layer-heart-star",
        name: "Shape",
        from: "M 12 6.8 L 15.4 4.1 L 19.6 5.3 L 21 9.2 L 19 14 L 12 20.8 L 5 14 L 3 9.2 L 4.4 5.3 L 8.6 4.1 Z",
        to: "M 12 3 L 14.4 9.1 L 20.9 9.4 L 15.9 13.5 L 17.6 20 L 12 16.4 L 6.4 20 L 8.1 13.5 L 3.1 9.4 L 9.6 9.1 Z",
      },
    ],
  }),
];

const initialFrame = initialFrames[0];
const initialLayers = cloneLayersForInit(initialFrame.layers);
const initialVector = structuredClone(initialFrame.vector);
const initialAnimation = structuredClone(initialFrame.animation);
const initialRootAnimation: AnimationState = {
  id: "page-root-animation",
  name: "Page motion",
  duration: initialAnimation.duration,
  blocks: [],
};

function cloneLayersForInit(layers: Layer[]) {
  return structuredClone(layers);
}

const cloneLayers = (layers: Layer[]) => structuredClone(layers);
/** Apply fn to a layer's end geometry only when it exists (static layers have no `to`). */
const mapToEnd = (layer: Layer, fn: (p: PathData) => PathData): PathData | undefined =>
  layer.to ? fn(layer.to) : undefined;
/** Resolve end geometry, falling back to start for static layers. */
const endOf = (layer: Layer): PathData => layer.to ?? layer.from;

function saveActiveRoot(state: EditorState) {
  return state.selectedFrameId === PAGE_ROOT_ID
    ? {
        layers: cloneLayers(state.layers),
        animation: structuredClone(state.animation),
        hiddenLayerIds: [...state.hiddenLayerIds],
      }
    : {
        layers: cloneLayers(state.rootLayers),
        animation: structuredClone(state.rootAnimation),
        hiddenLayerIds: [...state.rootHiddenLayerIds],
      };
}

/** Capture the full editable state for undo/redo (C7: selection + animation included). */
const snapshotHistoryEntry = (s: EditorState): HistoryEntry => {
  const root = saveActiveRoot(s);
  return {
    frames: saveActiveFrame(s),
    selectedFrameId: s.selectedFrameId,
    rootLayers: root.layers,
    rootAnimation: root.animation,
    rootHiddenLayerIds: root.hiddenLayerIds,
    layers: cloneLayers(s.layers),
    vector: structuredClone(s.vector),
    animation: structuredClone(s.animation),
    hiddenLayerIds: [...s.hiddenLayerIds],
    selectedLayerId: s.selectedLayerId,
    selectedLayerIds: [...s.selectedLayerIds],
    selection: s.selection ? structuredClone(s.selection) : null,
    selectedPoints: s.selectedPoints.map((p) => structuredClone(p)),
    selectedSubPaths: s.selectedSubPaths.map((p) => structuredClone(p)),
    editingSide: s.editingSide,
    hasCanvasSelection: s.hasCanvasSelection,
    selectionKind: s.selectionKind,
  };
};

/** Restore a history entry, re-anchoring selection onto restored layers defensively. */
const restoreHistoryEntry = (s: EditorState, entry: HistoryEntry) => {
  const layerExists = entry.layers.some((l) => l.id === entry.selectedLayerId);
  return {
    frames: entry.frames.map(cloneFrame),
    selectedFrameId: entry.selectedFrameId,
    rootLayers: cloneLayers(entry.rootLayers),
    rootAnimation: structuredClone(entry.rootAnimation),
    rootHiddenLayerIds: [...entry.rootHiddenLayerIds],
    layers: entry.layers,
    vector: entry.vector,
    animation: entry.animation,
    hiddenLayerIds: entry.hiddenLayerIds,
    selectedLayerId: layerExists ? entry.selectedLayerId : (entry.layers[0]?.id ?? 0),
    selectedLayerIds: entry.selectedLayerIds,
    selection: entry.selection,
    selectedPoints: entry.selectedPoints,
    selectedSubPaths: entry.selectedSubPaths,
    editingSide: entry.editingSide,
    hasCanvasSelection: entry.hasCanvasSelection,
    selectionKind: entry.selectionKind,
  };
};

function normalizeLayerPaths(layer: Layer): Layer {
  // 3t0c: last line of defense. Any Layer arriving at the store boundary (from demos,
  // JSON deserialization, tests, paste, etc.) gets its PathData command IDs hardened.
  // Safe, pure, early-exits on already-good data.
  return {
    ...layer,
    from: ensureStableCommandIds(layer.from),
    to: mapToEnd(layer, ensureStableCommandIds),
    ...(layer.pathData && { pathData: ensureStableCommandIds(layer.pathData) }),
    // Note: children recursion not needed today (groups carry empty paths); future-proof if added.
  };
}

function normalizeLayers(layers: Layer[]): Layer[] {
  return layers.map(normalizeLayerPaths);
}

const getFirstEditableLayerId = (layers: Layer[]) =>
  layers.find((layer) => layer.type === "path" || layer.type === "clipPath")?.id ??
  layers[0]?.id ??
  0;

function cloneFrame(frame: CanvasFrame): CanvasFrame {
  return {
    ...frame,
    layers: cloneLayers(frame.layers),
    vector: structuredClone(frame.vector),
    animation: structuredClone(frame.animation),
    hiddenLayerIds: [...frame.hiddenLayerIds],
  };
}

function snapshotFrame(state: EditorState, frame?: CanvasFrame): CanvasFrame {
  return {
    id: frame?.id ?? state.selectedFrameId,
    name: frame?.name ?? state.vector.name ?? "Frame",
    x: frame?.x ?? 0,
    y: frame?.y ?? 0,
    layers: cloneLayers(state.layers),
    vector: structuredClone(state.vector),
    animation: structuredClone(state.animation),
    hiddenLayerIds: [...state.hiddenLayerIds],
  };
}

function saveActiveFrame(state: EditorState) {
  return state.frames.map((frame) =>
    frame.id === state.selectedFrameId ? snapshotFrame(state, frame) : cloneFrame(frame),
  );
}

function cubicPointAt(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  t: number,
): Point {
  const mt = 1 - t;
  return {
    x:
      mt ** 3 * start.x +
      3 * mt ** 2 * t * control1.x +
      3 * mt * t ** 2 * control2.x +
      t ** 3 * end.x,
    y:
      mt ** 3 * start.y +
      3 * mt ** 2 * t * control1.y +
      3 * mt * t ** 2 * control2.y +
      t ** 3 * end.y,
  };
}

function getFrameRect(frame: CanvasFrame) {
  return {
    x: frame.x || 0,
    y: frame.y || 0,
    w: frame.vector?.width || 48,
    h: frame.vector?.height || 48,
  };
}

function computeFramesViewport(frames: CanvasFrame[]): Viewport {
  return computeFitViewport(frames.map(getFrameRect));
}

function computeVectorViewport(vector: VectorMetadata, scale = 1): Viewport {
  return computeDetailViewport({ width: vector.width, height: vector.height }, scale);
}

function zoomViewportAtCenter(viewport: Viewport, scale: number): Viewport {
  return zoomAtWorldPoint(
    viewport,
    {
      x: viewport.x + viewport.w / 2,
      y: viewport.y + viewport.h / 2,
    },
    scale,
    0.25,
    8,
  );
}

export const useEditorStore = create<EditorState>((set, get) => ({
  frames: initialFrames.map(cloneFrame),
  selectedFrameId: initialFrame.id,
  rootLayers: [],
  rootAnimation: structuredClone(initialRootAnimation),
  rootHiddenLayerIds: [],
  layers: cloneLayers(initialLayers),
  vector: structuredClone(initialVector),
  animation: structuredClone(initialAnimation),
  hiddenLayerIds: [],
  history: [],
  future: [],
  canUndo: false,
  canRedo: false,
  selectedLayerId: getFirstEditableLayerId(initialLayers),
  selectedLayerIds: [getFirstEditableLayerId(initialLayers)],
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

  pushHistory: () => {
    set({
      history: [...get().history, snapshotHistoryEntry(get())].slice(-100),
      future: [],
      canUndo: true,
      canRedo: false,
    });
  },

  undo: () => {
    const { history } = get();
    if (history.length === 0) return;
    const entry = history[history.length - 1];
    const current = snapshotHistoryEntry(get());
    set({
      ...restoreHistoryEntry(get(), entry),
      history: history.slice(0, -1),
      future: [current, ...get().future],
      canUndo: history.length > 1,
      canRedo: true,
    });
  },

  redo: () => {
    const { future } = get();
    if (future.length === 0) return;
    const entry = future[0];
    const current = snapshotHistoryEntry(get());
    set({
      ...restoreHistoryEntry(get(), entry),
      future: future.slice(1),
      history: [...get().history, current],
      canUndo: true,
      canRedo: future.length > 1,
    });
  },

  addFrame: () => {
    const state = get();
    const savedFrames = saveActiveFrame(state);
    const nextIndex = savedFrames.length + 1;
    const name = `Frame ${nextIndex}`;
    // Place the new frame just to the right of the rightmost existing one (Figma-style),
    // aligned to the same top edge — not scattered across the world.
    const gap = 24;
    const rightEdge = savedFrames.reduce(
      (max, f) => Math.max(max, (f.x ?? 0) + (f.vector?.width ?? 48)),
      0,
    );
    const topEdge = savedFrames.length ? Math.min(...savedFrames.map((f) => f.y ?? 0)) : 40;
    const frame: CanvasFrame = {
      id: `frame-${Date.now()}`,
      name,
      x: savedFrames.length ? rightEdge + gap : 40,
      y: topEdge,
      layers: cloneLayers(initialLayers),
      vector: { ...initialVector, id: `vector-${Date.now()}`, name },
      animation: { ...initialAnimation, id: `anim-${Date.now()}` },
      hiddenLayerIds: [],
    };
    set({
      frames: [...savedFrames, frame],
      selectedFrameId: frame.id,
      detailViewport: computeVectorViewport(frame.vector),
      zoom: 1,
      layers: cloneLayers(frame.layers),
      vector: structuredClone(frame.vector),
      animation: structuredClone(frame.animation),
      hiddenLayerIds: [],
      selectedLayerId: getFirstEditableLayerId(frame.layers),
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
      // Figma-style: drop the copy immediately to the right of the original with a small
      // gap, on the same baseline — not flung off diagonally into the world.
      x: activeFrame.x + (activeFrame.vector?.width ?? 48) + 24,
      y: activeFrame.y,
      vector: {
        ...activeFrame.vector,
        id: `vector-${Date.now()}`,
        name: `${activeFrame.name} copy`,
      },
      animation: { ...activeFrame.animation, id: `anim-${Date.now()}` },
    });
    set({
      frames: [...savedFrames, frame],
      selectedFrameId: frame.id,
      detailViewport: computeVectorViewport(frame.vector),
      zoom: 1,
      layers: cloneLayers(frame.layers),
      vector: structuredClone(frame.vector),
      animation: structuredClone(frame.animation),
      hiddenLayerIds: [...frame.hiddenLayerIds],
      selectedLayerId: getFirstEditableLayerId(frame.layers),
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
    set((state) => {
      const frames = saveActiveFrame(state).map((frame) =>
        frame.id === id
          ? {
              ...frame,
              name: trimmedName,
              vector: { ...frame.vector, name: trimmedName },
            }
          : frame,
      );

      if (id !== state.selectedFrameId) {
        return { frames };
      }

      return {
        frames,
        vector: { ...state.vector, name: trimmedName },
      };
    });
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
    set({
      frames: nextFrames,
      selectedFrameId: fallbackFrame.id,
      detailViewport: computeVectorViewport(fallbackFrame.vector),
      zoom: 1,
      layers: cloneLayers(fallbackFrame.layers),
      vector: structuredClone(fallbackFrame.vector),
      animation: structuredClone(fallbackFrame.animation),
      hiddenLayerIds: [...fallbackFrame.hiddenLayerIds],
      selectedLayerId: getFirstEditableLayerId(fallbackFrame.layers),
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
      selectedBlockIds: [],
      progress: 0,
      isPlaying: false,
    });
  },

  selectFrame: (id) => {
    const state = get();
    /**
     * Figma: selecting a frame replaces the entire selection.
     * Children / points / timeline blocks are NOT co-selected with the frame.
     * Direct (vector) edit is exited back to object Select.
     */
    const clearChildSelection = {
      selection: null as null,
      selectedPoints: [] as [],
      selectedSubPaths: [] as [],
      selectedBlockIds: [] as string[],
      selectedLayerIds: [] as (string | number)[],
      hasCanvasSelection: true as const,
      selectionKind: "frame" as const,
      // Selecting the frame (not a path) leaves vector edit for Move
      toolMode: "select" as const,
    };

    // Same frame re-click: still promote selection to the frame and drop children.
    if (id === state.selectedFrameId) {
      set(clearChildSelection);
      return;
    }
    const savedFrames = saveActiveFrame(state);
    const savedRoot = saveActiveRoot(state);
    const frame = savedFrames.find((candidate) => candidate.id === id);
    if (!frame) return;
    // Switching frames does NOT reset the playhead or stop playback.
    set({
      frames: savedFrames,
      rootLayers: savedRoot.layers,
      rootAnimation: savedRoot.animation,
      rootHiddenLayerIds: savedRoot.hiddenLayerIds,
      selectedFrameId: frame.id,
      detailViewport: computeVectorViewport(frame.vector),
      zoom: 1,
      layers: cloneLayers(frame.layers),
      vector: structuredClone(frame.vector),
      animation: structuredClone(frame.animation),
      hiddenLayerIds: [...frame.hiddenLayerIds],
      // Keep a default “active layer for tools” but it is NOT selected (selectionKind: frame).
      selectedLayerId: getFirstEditableLayerId(frame.layers),
      ...clearChildSelection,
    });
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
      layers: cloneLayers(savedRoot.layers),
      vector: { id: PAGE_ROOT_ID, name: "Page", width: 1, height: 1, alpha: 1 },
      animation: structuredClone(savedRoot.animation),
      hiddenLayerIds: [...savedRoot.hiddenLayerIds],
      selectedLayerId: id,
      selectedLayerIds: [id],
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
      frames: state.frames.map((f) => (f.id === id ? { ...f, x: f.x + dx, y: f.y + dy } : f)),
    }));
  },
  moveFrames: (ids, dx, dy) => {
    if (!ids.length || (dx === 0 && dy === 0)) return;
    const idSet = new Set(ids);
    set((state) => ({
      frames: state.frames.map((f) => (idSet.has(f.id) ? { ...f, x: f.x + dx, y: f.y + dy } : f)),
    }));
  },

  moveSelectedLayersToFrame: (targetFrameId, options) => {
    const state = get();
    const sourceFrameId = state.selectedFrameId;
    if (!targetFrameId || targetFrameId === sourceFrameId) return false;

    const selectedIds =
      state.selectedLayerIds.length > 0
        ? state.selectedLayerIds
        : state.selectedLayerId != null
          ? [state.selectedLayerId]
          : [];
    if (selectedIds.length === 0) return false;

    const savedFrames = saveActiveFrame(state);
    const savedRoot = saveActiveRoot(state);
    const sourceIsRoot = sourceFrameId === PAGE_ROOT_ID;
    const source: CanvasFrame | undefined = sourceIsRoot
      ? {
          id: PAGE_ROOT_ID,
          name: "Page",
          x: 0,
          y: 0,
          layers: savedRoot.layers,
          vector: { id: PAGE_ROOT_ID, name: "Page", width: 1, height: 1, alpha: 1 },
          animation: savedRoot.animation,
          hiddenLayerIds: savedRoot.hiddenLayerIds,
        }
      : savedFrames.find((frame) => frame.id === sourceFrameId);
    const target = savedFrames.find((frame) => frame.id === targetFrameId);
    if (!source || !target) return false;

    // A selected group carries its descendants. A selected child whose parent stays
    // behind is detached to the destination root, matching Figma reparent semantics.
    const movedIdSet = new Set(selectedIds.map(String));
    let addedDescendant = true;
    while (addedDescendant) {
      addedDescendant = false;
      for (const layer of source.layers) {
        if (
          layer.parentId != null &&
          movedIdSet.has(String(layer.parentId)) &&
          !movedIdSet.has(String(layer.id))
        ) {
          movedIdSet.add(String(layer.id));
          addedDescendant = true;
        }
      }
    }

    const moving = source.layers.filter(
      (layer) => movedIdSet.has(String(layer.id)) && !layer.locked,
    );
    if (moving.length === 0) return false;
    const actualMovedIds = new Set(moving.map((layer) => String(layer.id)));
    // Layer IDs are document-global. Refuse a corrupt/imported collision instead
    // of silently replacing an unrelated destination object.
    if (target.layers.some((layer) => actualMovedIds.has(String(layer.id)))) return false;

    // Preserve the exact world transform while changing frame-local ownership.
    const offsetX = source.x - target.x;
    const offsetY = source.y - target.y;
    const movedLayers = moving.map((layer) => ({
      ...cloneLayers([layer])[0],
      translateX: (Number(layer.translateX) || 0) + offsetX,
      translateY: (Number(layer.translateY) || 0) + offsetY,
      parentId:
        layer.parentId != null && actualMovedIds.has(String(layer.parentId))
          ? layer.parentId
          : null,
    }));

    const movedBlocks = source.animation.blocks
      .filter((block) => actualMovedIds.has(String(block.layerId)))
      .map((block) => {
        const axisOffset =
          block.propertyName === "translateX"
            ? offsetX
            : block.propertyName === "translateY"
              ? offsetY
              : 0;
        if (!axisOffset) return structuredClone(block);
        return {
          ...structuredClone(block),
          fromValue:
            typeof block.fromValue === "number" ? block.fromValue + axisOffset : block.fromValue,
          toValue: typeof block.toValue === "number" ? block.toValue + axisOffset : block.toValue,
        };
      });
    const movedBlockIds = new Set(movedBlocks.map((block) => block.id));
    if (target.animation.blocks.some((block) => movedBlockIds.has(block.id))) return false;
    const targetLayers = [
      ...target.layers,
      ...movedLayers,
    ];
    const targetAnimation: AnimationState = {
      ...structuredClone(target.animation),
      duration: Math.max(
        target.animation.duration,
        ...movedBlocks.map((block) => block.endTime),
        1,
      ),
      blocks: [
        ...target.animation.blocks,
        ...movedBlocks,
      ],
    };
    const sourceHidden = new Set(source.hiddenLayerIds.map(String));
    const movedHiddenIds = moving
      .filter((layer) => sourceHidden.has(String(layer.id)))
      .map((layer) => String(layer.id));
    const targetHiddenIds = Array.from(
      new Set([...target.hiddenLayerIds.map(String), ...movedHiddenIds]),
    );

    if (options?.recordHistory !== false) get().pushHistory();

    const nextFrames = savedFrames.map((frame) => {
      if (!sourceIsRoot && frame.id === source.id) {
        return {
          ...frame,
          layers: frame.layers.filter((layer) => !actualMovedIds.has(String(layer.id))),
          animation: {
            ...frame.animation,
            blocks: frame.animation.blocks.filter(
              (block) => !actualMovedIds.has(String(block.layerId)),
            ),
          },
          hiddenLayerIds: frame.hiddenLayerIds.filter(
            (id) => !actualMovedIds.has(String(id)),
          ),
        };
      }
      if (frame.id === target.id) {
        return {
          ...frame,
          layers: cloneLayers(targetLayers),
          animation: structuredClone(targetAnimation),
          hiddenLayerIds: [...targetHiddenIds],
        };
      }
      return frame;
    });
    const nextRootLayers = sourceIsRoot
      ? savedRoot.layers.filter((layer) => !actualMovedIds.has(String(layer.id)))
      : savedRoot.layers;
    const nextRootAnimation = sourceIsRoot
      ? {
          ...savedRoot.animation,
          blocks: savedRoot.animation.blocks.filter(
            (block) => !actualMovedIds.has(String(block.layerId)),
          ),
        }
      : savedRoot.animation;
    const nextRootHiddenLayerIds = sourceIsRoot
      ? savedRoot.hiddenLayerIds.filter((id) => !actualMovedIds.has(String(id)))
      : savedRoot.hiddenLayerIds;

    const retainedSelectionIds = selectedIds.filter((id) => actualMovedIds.has(String(id)));
    const primaryId = retainedSelectionIds.at(-1) ?? movedLayers.at(-1)!.id;
    set({
      frames: nextFrames,
      rootLayers: cloneLayers(nextRootLayers),
      rootAnimation: structuredClone(nextRootAnimation),
      rootHiddenLayerIds: [...nextRootHiddenLayerIds],
      selectedFrameId: target.id,
      layers: cloneLayers(targetLayers),
      vector: structuredClone(target.vector),
      animation: structuredClone(targetAnimation),
      hiddenLayerIds: [...targetHiddenIds],
      selectedLayerId: primaryId,
      selectedLayerIds: retainedSelectionIds.length ? retainedSelectionIds : [primaryId],
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
      selectedBlockIds: [],
      hasCanvasSelection: true,
      selectionKind: "layer",
      toolMode: "select",
      detailViewport: computeVectorViewport(target.vector),
    });
    return true;
  },

  moveSelectedLayersToRoot: (options) => {
    const state = get();
    if (state.selectedFrameId === PAGE_ROOT_ID) return false;
    const selectedIds =
      state.selectedLayerIds.length > 0
        ? state.selectedLayerIds
        : state.selectedLayerId != null
          ? [state.selectedLayerId]
          : [];
    if (selectedIds.length === 0) return false;

    const savedFrames = saveActiveFrame(state);
    const savedRoot = saveActiveRoot(state);
    const source = savedFrames.find((frame) => frame.id === state.selectedFrameId);
    if (!source) return false;

    const movedIdSet = new Set(selectedIds.map(String));
    let addedDescendant = true;
    while (addedDescendant) {
      addedDescendant = false;
      for (const layer of source.layers) {
        if (
          layer.parentId != null &&
          movedIdSet.has(String(layer.parentId)) &&
          !movedIdSet.has(String(layer.id))
        ) {
          movedIdSet.add(String(layer.id));
          addedDescendant = true;
        }
      }
    }
    const moving = source.layers.filter(
      (layer) => movedIdSet.has(String(layer.id)) && !layer.locked,
    );
    if (moving.length === 0) return false;
    const actualMovedIds = new Set(moving.map((layer) => String(layer.id)));
    if (savedRoot.layers.some((layer) => actualMovedIds.has(String(layer.id)))) return false;

    const movedLayers = moving.map((layer) => ({
      ...cloneLayers([layer])[0],
      translateX: (Number(layer.translateX) || 0) + source.x,
      translateY: (Number(layer.translateY) || 0) + source.y,
      parentId:
        layer.parentId != null && actualMovedIds.has(String(layer.parentId))
          ? layer.parentId
          : null,
    }));
    const movedBlocks = source.animation.blocks
      .filter((block) => actualMovedIds.has(String(block.layerId)))
      .map((block) => {
        const axisOffset =
          block.propertyName === "translateX"
            ? source.x
            : block.propertyName === "translateY"
              ? source.y
              : 0;
        return {
          ...structuredClone(block),
          fromValue:
            axisOffset && typeof block.fromValue === "number"
              ? block.fromValue + axisOffset
              : block.fromValue,
          toValue:
            axisOffset && typeof block.toValue === "number"
              ? block.toValue + axisOffset
              : block.toValue,
        };
      });
    const movedBlockIds = new Set(movedBlocks.map((block) => block.id));
    if (savedRoot.animation.blocks.some((block) => movedBlockIds.has(block.id))) return false;

    const nextRootLayers = [...savedRoot.layers, ...movedLayers];
    const nextRootAnimation: AnimationState = {
      ...savedRoot.animation,
      duration: Math.max(
        savedRoot.animation.duration,
        ...movedBlocks.map((block) => block.endTime),
        1,
      ),
      blocks: [...savedRoot.animation.blocks, ...movedBlocks],
    };
    const sourceHidden = new Set(source.hiddenLayerIds.map(String));
    const nextRootHiddenLayerIds = Array.from(
      new Set([
        ...savedRoot.hiddenLayerIds.map(String),
        ...moving
          .filter((layer) => sourceHidden.has(String(layer.id)))
          .map((layer) => String(layer.id)),
      ]),
    );
    if (options?.recordHistory !== false) get().pushHistory();

    const nextFrames = savedFrames.map((frame) =>
      frame.id === source.id
        ? {
            ...frame,
            layers: frame.layers.filter((layer) => !actualMovedIds.has(String(layer.id))),
            animation: {
              ...frame.animation,
              blocks: frame.animation.blocks.filter(
                (block) => !actualMovedIds.has(String(block.layerId)),
              ),
            },
            hiddenLayerIds: frame.hiddenLayerIds.filter(
              (id) => !actualMovedIds.has(String(id)),
            ),
          }
        : frame,
    );
    const retainedSelectionIds = selectedIds.filter((id) => actualMovedIds.has(String(id)));
    const primaryId = retainedSelectionIds.at(-1) ?? movedLayers.at(-1)!.id;
    set({
      frames: nextFrames,
      rootLayers: cloneLayers(nextRootLayers),
      rootAnimation: structuredClone(nextRootAnimation),
      rootHiddenLayerIds: [...nextRootHiddenLayerIds],
      selectedFrameId: PAGE_ROOT_ID,
      layers: cloneLayers(nextRootLayers),
      vector: { id: PAGE_ROOT_ID, name: "Page", width: 1, height: 1, alpha: 1 },
      animation: structuredClone(nextRootAnimation),
      hiddenLayerIds: [...nextRootHiddenLayerIds],
      selectedLayerId: primaryId,
      selectedLayerIds: retainedSelectionIds.length ? retainedSelectionIds : [primaryId],
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
      selectedBlockIds: [],
      hasCanvasSelection: true,
      selectionKind: "layer",
      toolMode: "select",
    });
    return true;
  },

  // World camera actions (1el / k4mv Phase 2)
  setWorldViewport: (v) => {
    set((state) => ({
      worldViewport: { ...state.worldViewport, ...v },
    }));
  },

  setDetailViewport: (v) => {
    set((state) => {
      const next = typeof v === "function" ? v(state.detailViewport) : v;
      return {
        detailViewport: next,
        zoom: next.scale,
      };
    });
  },

  fitDetailToVector: (scale) => {
    const { vector, detailViewport } = get();
    const next = computeVectorViewport(vector, scale ?? detailViewport.scale);
    set({ detailViewport: next, zoom: next.scale });
  },

  fitWorldToFrames: (frameIds) => {
    const { frames, setWorldViewport } = get();
    const targetFrames = frameIds ? frames.filter((f) => frameIds.includes(f.id)) : frames;

    if (targetFrames.length === 0) return;

    setWorldViewport(computeFramesViewport(targetFrames));
  },

  bringFrameIntoView: (frameId, options = {}) => {
    const { frames, worldViewport, setWorldViewport } = get();
    const frame = frames.find((f) => f.id === frameId);
    if (!frame) return;

    const b = getFrameRect(frame);

    const pad = Math.max(b.w, b.h) * 0.6;
    const currentScale = worldViewport.scale;

    const target = {
      x: b.x - pad,
      y: b.y - pad,
      w: (b.w + pad * 2) / currentScale,
      h: (b.h + pad * 2) / currentScale,
      scale: currentScale,
    };

    const vb = worldViewport;
    const isVisible =
      b.x > vb.x && b.x + b.w < vb.x + vb.w && b.y > vb.y && b.y + b.h < vb.y + vb.h;

    if (!isVisible) {
      if (options.animate === false) {
        setWorldViewport(target);
      } else {
        // Smooth lerp (preserved from previous pro polish)
        const st = { ...vb };
        const dur = 220;
        const t0 = performance.now();

        const step = () => {
          const t = Math.min(1, (performance.now() - t0) / dur);
          const e = 1 - Math.pow(1 - t, 3);
          setWorldViewport({
            x: st.x + (target.x - st.x) * e,
            y: st.y + (target.y - st.y) * e,
            w: st.w + (target.w - st.w) * e,
            h: st.h + (target.h - st.h) * e,
            scale: target.scale,
          });
          if (t < 1) {
            requestAnimationFrame(step);
          }
        };
        requestAnimationFrame(step);
      }
    }
  },

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
    const normalized = normalizeLayers(project.layers);
    const frame: CanvasFrame = {
      id: `frame-${Date.now()}`,
      name: project.vector.name || "Sample",
      x: 0,
      y: 0,
      layers: cloneLayers(normalized),
      vector: structuredClone(project.vector),
      animation: structuredClone(project.animation),
      hiddenLayerIds: [...project.hiddenLayerIds],
    };
    get().pushHistory();
    set({
      frames: [frame],
      selectedFrameId: frame.id,
      rootLayers: [],
      rootAnimation: structuredClone(initialRootAnimation),
      rootHiddenLayerIds: [],
      worldViewport: computeFramesViewport([frame]),
      detailViewport: computeVectorViewport(frame.vector),
      layers: cloneLayers(normalized),
      vector: structuredClone(project.vector),
      animation: structuredClone(project.animation),
      hiddenLayerIds: [...project.hiddenLayerIds],
      selectedLayerId: getFirstEditableLayerId(normalized),
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
      progress: 0,
      isPlaying: false,
      isActionMode: false,
      editingSide: "from",
      selectedBlockIds: [],
      collapsedLayerIds: [],
      timelineZoom: 1,
      timelineScrollX: 0,
      timelineScrollY: 0,
      timelineCollapsed: false,
      speed: 1,
      isSlowMotion: false,
      isRepeating: true,
      zoom: 1,
      snapToGrid: true,
      toolMode: "select",
      cursorType: "default",
      hoveredItem: null,
      dragState: null,
      clipboard: null,
    });
  },

  setLayers: (layers) => {
    const normalized = normalizeLayers(layers);
    get().pushHistory();
    set({
      layers: normalized,
      selectedLayerId: normalized[0]?.id ?? 0,
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
      progress: 0,
    });
  },
  importLayers: (incomingLayers) => {
    if (!incomingLayers.length) return;
    const { layers } = get();
    const normalizedIncoming = normalizeLayers(incomingLayers);
    get().pushHistory();
    set({
      layers: [...layers, ...normalizedIncoming],
      selectedLayerId: normalizedIncoming[0]?.id ?? layers[0]?.id ?? 0,
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
    });
  },
  loadProject: (project) => {
    const normalized = normalizeLayers(project.layers);
    const frame: CanvasFrame = {
      id: `frame-${Date.now()}`,
      name: project.vector.name || "Imported frame",
      x: 0,
      y: 0,
      layers: cloneLayers(normalized),
      vector: structuredClone(project.vector),
      animation: structuredClone(project.animation),
      hiddenLayerIds: [...project.hiddenLayerIds],
    };
    get().pushHistory();
    set({
      frames: [frame],
      selectedFrameId: frame.id,
      rootLayers: [],
      rootAnimation: structuredClone(initialRootAnimation),
      rootHiddenLayerIds: [],
      worldViewport: computeFramesViewport([frame]),
      detailViewport: computeVectorViewport(frame.vector),
      layers: cloneLayers(normalized),
      vector: structuredClone(project.vector),
      animation: structuredClone(project.animation),
      hiddenLayerIds: [...project.hiddenLayerIds],
      selectedLayerId: getFirstEditableLayerId(normalized),
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
      progress: 0,
      isPlaying: false,
      isActionMode: false,
      editingSide: "from",
      selectedBlockIds: [],
      collapsedLayerIds: [],
      timelineZoom: 1,
      timelineScrollX: 0,
      timelineScrollY: 0,
      timelineCollapsed: false,
      speed: 1,
      isSlowMotion: false,
      isRepeating: true,
      zoom: 1,
      snapToGrid: true,
      toolMode: "select",
      cursorType: "default",
      hoveredItem: null,
      dragState: null,
      clipboard: null,
    });
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
    const ids = get().selectedLayerIds;
    // Path geometry must never be batch-copied onto multi-select (corrupts siblings).
    const isPathPatch =
      patch.from != null || patch.to != null || patch.pathData != null;
    if (ids.length > 1 && !isPathPatch) {
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
    const ids = options?.ids ?? get().selectedLayerIds;
    if (ids.length === 0) return;
    const idSet = new Set(ids.map(String));
    const newLayers = get().layers.map((l) => {
      if (!idSet.has(String(l.id)) || l.locked) return l;
      return { ...l, ...patch };
    });
    if (options?.recordHistory !== false) {
      get().pushHistory();
    }
    set({ layers: newLayers });
  },

  setSpacePanActive: (active) => set({ spacePanActive: active }),

  selectLayer: (id) =>
    set({
      selectedLayerId: id,
      selectedLayerIds: [id],
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
      selectedBlockIds: [],
      hasCanvasSelection: true,
      // Figma: selecting a child replaces frame selection — the layer is the selection.
      selectionKind: "layer",
    }),

  selectLayers: (ids) => {
    const unique: (string | number)[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const key = String(id);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(id);
    }
    if (unique.length === 0) {
      get().deselectAll();
      return;
    }
    set({
      selectedLayerId: unique[unique.length - 1]!,
      selectedLayerIds: unique,
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
      selectedBlockIds: [],
      hasCanvasSelection: true,
      selectionKind: "layer",
      // Multi-object selection uses Move tool (Figma leaves vector edit)
      toolMode: unique.length > 1 ? "select" : get().toolMode,
    });
  },
  setEditingSide: (side) =>
    set((state) => ({
      editingSide: side,
      selection: state.editingSide === side ? state.selection : null,
      selectedSubPaths: state.editingSide === side ? state.selectedSubPaths : [],
    })),
  startActionMode: () =>
    set({
      isActionMode: true,
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
      // Enter morph edit ready to manipulate points directly (best default for "edit")
      toolMode: "direct",
    }),
  closeActionMode: () =>
    set({ isActionMode: false, selection: null, selectedPoints: [], selectedSubPaths: [] }),

  updateSelectedPoint: (newPoint, options) => {
    const { layers, selectedLayerId, editingSide, selection } = get();
    if (!selection) return;

    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    if (layer.locked) return;
    const targetPath = editingSide === "from" ? layer.from : endOf(layer);

    const updatedPath = updatePoint(
      targetPath,
      selection.subPathIndex,
      selection.commandIndex,
      selection.pointIndex,
      newPoint,
    );

    const newLayers = [...layers];
    if (editingSide === "from") {
      newLayers[layerIndex] = { ...layer, from: updatedPath, pathData: updatedPath };
    } else {
      newLayers[layerIndex] = { ...layer, to: updatedPath };
    }

    if (options?.recordHistory !== false) {
      get().pushHistory();
    }
    set({ layers: newLayers });
  },

  translateSelectedPoints: (dx, dy, options) => {
    const { layers, selectedLayerId, editingSide, selectedPoints } = get();
    if (!selectedPoints || selectedPoints.length === 0 || (dx === 0 && dy === 0)) return;

    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    if (layer.locked) return;
    let targetPath = editingSide === "from" ? layer.from : endOf(layer);

    // Apply delta to every selected point (uniform translate for batch drag)
    for (const sel of selectedPoints) {
      const cmd = targetPath.subPaths[sel.subPathIndex]?.commands[sel.commandIndex];
      if (!cmd) continue;
      const currentPt = cmd.points[sel.pointIndex];
      if (!currentPt) continue;

      const newPt = { x: currentPt.x + dx, y: currentPt.y + dy };
      targetPath = updatePoint(
        targetPath,
        sel.subPathIndex,
        sel.commandIndex,
        sel.pointIndex,
        newPt,
      );
    }

    const newLayers = [...layers];
    if (editingSide === "from") {
      newLayers[layerIndex] = { ...layer, from: targetPath, pathData: targetPath };
    } else {
      newLayers[layerIndex] = { ...layer, to: targetPath };
    }

    if (options?.recordHistory !== false) {
      get().pushHistory();
    }
    set({ layers: newLayers });
  },

  translateSelectedSubPaths: (dx, dy, options) => {
    const { layers, selectedSubPaths } = get();
    if (!selectedSubPaths || selectedSubPaths.length === 0 || (dx === 0 && dy === 0)) return;

    const selectedByLayer = new Map<string | number, Set<number>>();
    for (const selection of selectedSubPaths) {
      const existing = selectedByLayer.get(selection.layerId) ?? new Set<number>();
      existing.add(selection.subPathIndex);
      selectedByLayer.set(selection.layerId, existing);
    }

    const newLayers = layers.map((layer) => {
      const subPathIndexes = selectedByLayer.get(layer.id);
      if (!subPathIndexes || subPathIndexes.size === 0) return layer;

      const movePath = (pathData: typeof layer.from) => {
        const next = structuredClone(pathData);
        for (const subPathIndex of subPathIndexes) {
          const subPath = next.subPaths[subPathIndex];
          if (!subPath) continue;
          for (const command of subPath.commands) {
            command.points = command.points.map((point) => ({
              x: point.x + dx,
              y: point.y + dy,
            }));
          }
        }
        return next;
      };

      const from = movePath(layer.from);
      const to = mapToEnd(layer, movePath);
      return { ...layer, from, to, pathData: from };
    });

    if (options?.recordHistory !== false) {
      get().pushHistory();
    }
    set({ layers: newLayers });
  },

  translateSelectedLayer: (dx, dy, options) => {
    const { layers, selectedLayerIds, selectedLayerId } = get();
    if (dx === 0 && dy === 0) return;

    const ids =
      selectedLayerIds.length > 0
        ? selectedLayerIds
        : selectedLayerId != null
          ? [selectedLayerId]
          : [];
    if (ids.length === 0) return;
    const idSet = new Set(ids.map(String));

    // Object move uses layer transforms (Figma Position) — multi-select moves all.
    const newLayers = layers.map((layer) => {
      if (!idSet.has(String(layer.id)) || layer.locked) return layer;
      return {
        ...layer,
        translateX: (layer.translateX ?? 0) + dx,
        translateY: (layer.translateY ?? 0) + dy,
      };
    });

    if (options?.recordHistory !== false) {
      get().pushHistory();
    }
    set({ layers: newLayers });
  },

  recordLayerTranslationAtPlayhead: () => {
    const { layers, selectedLayerIds, selectedLayerId, animation, progress } = get();
    const targets =
      selectedLayerIds.length > 0
        ? layers.filter((l) => selectedLayerIds.some((id) => String(id) === String(l.id)))
        : layers.filter((l) => String(l.id) === String(selectedLayerId));
    if (targets.length === 0) return;

    const duration = Math.max(1, animation.duration);
    const ms = Math.round(progress * duration);
    const nearStart = ms <= duration * 0.05;
    const nearEnd = ms >= duration * 0.95;
    const minSeg = 50;

    /** Insert or update keys for one property — splits segments at playhead (multi-keyframe). */
    const upsertKey = (
      blocks: typeof animation.blocks,
      layer: Layer,
      propertyName: "translateX" | "translateY",
      value: number,
    ) => {
      const segs = blocks
        .map((b, i) => ({ b, i }))
        .filter(
          ({ b }) =>
            String(b.layerId) === String(layer.id) && b.propertyName === propertyName,
        )
        .sort((a, c) => a.b.startTime - c.b.startTime);

      if (segs.length === 0) {
        return [
          ...blocks,
          {
            id: `block-${layer.id}-${propertyName}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            layerId: layer.id,
            propertyName,
            type: "number" as const,
            fromValue: nearStart ? value : 0,
            toValue: value,
            startTime: 0,
            endTime: duration,
            interpolator: "FAST_OUT_SLOW_IN" as const,
          },
        ];
      }

      // Find covering segment
      const cover = segs.find(
        ({ b }) => ms >= b.startTime && ms <= b.endTime,
      );
      if (!cover) {
        // Between segments or past end — extend last or create new
        const last = segs[segs.length - 1]!.b;
        if (ms > last.endTime) {
          return [
            ...blocks,
            {
              id: `block-${layer.id}-${propertyName}-${Date.now()}-tail`,
              layerId: layer.id,
              propertyName,
              type: "number" as const,
              fromValue: Number(last.toValue) || 0,
              toValue: value,
              startTime: last.endTime,
              endTime: duration,
              interpolator: last.interpolator || "FAST_OUT_SLOW_IN",
            },
          ];
        }
        const first = segs[0]!.b;
        return [
          ...blocks,
          {
            id: `block-${layer.id}-${propertyName}-${Date.now()}-head`,
            layerId: layer.id,
            propertyName,
            type: "number" as const,
            fromValue: value,
            toValue: Number(first.fromValue) || 0,
            startTime: 0,
            endTime: first.startTime,
            interpolator: first.interpolator || "FAST_OUT_SLOW_IN",
          },
        ];
      }

      const prev = cover.b;
      const fromV = Number(prev.fromValue) || 0;
      const toV = Number(prev.toValue) || 0;

      if (nearStart || Math.abs(ms - prev.startTime) < minSeg) {
        const next = [...blocks];
        next[cover.i] = { ...prev, fromValue: value, type: "number" };
        return next;
      }
      if (nearEnd || Math.abs(ms - prev.endTime) < minSeg) {
        const next = [...blocks];
        next[cover.i] = { ...prev, toValue: value, type: "number" };
        return next;
      }

      // Mid-segment: SPLIT into two blocks at playhead (true multi-keyframe).
      const left = {
        ...prev,
        id: `${prev.id}-L`,
        toValue: value,
        endTime: ms,
        type: "number" as const,
      };
      const right = {
        ...prev,
        id: `${prev.id}-R-${Date.now()}`,
        fromValue: value,
        toValue: toV,
        startTime: ms,
        type: "number" as const,
      };
      // Keep left from as fromV
      left.fromValue = fromV;
      const without = blocks.filter((_, i) => i !== cover.i);
      return [...without, left, right];
    };

    let blocks = animation.blocks;
    for (const layer of targets) {
      blocks = upsertKey(blocks, layer, "translateX", layer.translateX ?? 0);
      blocks = upsertKey(blocks, layer, "translateY", layer.translateY ?? 0);
    }

    const targetIds = new Set(targets.map((l) => String(l.id)));
    const newLayers = layers.map((l) =>
      targetIds.has(String(l.id)) ? { ...l, expanded: true } : l,
    );

    set({
      animation: { ...animation, blocks },
      layers: newLayers,
    });
  },

  /**
   * Scale selected path(s). `fromBounds`/`toBounds` are the control AABB (usually
   * the primary layer's frozen path-local bounds). Each selected layer scales
   * from its *own* bounds by the same factors, so multi-select never clones one
   * path onto another.
   */
  resizeSelectedLayer: (fromBounds, toBounds, options) => {
    const { layers, selectedLayerIds, selectedLayerId } = get();
    const ids =
      selectedLayerIds.length > 0
        ? selectedLayerIds
        : selectedLayerId != null
          ? [selectedLayerId]
          : [];
    const idSet = new Set(ids.map(String));
    const sx = toBounds.width / Math.max(0.001, fromBounds.width);
    const sy = toBounds.height / Math.max(0.001, fromBounds.height);
    const mapOwn = (
      path: PathData,
      frozenOwn: { x: number; y: number; width: number; height: number } | null,
    ) => {
      const ownFrom =
        frozenOwn ??
        (() => {
          const b = getPathDataBounds(path);
          return b
            ? { x: b.x, y: b.y, width: b.w, height: b.h }
            : { x: 0, y: 0, width: 1, height: 1 };
        })();
      const ownTo = {
        x: toBounds.x + (ownFrom.x - fromBounds.x) * sx,
        y: toBounds.y + (ownFrom.y - fromBounds.y) * sy,
        width: ownFrom.width * sx,
        height: ownFrom.height * sy,
      };
      return scalePathToBounds(path, ownFrom, ownTo);
    };
    const newLayers = layers.map((layer) => {
      if (!idSet.has(String(layer.id)) || layer.locked) return layer;
      if (layer.type === "group") return layer;
      const ownB = getPathDataBounds(layer.from);
      const frozenOwn = ownB
        ? { x: ownB.x, y: ownB.y, width: ownB.w, height: ownB.h }
        : null;
      // Note: live bounds each move is ok when we use proportional mapping from control AABB;
      // for frozen-source multi, canvas should pass control AABB from primary freeze.
      const from = mapOwn(layer.from, frozenOwn);
      const to = mapToEnd(layer, (p) => {
        const ob = getPathDataBounds(p);
        return mapOwn(
          p,
          ob ? { x: ob.x, y: ob.y, width: ob.w, height: ob.h } : null,
        );
      });
      return { ...layer, from, to, pathData: from };
    });

    if (options?.recordHistory !== false) {
      get().pushHistory();
    }
    set({ layers: newLayers });
  },

  rotateSelectedLayers: (deltaDeg, options) => {
    if (!deltaDeg) return;
    const { layers, selectedLayerIds, selectedLayerId } = get();
    const ids =
      selectedLayerIds.length > 0
        ? selectedLayerIds
        : selectedLayerId != null
          ? [selectedLayerId]
          : [];
    const idSet = new Set(ids.map(String));
    const newLayers = layers.map((layer) => {
      if (!idSet.has(String(layer.id)) || layer.locked) return layer;
      return {
        ...layer,
        rotation: (Number(layer.rotation) || 0) + deltaDeg,
      };
    });
    if (options?.recordHistory !== false) get().pushHistory();
    set({ layers: newLayers });
  },

  deleteSelectedLayers: () => {
    const { layers, selectedLayerIds, selectedLayerId } = get();
    const ids =
      selectedLayerIds.length > 0
        ? selectedLayerIds
        : selectedLayerId != null
          ? [selectedLayerId]
          : [];
    if (ids.length === 0 || layers.length <= ids.length) return;
    const idSet = new Set(ids.map(String));
    const remaining = layers.filter((l) => !idSet.has(String(l.id)));
    get().pushHistory();
    set({
      layers: remaining,
      selectedLayerId: remaining[0]?.id ?? 0,
      selectedLayerIds: remaining[0] ? [remaining[0].id] : [],
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
      hasCanvasSelection: remaining.length > 0,
      selectionKind: remaining.length > 0 ? "layer" : "none",
    });
  },

  toggleLayerLock: (id) => {
    const { layers } = get();
    get().pushHistory();
    set({
      layers: layers.map((l) =>
        String(l.id) === String(id) ? { ...l, locked: !l.locked } : l,
      ),
    });
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
      hasCanvasSelection: true,
      selectionKind: "layer",
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
        String(l.parentId) === gid
          ? { ...l, parentId: group.parentId ?? undefined }
          : l,
      );
    get().pushHistory();
    set({
      layers: next,
      selectedLayerId: childIds[0] ?? next[0]?.id ?? 0,
      selectedLayerIds: childIds.length ? childIds : next[0] ? [next[0].id] : [],
      hasCanvasSelection: true,
      selectionKind: "layer",
    });
  },

  duplicateSelectedLayersOffset: (dx, dy) => {
    const { layers, selectedLayerIds, selectedLayerId } = get();
    const ids =
      selectedLayerIds.length > 0
        ? selectedLayerIds
        : selectedLayerId != null
          ? [selectedLayerId]
          : [];
    if (ids.length === 0) return;
    const idSet = new Set(ids.map(String));
    const clones = layers
      .filter((l) => idSet.has(String(l.id)))
      .map((l) => ({
        ...structuredClone(l),
        id: `${l.id}-dup-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        name: `${l.name} copy`,
        translateX: (l.translateX ?? 0) + dx,
        translateY: (l.translateY ?? 0) + dy,
      }));
    get().pushHistory();
    set({
      layers: [...layers, ...clones],
      selectedLayerId: clones[clones.length - 1]?.id ?? selectedLayerId,
      selectedLayerIds: clones.map((c) => c.id),
      hasCanvasSelection: true,
      selectionKind: "layer",
    });
  },

  addPointOnPath: (clickX, clickY) => {
    const { layers, selectedLayerId, editingSide } = get();
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    if (layer.locked) return;
    // Structural op: keep from/to command counts equal by splitting BOTH sides at the
    // same (subIdx, cmdIdx). The click determines the position on the active side; we
    // mirror the insertion onto the other side so the morph stays interpolatable.
    const activePath = editingSide === "from" ? layer.from : endOf(layer);
    const otherPath = editingSide === "from" ? layer.to : layer.from;
    const splitActive = splitPointNear(activePath, { x: clickX, y: clickY });
    if (!splitActive) return;

    // Detect where splitPointNear inserted the new command (an id absent before the split).
    let splitSub = -1;
    let splitCmd = -1;
    for (let s = 0; s < activePath.subPaths.length; s++) {
      const beforeIds = new Set(activePath.subPaths[s].commands.map((c) => c.id));
      const afterCmds = splitActive.subPaths[s]?.commands ?? [];
      const insertPos = afterCmds.findIndex((c) => !beforeIds.has(c.id));
      if (insertPos !== -1) {
        splitSub = s;
        splitCmd = insertPos - 1; // splitCommandInHalf inserts the new command at cmdIdx + 1
        break;
      }
    }
    // Only mirror the split onto the other side if this is a morph layer (has `to`).
    // Static layers just gain a point on their single (from) geometry.
    const splitOther =
      otherPath && splitSub !== -1 && splitCmd >= 0
        ? splitCommandInHalf(otherPath, splitSub, splitCmd)
        : otherPath;

    const from = editingSide === "from" ? splitActive : (splitOther ?? splitActive);
    const to = editingSide === "from" ? splitOther : splitActive;
    const newLayers = [...layers];
    newLayers[layerIndex] = { ...layer, from, to, pathData: from };

    get().pushHistory();
    set({ layers: newLayers });
  },

  splitSelectedLayerSegment: (segment) => {
    const { layers } = get();
    const layerIndex = layers.findIndex((l) => l.id === segment.layerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    const splitPath = (pathData: typeof layer.from) =>
      splitCommandInHalf(pathData, segment.subPathIndex, segment.commandIndex);
    const from = splitPath(layer.from);
    const to = mapToEnd(layer, splitPath);
    const newLayers = [...layers];
    newLayers[layerIndex] = { ...layer, from, to, pathData: from };

    get().pushHistory();
    set({
      layers: newLayers,
      selectedLayerId: segment.layerId,
      editingSide: segment.side,
      selection: {
        layerId: segment.layerId,
        side: segment.side,
        subPathIndex: segment.subPathIndex,
        commandIndex: segment.commandIndex,
        pointIndex: Math.max(
          0,
          (from.subPaths[segment.subPathIndex]?.commands[segment.commandIndex]?.points.length ??
            1) - 1,
        ),
      },
      selectedPoints: [],
      selectedSubPaths: [],
    });
  },

  bendSelectedLayerSegment: (segment, point, options) => {
    const { layers } = get();
    const layerIndex = layers.findIndex((l) => l.id === segment.layerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    if (layer.locked) return;
    const bendPath = (pathData: typeof layer.from) => {
      const next = structuredClone(pathData);
      const subPath = next.subPaths[segment.subPathIndex];
      const command = subPath?.commands[segment.commandIndex];
      const prevCommand = subPath?.commands[segment.commandIndex - 1];
      const start = prevCommand?.points.at(-1);
      const end = command?.points.at(-1);
      if (!subPath || !command || !start || !end || command.type === "M" || command.type === "Z")
        return next;

      if (command.type === "L" || command.points.length === 1) {
        const control = {
          x: 2 * point.x - 0.5 * start.x - 0.5 * end.x,
          y: 2 * point.y - 0.5 * start.y - 0.5 * end.y,
        };
        command.type = "C";
        command.points = [
          {
            x: start.x + (2 / 3) * (control.x - start.x),
            y: start.y + (2 / 3) * (control.y - start.y),
          },
          {
            x: end.x + (2 / 3) * (control.x - end.x),
            y: end.y + (2 / 3) * (control.y - end.y),
          },
          end,
        ];
        return next;
      }

      if (command.type === "C" && command.points.length >= 3) {
        const mid = cubicPointAt(start, command.points[0], command.points[1], end, 0.5);
        const dx = point.x - mid.x;
        const dy = point.y - mid.y;
        command.points = [
          { x: command.points[0].x + dx, y: command.points[0].y + dy },
          { x: command.points[1].x + dx, y: command.points[1].y + dy },
          command.points[2],
        ];
      }

      return next;
    };

    // Shape op: edit ONLY the active side so the user can author independent morph endpoints.
    const isFrom = segment.side === "from";
    const edited = bendPath(isFrom ? layer.from : endOf(layer));
    const from = isFrom ? edited : layer.from;
    const to = isFrom ? layer.to : edited;
    const newLayers = [...layers];
    newLayers[layerIndex] = { ...layer, from, to, pathData: from };

    if (options?.recordHistory !== false) {
      get().pushHistory();
    }
    set({
      layers: newLayers,
      selectedLayerId: segment.layerId,
      editingSide: segment.side,
    });
  },

  flexSelectedLayerSegment: (segment, delta, t = 0.5, options) => {
    const { layers } = get();
    const layerIndex = layers.findIndex((l) => l.id === segment.layerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    if (layer.locked) return;
    const flexPath = (pathData: typeof layer.from) => {
      const next = structuredClone(pathData);
      const subPath = next.subPaths[segment.subPathIndex];
      const command = subPath?.commands[segment.commandIndex];
      const prevCommand = subPath?.commands[segment.commandIndex - 1];
      const start = prevCommand?.points.at(-1);
      const end = command?.points.at(-1);
      if (!subPath || !command || !start || !end || command.type === "M" || command.type === "Z")
        return next;

      let c1: Point | null = null;
      let c2: Point | null = null;

      if (command.type === "C" && command.points.length >= 3) {
        c1 = command.points[0];
        c2 = command.points[1];
      } else if (command.type === "Q" && command.points.length >= 2) {
        c1 = command.points[0];
        c2 = null;
      } else if (command.type === "L" || command.points.length === 1) {
        // Promote to cubic exactly as bendSelectedLayerSegment does, then flex the new controls
        const control = {
          x: 2 * ((start.x + end.x) / 2) - 0.5 * start.x - 0.5 * end.x,
          y: 2 * ((start.y + end.y) / 2) - 0.5 * start.y - 0.5 * end.y,
        };
        command.type = "C";
        command.points = [
          {
            x: start.x + (2 / 3) * (control.x - start.x),
            y: start.y + (2 / 3) * (control.y - start.y),
          },
          {
            x: end.x + (2 / 3) * (control.x - end.x),
            y: end.y + (2 / 3) * (control.y - end.y),
          },
          end,
        ];
        c1 = command.points[0];
        c2 = command.points[1];
      }

      if (!c1 && !c2) return next;

      const safeT = Math.max(0, Math.min(1, t ?? 0.5));
      const { control1: newC1, control2: newC2 } = flexCurvature(start, c1, c2, end, safeT, delta);

      if (command.type === "C" && command.points.length >= 3) {
        if (newC1) command.points[0] = { ...newC1 };
        if (newC2) command.points[1] = { ...newC2 };
      } else if (command.type === "Q" && command.points.length >= 2 && newC1) {
        command.points[0] = { ...newC1 };
      }

      return next;
    };

    // Shape op: edit ONLY the active side so the user can author independent morph endpoints.
    const isFrom = segment.side === "from";
    const edited = flexPath(isFrom ? layer.from : endOf(layer));
    const from = isFrom ? edited : layer.from;
    const to = isFrom ? layer.to : edited;
    const newLayers = [...layers];
    newLayers[layerIndex] = { ...layer, from, to, pathData: from };

    if (options?.recordHistory !== false) {
      get().pushHistory();
    }
    set({
      layers: newLayers,
      selectedLayerId: segment.layerId,
      editingSide: segment.side,
    });
  },

  deleteSelectedPoint: () => {
    const { layers, selectedLayerId, selection, selectedPoints } = get();
    const toDelete = selectedPoints.length > 0 ? selectedPoints : (selection ? [selection] : []);
    if (toDelete.length === 0) return;

    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    if (layer.locked) return;

    // Structural op: delete the SAME command indices on BOTH sides so the morph stays
    // interpolatable. Group by subpath, delete highest index first to preserve indices.
    const bySub = new Map<number, number[]>();
    for (const sel of toDelete) {
      if (String(sel.layerId) !== String(selectedLayerId)) continue;
      if (!bySub.has(sel.subPathIndex)) bySub.set(sel.subPathIndex, []);
      bySub.get(sel.subPathIndex)!.push(sel.commandIndex);
    }
    if (bySub.size === 0) return;

    const deleteOn = (pathData: Layer["from"]) => {
      let p = structuredClone(pathData);
      for (const [subIdx, cmdIdxs] of bySub.entries()) {
        for (const cmdIdx of [...new Set(cmdIdxs)].sort((a, b) => b - a)) {
          p = deleteCommand(p, subIdx, cmdIdx);
        }
      }
      return p;
    };

    const from = deleteOn(layer.from);
    const to = mapToEnd(layer, deleteOn);
    const newLayers = [...layers];
    newLayers[layerIndex] = { ...layer, from, to, pathData: from };

    get().pushHistory();
    set({
      layers: newLayers,
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
    });
  },

  deleteSelectedSubPath: () => {
    const { layers, selectedLayerId, editingSide, selection, selectedSubPaths } = get();
    const toDelete = selectedSubPaths.length > 0 ? selectedSubPaths : (selection ? [{ layerId: selection.layerId, side: selection.side, subPathIndex: selection.subPathIndex }] : []);
    if (toDelete.length === 0) return;

    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;
    const layer = layers[layerIndex];

    let targetFrom = structuredClone(layer.from);
    let targetTo = layer.to ? structuredClone(layer.to) : undefined;

    // Delete subpaths descending per side to keep indices valid
    const fromIdxs = toDelete
      .filter(s => s.side === "from" && String(s.layerId) === String(selectedLayerId))
      .map(s => s.subPathIndex)
      .sort((a, b) => b - a);
    for (const idx of fromIdxs) {
      targetFrom = deleteSubPath(targetFrom, idx);
    }

    const toIdxs = toDelete
      .filter(s => s.side === "to" && String(s.layerId) === String(selectedLayerId))
      .map(s => s.subPathIndex)
      .sort((a, b) => b - a);
    if (targetTo) {
      for (const idx of toIdxs) {
        targetTo = deleteSubPath(targetTo, idx);
      }
    }

    const newLayers = [...layers];
    const updatedLayer = {
      ...layer,
      from: targetFrom,
      to: targetTo,
    };
    if (editingSide === "from") {
      updatedLayer.pathData = targetFrom;
    }
    newLayers[layerIndex] = updatedLayer;

    get().pushHistory();
    set({ layers: newLayers, selection: null, selectedPoints: [], selectedSubPaths: [] });
  },

  extractSelectedSubPathToNewLayer: () => {
    const { layers, selectedLayerId, editingSide, selectedSubPaths, selection } = get();
    // Determine the subpath index from either multi-subpath selection or single selection
    let subIdx: number | null = null;
    const subSel = selectedSubPaths.find(
      (s) => String(s.layerId) === String(selectedLayerId) && s.side === editingSide,
    );
    if (subSel) {
      subIdx = subSel.subPathIndex;
    } else if (selection && String(selection.layerId) === String(selectedLayerId) && selection.side === editingSide) {
      subIdx = selection.subPathIndex;
    }
    if (subIdx == null) return;

    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;
    const layer = layers[layerIndex];

    // Extract from both sides so the morph stays consistent (subpath indices should correspond)
    const fromExtract = extractSubPath(layer.from, subIdx);
    const toExtract = layer.to ? extractSubPath(layer.to, subIdx) : null;

    if (fromExtract.extracted.subPaths.length === 0 && (toExtract?.extracted.subPaths.length ?? 0) === 0)
      return;

    // Create a new independent layer for the extracted subpath (inherits style, can now be edited separately)
    const newId = Date.now() + Math.random();
    const newLayer: Layer = {
      ...structuredClone(layer),
      id: newId,
      name: `${layer.name} subpath`,
      from: fromExtract.extracted,
      to: toExtract?.extracted,
      timeline: [], // start fresh for the new layer's animations
    };
    newLayer.pathData = editingSide === "from" ? newLayer.from : (newLayer.to ?? newLayer.from);

    // Update original with remainders (use the from-side index; to may differ in count but we used matching index)
    const updatedOriginal = {
      ...layer,
      from: fromExtract.remaining,
      to: toExtract?.remaining,
    };
    updatedOriginal.pathData =
      editingSide === "from" ? updatedOriginal.from : (updatedOriginal.to ?? updatedOriginal.from);

    const newLayers = [...layers];
    newLayers[layerIndex] = updatedOriginal;

    get().pushHistory();
    set({
      layers: [...newLayers, newLayer],
      selectedLayerId: newId,
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
    });
  },

  splitSelectedCommand: () => {
    const { layers, selectedLayerId, editingSide, selection } = get();
    if (!selection) return;
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;
    const layer = layers[layerIndex];
    if (layer.locked) return;
    const targetPath = editingSide === "from" ? layer.from : endOf(layer);
    const updatedPath = splitCommandInHalf(
      targetPath,
      selection.subPathIndex,
      selection.commandIndex,
    );
    const newLayers = [...layers];
    if (editingSide === "from") {
      newLayers[layerIndex] = { ...layer, from: updatedPath, pathData: updatedPath };
    } else {
      newLayers[layerIndex] = { ...layer, to: updatedPath };
    }
    get().pushHistory();
    set({ layers: newLayers });
  },

  setSelectedCommandAsFirst: () => {
    const { layers, selectedLayerId, editingSide, selection } = get();
    if (!selection) return;
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;
    const layer = layers[layerIndex];
    const targetPath = editingSide === "from" ? layer.from : endOf(layer);
    const updatedPath = setCommandAsFirst(
      targetPath,
      selection.subPathIndex,
      selection.commandIndex,
    );
    const newLayers = [...layers];
    if (editingSide === "from") {
      newLayers[layerIndex] = { ...layer, from: updatedPath, pathData: updatedPath };
    } else {
      newLayers[layerIndex] = { ...layer, to: updatedPath };
    }
    get().pushHistory();
    set({ layers: newLayers });
  },

  togglePlayback: () => set((state) => {
    const atEnd = state.progress >= 0.999;
    if (!state.isPlaying && atEnd) {
      // Restart from beginning when hitting Play after the animation finished
      return { isPlaying: true, progress: 0 };
    }
    return { isPlaying: !state.isPlaying };
  }),
  setProgress: (progress) => set({ progress: Math.max(0, Math.min(1, progress)) }),
  setSpeed: (speed) => set({ speed }),
  toggleSlowMotion: () => set((state) => ({ isSlowMotion: !state.isSlowMotion })),
  toggleRepeating: () => set((state) => ({ isRepeating: !state.isRepeating })),

  setZoom: (zoom) =>
    set((state) => {
      const detailViewport = zoomViewportAtCenter(state.detailViewport, zoom);
      return {
        zoom: detailViewport.scale,
        detailViewport,
      };
    }),
  toggleSnap: () => set((state) => ({ snapToGrid: !state.snapToGrid })),
  setGridDivisions: (divisions) =>
    set({ gridDivisions: divisions > 1 ? Math.round(divisions) : 4 }),

  selectBlocks: (blockIds) => set({ selectedBlockIds: blockIds }),
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
  setTimelineZoom: (zoom) => set({ timelineZoom: Math.max(0.1, Math.min(10, zoom)) }),
  setTimelineScroll: (x, y) => set({ timelineScrollX: x, timelineScrollY: y }),
  toggleTimelineCollapsed: () => set((state) => ({ timelineCollapsed: !state.timelineCollapsed })),
  setTimelineCollapsed: (collapsed: boolean) => set({ timelineCollapsed: collapsed }),

  // H5: switching tool exits Action Mode so tool shortcuts actually take effect on the canvas.
  setToolMode: (mode) => set({ toolMode: mode, isActionMode: false }),
  setCursorType: (cursor) => set({ cursorType: cursor }),
  setHoveredItem: (item) => set({ hoveredItem: item }),
  startDrag: (type, x, y) =>
    set({ dragState: { type, startX: x, startY: y, currentX: x, currentY: y } }),
  updateDrag: (x, y) =>
    set((state) =>
      state.dragState ? { dragState: { ...state.dragState, currentX: x, currentY: y } } : {},
    ),
  endDrag: () => set({ dragState: null }),

  copyLayers: (layerIds) => {
    const { layers } = get();
    const idSet = new Set(layerIds.map(String));
    const copied = layers.filter((l) => idSet.has(String(l.id)));
    if (copied.length === 0) return;
    set({ clipboard: { layers: structuredClone(copied), timestamp: Date.now() } });
  },
  pasteLayers: () => {
    const { clipboard, layers } = get();
    if (!clipboard || clipboard.layers.length === 0) return;
    const pasted = clipboard.layers.map((l, i) => ({
      ...structuredClone(l),
      id: `paste-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      name: `${l.name} copy`,
      translateX: (l.translateX ?? 0) + 8,
      translateY: (l.translateY ?? 0) + 8,
    }));
    get().pushHistory();
    set({
      layers: [...layers, ...pasted],
      selectedLayerId: pasted[pasted.length - 1]?.id ?? layers[0]?.id ?? 0,
      selectedLayerIds: pasted.map((p) => p.id),
      hasCanvasSelection: true,
      selectionKind: "layer",
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
    });
  },
  cutLayers: (layerIds) => {
    const { layers } = get();
    const idSet = new Set(layerIds.map(String));
    if (layers.length <= idSet.size) return;
    get().copyLayers(layerIds);
    const remaining = layers.filter((l) => !idSet.has(String(l.id)));
    get().pushHistory();
    set({
      layers: remaining,
      selectedLayerId: remaining[0]?.id ?? 0,
      selectedLayerIds: remaining[0] ? [remaining[0].id] : [],
      hasCanvasSelection: remaining.length > 0,
      selectionKind: remaining.length > 0 ? "layer" : "none",
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
    });
  },

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
    let idxB = layerB
      ? layers.findIndex((l) => String(l.id) === String(layerB!.id))
      : -1;
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
      hasCanvasSelection: true,
      selectionKind: "layer",
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
        };
      }
      return { selection, selectedPoints: [selection], selectedSubPaths: [] };
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
        };
      }
      return {
        selectedLayerId: selection.layerId,
        editingSide: selection.side,
        selection: null,
        selectedPoints: [],
        selectedSubPaths: [selection],
      };
    });
  },
  selectMultiplePoints: (points: Selection[]) =>
    set({ selectedPoints: points, selection: points[0] || null, selectedSubPaths: [] }),
  selectMultipleSubPaths: (subPaths: SubPathSelection[]) =>
    set({
      selectedSubPaths: subPaths,
      selectedLayerId: subPaths[0]?.layerId ?? get().selectedLayerId,
      editingSide: subPaths[0]?.side ?? get().editingSide,
      selection: null,
      selectedPoints: [],
    }),
  clearSelection: () => set({ selection: null, selectedPoints: [], selectedSubPaths: [] }),

  deselectAll: () =>
    set({
      hasCanvasSelection: false,
      selectionKind: "none",
      selectedLayerIds: [],
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

  // Full layer management (single source of truth)
  addLayer: (type = "path") => {
    const { layers } = get();
    const label =
      type === "clipPath" ? "Clip path" : type === "group" ? "Group layer" : "Path layer";
    const newLayer: Layer = createPathLayer({
      id: Date.now(),
      name: `${label} ${layers.length + 1}`,
      type,
      from: parsePath("M 10 10 L 30 10 L 30 30 L 10 30 Z"),
      // No `to` → a STATIC shape by default. Morphing is opt-in (set a `to` / add an end state).
      visible: true,
      locked: false,
      fillColor: type === "path" ? "#000000" : "",
      strokeColor: type === "clipPath" ? "#000000" : "",
      strokeWidth: type === "clipPath" ? 1.5 : 0,
    });
    get().pushHistory();
    set({
      layers: [...layers, newLayer],
      selectedLayerId: newLayer.id,
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
    });
  },

  deleteLayer: (id: string | number) => {
    const { layers, selectedLayerId } = get();
    if (layers.length === 1) return;

    const newLayers = layers.filter((l) => l.id !== id);
    let newSelected = selectedLayerId;
    if (selectedLayerId === id) {
      newSelected = newLayers[0]?.id ?? 0;
    }
    get().pushHistory();
    set({
      layers: newLayers,
      selectedLayerId: newSelected,
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
    });
  },

  toggleLayerVisibility: (id: string | number) => {
    const { layers } = get();
    const newLayers = layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l));
    get().pushHistory();
    set({ layers: newLayers });
  },

  toggleLayerExpanded: (id: string | number) => {
    const { layers } = get();
    set({
      layers: layers.map((l) => (l.id === id ? { ...l, expanded: l.expanded === false } : l)),
    });
  },

  convertLayerType: (id, type) => {
    const { layers } = get();
    const newLayers = layers.map((layer) => (layer.id === id ? { ...layer, type } : layer));
    get().pushHistory();
    set({ layers: newLayers });
  },

  addTimelineBlock: (layerId, propertyName) => {
    const { layers, animation } = get();
    const layer = layers.find((candidate) => candidate.id === layerId);
    if (!layer) return;

    const value = (() => {
      if (propertyName === "pathData") return pathToString(layer.pathData ?? layer.from);
      const candidate = layer[propertyName as keyof Layer];
      return typeof candidate === "number" || typeof candidate === "string" ? candidate : "";
    })();

    const block = {
      id: `${Date.now()}`,
      layerId,
      propertyName,
      startTime: 0,
      endTime: animation.duration,
      interpolator: "FAST_OUT_SLOW_IN",
      type:
        propertyName === "pathData"
          ? ("path" as const)
          : typeof value === "number"
            ? ("number" as const)
            : ("color" as const),
      fromValue: value,
      toValue: value,
    };

    get().pushHistory();
    set({
      animation: {
        ...animation,
        blocks: [...animation.blocks, block],
      },
      layers: layers.map((candidate) =>
        candidate.id === layerId
          ? { ...candidate, timeline: [...(candidate.timeline ?? []), block], expanded: true }
          : candidate,
      ),
    });
  },

  updateTimelineBlock: (blockId, patch) => {
    const { animation } = get();
    const newBlocks = animation.blocks.map((b) => (b.id === blockId ? { ...b, ...patch } : b));
    set({
      animation: { ...animation, blocks: newBlocks },
    });
  },

  updateVector: (patch) => {
    set((state) => {
      const vector = { ...state.vector, ...patch };
      const frames = saveActiveFrame({ ...state, vector }).map((frame) =>
        frame.id === state.selectedFrameId ? { ...frame, name: vector.name, vector } : frame,
      );
      return {
        vector,
        frames,
        detailViewport: computeVectorViewport(vector, state.detailViewport.scale),
      };
    });
  },

  setAnimationDuration: (ms) => {
    set((state) => ({
      animation: {
        ...state.animation,
        duration: Math.max(100, ms),
        // Clamp every block to the new [0, duration] so none overflow past 100%
        // (BUG-1). Preserve the trailing-block re-anchor when shortening.
        blocks: state.animation.blocks.map((b) => ({
          ...b,
          startTime: Math.min(b.startTime, Math.max(100, ms) - 50),
          endTime:
            b.endTime === state.animation.duration
              ? Math.max(100, ms)
              : Math.min(b.endTime, Math.max(100, ms)),
        })),
      },
    }));
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
      toolMode: "direct",
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

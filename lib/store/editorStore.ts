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
  translatePath,
  scalePathToBounds,
  deleteCommand,
  deleteSubPath,
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

interface EditorState {
  // Workspace frames
  frames: CanvasFrame[];
  selectedFrameId: string;

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
  history: Layer[][];
  future: Layer[][];
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
  selectLayer: (id: string | number) => void;
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
  resizeSelectedLayer: (
    fromBounds: { x: number; y: number; width: number; height: number },
    toBounds: { x: number; y: number; width: number; height: number },
    options?: { recordHistory?: boolean },
  ) => void;

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

const initialLayers: Layer[] = [
  createPathLayer({
    id: 0,
    name: "Play → Pause",
    from: parsePath("M 12 6 L 12 18 M 6 12 L 18 12"),
    to: parsePath("M 8 8 L 16 16 M 8 16 L 16 8"),
    visible: true,
    locked: false,
    strokeColor: "#000000",
    strokeWidth: 2.4,
  }),
  createPathLayer({
    id: 1,
    name: "Menu → Close",
    from: parsePath("M 4 6 L 20 6 M 4 12 L 20 12 M 4 18 L 20 18"),
    to: parsePath("M 6 6 L 18 18 M 18 6 L 6 18"),
    visible: true,
    locked: false,
    strokeColor: "#000000",
    strokeWidth: 2.4,
  }),
  createPathLayer({
    id: 2,
    name: "Heart → Star",
    from: parsePath(
      "M 12 21 L 12 21 L 12 21 C 12 21 4 15 4 9 C 4 5 7 3 10 5 C 12 3 15 5 15 9 C 15 15 12 21 12 21 Z",
    ),
    to: parsePath("M 12 4 L 14 9 L 19 9 L 15 12 L 17 17 L 12 14 L 7 17 L 9 12 L 5 9 L 10 9 Z"),
    visible: true,
    locked: false,
    fillColor: "#000000",
  }),
];

const cloneLayers = (layers: Layer[]) => structuredClone(layers);

function normalizeLayerPaths(layer: Layer): Layer {
  // 3t0c: last line of defense. Any Layer arriving at the store boundary (from demos,
  // JSON deserialization, tests, paste, etc.) gets its PathData command IDs hardened.
  // Safe, pure, early-exits on already-good data.
  return {
    ...layer,
    from: ensureStableCommandIds(layer.from),
    to: ensureStableCommandIds(layer.to),
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
const initialVector: VectorMetadata = {
  id: "vector",
  name: "ShapeShifter",
  width: 24,
  height: 24,
  alpha: 1,
};
const initialAnimation: AnimationState = { id: "anim", name: "anim", duration: 1000, blocks: [] };

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

const initialFrame: CanvasFrame = {
  id: "frame-1",
  name: "ShapeShifter",
  x: 0,
  y: 0,
  layers: cloneLayers(initialLayers),
  vector: structuredClone(initialVector),
  animation: structuredClone(initialAnimation),
  hiddenLayerIds: [],
};

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
  frames: [initialFrame],
  selectedFrameId: initialFrame.id,
  layers: initialLayers,
  vector: initialVector,
  animation: initialAnimation,
  hiddenLayerIds: [],
  history: [],
  future: [],
  canUndo: false,
  canRedo: false,
  selectedLayerId: 0,
  editingSide: "from",
  isActionMode: false,
  selection: null,
  selectedPoints: [],
  selectedSubPaths: [],
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
  worldViewport: computeFramesViewport([initialFrame]),
  detailViewport: computeVectorViewport(initialVector),
  toolMode: "select",
  cursorType: "default",
  hoveredItem: null,
  dragState: null,
  clipboard: null,

  pushHistory: () => {
    const { layers, history } = get();
    set({
      history: [...history, cloneLayers(layers)].slice(-100),
      future: [],
      canUndo: true,
      canRedo: false,
    });
  },

  undo: () => {
    const { history, layers } = get();
    if (history.length === 0) return;
    const prev = history[history.length - 1];
    set({
      layers: prev,
      history: history.slice(0, -1),
      future: [cloneLayers(layers), ...get().future],
      canUndo: history.length > 1,
      canRedo: true,
    });
  },

  redo: () => {
    const { future, layers } = get();
    if (future.length === 0) return;
    const next = future[0];
    set({
      layers: next,
      future: future.slice(1),
      history: [...get().history, cloneLayers(layers)],
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
    if (id === state.selectedFrameId) return;
    const savedFrames = saveActiveFrame(state);
    const frame = savedFrames.find((candidate) => candidate.id === id);
    if (!frame) return;
    set({
      frames: savedFrames,
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
      progress: 0,
      isPlaying: false,
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
    const { layers, selectedLayerId } = get();
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;

    const newLayers = [...layers];
    newLayers[layerIndex] = { ...newLayers[layerIndex], ...patch };
    if (options?.recordHistory !== false) {
      get().pushHistory();
    }
    set({ layers: newLayers });
  },
  selectLayer: (id) =>
    set({ selectedLayerId: id, selection: null, selectedPoints: [], selectedSubPaths: [] }),
  setEditingSide: (side) =>
    set((state) => ({
      editingSide: side,
      selection: state.editingSide === side ? state.selection : null,
      selectedSubPaths: state.editingSide === side ? state.selectedSubPaths : [],
    })),
  startActionMode: () =>
    set({ isActionMode: true, selection: null, selectedPoints: [], selectedSubPaths: [] }),
  closeActionMode: () =>
    set({ isActionMode: false, selection: null, selectedPoints: [], selectedSubPaths: [] }),

  updateSelectedPoint: (newPoint, options) => {
    const { layers, selectedLayerId, editingSide, selection } = get();
    if (!selection) return;

    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    const targetPath = editingSide === "from" ? layer.from : layer.to;

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
    let targetPath = editingSide === "from" ? layer.from : layer.to;

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
      const to = movePath(layer.to);
      return { ...layer, from, to, pathData: from };
    });

    if (options?.recordHistory !== false) {
      get().pushHistory();
    }
    set({ layers: newLayers });
  },

  translateSelectedLayer: (dx, dy, options) => {
    const { layers, selectedLayerId } = get();
    if (dx === 0 && dy === 0) return;

    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    const from = translatePath(layer.from, dx, dy);
    const to = translatePath(layer.to, dx, dy);
    const newLayers = [...layers];
    newLayers[layerIndex] = { ...layer, from, to, pathData: from };

    if (options?.recordHistory !== false) {
      get().pushHistory();
    }
    set({ layers: newLayers });
  },

  resizeSelectedLayer: (fromBounds, toBounds, options) => {
    const { layers, selectedLayerId } = get();
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    const from = scalePathToBounds(layer.from, fromBounds, toBounds);
    const to = scalePathToBounds(layer.to, fromBounds, toBounds);
    const newLayers = [...layers];
    newLayers[layerIndex] = { ...layer, from, to, pathData: from };

    if (options?.recordHistory !== false) {
      get().pushHistory();
    }
    set({ layers: newLayers });
  },

  addPointOnPath: (clickX, clickY) => {
    const { layers, selectedLayerId, editingSide } = get();
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    const targetPath = editingSide === "from" ? layer.from : layer.to;

    // Split the nearest segment (preserves type: C→C, Q→Q, etc.)
    const updatedPath = splitPointNear(targetPath, { x: clickX, y: clickY });
    if (!updatedPath) return;

    const newLayers = [...layers];
    if (editingSide === "from") {
      newLayers[layerIndex] = { ...layer, from: updatedPath, pathData: updatedPath };
    } else {
      newLayers[layerIndex] = { ...layer, to: updatedPath };
    }

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
    const to = splitPath(layer.to);
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

    const from = bendPath(layer.from);
    const to = bendPath(layer.to);
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

    const from = flexPath(layer.from);
    const to = flexPath(layer.to);
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
    const { layers, selectedLayerId, editingSide, selection } = get();
    if (!selection) return;

    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    const targetPath = editingSide === "from" ? layer.from : layer.to;

    const updatedPath = deleteCommand(targetPath, selection.subPathIndex, selection.commandIndex);

    const newLayers = [...layers];
    if (editingSide === "from") {
      newLayers[layerIndex] = { ...layer, from: updatedPath, pathData: updatedPath };
    } else {
      newLayers[layerIndex] = { ...layer, to: updatedPath };
    }

    get().pushHistory();
    set({
      layers: newLayers,
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
    });
  },

  deleteSelectedSubPath: () => {
    const { layers, selectedLayerId, editingSide, selection } = get();
    if (!selection) return;
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;
    const layer = layers[layerIndex];
    const targetPath = editingSide === "from" ? layer.from : layer.to;
    const updatedPath = deleteSubPath(targetPath, selection.subPathIndex);
    const newLayers = [...layers];
    if (editingSide === "from") {
      newLayers[layerIndex] = { ...layer, from: updatedPath, pathData: updatedPath };
    } else {
      newLayers[layerIndex] = { ...layer, to: updatedPath };
    }
    get().pushHistory();
    set({ layers: newLayers, selection: null, selectedPoints: [], selectedSubPaths: [] });
  },

  splitSelectedCommand: () => {
    const { layers, selectedLayerId, editingSide, selection } = get();
    if (!selection) return;
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;
    const layer = layers[layerIndex];
    const targetPath = editingSide === "from" ? layer.from : layer.to;
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
    const targetPath = editingSide === "from" ? layer.from : layer.to;
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

  togglePlayback: () => set((state) => ({ isPlaying: !state.isPlaying })),
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

  setToolMode: (mode) => set({ toolMode: mode }),
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
    const copied = layers.filter((l) => layerIds.includes(l.id));
    if (copied.length === 0) return;
    set({ clipboard: { layers: structuredClone(copied), timestamp: Date.now() } });
  },
  pasteLayers: () => {
    const { clipboard, layers } = get();
    if (!clipboard || clipboard.layers.length === 0) return;
    const pasted = clipboard.layers.map((l) => ({
      ...structuredClone(l),
      id: Date.now() + Math.random(),
      name: `${l.name} copy`,
    }));
    get().pushHistory();
    set({
      layers: [...layers, ...pasted],
      selectedLayerId: pasted[0]?.id ?? layers[0]?.id ?? 0,
      selection: null,
      selectedPoints: [],
      selectedSubPaths: [],
    });
  },
  cutLayers: (layerIds) => {
    const { layers } = get();
    if (layers.length <= layerIds.length) return;
    get().copyLayers(layerIds);
    const remaining = layers.filter((l) => !layerIds.includes(l.id));
    get().pushHistory();
    set({
      layers: remaining,
      selectedLayerId: remaining[0]?.id ?? 0,
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
    const targetPath = editingSide === "from" ? layer.from : layer.to;

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
    const targetPath = editingSide === "from" ? layer.from : layer.to;

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
    const { layers, selectedLayerId } = get();
    if (layers.length < 2) return;
    const idxA = layers.findIndex((l) => l.id === selectedLayerId);
    if (idxA === -1) return;
    // Operate on selected (A) + next layer (B) for multi-select parity (first two or pairwise); smallest, no selection model change
    const idxB = (idxA + 1) % layers.length;
    if (idxB === idxA) return;
    const layerA = layers[idxA];
    const layerB = layers[idxB];
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
    // Remove B (adjust for splice order)
    const removeIdx = idxB > idxA ? idxB : idxB;
    if (removeIdx < newLayers.length) {
      newLayers = newLayers.filter((_, i) => i !== removeIdx);
    }
    get().pushHistory();
    set({
      layers: newLayers,
      selectedLayerId: resultLayer.id,
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

  getCurrentSelectedPoint: () => {
    const state = get();
    if (!state.selection) return null;
    const layer = state.layers.find((l) => l.id === state.selection?.layerId);
    if (!layer) return null;
    const path = state.editingSide === "from" ? layer.from : layer.to;
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
      to: parsePath("M 15 15 L 25 15 L 25 25 L 15 25 Z"),
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
        blocks: state.animation.blocks.map((b) =>
          b.endTime === state.animation.duration ? { ...b, endTime: Math.max(100, ms) } : b,
        ),
      },
    }));
  },

  // === Project reset ===
  resetProject: () => {
    get().pushHistory();
    set({
      frames: [cloneFrame(initialFrame)],
      selectedFrameId: initialFrame.id,
      worldViewport: computeFramesViewport([initialFrame]),
      detailViewport: computeVectorViewport(initialVector),
      layers: cloneLayers(initialLayers),
      selectedLayerId: initialLayers[0]?.id ?? 0,
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
      vector: structuredClone(initialVector),
      animation: structuredClone(initialAnimation),
      hiddenLayerIds: [],
      selectedBlockIds: [],
      collapsedLayerIds: [],
      timelineZoom: 1,
      timelineScrollX: 0,
      timelineScrollY: 0,
      timelineCollapsed: false,
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
    const target = editingSide === "from" ? lay.from : lay.to;
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
    const toCount = countPathPoints(layer.to);
    const ratio = Math.max(fromCount, toCount) / Math.max(1, Math.min(fromCount, toCount));
    const compatible = arePathsStructurallyCompatible(layer.from, layer.to);

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

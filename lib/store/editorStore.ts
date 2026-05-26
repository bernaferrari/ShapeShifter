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
  addPointAfter,
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
} from "../shapeshifter/pathUtils";
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

  // Playback
  isPlaying: boolean;
  progress: number; // 0-1
  speed: number;
  isSlowMotion: boolean;
  isRepeating: boolean;

  // UI
  zoom: number;
  snapToGrid: boolean;

  // Timeline
  selectedBlockIds: string[];
  collapsedLayerIds: (string | number)[];
  timelineZoom: number;
  timelineScrollX: number;
  timelineScrollY: number;

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
  selectFrame: (id: string) => void;

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
  deleteSelectedPoint: () => void;
  deleteSelectedSubPath: () => void;
  splitSelectedCommand: () => void;
  setSelectedCommandAsFirst: () => void;

  // Batch direct manipulation (for multi point selection drag parity)
  translateSelectedPoints: (dx: number, dy: number, options?: { recordHistory?: boolean }) => void;
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
  updateTimelineBlock: (blockId: string, patch: Partial<{startTime: number; endTime: number; interpolator: string}>) => void;
  clearBlockSelection: () => void;
  toggleLayerCollapsed: (layerId: string | number) => void;
  setTimelineZoom: (zoom: number) => void;
  setTimelineScroll: (x: number, y: number) => void;

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
  loadSample: (index: number) => void;

  // Layer management
  addLayer: (type?: LayerType) => void;
  deleteLayer: (id: string | number) => void;
  toggleLayerVisibility: (id: string | number) => void;
  toggleLayerExpanded: (id: string | number) => void;
  convertLayerType: (id: string | number, type: Extract<LayerType, "path" | "clipPath">) => void;
  addTimelineBlock: (layerId: string | number, propertyName: string) => void;

  // Selection (single primary + multi batch for direct manipulation parity)
  selectPoint: (selection: Selection | null, addToMulti?: boolean) => void;
  clearSelection: () => void;
  selectMultiplePoints: (points: Selection[]) => void;

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
const getFirstEditableLayerId = (layers: Layer[]) =>
  layers.find((layer) => layer.type === "path" || layer.type === "clipPath")?.id ?? layers[0]?.id ?? 0;
const initialVector: VectorMetadata = { id: "vector", name: "ShapeShifter", width: 24, height: 24, alpha: 1 };
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
  isPlaying: false,
  progress: 0,
  speed: 1,
  isSlowMotion: false,
  isRepeating: true,
  zoom: 1,
  snapToGrid: true,
  selectedBlockIds: [],
  collapsedLayerIds: [],
  timelineZoom: 1,
  timelineScrollX: 0,
  timelineScrollY: 0,
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
    const frame: CanvasFrame = {
      id: `frame-${Date.now()}`,
      name,
      x: nextIndex * 32,
      y: 0,
      layers: cloneLayers(initialLayers),
      vector: { ...initialVector, id: `vector-${Date.now()}`, name },
      animation: { ...initialAnimation, id: `anim-${Date.now()}` },
      hiddenLayerIds: [],
    };
    set({
      frames: [...savedFrames, frame],
      selectedFrameId: frame.id,
      layers: cloneLayers(frame.layers),
      vector: structuredClone(frame.vector),
      animation: structuredClone(frame.animation),
      hiddenLayerIds: [],
      selectedLayerId: getFirstEditableLayerId(frame.layers),
      selection: null,
      selectedPoints: [],
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
      x: activeFrame.x + 32,
      y: activeFrame.y + 32,
      vector: { ...activeFrame.vector, id: `vector-${Date.now()}`, name: `${activeFrame.name} copy` },
      animation: { ...activeFrame.animation, id: `anim-${Date.now()}` },
    });
    set({
      frames: [...savedFrames, frame],
      selectedFrameId: frame.id,
      layers: cloneLayers(frame.layers),
      vector: structuredClone(frame.vector),
      animation: structuredClone(frame.animation),
      hiddenLayerIds: [...frame.hiddenLayerIds],
      selectedLayerId: getFirstEditableLayerId(frame.layers),
      selection: null,
      selectedPoints: [],
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
      layers: cloneLayers(frame.layers),
      vector: structuredClone(frame.vector),
      animation: structuredClone(frame.animation),
      hiddenLayerIds: [...frame.hiddenLayerIds],
      selectedLayerId: getFirstEditableLayerId(frame.layers),
      selection: null,
      selectedPoints: [],
      selectedBlockIds: [],
      progress: 0,
      isPlaying: false,
    });
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
    const frame: CanvasFrame = {
      id: `frame-${Date.now()}`,
      name: project.vector.name || "Sample",
      x: 0,
      y: 0,
      layers: cloneLayers(project.layers),
      vector: structuredClone(project.vector),
      animation: structuredClone(project.animation),
      hiddenLayerIds: [...project.hiddenLayerIds],
    };
    get().pushHistory();
    set({
      frames: [frame],
      selectedFrameId: frame.id,
      layers: project.layers,
      vector: project.vector,
      animation: project.animation,
      hiddenLayerIds: project.hiddenLayerIds,
      selectedLayerId: getFirstEditableLayerId(project.layers),
      selection: null,
      selectedPoints: [],
      progress: 0,
      isPlaying: false,
      isActionMode: false,
      editingSide: "from",
      selectedBlockIds: [],
      collapsedLayerIds: [],
      timelineZoom: 1,
      timelineScrollX: 0,
      timelineScrollY: 0,
    });
  },

  setLayers: (layers) => {
    get().pushHistory();
    set({
      layers,
      selectedLayerId: layers[0]?.id ?? 0,
      selection: null, selectedPoints: [],
      progress: 0,
    });
  },
  importLayers: (incomingLayers) => {
    if (!incomingLayers.length) return;
    const { layers } = get();
    get().pushHistory();
    set({
      layers: [...layers, ...incomingLayers],
      selectedLayerId: incomingLayers[0]?.id ?? layers[0]?.id ?? 0,
      selection: null,
    });
  },
  loadProject: (project) => {
    const frame: CanvasFrame = {
      id: `frame-${Date.now()}`,
      name: project.vector.name || "Imported frame",
      x: 0,
      y: 0,
      layers: cloneLayers(project.layers),
      vector: structuredClone(project.vector),
      animation: structuredClone(project.animation),
      hiddenLayerIds: [...project.hiddenLayerIds],
    };
    get().pushHistory();
    set({
      frames: [frame],
      selectedFrameId: frame.id,
      layers: project.layers,
      vector: project.vector,
      animation: project.animation,
      hiddenLayerIds: project.hiddenLayerIds,
      selectedLayerId: getFirstEditableLayerId(project.layers),
      selection: null, selectedPoints: [],
      progress: 0,
      isPlaying: false,
      isActionMode: false,
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
  selectLayer: (id) => set({ selectedLayerId: id, selection: null, selectedPoints: [] }),
  setEditingSide: (side) =>
    set((state) => ({
      editingSide: side,
      selection: state.editingSide === side ? state.selection : null,
    })),
  startActionMode: () => set({ isActionMode: true, selection: null, selectedPoints: [] }),
  closeActionMode: () => set({ isActionMode: false, selection: null, selectedPoints: [] }),

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
    const { layers, selectedLayerId, editingSide, selectedPoints, selection } = get();
    if (!selectedPoints || selectedPoints.length === 0 || dx === 0 && dy === 0) return;

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
    set({ layers: newLayers, selection: null, selectedPoints: [] });
  },

  splitSelectedCommand: () => {
    const { layers, selectedLayerId, editingSide, selection } = get();
    if (!selection) return;
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;
    const layer = layers[layerIndex];
    const targetPath = editingSide === "from" ? layer.from : layer.to;
    const updatedPath = splitCommandInHalf(targetPath, selection.subPathIndex, selection.commandIndex);
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
    const updatedPath = setCommandAsFirst(targetPath, selection.subPathIndex, selection.commandIndex);
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

  setZoom: (zoom) => set({ zoom }),
  toggleSnap: () => set((state) => ({ snapToGrid: !state.snapToGrid })),

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

  setToolMode: (mode) => set({ toolMode: mode }),
  setCursorType: (cursor) => set({ cursorType: cursor }),
  setHoveredItem: (item) => set({ hoveredItem: item }),
  startDrag: (type, x, y) => set({ dragState: { type, startX: x, startY: y, currentX: x, currentY: y } }),
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

  selectPoint: (selection, addToMulti = false) => {
    if (!selection) {
      set({ selection: null, selectedPoints: [] });
      return;
    }
    set((state) => {
      if (addToMulti) {
        const exists = state.selectedPoints.some(
          (p) => p.subPathIndex === selection.subPathIndex &&
                 p.commandIndex === selection.commandIndex &&
                 p.pointIndex === selection.pointIndex &&
                 p.layerId === selection.layerId && p.side === selection.side
        );
        const newSelected = exists 
          ? state.selectedPoints.filter(p => !(p.subPathIndex === selection.subPathIndex && p.commandIndex === selection.commandIndex && p.pointIndex === selection.pointIndex && p.layerId === selection.layerId && p.side === selection.side))
          : [...state.selectedPoints, selection];
        return { 
          selection, 
          selectedPoints: newSelected.length > 0 ? newSelected : [selection] 
        };
      }
      return { selection, selectedPoints: [selection] };
    });
  },
  selectMultiplePoints: (points: Selection[]) => set({ selectedPoints: points, selection: points[0] || null }),
  clearSelection: () => set({ selection: null, selectedPoints: [] }),

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
    set({ layers: [...layers, newLayer], selectedLayerId: newLayer.id, selection: null, selectedPoints: [] });
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
    set({ layers: newLayers, selectedLayerId: newSelected, selection: null, selectedPoints: [] });
  },

  toggleLayerVisibility: (id: string | number) => {
    const { layers } = get();
    const newLayers = layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l));
    get().pushHistory();
    set({ layers: newLayers });
  },

  toggleLayerExpanded: (id: string | number) => {
    const { layers } = get();
    set({ layers: layers.map((l) => (l.id === id ? { ...l, expanded: l.expanded === false } : l)) });
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
      type: propertyName === "pathData" ? "path" as const : typeof value === "number" ? "number" as const : "color" as const,
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
    const newBlocks = animation.blocks.map((b) =>
      b.id === blockId ? { ...b, ...patch } : b
    );
    set({
      animation: { ...animation, blocks: newBlocks },
    });
  },

  updateVector: (patch) => {
    set((state) => ({ vector: { ...state.vector, ...patch } }));
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
      layers: cloneLayers(initialLayers),
      selectedLayerId: initialLayers[0]?.id ?? 0,
      selection: null, selectedPoints: [],
      progress: 0,
      speed: 1,
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
      toolMode: "select",
      cursorType: "default",
      hoveredItem: null,
      dragState: null,
      clipboard: null,
    });
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

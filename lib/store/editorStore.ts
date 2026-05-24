import { create } from "zustand";

/**
 * ShapeShifter 2026 - Editor Store
 * Central state management using Zustand.
 * Single source of truth for layers, selection, playback, and path mutations.
 */

import {
  parsePath,
  updatePoint,
  addPointAfter,
  deleteCommand,
  insertPointNear,
  getInterpolatedPath,
  reversePath,
  shiftPath,
} from "../shapeshifter/pathUtils";
import type { Layer, Selection, Point, PathData } from "../shapeshifter/types";

interface EditorState {
  // Layers
  layers: Layer[];
  selectedLayerId: string | number;

  // Editing mode
  editingSide: "from" | "to";

  // Selection
  selection: Selection | null;

  // Playback
  isPlaying: boolean;
  progress: number; // 0-1
  speed: number;

  // UI
  zoom: number;
  snapToGrid: boolean;

  // History for undo/redo (professional 2026 tool feel)
  history: any[];
  future: any[];
  canUndo: boolean;
  canRedo: boolean;

  // History actions
  undo: () => void;
  redo: () => void;
  pushHistory: () => void; // internal

  // Actions
  setLayers: (layers: Layer[]) => void;
  selectLayer: (id: string | number) => void;
  setEditingSide: (side: "from" | "to") => void;

  // Path manipulation (the heart of ShapeShifter)
  updateSelectedPoint: (newPoint: Point) => void;
  addPointOnPath: (clickX: number, clickY: number) => void;
  deleteSelectedPoint: () => void;

  // Playback
  togglePlayback: () => void;
  setProgress: (progress: number) => void;
  setSpeed: (speed: number) => void;

  // UI
  setZoom: (zoom: number) => void;
  toggleSnap: () => void;

  // Magic tools (ported & enhanced from 2017 original)
  reverseSelectedLayer: () => void;
  shiftSelectedLayer: (steps?: number) => boolean;
  autoFixSelectedLayer: () => boolean;
  loadSample: (index: number) => void;

  // Layer management
  addLayer: () => void;
  deleteLayer: (id: string | number) => void;
  toggleLayerVisibility: (id: string | number) => void;

  // Selection
  selectPoint: (selection: Selection) => void;
  clearSelection: () => void;

  // Helpers
  getCurrentSelectedPoint: () => Point | null;
  getSelectedPoint: () => Point | null;
  getCompatibilityStatus: () => any;
}

const initialLayers: Layer[] = [
  {
    id: 0,
    name: "Play → Pause",
    from: parsePath("M 12 6 L 12 18 M 6 12 L 18 12"),
    to: parsePath("M 8 8 L 16 16 M 8 16 L 16 8"),
    visible: true,
    locked: false,
  },
  {
    id: 1,
    name: "Menu → Close",
    from: parsePath("M 4 6 L 20 6 M 4 12 L 20 12 M 4 18 L 20 18"),
    to: parsePath("M 6 6 L 18 18 M 18 6 L 6 18"),
    visible: true,
    locked: false,
  },
  {
    id: 2,
    name: "Heart → Star",
    from: parsePath(
      "M 12 21 L 12 21 L 12 21 C 12 21 4 15 4 9 C 4 5 7 3 10 5 C 12 3 15 5 15 9 C 15 15 12 21 12 21 Z",
    ),
    to: parsePath("M 12 4 L 14 9 L 19 9 L 15 12 L 17 17 L 12 14 L 7 17 L 9 12 L 5 9 L 10 9 Z"),
    visible: true,
    locked: false,
  },
];

export const useEditorStore = create<EditorState>((set, get) => ({
  layers: initialLayers,
  history: [],
  future: [],
  canUndo: false,
  canRedo: false,
  selectedLayerId: 0,
  editingSide: "from",
  selection: null,
  isPlaying: false,
  progress: 0,
  speed: 1,
  zoom: 1,
  snapToGrid: true,

  pushHistory: () => {
    const { layers, history } = get();
    set({
      history: [...history, JSON.parse(JSON.stringify(layers))],
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
      future: [JSON.parse(JSON.stringify(layers)), ...get().future],
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
      history: [...get().history, JSON.parse(JSON.stringify(layers))],
      canUndo: true,
      canRedo: future.length > 1,
    });
  },

  autoFixSelectedLayer: () => {
    const { layers, selectedLayerId, editingSide } = get();
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return false;
    const layer = layers[layerIndex];

    const countPoints = (path: PathData) =>
      path.subPaths.reduce(
        (sum, sp) => sum + sp.commands.reduce((csum, cmd) => csum + cmd.points.length, 0),
        0,
      );

    const fromCount = countPoints(layer.from);
    const toCount = countPoints(layer.to);
    if (fromCount === toCount) return true;

    // Pad the shorter path by duplicating its last point in each subpath
    const shorter = fromCount < toCount ? "from" : "to";
    const diff = Math.abs(fromCount - toCount);
    const path = JSON.parse(JSON.stringify(layer[shorter])) as PathData;

    let remaining = diff;
    for (const sp of path.subPaths) {
      const lastCmd = sp.commands[sp.commands.length - 1];
      if (lastCmd && lastCmd.points.length > 0 && remaining > 0) {
        const lastPt = lastCmd.points[lastCmd.points.length - 1];
        while (remaining > 0) {
          lastCmd.points.push({ ...lastPt });
          remaining--;
        }
      }
    }

    const newLayers = [...layers];
    newLayers[layerIndex] = { ...layer, [shorter]: path };
    set({ layers: newLayers });
    return true;
  },

  loadSample: (index: number) => {
    const samples: { name: string; from: string; to: string }[] = [
      {
        name: "Play → Pause",
        from: "M 12 6 L 12 18 M 6 12 L 18 12",
        to: "M 8 8 L 16 16 M 8 16 L 16 8",
      },
      {
        name: "Menu → Close",
        from: "M 4 6 L 20 6 M 4 12 L 20 12 M 4 18 L 20 18",
        to: "M 6 6 L 18 18 M 18 6 L 6 18",
      },
      {
        name: "Heart → Star",
        from: "M 12 21 L 12 21 L 12 21 C 12 21 4 15 4 9 C 4 5 7 3 10 5 C 12 3 15 5 15 9 C 15 15 12 21 12 21 Z",
        to: "M 12 4 L 14 9 L 19 9 L 15 12 L 17 17 L 12 14 L 7 17 L 9 12 L 5 9 L 10 9 Z",
      },
    ];
    const sample = samples[index % samples.length];
    if (!sample) return;

    const { layers, selectedLayerId } = get();
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;

    const newLayers = [...layers];
    newLayers[layerIndex] = {
      ...newLayers[layerIndex],
      name: sample.name,
      from: parsePath(sample.from),
      to: parsePath(sample.to),
    };
    set({ layers: newLayers });
  },

  setLayers: (layers) => set({ layers }),
  selectLayer: (id) => set({ selectedLayerId: id, selection: null }),
  setEditingSide: (side) => set({ editingSide: side }),

  updateSelectedPoint: (newPoint) => {
    get().pushHistory();
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
      newLayers[layerIndex] = { ...layer, from: updatedPath };
    } else {
      newLayers[layerIndex] = { ...layer, to: updatedPath };
    }

    set({ layers: newLayers });
  },

  addPointOnPath: (clickX, clickY) => {
    const { layers, selectedLayerId, editingSide } = get();
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    const targetPath = editingSide === "from" ? layer.from : layer.to;

    const result = insertPointNear(targetPath, { x: clickX, y: clickY });
    if (!result) return;

    const updatedPath = addPointAfter(targetPath, result.subIdx, result.cmdIdx, result.newPoint);

    const newLayers = [...layers];
    if (editingSide === "from") {
      newLayers[layerIndex] = { ...layer, from: updatedPath };
    } else {
      newLayers[layerIndex] = { ...layer, to: updatedPath };
    }

    set({ layers: newLayers });
  },

  deleteSelectedPoint: () => {
    get().pushHistory();
    const { layers, selectedLayerId, editingSide, selection } = get();
    if (!selection) return;

    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    const targetPath = editingSide === "from" ? layer.from : layer.to;

    const updatedPath = deleteCommand(targetPath, selection.subPathIndex, selection.commandIndex);

    const newLayers = [...layers];
    if (editingSide === "from") {
      newLayers[layerIndex] = { ...layer, from: updatedPath };
    } else {
      newLayers[layerIndex] = { ...layer, to: updatedPath };
    }

    set({
      layers: newLayers,
      selection: null,
    });
  },

  togglePlayback: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setProgress: (progress) => set({ progress }),
  setSpeed: (speed) => set({ speed }),

  setZoom: (zoom) => set({ zoom }),
  toggleSnap: () => set((state) => ({ snapToGrid: !state.snapToGrid })),

  // === MAGIC TOOL: Reverse (core 2017 feature, now real) ===
  reverseSelectedLayer: () => {
    get().pushHistory();
    const { layers, selectedLayerId, editingSide } = get();
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return;

    const layer = layers[layerIndex];
    const targetPath = editingSide === "from" ? layer.from : layer.to;

    const updatedPath = reversePath(targetPath);

    const newLayers = [...layers];
    if (editingSide === "from") {
      newLayers[layerIndex] = { ...layer, from: updatedPath };
    } else {
      newLayers[layerIndex] = { ...layer, to: updatedPath };
    }

    set({ layers: newLayers });
  },

  shiftSelectedLayer: (steps: number = 1) => {
    get().pushHistory();
    const { layers, selectedLayerId, editingSide } = get();
    const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
    if (layerIndex === -1) return false;

    const layer = layers[layerIndex];
    const targetPath = editingSide === "from" ? layer.from : layer.to;

    const updatedPath = shiftPath(targetPath, steps);

    const newLayers = [...layers];
    if (editingSide === "from") {
      newLayers[layerIndex] = { ...layer, from: updatedPath };
    } else {
      newLayers[layerIndex] = { ...layer, to: updatedPath };
    }

    set({ layers: newLayers });
    return true; // for toast feedback
  },

  selectPoint: (selection) => set({ selection }),
  clearSelection: () => set({ selection: null }),

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
  addLayer: () => {
    const { layers } = get();
    const newLayer: Layer = {
      id: Date.now(),
      name: `Layer ${layers.length + 1}`,
      from: parsePath("M 10 10 L 30 10 L 30 30 L 10 30 Z"),
      to: parsePath("M 15 15 L 25 15 L 25 25 L 15 25 Z"),
      visible: true,
      locked: false,
    };
    set({ layers: [...layers, newLayer], selectedLayerId: newLayer.id });
  },

  deleteLayer: (id: string | number) => {
    const { layers, selectedLayerId } = get();
    if (layers.length === 1) return;

    const newLayers = layers.filter((l) => l.id !== id);
    let newSelected = selectedLayerId;
    if (selectedLayerId === id) {
      newSelected = newLayers[0]?.id ?? 0;
    }
    set({ layers: newLayers, selectedLayerId: newSelected });
  },

  toggleLayerVisibility: (id: string | number) => {
    const { layers } = get();
    const newLayers = layers.map((l) => (l.id === id ? { ...l, visible: !l.visible } : l));
    set({ layers: newLayers });
  },

  // === Compatibility helper (for UI warnings) ===
  getCompatibilityStatus: () => {
    const { layers, selectedLayerId } = get();
    const layer = layers.find((l) => l.id === selectedLayerId);
    if (!layer) return { compatible: true, fromPoints: 0, toPoints: 0, warning: "" };

    const countPoints = (path: any) =>
      path.subPaths.reduce(
        (sum: number, sp: any) =>
          sum + sp.commands.reduce((csum: number, cmd: any) => csum + cmd.points.length, 0),
        0,
      );

    const fromCount = countPoints(layer.from);
    const toCount = countPoints(layer.to);
    const diff = Math.abs(fromCount - toCount);
    const ratio = Math.max(fromCount, toCount) / Math.max(1, Math.min(fromCount, toCount));

    let warning = "";
    if (diff > 0) {
      if (ratio > 1.5) {
        warning = "Paths have very different point counts — use Auto Fix";
      } else {
        warning = "Point counts differ — morph may look uneven";
      }
    }

    return {
      compatible: diff === 0,
      fromPoints: fromCount,
      toPoints: toCount,
      warning,
    };
  },

  getSelectedPoint: () => {
    const { layers, selection, editingSide } = get();
    if (!selection) return null;
    const layer = layers.find((l) => l.id === selection.layerId);
    if (!layer) return null;
    const path = editingSide === "from" ? layer.from : layer.to;
    const cmd = path.subPaths[selection.subPathIndex]?.commands[selection.commandIndex];
    return cmd?.points[selection.pointIndex] || null;
  },
}));

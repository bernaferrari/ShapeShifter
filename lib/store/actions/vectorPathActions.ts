import {
  deleteCommand,
  deleteSubPath,
  extractSubPath,
  setCommandAsFirst,
  splitCommandInHalf,
  splitPointNear,
} from "../../shapeshifter/pathUtils";
import { flexCurvature } from "../../shapeshifter/gestures/HitTests";
import type { Layer, PathData, Point } from "../../shapeshifter/types";
import type { EditorState } from "../editorStore";

type VectorPathAction =
  | "addPointOnPath"
  | "splitSelectedLayerSegment"
  | "bendSelectedLayerSegment"
  | "flexSelectedLayerSegment"
  | "deleteSelectedPoint"
  | "deleteSelectedSubPath"
  | "extractSelectedSubPathToNewLayer"
  | "splitSelectedCommand"
  | "setSelectedCommandAsFirst";

type VectorPathActions = Pick<EditorState, VectorPathAction>;
type SetEditorState = (update: Partial<EditorState>) => void;

const mapEndPath = (layer: Layer, transform: (path: PathData) => PathData) =>
  layer.to ? transform(layer.to) : undefined;
const endPath = (layer: Layer) => layer.to ?? layer.from;

function cubicPointAt(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  t: number,
): Point {
  const remaining = 1 - t;
  return {
    x:
      remaining ** 3 * start.x +
      3 * remaining ** 2 * t * control1.x +
      3 * remaining * t ** 2 * control2.x +
      t ** 3 * end.x,
    y:
      remaining ** 3 * start.y +
      3 * remaining ** 2 * t * control1.y +
      3 * remaining * t ** 2 * control2.y +
      t ** 3 * end.y,
  };
}

export function createVectorPathActions(
  set: SetEditorState,
  get: () => EditorState,
): VectorPathActions {
  const mapToEnd = mapEndPath;
  const endOf = endPath;
  return {
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
        const { control1: newC1, control2: newC2 } = flexCurvature(
          start,
          c1,
          c2,
          end,
          safeT,
          delta,
        );

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
      const toDelete = selectedPoints.length > 0 ? selectedPoints : selection ? [selection] : [];
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
      const toDelete =
        selectedSubPaths.length > 0
          ? selectedSubPaths
          : selection
            ? [
                {
                  layerId: selection.layerId,
                  side: selection.side,
                  subPathIndex: selection.subPathIndex,
                },
              ]
            : [];
      if (toDelete.length === 0) return;

      const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
      if (layerIndex === -1) return;
      const layer = layers[layerIndex];

      let targetFrom = structuredClone(layer.from);
      let targetTo = layer.to ? structuredClone(layer.to) : undefined;

      // Delete subpaths descending per side to keep indices valid
      const fromIdxs = toDelete
        .filter((s) => s.side === "from" && String(s.layerId) === String(selectedLayerId))
        .map((s) => s.subPathIndex)
        .sort((a, b) => b - a);
      for (const idx of fromIdxs) {
        targetFrom = deleteSubPath(targetFrom, idx);
      }

      const toIdxs = toDelete
        .filter((s) => s.side === "to" && String(s.layerId) === String(selectedLayerId))
        .map((s) => s.subPathIndex)
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
      } else if (
        selection &&
        String(selection.layerId) === String(selectedLayerId) &&
        selection.side === editingSide
      ) {
        subIdx = selection.subPathIndex;
      }
      if (subIdx == null) return;

      const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
      if (layerIndex === -1) return;
      const layer = layers[layerIndex];

      // Extract from both sides so the morph stays consistent (subpath indices should correspond)
      const fromExtract = extractSubPath(layer.from, subIdx);
      const toExtract = layer.to ? extractSubPath(layer.to, subIdx) : null;

      if (
        fromExtract.extracted.subPaths.length === 0 &&
        (toExtract?.extracted.subPaths.length ?? 0) === 0
      )
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
        editingSide === "from"
          ? updatedOriginal.from
          : (updatedOriginal.to ?? updatedOriginal.from);

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

      if (!layer.to) {
        // Static layer: only the single (from) geometry gains a command.
        const updatedFrom = splitCommandInHalf(
          layer.from,
          selection.subPathIndex,
          selection.commandIndex,
        );
        const newLayers = [...layers];
        newLayers[layerIndex] = { ...layer, from: updatedFrom, pathData: updatedFrom };
        get().pushHistory();
        set({ layers: newLayers });
        return;
      }

      // Structural op: keep from/to command counts equal by splitting BOTH sides at
      // the same (subIdx, cmdIdx) — the same discipline as addPointOnPath — so the
      // morph stays interpolatable instead of silently desyncing until Auto Fix.
      const activePath = editingSide === "from" ? layer.from : layer.to;
      const otherPath = editingSide === "from" ? layer.to : layer.from;
      const splitActive = splitCommandInHalf(
        activePath,
        selection.subPathIndex,
        selection.commandIndex,
      );
      const splitOther =
        otherPath && otherPath.subPaths[selection.subPathIndex]?.commands[selection.commandIndex]
          ? splitCommandInHalf(otherPath, selection.subPathIndex, selection.commandIndex)
          : otherPath;
      const from = editingSide === "from" ? splitActive : (splitOther ?? splitActive);
      const to = editingSide === "from" ? splitOther : splitActive;
      const newLayers = [...layers];
      newLayers[layerIndex] = { ...layer, from, to, pathData: from };
      get().pushHistory();
      set({ layers: newLayers });
    },

    setSelectedCommandAsFirst: () => {
      const { layers, selectedLayerId, editingSide, selection } = get();
      if (!selection) return;
      const layerIndex = layers.findIndex((l) => l.id === selectedLayerId);
      if (layerIndex === -1) return;
      const layer = layers[layerIndex];
      if (!layer.to) {
        // Static layer: rotate its single (from) geometry.
        const updatedFrom = setCommandAsFirst(
          layer.from,
          selection.subPathIndex,
          selection.commandIndex,
        );
        const newLayers = [...layers];
        newLayers[layerIndex] = { ...layer, from: updatedFrom, pathData: updatedFrom };
        get().pushHistory();
        set({ layers: newLayers });
        return;
      }

      // Structural op: rotate BOTH sides at the same (subIdx, cmdIdx). Rotating only
      // the active side keeps the command count but scrambles from/to point
      // correspondence, corrupting the morph. setCommandAsFirst no-ops on a side
      // whose subpath lacks the index instead of corrupting a desynced pair.
      const activePath = editingSide === "from" ? layer.from : layer.to!;
      const otherPath = editingSide === "from" ? layer.to! : layer.from;
      const from = setCommandAsFirst(activePath, selection.subPathIndex, selection.commandIndex);
      const to = setCommandAsFirst(otherPath, selection.subPathIndex, selection.commandIndex);
      const newLayers = [...layers];
      newLayers[layerIndex] = { ...layer, from, to, pathData: from };
      get().pushHistory();
      set({ layers: newLayers });
    },
  };
}

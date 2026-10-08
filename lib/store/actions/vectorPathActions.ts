import {
  reversePath,
  shiftPath,
  deleteCommand,
  deleteSubPath,
  extractSubPath,
  setCommandAsFirst,
  insertPointNear,
  splitCommandAt,
  changeCommandType,
  updateCommandPoint,
  getPathDataBounds,
  parsePath,
  pathToString,
  androidPathMorphSignature,
  generateId,
} from "../../pathshift/pathUtils";
import { toast } from "sonner";
import { structuralLockIssue } from "../commands/structuralLayers";
import { commitPathTopology, isEditablePath } from "../commands/pathTopology";
import { flexCurvature } from "../../pathshift/gestures/HitTests";
import type { Layer, Point } from "../../pathshift/types";
import type { EditorState } from "../editorStore";

type VectorPathAction =
  | "reverseSelectedLayer"
  | "shiftSelectedLayer"
  | "editSelectedPathPoint"
  | "changeSelectedPathCommand"
  | "addSelectedPathPoint"
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
  const endOf = endPath;
  return {
    reverseSelectedLayer: () => {
      commitPathTopology(set, get, get().selectedLayerId, reversePath);
    },
    shiftSelectedLayer: (steps = 1) =>
      commitPathTopology(set, get, get().selectedLayerId, (path) => shiftPath(path, steps)),
    editSelectedPathPoint: (subPathIndex, commandIndex, pointIndex, point) => {
      const state = get();
      const layer = state.layers.find((item) => String(item.id) === String(state.selectedLayerId));
      if (
        !layer ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        Math.abs(point.x) > 1e7 ||
        Math.abs(point.y) > 1e7
      )
        return false;
      if (structuralLockIssue(state.layers, [layer.id], false)) return false;
      const source = state.editingSide === "from" ? layer.from : (layer.to ?? layer.from);
      if (!source.subPaths[subPathIndex]?.commands[commandIndex]?.points[pointIndex]) return false;
      state.beginHistoryGesture();
      try {
        state.ensurePathKeyframeAtPlayhead();
        const current = get();
        const live = current.layers.find((item) => String(item.id) === String(layer.id));
        const path = current.editingSide === "from" ? live?.from : (live?.to ?? live?.from);
        if (!path) return false;
        const next = updateCommandPoint(path, subPathIndex, commandIndex, pointIndex, point);
        if (next === path) return false;
        current.updateSelectedLayer(
          current.editingSide === "from" ? { from: next, pathData: next } : { to: next },
        );
        return true;
      } finally {
        get().endHistoryGesture();
      }
    },
    changeSelectedPathCommand: (subPathIndex, commandIndex, type) =>
      commitPathTopology(set, get, get().selectedLayerId, (path) =>
        changeCommandType(path, subPathIndex, commandIndex, type),
      ),

    addSelectedPathPoint: (subPathIndex, commandIndex, t = 0.5) => {
      const state = get();
      const layer = state.layers.find((item) => String(item.id) === String(state.selectedLayerId));
      const path = state.editingSide === "from" ? layer?.from : (layer?.to ?? layer?.from);
      const command = path?.subPaths[subPathIndex]?.commands[commandIndex];
      if (!command) return false;
      // A start row adds an anchor on the outgoing edge; other rows split their incoming edge.
      const target = command.type === "M" ? commandIndex + 1 : commandIndex;
      const changed = commitPathTopology(set, get, state.selectedLayerId, (path) =>
        splitCommandAt(path, subPathIndex, target, t),
      );
      if (changed) {
        const current = get();
        const layer = current.layers.find(
          (item) => String(item.id) === String(state.selectedLayerId),
        );
        const path = current.editingSide === "from" ? layer?.from : (layer?.to ?? layer?.from);
        const inserted = path?.subPaths[subPathIndex]?.commands[target];
        if (inserted?.points.length)
          current.selectPoint({
            layerId: state.selectedLayerId,
            side: current.editingSide,
            subPathIndex,
            commandIndex: target,
            pointIndex: inserted.points.length - 1,
          });
      }
      return changed;
    },

    addPointOnPath: (clickX, clickY) => {
      const state = get();
      const layer = state.layers.find((item) => String(item.id) === String(state.selectedLayerId));
      const path = state.editingSide === "from" ? layer?.from : (layer?.to ?? layer?.from);
      if (!path) return;
      const hit = insertPointNear(path, { x: clickX, y: clickY });
      if (!hit || hit.t <= 1e-6 || hit.t >= 1 - 1e-6) return;
      commitPathTopology(set, get, state.selectedLayerId, (path) =>
        splitCommandAt(path, hit.subIdx, hit.cmdIdx, hit.t),
      );
    },

    splitSelectedLayerSegment: (segment) => {
      if (String(get().selectedLayerId) !== String(segment.layerId))
        get().selectLayer(segment.layerId);
      get().setEditingSide(segment.side);
      get().addSelectedPathPoint(segment.subPathIndex, segment.commandIndex);
    },

    bendSelectedLayerSegment: (segment, point, options) => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      const initial = get();
      if (structuralLockIssue(initial.layers, [segment.layerId], false)) return;
      const initialLayer = initial.layers.find(
        (item) => String(item.id) === String(segment.layerId),
      );
      const initialPath =
        segment.side === "from" ? initialLayer?.from : (initialLayer?.to ?? initialLayer?.from);
      const type =
        initialPath?.subPaths[segment.subPathIndex]?.commands[segment.commandIndex]?.type;
      if (!type || !["L", "C", "Q", "S", "T"].includes(type)) return;
      const promoted = type !== "C";
      if (
        promoted &&
        !commitPathTopology(
          set,
          get,
          segment.layerId,
          (path) => changeCommandType(path, segment.subPathIndex, segment.commandIndex, "C"),
          { recordHistory: options?.recordHistory },
        )
      )
        return;
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

        if (command.type === "C" && command.points.length >= 3) {
          const mid = cubicPointAt(start, command.points[0], command.points[1], end, 0.5);
          // At the midpoint, the two controls contribute 3/4 of their shared displacement.
          const dx = (4 / 3) * (point.x - mid.x);
          const dy = (4 / 3) * (point.y - mid.y);
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
      if (!isEditablePath(edited)) return;
      const from = isFrom ? edited : layer.from;
      const to = isFrom ? layer.to : edited;
      const newLayers = [...layers];
      newLayers[layerIndex] = { ...layer, from, to, pathData: from };

      if (!promoted && options?.recordHistory !== false) {
        get().pushHistory();
      }
      set({
        layers: newLayers,
        selectedLayerId: segment.layerId,
        editingSide: segment.side,
      });
    },

    flexSelectedLayerSegment: (segment, delta, t = 0.5, options) => {
      if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y) || !Number.isFinite(t)) return;
      const initial = get();
      if (structuralLockIssue(initial.layers, [segment.layerId], false)) return;
      const initialLayer = initial.layers.find(
        (item) => String(item.id) === String(segment.layerId),
      );
      const initialPath =
        segment.side === "from" ? initialLayer?.from : (initialLayer?.to ?? initialLayer?.from);
      const type =
        initialPath?.subPaths[segment.subPathIndex]?.commands[segment.commandIndex]?.type;
      if (!type || !["L", "C", "Q", "S", "T"].includes(type)) return;
      const promoted = type !== "C" && type !== "Q";
      if (
        promoted &&
        !commitPathTopology(
          set,
          get,
          segment.layerId,
          (path) => changeCommandType(path, segment.subPathIndex, segment.commandIndex, "C"),
          { recordHistory: options?.recordHistory },
        )
      )
        return;
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
      if (!isEditablePath(edited)) return;
      const from = isFrom ? edited : layer.from;
      const to = isFrom ? layer.to : edited;
      const newLayers = [...layers];
      newLayers[layerIndex] = { ...layer, from, to, pathData: from };

      if (!promoted && options?.recordHistory !== false) {
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

      const source = get().editingSide === "from" ? layer.from : (layer.to ?? layer.from);
      const bySub = new Map<number, number[]>();
      const handles: typeof toDelete = [];
      for (const sel of toDelete) {
        if (String(sel.layerId) !== String(selectedLayerId)) continue;
        const command = source.subPaths[sel.subPathIndex]?.commands[sel.commandIndex];
        if (!command?.points[sel.pointIndex]) continue;
        if (sel.pointIndex !== command.points.length - 1) {
          handles.push(sel);
          continue;
        }
        if (!bySub.has(sel.subPathIndex)) bySub.set(sel.subPathIndex, []);
        bySub.get(sel.subPathIndex)!.push(sel.commandIndex);
      }
      if (!bySub.size && !handles.length) return;
      const deleteOn = (pathData: Layer["from"]) => {
        let path = structuredClone(pathData);
        // Deleting a handle collapses that tangent, rather than deleting its vertex.
        for (const sel of handles) {
          const commands = path.subPaths[sel.subPathIndex]?.commands;
          const command = commands?.[sel.commandIndex];
          const start = commands?.[sel.commandIndex - 1]?.points.at(-1);
          const end = command?.points.at(-1);
          if (!command || !start || !end || bySub.get(sel.subPathIndex)?.includes(sel.commandIndex))
            continue;
          const point =
            command.type === "Q"
              ? { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
              : command.type === "C" && sel.pointIndex === 0
                ? start
                : end;
          command.points[sel.pointIndex] = { ...point };
        }
        for (const [subIdx, indices] of [...bySub.entries()].sort(([a], [b]) => b - a))
          for (const cmdIdx of [...new Set(indices)].sort((a, b) => b - a))
            path = deleteCommand(path, subIdx, cmdIdx);
        return path;
      };
      if (commitPathTopology(set, get, selectedLayerId, deleteOn))
        set({ selection: null, selectedPoints: [], selectedSubPaths: [] });
    },

    deleteSelectedSubPath: () => {
      const { selectedLayerId, selection, selectedSubPaths } = get();
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

      const indices = [
        ...new Set(
          toDelete
            .filter((item) => String(item.layerId) === String(selectedLayerId))
            .map((item) => item.subPathIndex),
        ),
      ].sort((a, b) => b - a);
      commitPathTopology(set, get, selectedLayerId, (path) =>
        indices.reduce((next, index) => deleteSubPath(next, index), path),
      );
    },

    extractSelectedSubPathToNewLayer: () => {
      const state = get();
      const layer = state.layers.find((item) => String(item.id) === String(state.selectedLayerId));
      const selection =
        state.selectedSubPaths.find(
          (item) => String(item.layerId) === String(state.selectedLayerId),
        ) ?? state.selection;
      if (!layer || !selection || String(selection.layerId) !== String(layer.id)) return;
      const issue = structuralLockIssue(state.layers, [layer.id], false);
      if (issue) {
        toast.error(issue);
        return;
      }
      if (layer.type !== "path") {
        toast.error("Keep mask contours together to preserve clipping.");
        return;
      }
      try {
        const partition = (path: Layer["from"]) => {
          if (!isEditablePath(path))
            throw new Error("Repair the invalid path data before extracting a contour.");
          const extracted = extractSubPath(path, selection.subPathIndex);
          if (!extracted.extracted.subPaths.length)
            throw new Error("That contour no longer exists. Select it again.");
          const box = getPathDataBounds(extracted.extracted);
          for (const sub of extracted.remaining.subPaths) {
            const other = getPathDataBounds({ subPaths: [sub] });
            if (
              box &&
              other &&
              box.x < other.x + other.w &&
              box.x + box.w > other.x &&
              box.y < other.y + other.h &&
              box.y + box.h > other.y
            )
              throw new Error(
                "Keep overlapping contours together to preserve their fill and opacity.",
              );
          }
          return extracted;
        };
        const from = partition(layer.from);
        const to = layer.to ? partition(layer.to) : undefined;
        const id = generateId();
        const originalBlocks: typeof state.animation.blocks = [];
        const extractedBlocks: typeof state.animation.blocks = [];
        const remainingSignatures = new Set([
          androidPathMorphSignature(from.remaining),
          ...(to ? [androidPathMorphSignature(to.remaining)] : []),
        ]);
        const extractedSignatures = new Set([
          androidPathMorphSignature(from.extracted),
          ...(to ? [androidPathMorphSignature(to.extracted)] : []),
        ]);
        for (const block of state.animation.blocks) {
          if (String(block.layerId) !== String(layer.id)) {
            originalBlocks.push(block);
            continue;
          }
          if (block.propertyName !== "pathData") {
            originalBlocks.push(block);
            extractedBlocks.push({ ...block, id: generateId(), layerId: id });
            continue;
          }
          const start = partition(parsePath(String(block.fromValue)));
          const end = partition(parsePath(String(block.toValue)));
          for (const pose of [start, end]) {
            remainingSignatures.add(androidPathMorphSignature(pose.remaining));
            extractedSignatures.add(androidPathMorphSignature(pose.extracted));
          }
          originalBlocks.push({
            ...block,
            fromValue: pathToString(start.remaining),
            toValue: pathToString(end.remaining),
          });
          extractedBlocks.push({
            ...block,
            id: generateId(),
            layerId: id,
            fromValue: pathToString(start.extracted),
            toValue: pathToString(end.extracted),
          });
        }
        if (remainingSignatures.size > 1 || extractedSignatures.size > 1)
          throw new Error("Match the animation points before extracting a contour.");
        const next = [...state.layers];
        const index = next.indexOf(layer);
        next[index] = {
          ...layer,
          from: from.remaining,
          to: to?.remaining,
          pathData: from.remaining,
          morphMapping: undefined,
        };
        next.splice(index + 1, 0, {
          ...structuredClone(layer),
          id,
          name: `${layer.name} contour`,
          from: from.extracted,
          to: to?.extracted,
          pathData: from.extracted,
          morphMapping: undefined,
        });
        state.pushHistory();
        set({
          layers: next,
          animation: { ...state.animation, blocks: [...originalBlocks, ...extractedBlocks] },
          selectedLayerId: id,
          selectedLayerIds: [id],
          selectedLayerRefs: [{ ownerId: state.selectedFrameId, layerId: id }],
          selection: null,
          selectedPoints: [],
          selectedSubPaths: [],
          selectedBlockIds: [],
          morphPreview: null,
          dragState: null,
          isActionMode: false,
          isPlaying: false,
        });
      } catch (cause) {
        toast.error(
          cause instanceof Error
            ? cause.message
            : "The contour could not be extracted. Your artwork has been preserved.",
        );
      }
    },

    splitSelectedCommand: () => {
      const state = get();
      const selection = state.selection;
      if (!selection) return;
      get().addSelectedPathPoint(selection.subPathIndex, selection.commandIndex);
    },

    setSelectedCommandAsFirst: () => {
      const state = get();
      const selection = state.selection;
      if (!selection) return;
      commitPathTopology(set, get, state.selectedLayerId, (path) =>
        setCommandAsFirst(path, selection.subPathIndex, selection.commandIndex),
      );
    },
  };
}

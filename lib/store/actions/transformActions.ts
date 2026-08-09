import { getPathDataBounds, scalePathToBounds, updatePoint } from "../../shapeshifter/pathUtils";
import { recordTranslationAtProgress } from "../../shapeshifter/motion/recordTranslation";
import { PAGE_ROOT_ID } from "../../shapeshifter/scene/owners";
import type { Layer, PathData } from "../../shapeshifter/types";
import type { EditorState } from "../editorStore";
import { saveActiveFrame, saveActiveRoot } from "../workspaceState";

type TransformActionKey =
  | "updateSelectedPoint"
  | "translateSelectedPoints"
  | "translateSelectedSubPaths"
  | "translateSelectedLayer"
  | "recordLayerTranslationAtPlayhead"
  | "resizeSelectedLayer"
  | "rotateSelectedLayers";

type SetEditorState = (
  update: Partial<EditorState> | ((state: EditorState) => Partial<EditorState> | EditorState),
) => void;

const mapToEnd = (layer: Layer, transform: (path: PathData) => PathData): PathData | undefined =>
  layer.to ? transform(layer.to) : undefined;
const endOf = (layer: Layer): PathData => layer.to ?? layer.from;

export function createTransformActions(
  set: SetEditorState,
  get: () => EditorState,
): Pick<EditorState, TransformActionKey> {
  return {
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
      const state = get();
      const { selectedLayerIds, selectedLayerId } = state;
      if (dx === 0 && dy === 0) return;

      const refs =
        state.selectedLayerRefs.length > 0
          ? state.selectedLayerRefs
          : (selectedLayerIds.length > 0
              ? selectedLayerIds
              : selectedLayerId != null
                ? [selectedLayerId]
                : []
            ).map((layerId) => ({ ownerId: state.selectedFrameId, layerId }));
      if (refs.length === 0) return;
      const idsByOwner = new Map<string, Set<string>>();
      for (const ref of refs) {
        const ids = idsByOwner.get(ref.ownerId) ?? new Set<string>();
        ids.add(String(ref.layerId));
        idsByOwner.set(ref.ownerId, ids);
      }
      const moveOwnerLayers = (ownerId: string, ownerLayers: Layer[]) => {
        const ids = idsByOwner.get(ownerId);
        if (!ids) return ownerLayers;
        return ownerLayers.map((layer) =>
          !ids.has(String(layer.id)) || layer.locked
            ? layer
            : {
                ...layer,
                translateX: (layer.translateX ?? 0) + dx,
                translateY: (layer.translateY ?? 0) + dy,
              },
        );
      };
      const savedFrames = saveActiveFrame(state);
      const savedRoot = saveActiveRoot(state);
      const nextFrames = savedFrames.map((frame) => ({
        ...frame,
        layers: moveOwnerLayers(frame.id, frame.layers),
      }));
      const nextRootLayers = moveOwnerLayers(PAGE_ROOT_ID, savedRoot.layers);
      const nextLayers =
        state.selectedFrameId === PAGE_ROOT_ID
          ? nextRootLayers
          : (nextFrames.find((frame) => frame.id === state.selectedFrameId)?.layers ??
            state.layers);

      if (options?.recordHistory !== false) {
        get().pushHistory();
      }
      set({
        frames: nextFrames,
        rootLayers: nextRootLayers,
        layers: nextLayers,
      });
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
            ({ b }) => String(b.layerId) === String(layer.id) && b.propertyName === propertyName,
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
        const cover = segs.find(({ b }) => ms >= b.startTime && ms <= b.endTime);
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

      const current = get();
      const idsByOwner = new Map<string, Array<string | number>>();
      for (const ref of current.selectedLayerRefs) {
        idsByOwner.set(ref.ownerId, [...(idsByOwner.get(ref.ownerId) ?? []), ref.layerId]);
      }
      const activeAnimation = { ...animation, blocks };
      const savedFrames = saveActiveFrame(current);
      const savedRoot = saveActiveRoot(current);
      const nextFrames = savedFrames.map((frame) => {
        if (frame.id === current.selectedFrameId) {
          return { ...frame, layers: newLayers, animation: activeAnimation };
        }
        const ownerIds = idsByOwner.get(frame.id);
        if (!ownerIds?.length) return frame;
        const recorded = recordTranslationAtProgress(
          frame.layers,
          frame.animation,
          ownerIds,
          progress,
        );
        return { ...frame, layers: recorded.layers, animation: recorded.animation };
      });
      const rootRecorded =
        current.selectedFrameId === PAGE_ROOT_ID
          ? { layers: newLayers, animation: activeAnimation }
          : idsByOwner.get(PAGE_ROOT_ID)?.length
            ? recordTranslationAtProgress(
                savedRoot.layers,
                savedRoot.animation,
                idsByOwner.get(PAGE_ROOT_ID)!,
                progress,
              )
            : { layers: savedRoot.layers, animation: savedRoot.animation };

      set({
        frames: nextFrames,
        rootLayers: rootRecorded.layers,
        rootAnimation: rootRecorded.animation,
        animation: activeAnimation,
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
        const frozenOwn = ownB ? { x: ownB.x, y: ownB.y, width: ownB.w, height: ownB.h } : null;
        // Note: live bounds each move is ok when we use proportional mapping from control AABB;
        // for frozen-source multi, canvas should pass control AABB from primary freeze.
        const from = mapOwn(layer.from, frozenOwn);
        const to = mapToEnd(layer, (p) => {
          const ob = getPathDataBounds(p);
          return mapOwn(p, ob ? { x: ob.x, y: ob.y, width: ob.w, height: ob.h } : null);
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
  };
}

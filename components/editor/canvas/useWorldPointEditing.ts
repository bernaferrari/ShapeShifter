"use client";

import { useCallback, useRef } from "react";
import { snapValueToStep } from "@/lib/shapeshifter/camera";
import { translatePathPoints } from "@/lib/shapeshifter/pathUtils";
import type { PathData, Point, Selection } from "@/lib/shapeshifter/types";
import {
  inverseAffine,
  transformPointWithMatrix,
  type AffineMatrix,
} from "@/lib/shapeshifter/scene/layerTransform";
import { useEditorStore, type EditorState } from "@/lib/store/editorStore";
import { beginLiveGesture, endLiveGesture, ownsLiveGesture } from "@/lib/store/liveGesture";

interface WorldPointEditingOptions {
  path: PathData | null;
  ownerOrigin: Point | null;
  layerTranslation: Point;
  /** Full evaluated owner-to-world matrix. Supersedes translation-only editing. */
  worldMatrix?: AffineMatrix | null;
  locked?: boolean;
  layerId: string | number;
  editingSide: "from" | "to";
  hitRadius: number;
  snapStep?: number;
  syncActiveOwner: EditorState["syncActiveOwner"];
}

interface PointDrag {
  selection: Selection;
  path: PathData;
  expectedPath: PathData | undefined;
  progress: number;
  blocks: EditorState["animation"]["blocks"];
  points: Selection[];
  origin: Point;
  ownerId: string;
  history: EditorState["history"];
  marker: ReturnType<typeof beginLiveGesture>;
}

function ownsPointDrag(drag: PointDrag, state: EditorState): boolean {
  const layer = state.layers.find((item) => String(item.id) === String(drag.selection.layerId));
  const path = drag.selection.side === "from" ? (layer?.pathData ?? layer?.from) : layer?.to;
  return (
    ownsLiveGesture(drag.marker) &&
    state.selectedFrameId === drag.ownerId &&
    String(state.selectedLayerId) === String(drag.selection.layerId) &&
    state.editingSide === drag.selection.side &&
    state.history === drag.history &&
    state.progress === drag.progress &&
    state.animation.blocks === drag.blocks &&
    path === drag.expectedPath
  );
}

export function useWorldPointEditing({
  path,
  ownerOrigin,
  layerTranslation,
  worldMatrix,
  locked = false,
  layerId,
  editingSide,
  hitRadius,
  snapStep,
  syncActiveOwner,
}: WorldPointEditingOptions) {
  const dragRef = useRef<PointDrag | null>(null);
  const movedRef = useRef(false);

  const hitTest = useCallback(
    (point: Point): Selection | null => {
      if (locked || !path || !ownerOrigin) return null;
      let nearest: Selection | null = null;
      let nearestDistance = Infinity;
      let nearestRank = -1;
      const selected = useEditorStore.getState().selectedPoints;
      for (let subPathIndex = 0; subPathIndex < path.subPaths.length; subPathIndex++) {
        const commands = path.subPaths[subPathIndex].commands;
        for (let commandIndex = 0; commandIndex < commands.length; commandIndex++) {
          for (
            let pointIndex = 0;
            pointIndex < commands[commandIndex].points.length;
            pointIndex++
          ) {
            const candidate = commands[commandIndex].points[pointIndex];
            const transformed = worldMatrix
              ? transformPointWithMatrix(candidate, worldMatrix)
              : { x: layerTranslation.x + candidate.x, y: layerTranslation.y + candidate.y };
            const worldX = ownerOrigin.x + transformed.x;
            const worldY = ownerOrigin.y + transformed.y;
            const distance = Math.hypot(point.x - worldX, point.y - worldY);
            const explicitlySelected = selected.some(
              (item) =>
                String(item.layerId) === String(layerId) &&
                item.side === editingSide &&
                item.subPathIndex === subPathIndex &&
                item.commandIndex === commandIndex &&
                item.pointIndex === pointIndex,
            );
            const rank =
              (explicitlySelected ? 2 : 0) +
              (pointIndex === commands[commandIndex].points.length - 1 ? 1 : 0);
            if (
              distance <= hitRadius &&
              (distance < nearestDistance - 1e-9 ||
                (Math.abs(distance - nearestDistance) <= 1e-9 && rank > nearestRank))
            ) {
              nearest = { layerId, side: editingSide, subPathIndex, commandIndex, pointIndex };
              nearestDistance = distance;
              nearestRank = rank;
            }
          }
        }
      }
      return nearest;
    },
    [
      editingSide,
      hitRadius,
      layerId,
      layerTranslation.x,
      layerTranslation.y,
      ownerOrigin,
      path,
      worldMatrix,
      locked,
    ],
  );

  const start = useCallback(
    (selection: Selection, additive = false) => {
      endLiveGesture(dragRef.current?.marker);
      dragRef.current = null;
      const store = useEditorStore.getState();
      const layer = store.layers.find(
        (candidate) => String(candidate.id) === String(selection.layerId),
      );
      if (locked || !layer || layer.locked) return;
      const samePoint = (candidate: Selection) =>
        String(candidate.layerId) === String(selection.layerId) &&
        candidate.side === selection.side &&
        candidate.subPathIndex === selection.subPathIndex &&
        candidate.commandIndex === selection.commandIndex &&
        candidate.pointIndex === selection.pointIndex;
      // Dragging an already selected anchor preserves the rest of the selection.
      if (additive || !store.selectedPoints.some(samePoint)) store.selectPoint(selection, additive);
      const points = useEditorStore
        .getState()
        .selectedPoints.filter(
          (candidate) =>
            String(candidate.layerId) === String(selection.layerId) &&
            candidate.side === selection.side,
        );
      const expectedPath = selection.side === "from" ? (layer.pathData ?? layer.from) : layer.to;
      const source = path ?? expectedPath;
      const origin =
        source?.subPaths[selection.subPathIndex]?.commands[selection.commandIndex]?.points[
          selection.pointIndex
        ];
      dragRef.current =
        source && origin && points.some(samePoint)
          ? {
              selection,
              path: source,
              expectedPath,
              progress: store.progress,
              blocks: store.animation.blocks,
              points,
              origin: { ...origin },
              ownerId: store.selectedFrameId,
              history: store.history,
              marker: beginLiveGesture("world-anchor", origin),
            }
          : null;
      movedRef.current = false;
    },
    [locked, path],
  );

  const update = useCallback(
    (point: Point, bypassSnap: boolean) => {
      const drag = dragRef.current;
      if (!drag || !ownerOrigin) return false;
      const state = useEditorStore.getState();
      if (!ownsPointDrag(drag, state) || locked) {
        endLiveGesture(drag.marker);
        dragRef.current = null;
        movedRef.current = false;
        return false;
      }
      const ownerPoint = { x: point.x - ownerOrigin.x, y: point.y - ownerOrigin.y };
      const inverse = worldMatrix ? inverseAffine(worldMatrix) : null;
      const raw = worldMatrix
        ? inverse
          ? transformPointWithMatrix(ownerPoint, inverse)
          : null
        : {
            x: ownerPoint.x - layerTranslation.x,
            y: ownerPoint.y - layerTranslation.y,
          };
      if (!raw) return false;
      const local =
        snapStep != null && !bypassSnap
          ? { x: snapValueToStep(raw.x, snapStep), y: snapValueToStep(raw.y, snapStep) }
          : raw;
      if (!Number.isFinite(local.x) || !Number.isFinite(local.y)) return false;
      const dx = local.x - drag.origin.x;
      const dy = local.y - drag.origin.y;
      if (!movedRef.current && Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return false;
      if (!movedRef.current && translatePathPoints(drag.path, drag.points, dx, dy) === drag.path)
        return false;
      if (!movedRef.current) {
        // Inserting the pose and changing it are one user gesture, not two undo steps.
        state.beginHistoryGesture();
        try {
          if (!state.isActionMode && state.ensurePathKeyframeAtPlayhead()) {
            const seeded = useEditorStore.getState();
            const layer = seeded.layers.find(
              (item) => String(item.id) === String(drag.selection.layerId),
            );
            const source =
              seeded.editingSide === "from" ? (layer?.pathData ?? layer?.from) : layer?.to;
            if (!source) return false;
            drag.path = source;
            drag.selection = { ...drag.selection, side: seeded.editingSide };
            drag.points = drag.points.map((item) => ({ ...item, side: seeded.editingSide }));
          }
          useEditorStore.getState().pushHistory();
          drag.history = useEditorStore.getState().history;
          movedRef.current = true;
        } finally {
          useEditorStore.getState().endHistoryGesture();
        }
      }
      // Apply an absolute local-space delta to the frozen gesture geometry. It
      // neither accumulates rounding error nor distorts rotated/scaled parents.
      const updated = translatePathPoints(drag.path, drag.points, dx, dy);
      useEditorStore
        .getState()
        .updateSelectedLayer(
          drag.selection.side === "from" ? { from: updated, pathData: updated } : { to: updated },
          { recordHistory: false },
        );
      const published = useEditorStore.getState();
      const layer = published.layers.find(
        (item) => String(item.id) === String(drag.selection.layerId),
      );
      drag.expectedPath =
        drag.selection.side === "from" ? (layer?.pathData ?? layer?.from) : layer?.to;
      drag.blocks = published.animation.blocks;
      return true;
    },
    [layerTranslation.x, layerTranslation.y, ownerOrigin, snapStep, worldMatrix, locked],
  );

  const finish = useCallback(() => {
    if (!dragRef.current) return false;
    const drag = dragRef.current;
    const state = useEditorStore.getState();
    const moved = movedRef.current && ownsPointDrag(drag, state);
    dragRef.current = null;
    endLiveGesture(drag.marker);
    movedRef.current = false;
    if (moved) syncActiveOwner();
    return true;
  }, [syncActiveOwner]);

  const cancel = useCallback(() => {
    const drag = dragRef.current;
    const state = useEditorStore.getState();
    dragRef.current = null;
    if (drag && movedRef.current && ownsPointDrag(drag, state))
      state.cancelLastHistoryTransaction();
    endLiveGesture(drag?.marker);
    movedRef.current = false;
  }, []);

  const hasDrag = useCallback(() => Boolean(dragRef.current), []);

  return { hitTest, start, update, finish, cancel, hasDrag };
}

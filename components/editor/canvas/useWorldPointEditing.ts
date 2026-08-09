"use client";

import { useCallback, useRef } from "react";
import { snapValueToStep } from "@/lib/shapeshifter/camera";
import { updateCommandPoint } from "@/lib/shapeshifter/pathUtils";
import type { PathData, Point, Selection } from "@/lib/shapeshifter/types";
import { useEditorStore, type EditorState } from "@/lib/store/editorStore";

interface WorldPointEditingOptions {
  path: PathData | null;
  ownerOrigin: Point | null;
  layerTranslation: Point;
  layerId: string | number;
  editingSide: "from" | "to";
  hitRadius: number;
  snapStep?: number;
  syncActiveOwner: EditorState["syncActiveOwner"];
}

export function useWorldPointEditing({
  path,
  ownerOrigin,
  layerTranslation,
  layerId,
  editingSide,
  hitRadius,
  snapStep,
  syncActiveOwner,
}: WorldPointEditingOptions) {
  const dragRef = useRef<Selection | null>(null);
  const movedRef = useRef(false);

  const hitTest = useCallback(
    (point: Point): Selection | null => {
      if (!path || !ownerOrigin) return null;
      for (let subPathIndex = 0; subPathIndex < path.subPaths.length; subPathIndex++) {
        const commands = path.subPaths[subPathIndex].commands;
        for (let commandIndex = 0; commandIndex < commands.length; commandIndex++) {
          for (
            let pointIndex = 0;
            pointIndex < commands[commandIndex].points.length;
            pointIndex++
          ) {
            const candidate = commands[commandIndex].points[pointIndex];
            const worldX = ownerOrigin.x + layerTranslation.x + candidate.x;
            const worldY = ownerOrigin.y + layerTranslation.y + candidate.y;
            if (Math.hypot(point.x - worldX, point.y - worldY) <= hitRadius) {
              return {
                layerId,
                side: editingSide,
                subPathIndex,
                commandIndex,
                pointIndex,
              };
            }
          }
        }
      }
      return null;
    },
    [editingSide, hitRadius, layerId, layerTranslation.x, layerTranslation.y, ownerOrigin, path],
  );

  const start = useCallback((selection: Selection) => {
    useEditorStore.getState().selectPoint(selection);
    dragRef.current = selection;
    movedRef.current = false;
  }, []);

  const update = useCallback(
    (point: Point, bypassSnap: boolean) => {
      const selection = dragRef.current;
      if (!selection || !path || !ownerOrigin) return false;
      const raw = {
        x: point.x - ownerOrigin.x - layerTranslation.x,
        y: point.y - ownerOrigin.y - layerTranslation.y,
      };
      const local =
        snapStep != null && !bypassSnap
          ? { x: snapValueToStep(raw.x, snapStep), y: snapValueToStep(raw.y, snapStep) }
          : raw;
      const updated = updateCommandPoint(
        path,
        selection.subPathIndex,
        selection.commandIndex,
        selection.pointIndex,
        local,
      );
      if (!movedRef.current) {
        useEditorStore.getState().pushHistory();
        movedRef.current = true;
      }
      useEditorStore
        .getState()
        .updateSelectedLayer(
          editingSide === "from" ? { from: updated, pathData: updated } : { to: updated },
          { recordHistory: false },
        );
      return true;
    },
    [editingSide, layerTranslation.x, layerTranslation.y, ownerOrigin, path, snapStep],
  );

  const finish = useCallback(() => {
    if (!dragRef.current) return false;
    const moved = movedRef.current;
    dragRef.current = null;
    movedRef.current = false;
    if (moved) syncActiveOwner();
    return true;
  }, [syncActiveOwner]);

  const cancel = useCallback(() => {
    dragRef.current = null;
    if (movedRef.current) useEditorStore.getState().cancelLastHistoryTransaction();
    movedRef.current = false;
  }, []);

  const hasDrag = useCallback(() => Boolean(dragRef.current), []);

  return { hitTest, start, update, finish, cancel, hasDrag };
}

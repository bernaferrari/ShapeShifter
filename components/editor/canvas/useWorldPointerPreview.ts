"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { snapValueToStep } from "@/lib/shapeshifter/camera";
import { isPointInFillRegion } from "@/lib/shapeshifter/pathUtils";
import { evaluateAndroidScene } from "@/lib/shapeshifter/scene/evaluate";
import {
  inverseAffine,
  transformPointWithMatrix,
  type AffineMatrix,
} from "@/lib/shapeshifter/scene/layerTransform";
import type { PathData, Point } from "@/lib/shapeshifter/types";
import type { ToolMode } from "@/lib/shapeshifter/toolModes";
import { useEditorStore } from "@/lib/store/editorStore";

interface LayerHit {
  frameId: string;
  layerId: string | number;
}

interface PointerModifiers {
  metaKey: boolean;
  ctrlKey: boolean;
}

interface WorldPointerPreviewOptions {
  toolMode: ToolMode;
  worldPointFromClient: (clientX: number, clientY: number) => Point | null;
  hitLayerAtWorld: (point: Point | null) => LayerHit | null;
  hitArtboard: (point: Point | null) => string | null;
  penActiveSubpathRef: RefObject<number | null>;
  setPenPreview: (point: Point | null) => void;
  editOrigin: Point | null;
  editPath: PathData | null;
  snapToGrid: boolean;
  snapStep: number;
}

export function useWorldPointerPreview({
  toolMode,
  worldPointFromClient,
  hitLayerAtWorld,
  hitArtboard,
  penActiveSubpathRef,
  setPenPreview,
  editOrigin,
  editPath,
  snapToGrid,
  snapStep,
}: WorldPointerPreviewOptions) {
  const [hoveredFrameId, setHoveredFrameId] = useState<string | null>(null);
  const [hoveredLayerKey, setHoveredLayerKey] = useState<string | null>(null);
  const [paintHoverValid, setPaintHoverValid] = useState(false);
  /**
   * World point -> layer-local coordinates, mirroring the commit path in
   * useWorldPointerRouter: subtract the owner origin, then apply the inverse of
   * the evaluated world matrix (resolved from the same memoized scene that
   * CanvasArea overlays render with, so preview and commit always agree).
   */
  const resolveEditMatrix = useCallback((): AffineMatrix | null => {
    const state = useEditorStore.getState();
    if (!state.layers.length || state.selectedLayerId == null) return null;
    const scene = evaluateAndroidScene(state.layers, state.animation, state.progress, true);
    return scene.nodesById.get(String(state.selectedLayerId))?.worldMatrix ?? null;
  }, []);

  const worldToLocal = useCallback(
    (point: Point, origin: Point, matrix: AffineMatrix | null): Point | null => {
      const ownerPoint = { x: point.x - origin.x, y: point.y - origin.y };
      if (!matrix) return ownerPoint;
      const inverse = inverseAffine(matrix);
      return inverse ? transformPointWithMatrix(ownerPoint, inverse) : null;
    },
    [],
  );

  const clearObjectHover = useCallback(() => {
    setHoveredFrameId(null);
    setHoveredLayerKey(null);
  }, []);
  const clearPaintPreview = useCallback(() => setPaintHoverValid(false), []);

  useEffect(() => {
    if (toolMode !== "paint") clearPaintPreview();
  }, [clearPaintPreview, toolMode]);

  const updateIdle = useCallback(
    (clientX: number, clientY: number, modifiers: PointerModifiers) => {
      if (toolMode === "select" || toolMode === "direct") {
        const point = worldPointFromClient(clientX, clientY);
        const layerHit = point ? hitLayerAtWorld(point) : null;
        const frameId = layerHit?.frameId ?? (point ? hitArtboard(point) : null);
        const layerKey = layerHit ? `${layerHit.frameId}:${layerHit.layerId}` : null;
        setHoveredFrameId((current) => (current === frameId ? current : frameId));
        setHoveredLayerKey((current) => (current === layerKey ? current : layerKey));
        return;
      }
      if (toolMode === "pen" && penActiveSubpathRef.current != null && editOrigin) {
        const point = worldPointFromClient(clientX, clientY);
        if (!point) return;
        const raw = worldToLocal(point, editOrigin, resolveEditMatrix());
        if (!raw) return;
        const free = modifiers.metaKey || modifiers.ctrlKey || !snapToGrid;
        setPenPreview(
          free
            ? raw
            : {
                x: snapValueToStep(raw.x, snapStep),
                y: snapValueToStep(raw.y, snapStep),
              },
        );
        return;
      }
      clearObjectHover();
    },
    [
      clearObjectHover,
      editOrigin,
      hitArtboard,
      hitLayerAtWorld,
      penActiveSubpathRef,
      resolveEditMatrix,
      setPenPreview,
      snapStep,
      snapToGrid,
      toolMode,
      worldPointFromClient,
      worldToLocal,
    ],
  );

  const updatePaintPreview = useCallback(
    (point: Point) => {
      if (toolMode !== "paint") {
        clearPaintPreview();
        return;
      }
      if (editOrigin && editPath) {
        const local = worldToLocal(point, editOrigin, resolveEditMatrix());
        setPaintHoverValid(local ? isPointInFillRegion(local, editPath) : false);
        return;
      }
      setPaintHoverValid(Boolean(hitArtboard(point)));
    },
    [
      clearPaintPreview,
      editOrigin,
      editPath,
      hitArtboard,
      resolveEditMatrix,
      toolMode,
      worldToLocal,
    ],
  );

  const handlePointerLeave = useCallback(() => {
    clearObjectHover();
    if (toolMode === "paint") clearPaintPreview();
  }, [clearObjectHover, clearPaintPreview, toolMode]);

  return {
    hoveredFrameId,
    hoveredLayerKey,
    paintHoverValid,
    updateIdle,
    updatePaintPreview,
    clearPaintPreview,
    handlePointerLeave,
  };
}

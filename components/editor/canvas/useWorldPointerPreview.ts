"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { snapValueToStep } from "@/lib/shapeshifter/camera";
import { isPointInFillRegion } from "@/lib/shapeshifter/pathUtils";
import type { PathData, Point } from "@/lib/shapeshifter/types";
import type { ToolMode } from "@/lib/shapeshifter/toolModes";

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
        const local = { x: point.x - editOrigin.x, y: point.y - editOrigin.y };
        const free = modifiers.metaKey || modifiers.ctrlKey || !snapToGrid;
        setPenPreview(
          free
            ? local
            : {
                x: snapValueToStep(local.x, snapStep),
                y: snapValueToStep(local.y, snapStep),
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
      setPenPreview,
      snapStep,
      snapToGrid,
      toolMode,
      worldPointFromClient,
    ],
  );

  const updatePaintPreview = useCallback(
    (point: Point) => {
      if (toolMode !== "paint") {
        clearPaintPreview();
        return;
      }
      if (editOrigin && editPath) {
        setPaintHoverValid(
          isPointInFillRegion({ x: point.x - editOrigin.x, y: point.y - editOrigin.y }, editPath),
        );
        return;
      }
      setPaintHoverValid(Boolean(hitArtboard(point)));
    },
    [clearPaintPreview, editOrigin, editPath, hitArtboard, toolMode],
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

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { toast } from "sonner";
import { GestureDispatcher } from "@/lib/shapeshifter/gestures/GestureDispatcher";
import {
  collectPointsInLasso,
  collectPointsInRect,
  getMarqueeRect,
} from "@/lib/shapeshifter/gestures/HitTests";
import { isPointInFillRegion, parsePath } from "@/lib/shapeshifter/pathUtils";
import type { PathData, Point } from "@/lib/shapeshifter/types";
import { useEditorStore, type EditorState } from "@/lib/store/editorStore";
import { getPathBounds, rectsIntersect } from "./pathCanvasGeometry";
import { getPreviewLayers } from "./pathCanvasPreview";

type PathCanvasSide = "from" | "to" | "preview";
type PointFromClient = (clientX: number, clientY: number) => Point | null;
type PanHandler = (event: ReactPointerEvent<Element>) => void;
type UpdatePanHandler = (event: ReactPointerEvent<Element>) => boolean;

interface PathCanvasGestureOptions {
  side: PathCanvasSide;
  svgRef: RefObject<SVGSVGElement | null>;
  pointFromClient: PointFromClient;
  isPanning: boolean;
  startPan: PanHandler;
  updatePan: UpdatePanHandler;
  endPan: () => void;
  toolMode: EditorState["toolMode"];
  editingSide: EditorState["editingSide"];
  snapToGrid: boolean;
  zoom: number;
  isActionMode: boolean;
  pushHistory: () => void;
  paintColor: string;
}

interface MarqueeState {
  start: Point;
  current: Point;
}

const emptyPath = (): PathData => ({ subPaths: [] });
const selectionKey = (selection: {
  layerId: string | number;
  side: "from" | "to";
  subPathIndex: number;
  commandIndex: number;
  pointIndex: number;
}) =>
  `${String(selection.layerId)}:${selection.side}:${selection.subPathIndex}:${selection.commandIndex}:${selection.pointIndex}`;

function commitMarquee(side: PathCanvasSide, start: Point, end: Point, additive: boolean) {
  const state = useEditorStore.getState();
  const selectRect = getMarqueeRect(start, end);
  const isBoxGesture = selectRect.width > 0.2 || selectRect.height > 0.2;

  if (side === "preview" && !state.isActionMode) {
    if (isBoxGesture) {
      const subPathHits = state.layers.flatMap((layer) => {
        if (layer.visible === false || layer.locked) return [];
        return layer.from.subPaths.flatMap((subPath, subPathIndex) => {
          const bounds = getPathBounds({ subPaths: [subPath] });
          return bounds && rectsIntersect(selectRect, bounds)
            ? [{ layerId: layer.id, side: "from" as const, subPathIndex }]
            : [];
        });
      });
      if (subPathHits.length > 0) {
        const hitKeys = new Set(
          subPathHits.map((hit) => `${String(hit.layerId)}:${hit.side}:${hit.subPathIndex}`),
        );
        const merged = additive
          ? [
              ...state.selectedSubPaths.filter(
                (selection) =>
                  !hitKeys.has(
                    `${String(selection.layerId)}:${selection.side}:${selection.subPathIndex}`,
                  ),
              ),
              ...subPathHits,
            ]
          : subPathHits;
        state.selectMultipleSubPaths(merged);
        state.setEditingSide("from");
        return;
      }
    }

    const renderedLayers = getPreviewLayers(
      state.layers,
      state.animation.blocks,
      state.animation.duration,
      state.progress,
    );
    const hitLayer = [...renderedLayers].reverse().find(({ d }) => {
      const bounds = getPathBounds(parsePath(d));
      return bounds ? rectsIntersect(selectRect, bounds) : false;
    });
    if (!hitLayer) {
      if (!additive) state.clearSelection();
      return;
    }
    if (additive) {
      const ids = state.selectedLayerIds.length ? state.selectedLayerIds : [state.selectedLayerId];
      if (!ids.some((id) => String(id) === String(hitLayer.layer.id))) {
        state.selectLayers([...ids, hitLayer.layer.id]);
      }
    } else {
      state.selectLayer(hitLayer.layer.id);
    }
    state.setEditingSide("from");
    return;
  }

  const layer = state.layers.find((candidate) => candidate.id === state.selectedLayerId);
  const path = layer
    ? state.editingSide === "from"
      ? layer.from
      : (layer.to ?? layer.from)
    : emptyPath();
  const hits = collectPointsInRect(path, selectRect);
  if (hits.length === 0) {
    if (!additive) state.clearSelection();
    return;
  }
  const selections = hits.map((hit) => ({
    layerId: state.selectedLayerId,
    side: state.editingSide,
    ...hit,
  }));
  const selectionKeys = new Set(selections.map(selectionKey));
  state.selectMultiplePoints(
    additive
      ? [
          ...state.selectedPoints.filter(
            (selection) => !selectionKeys.has(selectionKey(selection)),
          ),
          ...selections,
        ]
      : selections,
  );
}

export function usePathCanvasGestures({
  side,
  svgRef,
  pointFromClient,
  isPanning,
  startPan,
  updatePan,
  endPan,
  toolMode,
  editingSide,
  snapToGrid,
  zoom,
  isActionMode,
  pushHistory,
  paintColor,
}: PathCanvasGestureOptions) {
  const dispatcherRef = useRef<GestureDispatcher | null>(null);
  const lassoPointsRef = useRef<Point[]>([]);
  const lassoRafRef = useRef<number | null>(null);
  const paintPreviewRafRef = useRef<number | null>(null);
  const paintHitRef = useRef<{ layerId: string | number } | null>(null);
  const pointerDownPositionRef = useRef<Point | null>(null);
  const [, setLassoFrame] = useState(0);
  const [, setPaintPreviewFrame] = useState(0);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);

  const paintCursor = useMemo(() => {
    const color = paintColor.replace("#", "%23");
    return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cg%3E%3Cpath fill='${color}' stroke='%23000' stroke-width='0.8' d='M3 3 L13 3 L14 13 L2 13 Z'/%3E%3Cpath fill='none' stroke='%23000' stroke-width='1' d='M3 3 L3 13 M13 3 L13 13'/%3E%3Cpath fill='%23ddd' d='M5 5 L11 5 L10 11 L6 11 Z'/%3E%3Cpath fill='none' stroke='%23000' stroke-width='0.5' d='M4 2 L12 2'/%3E%3C/g%3E%3C/svg%3E") 4 2, crosshair`;
  }, [paintColor]);

  const clearPaintPreview = useCallback(() => {
    if (paintPreviewRafRef.current) cancelAnimationFrame(paintPreviewRafRef.current);
    paintPreviewRafRef.current = null;
    paintHitRef.current = null;
    setPaintPreviewFrame((frame) => (frame + 1) % 10000);
  }, []);

  useEffect(() => {
    if (!dispatcherRef.current) {
      dispatcherRef.current = new GestureDispatcher(
        { toolMode, editingSide, snapToGrid, zoom },
        {
          setCursor: () => {},
          pushHistory,
          beginMarqueeSelection: (start, additive) => {
            if (!additive) useEditorStore.getState().clearSelection();
            setMarquee({ start, current: start });
          },
          updateMarquee: (current) =>
            setMarquee((previous) => (previous ? { ...previous, current } : null)),
          endMarquee: () => setMarquee(null),
          commitMarqueeSelection: (start, end, additive) =>
            commitMarquee(side, start, end, additive),
        },
      );
    }
    dispatcherRef.current.updateContext({ toolMode, editingSide, snapToGrid, zoom });
    if (toolMode !== "paint" && paintHitRef.current) clearPaintPreview();
  }, [clearPaintPreview, editingSide, pushHistory, side, snapToGrid, toolMode, zoom]);

  useEffect(
    () => () => {
      if (lassoRafRef.current) cancelAnimationFrame(lassoRafRef.current);
      if (paintPreviewRafRef.current) cancelAnimationFrame(paintPreviewRafRef.current);
    },
    [],
  );

  const computePaintHit = useCallback(
    (point: Point) => {
      const state = useEditorStore.getState();
      const testSide = side === "preview" ? "from" : state.editingSide;
      for (let index = state.layers.length - 1; index >= 0; index--) {
        const layer = state.layers[index];
        if (
          !layer.visible ||
          layer.locked ||
          (layer.type !== "path" && layer.type !== "clipPath")
        ) {
          continue;
        }
        const path = testSide === "from" ? layer.from : (layer.to ?? layer.from);
        if (isPointInFillRegion(point, path)) return layer.id;
      }
      return null;
    },
    [side],
  );

  const applyPaint = useCallback(
    (targetId: string | number) => {
      const state = useEditorStore.getState();
      const source =
        state.layers.find((layer) => layer.id === state.selectedLayerId) ?? state.layers[0];
      const target = state.layers.find((layer) => layer.id === targetId);
      if (!target) return;
      state.selectLayer(targetId);
      useEditorStore.getState().updateSelectedLayer({
        fillColor: source?.fillColor || "#000000",
        fillAlpha: source?.fillAlpha ?? 1,
        fillType: source?.fillType || "nonZero",
      });
      toast.success(`Painted ${target.name || "layer"} with ${source?.fillColor || "#000000"}`);
      clearPaintPreview();
    },
    [clearPaintPreview],
  );

  const capturePointer = useCallback(
    (pointerId: number) => {
      try {
        svgRef.current?.setPointerCapture(pointerId);
      } catch {
        // The pointer may have been released before React receives the event.
      }
    },
    [svgRef],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<Element>) => {
      if (event.button === 0) {
        pointerDownPositionRef.current = { x: event.clientX, y: event.clientY };
      }
      const spacePan = useEditorStore.getState().spacePanActive;
      if (event.button === 1 || event.altKey || spacePan) {
        event.preventDefault();
        if (spacePan) (window as { __ssSpacePanUsed?: boolean }).__ssSpacePanUsed = true;
        startPan(event);
        return;
      }

      const point = pointFromClient(event.clientX, event.clientY);
      if (!point) return;
      const state = useEditorStore.getState();
      if (side === "preview" && !isActionMode && event.button === 0) {
        dispatcherRef.current?.handlePointerDown(
          point,
          { type: "marquee" },
          { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey },
        );
        capturePointer(event.pointerId);
        return;
      }
      if (
        (state.toolMode === "select" ||
          state.toolMode === "rotate" ||
          state.toolMode === "transform") &&
        state.editingSide === (side === "from" ? "from" : "to") &&
        event.button === 0
      ) {
        dispatcherRef.current?.handlePointerDown(
          point,
          { type: "marquee" },
          { shift: event.shiftKey, alt: event.altKey, ctrl: event.ctrlKey },
        );
        capturePointer(event.pointerId);
      }
      if (state.toolMode === "paint" && event.button === 0) {
        const hitId = computePaintHit(point);
        if (hitId != null) applyPaint(hitId);
        else toast.info("No fill region under cursor");
        capturePointer(event.pointerId);
      }
    },
    [applyPaint, capturePointer, computePaintHit, isActionMode, pointFromClient, side, startPan],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<Element>) => {
      updatePan(event);
      const point = pointFromClient(event.clientX, event.clientY);
      if (!point) return;
      dispatcherRef.current?.handlePointerMove(point, {
        shift: event.shiftKey,
        alt: event.altKey,
        ctrl: event.ctrlKey,
      });
      const currentTool = useEditorStore.getState().toolMode;
      if (!isPanning && currentTool === "pencil") {
        const points = lassoPointsRef.current;
        if (
          points.length === 0 ||
          Math.hypot(point.x - points.at(-1)!.x, point.y - points.at(-1)!.y) > 0.25
        ) {
          points.push(point);
          if (points.length > 4 && Math.hypot(point.x - points[0].x, point.y - points[0].y) < 1.8) {
            points[points.length - 1] = { ...points[0] };
          }
        }
        if (points.length > 350) points.shift();
        if (!lassoRafRef.current) {
          lassoRafRef.current = requestAnimationFrame(() => {
            setLassoFrame((frame) => (frame + 1) % 10000);
            lassoRafRef.current = null;
          });
        }
      }
      if (!isPanning && currentTool === "paint") {
        const hitId = computePaintHit(point);
        if ((paintHitRef.current?.layerId ?? null) !== hitId) {
          paintHitRef.current = hitId != null ? { layerId: hitId } : null;
          if (!paintPreviewRafRef.current) {
            paintPreviewRafRef.current = requestAnimationFrame(() => {
              paintPreviewRafRef.current = null;
              setPaintPreviewFrame((frame) => (frame + 1) % 10000);
            });
          }
        }
      }
    },
    [computePaintHit, isPanning, pointFromClient, updatePan],
  );

  const commitLasso = useCallback((additive: boolean) => {
    if (lassoPointsRef.current.length < 3) return;
    const state = useEditorStore.getState();
    const layer = state.layers.find((candidate) => candidate.id === state.selectedLayerId);
    const path = layer
      ? state.editingSide === "from"
        ? layer.from
        : (layer.to ?? layer.from)
      : emptyPath();
    const hits = collectPointsInLasso(path, lassoPointsRef.current, {
      tolerance: 0.6,
      sampleCurves: true,
    });
    if (hits.length === 0) {
      if (!additive) state.clearSelection();
      return;
    }
    const selections = hits.map((hit) => ({
      layerId: state.selectedLayerId,
      side: state.editingSide,
      ...hit,
    }));
    const selectionKeys = new Set(selections.map(selectionKey));
    if (!additive) state.clearSelection();
    state.selectMultiplePoints(
      additive
        ? [
            ...state.selectedPoints.filter(
              (selection) => !selectionKeys.has(selectionKey(selection)),
            ),
            ...selections,
          ]
        : selections,
    );
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<Element>) => {
      endPan();
      const point = pointFromClient(event.clientX, event.clientY) ?? { x: 0, y: 0 };
      dispatcherRef.current?.handlePointerUp(point, {
        shift: event.shiftKey,
        alt: event.altKey,
        ctrl: event.ctrlKey,
      });
      if (svgRef.current?.hasPointerCapture(event.pointerId)) {
        svgRef.current.releasePointerCapture(event.pointerId);
      }
      if (useEditorStore.getState().toolMode === "pencil") commitLasso(event.shiftKey);
      if (lassoRafRef.current) cancelAnimationFrame(lassoRafRef.current);
      lassoRafRef.current = null;
      lassoPointsRef.current = [];
      setLassoFrame(0);
      if (useEditorStore.getState().toolMode === "paint") clearPaintPreview();
    },
    [clearPaintPreview, commitLasso, endPan, pointFromClient, svgRef],
  );

  return {
    marquee,
    lassoPointsRef,
    paintHitRef,
    pointerDownPositionRef,
    paintCursor,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}

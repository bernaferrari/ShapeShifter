"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import type { Viewport } from "@/lib/pathshift/camera";
import { scalePathToBounds, translatePathPoints } from "@/lib/pathshift/pathUtils";
import { evaluateAndroidScene } from "@/lib/pathshift/scene/evaluate";
import { beginLiveGesture, endLiveGesture, ownsLiveGesture } from "@/lib/store/liveGesture";
import type { Layer, Point, Selection } from "@/lib/pathshift/types";
import {
  useEditorStore,
  type SegmentSelection,
  type SubPathSelection,
} from "@/lib/store/editorStore";
import {
  getAngle,
  getBoundsCenter,
  getBoundsFromResizeHandle,
  getPathBounds,
  makeWorldToLocal,
  type Bounds,
  type ResizeHandle,
  type SegmentTarget,
} from "./pathCanvasGeometry";
import { isEditorShortcutBlocked } from "../hooks/useEditorKeyboardShortcuts";

type PathCanvasSide = "from" | "to" | "preview";
type PointFromClient = (clientX: number, clientY: number) => Point | null;

interface PathCanvasEditingOptions {
  side: PathCanvasSide;
  svgRef: RefObject<SVGSVGElement | null>;
  view: Viewport;
  pointFromClient: PointFromClient;
  pointerDownPositionRef: RefObject<Point | null>;
  /** Selected layer, if it still exists. Null after deletion mid-gesture. */
  currentLayer: Layer | null;
  selectedLayerId: string | number;
  editingSide: "from" | "to";
  selectedPoints: Selection[];
  selection: Selection | null;
  selectedLayerSubPaths: SubPathSelection[];
  isEditingThisSide: boolean;
  isActionMode: boolean;
  snapToGrid: boolean;
  selectedLayerBounds: Bounds | null;
  selectedPreviewTransform?: string;
}

function useWindowPointerDrag() {
  const cleanupRef = useRef<(() => void) | null>(null);

  const end = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  }, []);

  const start = useCallback(
    (onMove: (event: PointerEvent) => void, onEnd?: () => void, onCancel?: () => void) => {
      end();
      const finish = (cancelled: boolean) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", release);
        window.removeEventListener("pointercancel", cancel);
        window.removeEventListener("keydown", keyDown);
        cleanupRef.current = null;
        if (cancelled && onCancel) onCancel();
        else onEnd?.();
      };
      const release = () => finish(false);
      const cancel = () => finish(true);
      const keyDown = (event: KeyboardEvent) => {
        if (onCancel && event.key === "Escape" && !isEditorShortcutBlocked(event)) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        }
      };
      cleanupRef.current = cancel;
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", release);
      window.addEventListener("pointercancel", cancel);
      if (onCancel) window.addEventListener("keydown", keyDown);
    },
    [end],
  );

  useEffect(() => end, [end]);
  return start;
}

const capturePointer = (element: Element, pointerId: number) => {
  try {
    element.setPointerCapture(pointerId);
  } catch {
    // The pointer may have been released before React receives the event.
  }
};

const snapHalf = (value: number) => Math.round(value * 2) / 2;

export function usePathCanvasEditing({
  side,
  svgRef,
  view,
  pointFromClient,
  pointerDownPositionRef,
  currentLayer,
  selectedLayerId,
  editingSide,
  selectedPoints,
  selection,
  selectedLayerSubPaths,
  isEditingThisSide,
  isActionMode,
  snapToGrid,
  selectedLayerBounds,
  selectedPreviewTransform,
}: PathCanvasEditingOptions) {
  const beginWindowDrag = useWindowPointerDrag();
  const [isVectorEditing, setIsVectorEditing] = useState(false);
  const isEditingSubPaths = selectedLayerSubPaths.length > 0;
  const canEditPoints =
    isEditingThisSide ||
    (side === "preview" && (isVectorEditing || isEditingSubPaths) && !isActionMode);

  useEffect(() => {
    if (side !== "preview" || isActionMode) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditorShortcutBlocked(event)) return;
      if (event.key === "Escape") {
        if (useEditorStore.getState().selectedSubPaths.length > 0) {
          event.preventDefault();
          useEditorStore.getState().selectSubPath(null);
        } else {
          setIsVectorEditing(false);
        }
      } else if (event.key === "Enter") {
        event.preventDefault();
        setIsVectorEditing((editing) => !editing);
        useEditorStore.getState().setEditingSide("from");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isActionMode, side]);

  const onPointPointerDown = useCallback(
    (
      event: ReactPointerEvent<Element>,
      subPathIndex: number,
      commandIndex: number,
      pointIndex: number,
    ) => {
      if (!canEditPoints || event.button !== 0) return;
      event.stopPropagation();
      const store = useEditorStore.getState();
      const layer = store.layers.find((item) => String(item.id) === String(selectedLayerId));
      const editSide = side === "preview" ? "from" : editingSide;
      const path = editSide === "from" ? layer?.from : layer?.to;
      const origin = path?.subPaths[subPathIndex]?.commands[commandIndex]?.points[pointIndex];
      if (
        !layer ||
        !path ||
        !origin ||
        layer.locked ||
        evaluateAndroidScene(store.layers, store.animation, store.progress, true).nodesById.get(
          String(layer.id),
        )?.locked
      )
        return;
      capturePointer(event.currentTarget, event.pointerId);
      if (side === "preview") store.setEditingSide("from");
      const clicked = {
        layerId: selectedLayerId,
        side: editSide,
        subPathIndex,
        commandIndex,
        pointIndex,
      };
      const samePoint = (point: Selection) =>
        String(point.layerId) === String(selectedLayerId) &&
        point.side === editSide &&
        point.subPathIndex === subPathIndex &&
        point.commandIndex === commandIndex &&
        point.pointIndex === pointIndex;
      if (event.shiftKey || !store.selectedPoints.some(samePoint))
        store.selectPoint(clicked, event.shiftKey);
      const points = useEditorStore
        .getState()
        .selectedPoints.filter(
          (point) => String(point.layerId) === String(selectedLayerId) && point.side === editSide,
        );
      if (!points.some(samePoint)) return;
      const marker = beginLiveGesture("detail-anchor", origin);
      const ownerId = store.selectedFrameId;
      let history = useEditorStore.getState().history;
      let moved = false;
      let lastX = event.clientX;
      let lastY = event.clientY;
      const toLocal =
        side === "preview" ? makeWorldToLocal(selectedPreviewTransform) : (point: Point) => point;
      const valid = () => {
        const state = useEditorStore.getState();
        return (
          ownsLiveGesture(marker) &&
          state.selectedFrameId === ownerId &&
          String(state.selectedLayerId) === String(selectedLayerId) &&
          state.editingSide === editSide &&
          state.history === history &&
          !state.layers.find((item) => String(item.id) === String(selectedLayerId))?.locked
        );
      };
      beginWindowDrag(
        (moveEvent) => {
          if (!valid()) return;
          const point = pointFromClient(moveEvent.clientX, moveEvent.clientY);
          if (!point) return;
          const bounds = svgRef.current?.getBoundingClientRect();
          const dx = (moveEvent.clientX - lastX) * (bounds ? view.w / bounds.width : 1);
          const dy = (moveEvent.clientY - lastY) * (bounds ? view.h / bounds.height : 1);
          lastX = moveEvent.clientX;
          lastY = moveEvent.clientY;
          const liveStore = useEditorStore.getState();
          const delta = snapToGrid ? { x: snapHalf(dx), y: snapHalf(dy) } : { x: dx, y: dy };
          const raw = toLocal(point);
          const local = snapToGrid ? { x: snapHalf(raw.x), y: snapHalf(raw.y) } : raw;
          const offset = { x: local.x - origin.x, y: local.y - origin.y };
          if (!moved && !offset.x && !offset.y) return;
          if (!moved) {
            liveStore.pushHistory();
            history = useEditorStore.getState().history;
            moved = true;
          }
          if (
            points.length === 1 &&
            liveStore.toolMode === "direct" &&
            moveEvent.ctrlKey &&
            (dx !== 0 || dy !== 0)
          ) {
            liveStore.flexSelectedLayerSegment(
              {
                layerId: selectedLayerId,
                side: editSide,
                subPathIndex,
                commandIndex,
              },
              delta,
              pointIndex === 0 ? 0.33 : pointIndex === 1 ? 0.66 : 0.5,
              { recordHistory: false },
            );
          } else {
            const updated = translatePathPoints(path, points, offset.x, offset.y);
            liveStore.updateSelectedLayer(
              editSide === "from" ? { from: updated, pathData: updated } : { to: updated },
              { recordHistory: false },
            );
          }
        },
        () => endLiveGesture(marker),
        () => {
          if (moved && valid()) useEditorStore.getState().cancelLastHistoryTransaction();
          endLiveGesture(marker);
        },
      );
    },
    [
      beginWindowDrag,
      canEditPoints,
      editingSide,
      pointFromClient,
      selectedLayerId,
      side,
      snapToGrid,
      svgRef,
      view.h,
      view.w,
      selectedPreviewTransform,
    ],
  );

  const onCanvasClick = useCallback(
    (event: ReactMouseEvent<SVGSVGElement>) => {
      if (side === "preview") return;
      const store = useEditorStore.getState();
      if (!isEditingThisSide) {
        store.setEditingSide(side);
        return;
      }
      if ((event.target as Element | null)?.closest?.("[data-point],[data-segment]")) return;
      const down = pointerDownPositionRef.current;
      if (down && Math.hypot(event.clientX - down.x, event.clientY - down.y) > 3) return;
      const point = pointFromClient(event.clientX, event.clientY);
      if (point) store.addPointOnPath(point.x, point.y);
    },
    [isEditingThisSide, pointFromClient, pointerDownPositionRef, side],
  );

  const onPreviewPathPointerDown = useCallback(
    (event: ReactPointerEvent<SVGPathElement>, layerId = selectedLayerId) => {
      if (side !== "preview" || isActionMode || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      capturePointer(event.currentTarget, event.pointerId);
      const store = useEditorStore.getState();
      store.selectLayer(layerId);
      store.setEditingSide("from");
      store.pushHistory();
      let lastX = event.clientX;
      let lastY = event.clientY;
      beginWindowDrag((moveEvent) => {
        const bounds = svgRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const dx = ((moveEvent.clientX - lastX) / bounds.width) * view.w;
        const dy = ((moveEvent.clientY - lastY) / bounds.height) * view.h;
        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;
        useEditorStore.getState().translateSelectedLayer(dx, dy, { recordHistory: false });
      });
    },
    [beginWindowDrag, isActionMode, selectedLayerId, side, svgRef, view.h, view.w],
  );

  const onPreviewSubPathPointerDown = useCallback(
    (event: ReactPointerEvent<SVGPathElement>, subPathIndex: number) => {
      if (side !== "preview" || isActionMode || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      capturePointer(event.currentTarget, event.pointerId);
      const store = useEditorStore.getState();
      const subPathSelection: SubPathSelection = {
        layerId: selectedLayerId,
        side: "from",
        subPathIndex,
      };
      const additive = event.shiftKey || event.metaKey;
      const alreadySelected = selectedLayerSubPaths.some(
        (item) => item.subPathIndex === subPathIndex,
      );
      if (additive || !alreadySelected) store.selectSubPath(subPathSelection, additive);
      store.setEditingSide("from");
      store.pushHistory();
      let lastX = event.clientX;
      let lastY = event.clientY;
      beginWindowDrag((moveEvent) => {
        const bounds = svgRef.current?.getBoundingClientRect();
        if (!bounds) return;
        let dx = ((moveEvent.clientX - lastX) / bounds.width) * view.w;
        let dy = ((moveEvent.clientY - lastY) / bounds.height) * view.h;
        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;
        if (snapToGrid) {
          dx = snapHalf(dx);
          dy = snapHalf(dy);
        }
        if (dx || dy) {
          useEditorStore.getState().translateSelectedSubPaths(dx, dy, { recordHistory: false });
        }
      });
    },
    [
      beginWindowDrag,
      isActionMode,
      selectedLayerId,
      selectedLayerSubPaths,
      side,
      snapToGrid,
      svgRef,
      view.h,
      view.w,
    ],
  );

  const onSegmentPointerDown = useCallback(
    (event: ReactPointerEvent<SVGPathElement>, segment: SegmentTarget) => {
      if (isActionMode || event.button !== 0) return;
      if (side === "preview" && !isVectorEditing && !isEditingSubPaths) return;
      const store = useEditorStore.getState();
      if (side === "preview") store.setEditingSide("from");
      else if (!isEditingThisSide) store.setEditingSide(side);
      event.preventDefault();
      event.stopPropagation();
      capturePointer(event.currentTarget, event.pointerId);
      const segmentSelection: SegmentSelection = {
        layerId: selectedLayerId,
        side: side === "preview" ? "from" : editingSide,
        subPathIndex: segment.subPathIndex,
        commandIndex: segment.commandIndex,
      };
      store.pushHistory();
      let lastX = event.clientX;
      let lastY = event.clientY;
      beginWindowDrag((moveEvent) => {
        const point = pointFromClient(moveEvent.clientX, moveEvent.clientY);
        if (!point) return;
        const liveStore = useEditorStore.getState();
        if (liveStore.toolMode === "direct" && moveEvent.ctrlKey) {
          const bounds = svgRef.current?.getBoundingClientRect();
          const dx = (moveEvent.clientX - lastX) * (bounds ? view.w / bounds.width : 1);
          const dy = (moveEvent.clientY - lastY) * (bounds ? view.h / bounds.height : 1);
          lastX = moveEvent.clientX;
          lastY = moveEvent.clientY;
          if (dx || dy) {
            liveStore.flexSelectedLayerSegment(
              segmentSelection,
              snapToGrid ? { x: snapHalf(dx), y: snapHalf(dy) } : { x: dx, y: dy },
              0.5,
              { recordHistory: false },
            );
          }
        } else {
          liveStore.bendSelectedLayerSegment(
            segmentSelection,
            snapToGrid ? { x: snapHalf(point.x), y: snapHalf(point.y) } : point,
            { recordHistory: false },
          );
        }
      });
    },
    [
      beginWindowDrag,
      editingSide,
      isActionMode,
      isEditingSubPaths,
      isEditingThisSide,
      isVectorEditing,
      pointFromClient,
      selectedLayerId,
      side,
      snapToGrid,
      svgRef,
      view.h,
      view.w,
    ],
  );

  const onSegmentMidpointPointerDown = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>, segment: SegmentTarget) => {
      if (isActionMode || event.button !== 0) return;
      if (side === "preview" && !isVectorEditing && !isEditingSubPaths) return;
      event.preventDefault();
      event.stopPropagation();
      const store = useEditorStore.getState();
      store.splitSelectedLayerSegment({
        layerId: selectedLayerId,
        side: side === "preview" ? "from" : editingSide,
        subPathIndex: segment.subPathIndex,
        commandIndex: segment.commandIndex,
      });
      if (side === "preview") {
        store.setEditingSide("from");
        setIsVectorEditing(true);
      }
    },
    [editingSide, isActionMode, isEditingSubPaths, isVectorEditing, selectedLayerId, side],
  );

  const onPreviewPathDoubleClick = useCallback(
    (event: ReactMouseEvent<SVGPathElement>, layerId: string | number) => {
      if (side !== "preview" || isActionMode) return;
      event.preventDefault();
      event.stopPropagation();
      const store = useEditorStore.getState();
      store.selectLayer(layerId);
      store.setEditingSide("from");
      setIsVectorEditing(true);
    },
    [isActionMode, side],
  );

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<SVGElement>, handle: ResizeHandle) => {
      if (side !== "preview" || isActionMode || !selectedLayerBounds || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      capturePointer(event.currentTarget, event.pointerId);
      useEditorStore.getState().pushHistory();
      const layer = useEditorStore.getState().layers.find((item) => item.id === selectedLayerId);
      if (!layer) return;
      const originalFrom = structuredClone(layer.from);
      const originalTo = layer.to ? structuredClone(layer.to) : null;
      const originalBounds = getPathBounds(originalFrom) ?? selectedLayerBounds;
      const originalToBounds = originalTo ? (getPathBounds(originalTo) ?? originalBounds) : null;
      const toLocal = makeWorldToLocal(selectedPreviewTransform);
      beginWindowDrag((moveEvent) => {
        const point = pointFromClient(moveEvent.clientX, moveEvent.clientY);
        if (!point) return;
        const nextBounds = getBoundsFromResizeHandle(
          originalBounds,
          handle,
          toLocal(point),
          moveEvent.shiftKey,
        );
        const from = scalePathToBounds(originalFrom, originalBounds, nextBounds);
        const patch: Partial<Layer> = { from, pathData: from };
        if (originalTo && originalToBounds) {
          patch.to = scalePathToBounds(originalTo, originalToBounds, nextBounds);
        }
        useEditorStore.getState().updateSelectedLayer(patch, { recordHistory: false });
      });
    },
    [
      beginWindowDrag,
      isActionMode,
      pointFromClient,
      selectedLayerBounds,
      selectedLayerId,
      selectedPreviewTransform,
      side,
    ],
  );

  const onRotatePointerDown = useCallback(
    (event: ReactPointerEvent<SVGCircleElement>) => {
      if (side !== "preview" || isActionMode || !selectedLayerBounds || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      capturePointer(event.currentTarget, event.pointerId);
      const store = useEditorStore.getState();
      store.pushHistory();
      const center = getBoundsCenter(selectedLayerBounds);
      const baseRotation = currentLayer?.rotation ?? 0;
      const toLocal = makeWorldToLocal(selectedPreviewTransform);
      const startPoint = pointFromClient(event.clientX, event.clientY);
      const startAngle = startPoint ? getAngle(center, toLocal(startPoint)) : 0;
      store.updateSelectedLayer(
        { pivotX: center.x, pivotY: center.y, rotation: baseRotation },
        { recordHistory: false },
      );
      beginWindowDrag((moveEvent) => {
        const point = pointFromClient(moveEvent.clientX, moveEvent.clientY);
        if (!point) return;
        const rawRotation = baseRotation + getAngle(center, toLocal(point)) - startAngle;
        useEditorStore.getState().updateSelectedLayer(
          {
            pivotX: center.x,
            pivotY: center.y,
            rotation: moveEvent.shiftKey ? Math.round(rawRotation / 15) * 15 : rawRotation,
          },
          { recordHistory: false },
        );
      });
    },
    [
      beginWindowDrag,
      currentLayer?.rotation,
      isActionMode,
      pointFromClient,
      selectedLayerBounds,
      selectedPreviewTransform,
      side,
    ],
  );

  const onCanvasDoubleClick = useCallback(() => {
    if (side === "preview" && isVectorEditing) setIsVectorEditing(false);
  }, [isVectorEditing, side]);

  const isPointSelected = useCallback(
    (subPathIndex: number, commandIndex: number, pointIndex: number) => {
      if (selectedPoints.length > 0) {
        return selectedPoints.some(
          (item) =>
            item.subPathIndex === subPathIndex &&
            item.commandIndex === commandIndex &&
            item.pointIndex === pointIndex &&
            item.layerId === selectedLayerId &&
            item.side === editingSide,
        );
      }
      return (
        selection?.subPathIndex === subPathIndex &&
        selection.commandIndex === commandIndex &&
        selection.pointIndex === pointIndex
      );
    },
    [editingSide, selectedLayerId, selectedPoints, selection],
  );

  return {
    isVectorEditing,
    canEditPoints,
    isEditingSubPaths,
    onPointPointerDown,
    onCanvasClick,
    onPreviewPathPointerDown,
    onPreviewSubPathPointerDown,
    onSegmentPointerDown,
    onSegmentMidpointPointerDown,
    onPreviewPathDoubleClick,
    onResizePointerDown,
    onRotatePointerDown,
    onCanvasDoubleClick,
    isPointSelected,
  };
}

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject, WheelEvent as ReactWheelEvent } from "react";
import {
  clientToWorld,
  computeFitViewport,
  fitViewportToAspect,
  zoomAtWorldPoint,
  type Rect,
  type Viewport,
} from "@/lib/shapeshifter/camera";
import { PAGE_ROOT_ID, useEditorStore, type CanvasFrame } from "@/lib/store/editorStore";
import { vectorCoordinateRect } from "@/lib/shapeshifter/vectorSpace";

export const getCanvasFrameBounds = (frame: CanvasFrame): Rect => ({
  x: frame.x || 0,
  y: frame.y || 0,
  ...vectorCoordinateRect(frame.vector, 48),
});

export function useWorldCamera({
  svgRef,
  isActionMode,
  frames,
  selectedFrameId,
  selectedFrameIds,
  selectionKind,
  selectionBounds,
  viewport,
  onViewportChange,
  onFitFrames,
  onBringFrameIntoView,
}: {
  svgRef: RefObject<SVGSVGElement | null>;
  isActionMode: boolean;
  frames: CanvasFrame[];
  selectedFrameId: string;
  selectedFrameIds: string[];
  selectionKind: "none" | "frame" | "layer";
  selectionBounds: Rect | null;
  viewport: Viewport;
  onViewportChange: (viewport: Partial<Viewport>) => void;
  onFitFrames: (frameIds?: string[]) => void;
  onBringFrameIntoView: (frameId: string, options?: { animate?: boolean }) => void;
}) {
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });
  const view = useMemo(
    () =>
      fitViewportToAspect(
        viewport,
        viewportSize.w > 0 && viewportSize.h > 0 ? viewportSize.w / viewportSize.h : 1,
      ),
    [viewport, viewportSize],
  );
  const worldPerPixel = viewportSize.w > 0 ? view.w / viewportSize.w : 1;

  const setView = useCallback(
    (next: Viewport | ((previous: Viewport) => Viewport)) => {
      const resolved =
        typeof next === "function" ? next(useEditorStore.getState().worldViewport) : next;
      onViewportChange(resolved);
    },
    [onViewportChange],
  );

  const worldPointFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const bounds = svgRef.current?.getBoundingClientRect();
      return bounds ? clientToWorld(clientX, clientY, bounds, view) : null;
    },
    [svgRef, view],
  );

  const frameIdsSignature = useMemo(() => frames.map((frame) => frame.id).join("|"), [frames]);
  const previousDocumentRef = useRef<{
    frameIdsSignature: string;
    selectedFrameId: string | null;
  } | null>(null);

  useEffect(() => {
    const previous = previousDocumentRef.current;
    previousDocumentRef.current = { frameIdsSignature, selectedFrameId };
    if (!frames.length || !previous) return;
    if (previous.frameIdsSignature !== frameIdsSignature) {
      onFitFrames();
    } else if (selectedFrameId !== previous.selectedFrameId && selectionKind !== "layer") {
      onBringFrameIntoView(selectedFrameId, { animate: true });
    }
  }, [
    frameIdsSignature,
    frames.length,
    onBringFrameIntoView,
    onFitFrames,
    selectedFrameId,
    selectionKind,
  ]);

  useEffect(() => {
    const element = svgRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const bounds = entries[0]?.contentRect;
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        setViewportSize({ w: bounds.width, h: bounds.height });
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [isActionMode, svgRef]);

  const visibleFrames = useMemo(
    () =>
      frames.filter((frame) => {
        const bounds = getCanvasFrameBounds(frame);
        return !(
          bounds.x + bounds.w < view.x ||
          bounds.x > view.x + view.w ||
          bounds.y + bounds.h < view.y ||
          bounds.y > view.y + view.h
        );
      }),
    [frames, view],
  );

  const onWheel = useCallback(
    (event: ReactWheelEvent<SVGSVGElement>) => {
      event.preventDefault();
      if (event.ctrlKey || event.metaKey) {
        const point = worldPointFromClient(event.clientX, event.clientY);
        if (!point) return;
        const delta = Math.max(-100, Math.min(100, event.deltaY));
        const factor = Math.exp(-delta * 0.0015);
        setView(zoomAtWorldPoint(view, point, view.scale * factor, 0.05, 20));
        return;
      }
      const deltaX = event.shiftKey ? event.deltaY : event.deltaX;
      const deltaY = event.shiftKey ? 0 : event.deltaY;
      setView((current) => ({
        ...current,
        x: current.x + deltaX * worldPerPixel,
        y: current.y + deltaY * worldPerPixel,
      }));
    },
    [setView, view, worldPerPixel, worldPointFromClient],
  );

  const zoomAtCenter = useCallback(
    (factor: number) => {
      const center = { x: view.x + view.w / 2, y: view.y + view.h / 2 };
      setView(zoomAtWorldPoint(view, center, view.scale * factor, 0.05, 20));
    },
    [setView, view],
  );

  const fitToSelection = useCallback(() => {
    if (selectionKind === "layer" && selectionBounds) {
      const fitted = fitViewportToAspect(
        computeFitViewport([selectionBounds], {
          minPadding: Math.max(1, Math.min(selectionBounds.w, selectionBounds.h) * 0.2),
          maxScale: 20,
        }),
        view.w / view.h,
      );
      const multiplier = Math.min(view.w / fitted.w, view.h / fitted.h);
      setView({
        ...fitted,
        scale: Math.max(0.05, Math.min(20, view.scale * multiplier)),
      });
      return;
    }
    const frameIds = selectedFrameIds.length
      ? selectedFrameIds
      : selectedFrameId !== PAGE_ROOT_ID
        ? [selectedFrameId]
        : [];
    onFitFrames(frameIds.length ? frameIds : undefined);
  }, [
    onFitFrames,
    selectedFrameId,
    selectedFrameIds,
    selectionBounds,
    selectionKind,
    setView,
    view,
  ]);

  return {
    viewportSize,
    view,
    setView,
    worldPerPixel,
    worldPointFromClient,
    visibleFrames,
    onWheel,
    zoomAtCenter,
    fitToSelection,
  };
}

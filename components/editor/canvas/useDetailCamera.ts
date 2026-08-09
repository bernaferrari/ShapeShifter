"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject, WheelEvent } from "react";
import { fitViewportToAspect, zoomAtWorldPoint } from "@/lib/shapeshifter/camera";
import type { EditorState } from "@/lib/store/editorStore";

interface DetailCameraOptions {
  svgRef: RefObject<SVGSVGElement | null>;
  viewport: EditorState["detailViewport"];
  onViewportChange: EditorState["setDetailViewport"];
  onReset: (scale?: number) => void;
  resetKey?: number;
}

export function useDetailCamera({
  svgRef,
  viewport,
  onViewportChange,
  onReset,
  resetKey,
}: DetailCameraOptions) {
  const [elementAspect, setElementAspect] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [lastPan, setLastPan] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const element = svgRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const bounds = entries[0]?.contentRect;
      if (bounds && bounds.width > 0 && bounds.height > 0) {
        setElementAspect(bounds.width / bounds.height);
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [svgRef]);

  useEffect(() => {
    onReset(1);
  }, [onReset, resetKey]);

  const view = useMemo(
    () => fitViewportToAspect(viewport, elementAspect),
    [elementAspect, viewport],
  );

  const pointFromClient = useCallback(
    (clientX: number, clientY: number) => {
      const bounds = svgRef.current?.getBoundingClientRect();
      if (!bounds) return null;
      return {
        x: view.x + ((clientX - bounds.left) / bounds.width) * view.w,
        y: view.y + ((clientY - bounds.top) / bounds.height) * view.h,
      };
    },
    [svgRef, view],
  );

  const onWheel = useCallback(
    (event: WheelEvent<SVGSVGElement>) => {
      event.preventDefault();
      const bounds = svgRef.current?.getBoundingClientRect();
      if (!bounds) return;
      if (event.ctrlKey || event.metaKey) {
        const delta = Math.max(-100, Math.min(100, event.deltaY));
        const factor = Math.exp(-delta * 0.0015);
        onViewportChange((current) => {
          const liveView = fitViewportToAspect(current, elementAspect);
          const liveBounds = svgRef.current?.getBoundingClientRect();
          if (!liveBounds) return current;
          const mouse = {
            x: liveView.x + ((event.clientX - liveBounds.left) / liveBounds.width) * liveView.w,
            y: liveView.y + ((event.clientY - liveBounds.top) / liveBounds.height) * liveView.h,
          };
          return zoomAtWorldPoint(liveView, mouse, liveView.scale * factor, 0.25, 8);
        });
        return;
      }
      const worldPerPixelX = view.w / bounds.width;
      const worldPerPixelY = view.h / bounds.height;
      const deltaX = event.shiftKey ? event.deltaY : event.deltaX;
      const deltaY = event.shiftKey ? 0 : event.deltaY;
      onViewportChange((current) => ({
        ...current,
        x: current.x + deltaX * worldPerPixelX,
        y: current.y + deltaY * worldPerPixelY,
      }));
    },
    [elementAspect, onViewportChange, svgRef, view],
  );

  const startPan = useCallback(
    (event: ReactPointerEvent<Element>) => {
      setIsPanning(true);
      setLastPan({ x: event.clientX, y: event.clientY });
      try {
        svgRef.current?.setPointerCapture(event.pointerId);
      } catch {
        // The pointer may have been released before React receives the event.
      }
    },
    [svgRef],
  );

  const updatePan = useCallback(
    (event: ReactPointerEvent<Element>) => {
      if (!isPanning) return false;
      const bounds = svgRef.current?.getBoundingClientRect();
      if (!bounds) return true;
      const dx = ((event.clientX - lastPan.x) / bounds.width) * view.w;
      const dy = ((event.clientY - lastPan.y) / bounds.height) * view.h;
      onViewportChange((current) => ({ ...current, x: current.x - dx, y: current.y - dy }));
      setLastPan({ x: event.clientX, y: event.clientY });
      return true;
    },
    [isPanning, lastPan, onViewportChange, svgRef, view.h, view.w],
  );

  const endPan = useCallback(() => setIsPanning(false), []);

  return {
    view,
    pointFromClient,
    onWheel,
    isPanning,
    startPan,
    updatePan,
    endPan,
  };
}

"use client";

import { useCallback, useRef, useState, type RefObject } from "react";
import type { Viewport } from "@/lib/pathshift/camera";

interface WorldPanOptions {
  svgRef: RefObject<SVGSVGElement | null>;
  view: Viewport;
  setView: (next: Viewport | ((previous: Viewport) => Viewport)) => void;
}

export function useWorldPan({ svgRef, view, setView }: WorldPanOptions) {
  const [active, setActive] = useState(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const start = useCallback(
    (clientX: number, clientY: number, pointerId: number) => {
      setActive(true);
      lastPoint.current = { x: clientX, y: clientY };
      try {
        svgRef.current?.setPointerCapture(pointerId);
      } catch {
        // Pointer movement still arrives through the SVG handlers without capture.
      }
    },
    [svgRef],
  );

  const update = useCallback(
    (clientX: number, clientY: number) => {
      const previous = lastPoint.current;
      if (!previous) return false;
      const bounds = svgRef.current?.getBoundingClientRect();
      if (!bounds?.width || !bounds.height) return true;
      const deltaX = ((clientX - previous.x) / bounds.width) * view.w;
      const deltaY = ((clientY - previous.y) / bounds.height) * view.h;
      setView((current) => ({ ...current, x: current.x - deltaX, y: current.y - deltaY }));
      lastPoint.current = { x: clientX, y: clientY };
      return true;
    },
    [setView, svgRef, view.h, view.w],
  );

  const finish = useCallback(() => {
    lastPoint.current = null;
    setActive(false);
  }, []);
  return { active, start, update, finish, cancel: finish };
}

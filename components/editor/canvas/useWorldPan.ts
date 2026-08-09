"use client";

import { useCallback, useState, type RefObject } from "react";
import type { Viewport } from "@/lib/shapeshifter/camera";

interface WorldPanOptions {
  svgRef: RefObject<SVGSVGElement | null>;
  view: Viewport;
  setView: (next: Viewport | ((previous: Viewport) => Viewport)) => void;
}

export function useWorldPan({ svgRef, view, setView }: WorldPanOptions) {
  const [active, setActive] = useState(false);
  const [lastPoint, setLastPoint] = useState({ x: 0, y: 0 });

  const start = useCallback(
    (clientX: number, clientY: number, pointerId: number) => {
      setActive(true);
      setLastPoint({ x: clientX, y: clientY });
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
      if (!active) return false;
      const bounds = svgRef.current?.getBoundingClientRect();
      if (!bounds) return true;
      const deltaX = ((clientX - lastPoint.x) / bounds.width) * view.w;
      const deltaY = ((clientY - lastPoint.y) / bounds.height) * view.h;
      setView((current) => ({ ...current, x: current.x - deltaX, y: current.y - deltaY }));
      setLastPoint({ x: clientX, y: clientY });
      return true;
    },
    [active, lastPoint.x, lastPoint.y, setView, svgRef, view.h, view.w],
  );

  const finish = useCallback(() => setActive(false), []);
  return { active, start, update, finish, cancel: finish };
}

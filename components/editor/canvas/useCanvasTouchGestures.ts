"use client";

import React from "react";
import { useTouchViewportGestures } from "../hooks/useTouchViewportGestures";

/** Canvas camera adapter for the shared pinch and pan gesture ownership. */
export function useCanvasTouchGestures({
  svgRef,
  ...options
}: Omit<Parameters<typeof useTouchViewportGestures>[0], "elementRef"> & {
  svgRef: React.RefObject<SVGSVGElement | null>;
}) {
  return useTouchViewportGestures({ ...options, elementRef: svgRef });
}

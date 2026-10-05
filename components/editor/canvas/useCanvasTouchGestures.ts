"use client";

import React from "react";
import { clientToWorld, zoomAtWorldPoint, type Viewport } from "@/lib/shapeshifter/camera";

type PointerHandler = (event: React.PointerEvent<SVGSVGElement>) => void;

interface Handlers {
  onPointerDown: PointerHandler;
  onPointerMove: PointerHandler;
  onPointerUp: PointerHandler;
  onPointerCancel: PointerHandler;
}

interface Pinch {
  /** Camera when the second finger landed. */
  view: Viewport;
  /** Finger midpoint (world units, in the starting camera) and spread (px). */
  anchor: { x: number; y: number };
  distance: number;
}

/**
 * Touch: one finger edits like the mouse, two fingers pan and pinch-zoom the
 * camera (and cancel whatever the first finger started), like Figma on iPad.
 */
export function useCanvasTouchGestures({
  svgRef,
  view,
  setView,
  handlers,
}: {
  svgRef: React.RefObject<SVGSVGElement | null>;
  view: Viewport;
  setView: (view: Viewport) => void;
  handlers: Handlers;
}): Handlers {
  const touches = React.useRef(new Map<number, { x: number; y: number }>());
  const pinch = React.useRef<Pinch | null>(null);
  /** Once two fingers were down, ignore the rest of the touch sequence for editing. */
  const suppress = React.useRef(false);
  const viewRef = React.useRef(view);
  viewRef.current = view;

  const midpointAndDistance = () => {
    const [a, b] = [...touches.current.values()];
    return {
      x: (a!.x + b!.x) / 2,
      y: (a!.y + b!.y) / 2,
      distance: Math.max(1, Math.hypot(a!.x - b!.x, a!.y - b!.y)),
    };
  };

  const startPinch = () => {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const { x, y, distance } = midpointAndDistance();
    pinch.current = {
      view: viewRef.current,
      anchor: clientToWorld(x, y, bounds, viewRef.current),
      distance,
    };
  };

  const updatePinch = () => {
    const start = pinch.current;
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!start || !bounds) return;
    const { x, y, distance } = midpointAndDistance();
    const zoomed = zoomAtWorldPoint(
      start.view,
      start.anchor,
      start.view.scale * (distance / start.distance),
      0.05,
      20,
    );
    // Keep the world point that started under the fingers under their midpoint.
    const under = clientToWorld(x, y, bounds, zoomed);
    setView({
      ...zoomed,
      x: zoomed.x + start.anchor.x - under.x,
      y: zoomed.y + start.anchor.y - under.y,
    });
  };

  const release = (event: React.PointerEvent<SVGSVGElement>) => {
    touches.current.delete(event.pointerId);
    if (touches.current.size < 2) pinch.current = null;
    if (touches.current.size === 0) suppress.current = false;
  };

  return {
    onPointerDown: (event) => {
      if (event.pointerType !== "touch") return handlers.onPointerDown(event);
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.current.size === 2) {
        if (!suppress.current) handlers.onPointerCancel(event);
        suppress.current = true;
        startPinch();
        return;
      }
      if (!suppress.current) handlers.onPointerDown(event);
    },
    onPointerMove: (event) => {
      if (event.pointerType !== "touch" || !touches.current.has(event.pointerId))
        return handlers.onPointerMove(event);
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pinch.current) return updatePinch();
      if (!suppress.current) handlers.onPointerMove(event);
    },
    onPointerUp: (event) => {
      const suppressed = event.pointerType === "touch" && suppress.current;
      if (event.pointerType === "touch") release(event);
      if (!suppressed) handlers.onPointerUp(event);
    },
    onPointerCancel: (event) => {
      const suppressed = event.pointerType === "touch" && suppress.current;
      if (event.pointerType === "touch") release(event);
      if (!suppressed) handlers.onPointerCancel(event);
    },
  };
}

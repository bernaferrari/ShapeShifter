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
interface Touch {
  x: number;
  y: number;
  event: React.PointerEvent<SVGSVGElement>;
}
interface Pinch {
  ids: number[];
  view: Viewport;
  anchor: { x: number; y: number };
  distance: number;
}

/** One finger edits; two fingers own the camera until the whole sequence ends. */
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
}): Handlers & {
  onPointerDownCapture: PointerHandler;
  onPointerMoveCapture: PointerHandler;
  onPointerUpCapture: PointerHandler;
  onLostPointerCapture: PointerHandler;
} {
  const touches = React.useRef(new Map<number, Touch>());
  const pinch = React.useRef<Pinch | null>(null);
  const suppress = React.useRef(false);
  const viewRef = React.useRef(view);
  viewRef.current = view;

  const measure = () => {
    const [first, second] = [...touches.current.entries()];
    if (!first || !second) return null;
    const [aId, a] = first;
    const [bId, b] = second;
    return {
      ids: [aId, bId],
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      distance: Math.hypot(a.x - b.x, a.y - b.y),
    };
  };
  const startPinch = () => {
    pinch.current = null;
    const bounds = svgRef.current?.getBoundingClientRect();
    const pair = measure();
    // Nearly coincident contacts are not a reliable zoom baseline.
    if (!bounds?.width || !bounds.height || !pair || pair.distance < 8) return;
    pinch.current = {
      ids: pair.ids,
      view: viewRef.current,
      anchor: clientToWorld(pair.x, pair.y, bounds, viewRef.current),
      distance: pair.distance,
    };
  };
  const release = (pointerId: number) => {
    if (!touches.current.delete(pointerId)) return;
    if (touches.current.size < 2) pinch.current = null;
    else if (pinch.current?.ids.includes(pointerId)) startPinch();
    if (touches.current.size === 0) suppress.current = false;
  };
  const capture = (pointerId: number) => {
    try {
      svgRef.current?.setPointerCapture(pointerId);
    } catch {
      // Cancellation can end the native pointer before React receives it.
    }
  };
  const updatePinch = () => {
    const bounds = svgRef.current?.getBoundingClientRect();
    const pair = measure();
    if (!pinch.current) return startPinch();
    const start = pinch.current;
    if (!bounds?.width || !bounds.height || !pair) return;
    const zoomed = zoomAtWorldPoint(
      start.view,
      start.anchor,
      start.view.scale * (pair.distance / start.distance),
      0.05,
      20,
    );
    const under = clientToWorld(pair.x, pair.y, bounds, zoomed);
    const next = {
      ...zoomed,
      x: zoomed.x + start.anchor.x - under.x,
      y: zoomed.y + start.anchor.y - under.y,
    };
    viewRef.current = next;
    setView(next);
  };

  const cancelTouch = (pointerId: number) => {
    const touch = touches.current.get(pointerId);
    if (!touch) return;
    if (!suppress.current) handlers.onPointerCancel(touch.event);
    release(pointerId);
  };
  const reset = () => {
    const first = touches.current.values().next().value;
    if (first && !suppress.current) handlers.onPointerCancel(first.event);
    const ids = [...touches.current.keys()];
    touches.current.clear();
    pinch.current = null;
    suppress.current = false;
    for (const id of ids) {
      try {
        if (svgRef.current?.hasPointerCapture(id)) svgRef.current.releasePointerCapture(id);
      } catch {
        // Native capture may already be gone.
      }
    }
  };
  const lifecycle = React.useRef({ cancelTouch, reset });
  lifecycle.current = { cancelTouch, reset };
  React.useEffect(() => {
    // Bubble after React handles the canvas event. This also catches releases
    // outside the canvas if the browser drops capture or a panel intercepts it.
    const end = (event: PointerEvent) => {
      if (event.pointerType === "touch") lifecycle.current.cancelTouch(event.pointerId);
    };
    const blur = () => lifecycle.current.reset();
    const visibility = () => {
      if (document.visibilityState === "hidden") blur();
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", visibility);
      lifecycle.current.reset();
    };
  }, []);

  return {
    onPointerDownCapture: (event) => {
      if (event.pointerType !== "touch") return;
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY, event });
      if (touches.current.size === 2) {
        if (!suppress.current) {
          // Cancel the pointer that actually owns the editing transaction.
          handlers.onPointerCancel(touches.current.values().next().value!.event);
        }
        suppress.current = true;
        startPinch();
        for (const id of touches.current.keys()) capture(id);
        event.stopPropagation();
      } else if (suppress.current) {
        capture(event.pointerId);
        event.stopPropagation();
      }
    },
    onPointerDown: (event) => {
      if (event.pointerType !== "touch") return handlers.onPointerDown(event);
      if (!suppress.current) {
        handlers.onPointerDown(event);
        capture(event.pointerId);
      }
    },
    onPointerMoveCapture: (event) => {
      if (event.pointerType !== "touch") return;
      if (!touches.current.has(event.pointerId)) {
        event.stopPropagation();
        return;
      }
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY, event });
      if (touches.current.size >= 2) {
        updatePinch();
        event.stopPropagation();
      } else if (suppress.current) event.stopPropagation();
    },
    onPointerUpCapture: (event) => {
      if (event.pointerType === "touch" && suppress.current) {
        release(event.pointerId);
        event.stopPropagation();
      }
    },
    onPointerMove: (event) => {
      if (event.pointerType !== "touch") return handlers.onPointerMove(event);
      if (!touches.current.has(event.pointerId)) return;
      if (!suppress.current) handlers.onPointerMove(event);
    },
    onPointerUp: (event) => {
      if (event.pointerType !== "touch") return handlers.onPointerUp(event);
      if (!touches.current.has(event.pointerId)) return;
      const suppressed = suppress.current;
      release(event.pointerId);
      if (!suppressed) handlers.onPointerUp(event);
    },
    onPointerCancel: (event) => {
      if (event.pointerType !== "touch") return handlers.onPointerCancel(event);
      cancelTouch(event.pointerId);
    },
    onLostPointerCapture: (event) => {
      // A queued loss from the editing gesture is harmless if the pinch has
      // already recaptured this pointer on the same canvas.
      if (event.pointerType === "touch" && !svgRef.current?.hasPointerCapture?.(event.pointerId))
        cancelTouch(event.pointerId);
    },
  };
}

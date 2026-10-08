"use client";

import React from "react";
import { clientToWorld, zoomAtWorldPoint, type Viewport } from "@/lib/pathshift/camera";

type PointerHandler = (event: React.PointerEvent<Element>) => void;
interface Handlers {
  onPointerDown: PointerHandler;
  onPointerMove: PointerHandler;
  onPointerUp: PointerHandler;
  onPointerCancel: PointerHandler;
}
interface Touch {
  x: number;
  y: number;
  event: React.PointerEvent<Element>;
}
interface Pinch {
  ids: number[];
  view: Viewport;
  anchor: { x: number; y: number };
  distance: number;
}
interface Pan {
  id: number;
  view: Viewport;
  anchor: { x: number; y: number };
}

/** A pinch owns the camera, handing off to panning until all contacts end. */
export function useTouchViewportGestures({
  elementRef,
  view,
  setView,
  handlers,
  onGestureStart,
  getBounds,
  acceptTouch,
  minScale = 0.05,
  maxScale = 20,
  zoomAxes = "both",
  captureSingle = true,
}: {
  elementRef: React.RefObject<Element | null>;
  view: Viewport | (() => Viewport);
  setView: (view: Viewport) => void;
  handlers: Handlers;
  onGestureStart?: () => void;
  getBounds?: () => DOMRect | undefined;
  acceptTouch?: (event: React.SyntheticEvent<Element>) => boolean;
  minScale?: number;
  maxScale?: number;
  zoomAxes?: "both" | "horizontal";
  captureSingle?: boolean;
}): Handlers & {
  onPointerDownCapture: PointerHandler;
  onPointerMoveCapture: PointerHandler;
  onPointerUpCapture: PointerHandler;
  onLostPointerCapture: PointerHandler;
  onClickCapture: (event: React.MouseEvent<Element>) => void;
} {
  const touches = React.useRef(new Map<number, Touch>());
  const pinch = React.useRef<Pinch | null>(null);
  const pan = React.useRef<Pan | null>(null);
  const suppress = React.useRef(false);
  const suppressClick = React.useRef(false);
  const boundsForGesture = () =>
    getBounds ? getBounds() : elementRef.current?.getBoundingClientRect();
  const viewRef = React.useRef(typeof view === "function" ? view() : view);
  viewRef.current = typeof view === "function" ? view() : view;
  const currentView = () => (typeof view === "function" ? view() : viewRef.current);

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
    pan.current = null;
    const bounds = boundsForGesture();
    const pair = measure();
    // Nearly coincident contacts are not a reliable zoom baseline.
    if (!bounds?.width || !bounds.height || !pair || pair.distance < 8) return;
    const baseline = currentView();
    pinch.current = {
      ids: pair.ids,
      view: baseline,
      anchor: clientToWorld(pair.x, pair.y, bounds, baseline),
      distance: pair.distance,
    };
  };
  const startPan = () => {
    pan.current = null;
    const remaining = touches.current.entries().next().value;
    const bounds = boundsForGesture();
    if (!remaining || !bounds?.width || !bounds.height) return;
    const [id, touch] = remaining;
    const baseline = currentView();
    pan.current = {
      id,
      view: baseline,
      anchor: clientToWorld(touch.x, touch.y, bounds, baseline),
    };
  };
  const release = (pointerId: number) => {
    if (!touches.current.delete(pointerId)) return;
    if (touches.current.size < 2) pinch.current = null;
    else if (pinch.current?.ids.includes(pointerId)) startPinch();
    if (touches.current.size === 1 && suppress.current) startPan();
    if (touches.current.size === 0) {
      pan.current = null;
      suppress.current = false;
    }
  };
  const capture = (pointerId: number) => {
    try {
      elementRef.current?.setPointerCapture(pointerId);
    } catch {
      // Cancellation can end the native pointer before React receives it.
    }
  };
  const updatePinch = () => {
    const bounds = boundsForGesture();
    const pair = measure();
    if (!pinch.current) return startPinch();
    const start = pinch.current;
    if (!bounds?.width || !bounds.height || !pair) return;
    const scaled = zoomAtWorldPoint(
      start.view,
      start.anchor,
      start.view.scale * (pair.distance / start.distance),
      minScale,
      maxScale,
    );
    const zoomed =
      zoomAxes === "horizontal" ? { ...scaled, y: start.view.y, h: start.view.h } : scaled;
    const under = clientToWorld(pair.x, pair.y, bounds, zoomed);
    const next = {
      ...zoomed,
      x: zoomed.x + start.anchor.x - under.x,
      y: zoomed.y + start.anchor.y - under.y,
    };
    viewRef.current = next;
    setView(next);
  };
  const updatePan = () => {
    if (!pan.current) return startPan();
    const start = pan.current;
    const touch = touches.current.get(start.id);
    const bounds = boundsForGesture();
    if (!touch || !bounds?.width || !bounds.height) return;
    const under = clientToWorld(touch.x, touch.y, bounds, start.view);
    const next = {
      ...start.view,
      x: start.view.x + (start.anchor.x - under.x),
      y: start.view.y + (start.anchor.y - under.y),
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
  const finishTouch = (event: PointerEvent) => {
    if (!touches.current.has(event.pointerId)) return;
    const suppressed = suppress.current;
    release(event.pointerId);
    // HTML frame titles and releases outside the SVG bypass its bubble handler.
    // A normal release commits the gesture; only cancellation rolls it back.
    if (!suppressed) handlers.onPointerUp(event as unknown as React.PointerEvent<Element>);
  };
  const reset = () => {
    const first = touches.current.values().next().value;
    if (first && !suppress.current) handlers.onPointerCancel(first.event);
    const ids = [...touches.current.keys()];
    touches.current.clear();
    pinch.current = null;
    pan.current = null;
    suppress.current = false;
    for (const id of ids) {
      try {
        if (elementRef.current?.hasPointerCapture(id)) elementRef.current.releasePointerCapture(id);
      } catch {
        // Native capture may already be gone.
      }
    }
  };
  const lifecycle = React.useRef({ cancelTouch, finishTouch, reset });
  lifecycle.current = { cancelTouch, finishTouch, reset };
  React.useEffect(() => {
    // Bubble after React handles the surface event. This also catches releases
    // outside the canvas if the browser drops capture or a panel intercepts it.
    const end = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      if (event.type === "pointerup") lifecycle.current.finishTouch(event);
      else lifecycle.current.cancelTouch(event.pointerId);
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
      if (touches.current.size === 0) suppressClick.current = false;
      if (event.pointerType === "touch" && acceptTouch && !acceptTouch(event)) return;
      onGestureStart?.();
      if (event.pointerType !== "touch") return;
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY, event });
      if (touches.current.size === 2) {
        if (!suppress.current) {
          // Cancel the pointer that actually owns the editing transaction.
          handlers.onPointerCancel(touches.current.values().next().value!.event);
        }
        suppress.current = true;
        suppressClick.current = true;
        startPinch();
        for (const id of touches.current.keys()) capture(id);
        event.stopPropagation();
      } else if (suppress.current) {
        capture(event.pointerId);
        event.stopPropagation();
      }
    },
    onClickCapture: (event) => {
      if (acceptTouch && !acceptTouch(event)) return;
      if (suppressClick.current && event.detail !== 0) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    onPointerDown: (event) => {
      if (event.pointerType !== "touch") return handlers.onPointerDown(event);
      if (!suppress.current && touches.current.has(event.pointerId)) {
        handlers.onPointerDown(event);
        if (captureSingle) capture(event.pointerId);
      }
    },
    onPointerMoveCapture: (event) => {
      if (event.pointerType !== "touch") return;
      if (!touches.current.has(event.pointerId)) {
        if (!acceptTouch || acceptTouch(event)) event.stopPropagation();
        return;
      }
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY, event });
      if (touches.current.size >= 2) {
        updatePinch();
        event.stopPropagation();
      } else if (suppress.current) {
        updatePan();
        event.stopPropagation();
      }
    },
    onPointerUpCapture: (event) => {
      if (
        event.pointerType === "touch" &&
        suppress.current &&
        touches.current.has(event.pointerId)
      ) {
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
      // already recaptured this pointer on the same surface.
      if (
        event.pointerType === "touch" &&
        !elementRef.current?.hasPointerCapture?.(event.pointerId)
      )
        cancelTouch(event.pointerId);
    },
  };
}

import React from "react";

/**
 * One rule for every touch surface that sits inside something scrollable:
 * a finger commits nothing on contact. Drifting past the slop is a scroll,
 * lifting in place is a tap, and holding still picks the item up to drag.
 * Mouse and pen keep acting on press. Shared with Glyphrise's timeline.
 */
export const TOUCH_SLOP_PX = 8;
export const TOUCH_HOLD_MS = 350;

const claimed = new Set<number>();
/** Custom pan handlers skip touches an item has picked up. */
export const isTouchClaimed = (pointerId: number) => claimed.has(pointerId);

/** React clears `currentTarget` after dispatch; keep it for a deferred replay. */
function replayable<E extends React.PointerEvent<Element>>(event: E): E {
  const { currentTarget, target } = event;
  return Object.assign(Object.create(event) as E, { currentTarget, target });
}

/**
 * While a touch is picked up, nothing may scroll under it, and the platform's
 * long-press context menu must not open on top of the drag.
 */
function holdTouch(pointerId: number) {
  claimed.add(pointerId);
  const blockScroll = (event: TouchEvent) => {
    if (event.cancelable) event.preventDefault();
  };
  const blockMenu = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };
  const release = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return;
    claimed.delete(pointerId);
    window.removeEventListener("touchmove", blockScroll);
    window.removeEventListener("pointerup", release, true);
    window.removeEventListener("pointercancel", release, true);
    // The menu event can trail the release on Android; let it land first.
    window.setTimeout(() => window.removeEventListener("contextmenu", blockMenu, true), 400);
  };
  window.addEventListener("touchmove", blockScroll, { passive: false });
  window.addEventListener("contextmenu", blockMenu, true);
  window.addEventListener("pointerup", release, true);
  window.addEventListener("pointercancel", release, true);
  navigator.vibrate?.(8);
}

/**
 * Wraps a drag-start handler. Mouse and pen start immediately; touch starts
 * only after a still hold, replaying the original press so the drag code is
 * unchanged. A quick tap still produces the element's normal click.
 */
export function holdToDrag<E extends React.PointerEvent<Element>>(start: (event: E) => void) {
  return (event: E) => {
    if (event.pointerType !== "touch") return start(event);
    if (!event.isPrimary) return;
    const press = replayable(event);
    const { pointerId, clientX, clientY } = event;
    const cleanup = () => {
      window.clearTimeout(timer);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", end, true);
      window.removeEventListener("pointercancel", end, true);
      window.removeEventListener("pointerdown", otherDown, true);
    };
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (Math.hypot(moveEvent.clientX - clientX, moveEvent.clientY - clientY) > TOUCH_SLOP_PX)
        cleanup();
    };
    const end = (endEvent: PointerEvent) => {
      if (endEvent.pointerId === pointerId) cleanup();
    };
    // A second finger means pinch, never pick-up.
    const otherDown = (downEvent: PointerEvent) => {
      if (downEvent.pointerId !== pointerId) cleanup();
    };
    const timer = window.setTimeout(() => {
      cleanup();
      holdTouch(pointerId);
      start(press);
    }, TOUCH_HOLD_MS);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", end, true);
    window.addEventListener("pointercancel", end, true);
    window.addEventListener("pointerdown", otherDown, true);
  };
}

/**
 * Horizontal controls in a vertically scrolling pane (sliders, scrub labels)
 * pair `touch-action: pan-y` with this test: the edit begins only once the
 * finger travels sideways more than it travels down.
 */
export function horizontalIntent(
  start: { x: number; y: number },
  point: { x: number; y: number },
): "pending" | "drag" | "scroll" {
  const dx = Math.abs(point.x - start.x);
  const dy = Math.abs(point.y - start.y);
  if (Math.max(dx, dy) <= TOUCH_SLOP_PX) return "pending";
  return dx > dy ? "drag" : "scroll";
}

/** Remembers how the last press began, so `click` can tell taps from mouse clicks. */
export function usePressType() {
  const ref = React.useRef("mouse");
  return {
    ref,
    onPointerDownCapture: (event: React.PointerEvent) => {
      ref.current = event.pointerType;
    },
  };
}

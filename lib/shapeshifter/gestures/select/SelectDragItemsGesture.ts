/**
 * ShapeShifter 2026 - Marquee (box-select) Gesture
 *
 * Scope, as currently wired by GestureDispatcher: this class only ever runs for
 * *marquee* intent — a drag that starts on empty canvas (or an explicit "marquee"
 * HitTestResult) while toolMode is "select"/"default". GestureDispatcher gates on
 * `isMarqueeIntent = !hit || hit.type === "empty" || hit.type === "marquee"` before
 * instantiating this class, so a pointer-down that actually lands on a layer/point/
 * handle never reaches here in the first place.
 *
 * Click-to-select a single item, drag-to-move, resize handles, and the rotate handle
 * are intentionally NOT implemented in this gesture — they're handled directly by the
 * pointer-event handlers in PathCanvas.tsx/CanvasArea.tsx (hit-testing + store mutation
 * inline), which is where that logic already lives and works today. Do not add
 * hit-test/select/move code here expecting it to run for those interactions; it won't
 * be reached. If the gesture framework is ever made the single source of truth for
 * selection, that inline logic needs to move here *and* be deleted from
 * PathCanvas/CanvasArea in the same change, not duplicated.
 *
 * The only real work this class does: onMouseUp calls back into PathCanvas's
 * `commitMarqueeSelection`, which does the actual AABB collection + store selection
 * (honoring shift = additive union). Note GestureDispatcher.handlePointerMove always
 * passes a hardcoded `{x: 0, y: 0}` delta to onMouseDrag, so this class structurally
 * cannot apply a live per-frame drag delta — it only knows start/end points at commit
 * time. That's fine for marquee (only start/end matter); it's not a substitute for a
 * real drag-to-move gesture.
 */

import type { Point } from "../../types";
import { Gesture, type GestureContext, type GestureCallbacks } from "../Gesture";

export class SelectDragItemsGesture extends Gesture {
  private startPoint: Point | null = null;

  constructor(context: GestureContext, callbacks: GestureCallbacks) {
    super(context, callbacks);
  }

  onMouseDown(point: Point, _modifiers: { shift: boolean; alt: boolean; ctrl: boolean }): void {
    this.startPoint = point;
    this.setCursor("move");
  }

  onMouseDrag(
    _point: Point,
    _delta: Point,
    _modifiers: { shift: boolean; alt: boolean; ctrl: boolean },
  ): void {
    // Marquee only needs the rect visual, driven by PathCanvas via the
    // `updateMarquee` callback (see GestureDispatcher.handlePointerMove). Nothing to
    // do here — see class doc for why this can't become a real move-delta gesture
    // without GestureDispatcher passing a real delta.
  }

  onMouseUp(point: Point, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }): void {
    if (this.startPoint) {
      // The gesture owns the marquee commit trigger; the callback (wired by PathCanvas) applies
      // the real AABB collection + store selection, honoring shift = additive union (SEL-1).
      // A zero-movement click (start === point) is a valid marquee of zero size — PathCanvas's
      // commitMarqueeSelection already treats that as "clicked empty canvas" and clears selection.
      this.callbacks.commitMarqueeSelection?.(this.startPoint, point, modifiers.shift);
    }

    this.startPoint = null;
    this.setCursor("default");
  }
}

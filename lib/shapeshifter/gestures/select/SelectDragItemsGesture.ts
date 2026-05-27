/**
 * ShapeShifter 2026 - Select / Drag / Clone Items Gesture
 * The primary selection + move gesture (original SelectDragCloneItemsGesture).
 *
 * Handles:
 * - Click to select
 * - Drag to move (with shift constraint, alt clone)
 * - Integration with snap (Phase 7)
 *
 * PR-01.1 / 2cq (ShapeShifter-2cq under mvd/7fz): Now the first *live* concrete gesture
 * instantiated by GestureDispatcher for marquee intent (when toolMode select/default and
 * empty canvas or explicit "marquee" HitTestResult). The three (now four) marquee callbacks
 * are the bridge that lets the gesture own decision + lifecycle while PathCanvas owns only
 * transient rect rendering + capture.
 *
 * PR-02 completion (ShapeShifter-ubf / ubf.1 under 2cq/v6j): onMouseUp owns the commit trigger
 * (calls commitMarqueeSelection). The actual AABB multi-point collection + hit tests now live
 * in the gesture system (HitTests.collectPointsInRect + getMarqueeRect + rectsIntersect, used
 * by the PathCanvas callback). Dispatcher remains sole gate. Full multi, shift-additive,
 * empty-clear, preview-vs-edit parity preserved. Real hit tests extracted from monolith.
 *
 * References: DESIGN_ID 67dd105e Key Decision #2, beads ubf/2cq/v6j/ny0/1af, parity-checklist.md BatchSelect.
 * Next: Bend/Flex Ctrl+drag (ny0) and full Lasso.
 */

import type { Point } from "../../types";
import { Gesture, type GestureContext, type GestureCallbacks } from "../Gesture";

export class SelectDragItemsGesture extends Gesture {
  private startPoint: Point | null = null;
  private didMove = false;

  constructor(context: GestureContext, callbacks: GestureCallbacks) {
    super(context, callbacks);
  }

  onMouseDown(point: Point, _modifiers: { shift: boolean; alt: boolean; ctrl: boolean }): void {
    this.startPoint = point;
    this.didMove = false;

    // Note (vn7 k88 harden): Hit test + selection update for click/drag items currently handled in PathCanvas
    // direct handlers (handlePointPointerDown, selectLayer etc) for full edit-path parity. Gesture owns
    // marquee path exclusively via callbacks (PR-02). Skeleton records intent for future dedicated ownership
    // (no new API added; smallest per scope).
    this.setCursor("move");
  }

  onMouseDrag(
    _point: Point,
    _delta: Point,
    _modifiers: { shift: boolean; alt: boolean; ctrl: boolean },
  ): void {
    if (!this.startPoint) return;
    this.didMove = true;

    // Note (vn7 k88): Delta apply (shift 45deg constraint, alt clone, snap) lives in PathCanvas batch drag
    // session (see dragSession + handlePointPointerMove) for current parity. Gesture marquee uses zero-delta
    // bridge only. Future expansion point per DESIGN 67dd105e.
  }

  onMouseUp(point: Point, _modifiers: { shift: boolean; alt: boolean; ctrl: boolean }): void {
    if (this.startPoint) {
      // PR-02 start (ShapeShifter-2cq): The gesture owns the commit trigger for the marquee.
      // The registered commitMarqueeSelection callback (wired by PathCanvas at dispatcher creation)
      // performs the exact prior AABB collection + store multi-select actions (preview vs edit-path
      // branching) using the start/end points. This moves commit ownership out of the PathCanvas monolith.
      // endMarquee (clear) is handled by the dispatcher after this returns.
      this.callbacks.commitMarqueeSelection?.(this.startPoint, point);
    }

    if (!this.didMove) {
      // Pure click selection (no drag)
      // Note (vn7): select hit item routed via PathCanvas (see selectPoint/selectLayer calls); gesture
      // TODOs hardened to notes (dispatcher sole decision + callback bridge for marquee remains).
    }

    this.startPoint = null;
    this.didMove = false;
    this.setCursor("default");
  }
}

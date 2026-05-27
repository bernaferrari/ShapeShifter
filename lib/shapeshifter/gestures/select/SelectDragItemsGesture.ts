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
 * PR-02 start (this work): onMouseUp now calls commitMarqueeSelection(start, point) when
 * we have a startPoint. This triggers the AABB multi-point commit + hit test logic
 * (provided by PathCanvas via the callback at dispatcher creation time, using its helpers).
 * The gesture now owns the end-of-marquee commit trigger. Real hit tests + further
 * migration of the AABB collection itself will evolve here in subsequent PR-02 steps.
 *
 * References: DESIGN_ID 67dd105e Key Decision #2, beads 2cq/7fz/mvd/ish/c9f/dwm/v6j.
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

    // TODO: Hit test + update selection in store
    // For now the skeleton just records the intent
    this.setCursor("move");
  }

  onMouseDrag(_point: Point, _delta: Point, _modifiers: { shift: boolean; alt: boolean; ctrl: boolean }): void {
    if (!this.startPoint) return;
    this.didMove = true;

    // TODO: Apply delta to selected layers (respect shift 45deg, alt clone, snap)
    // This will call into store.translateSelectedLayers or similar
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
      // TODO: select the hit item
    }

    this.startPoint = null;
    this.didMove = false;
    this.setCursor("default");
  }
}

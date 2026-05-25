/**
 * ShapeShifter 2026 - Select / Drag / Clone Items Gesture
 * The primary selection + move gesture (original SelectDragCloneItemsGesture).
 * 
 * Handles:
 * - Click to select
 * - Drag to move (with shift constraint, alt clone)
 * - Integration with snap (Phase 7)
 * 
 * This is the highest user-impact gesture and the first real concrete gesture after the Phase 1 skeleton.
 */

import type { Point } from "../types";
import { Gesture, type GestureContext, type GestureCallbacks } from "./Gesture";

export class SelectDragItemsGesture extends Gesture {
  private startPoint: Point | null = null;
  private didMove = false;

  constructor(context: GestureContext, callbacks: GestureCallbacks) {
    super(context, callbacks);
  }

  onMouseDown(point: Point, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }): void {
    this.startPoint = point;
    this.didMove = false;

    // TODO: Hit test + update selection in store
    // For now the skeleton just records the intent
    this.setCursor("move");
  }

  onMouseDrag(point: Point, delta: Point, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }): void {
    if (!this.startPoint) return;
    this.didMove = true;

    // TODO: Apply delta to selected layers (respect shift 45deg, alt clone, snap)
    // This will call into store.translateSelectedLayers or similar
  }

  onMouseUp(point: Point, _modifiers: { shift: boolean; alt: boolean; ctrl: boolean }): void {
    if (!this.didMove) {
      // Pure click selection (no drag)
      // TODO: select the hit item
    }

    this.startPoint = null;
    this.didMove = false;
    this.setCursor("default");
  }
}

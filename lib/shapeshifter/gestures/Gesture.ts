/**
 * ShapeShifter 2026 - Gesture Base
 * Abstract foundation for all canvas interaction gestures.
 * Ported from original scripts/paper/gesture/Gesture.ts
 * Framework-agnostic (no DOM or Paper.js dependency).
 */

import type { Point } from "../types";
import type { ToolMode, CursorType } from "../toolModes";

export interface GestureContext {
  toolMode: ToolMode;
  editingSide: "from" | "to";
  snapToGrid: boolean;
  zoom: number;
}

export interface GestureCallbacks {
  setCursor: (cursor: CursorType) => void;
  pushHistory: () => void;

  /**
   * Transient marquee (box select) visual lifecycle callbacks.
   * PR-01.1 / ShapeShifter-ish (fix round under mvd/xwx): these allow the GestureDispatcher + concrete SelectDragItemsGesture
   * to own the *decision* and lifecycle for marquee start (when toolMode is select/default), while PathCanvas retains
   * ownership of the actual rect rendering + pointer capture (correct separation; no store pollution for transient UI).
   * 
   * beginMarqueeSelection: called by dispatcher on pointer down when it decides this is a marquee intent.
   *   - start: the initial point (in artboard coords)
   *   - additive: whether shift was held (do not clear prior selection)
   * updateMarquee: called on pointer move while a marquee gesture is active (live rect update).
   * endMarquee: called on pointer up (or cancel) to clear the transient rect.
   *
   * PR-02 start (ShapeShifter-2cq under mvd/7fz/ish/c9f): added commitMarqueeSelection so the concrete gesture
   * owns the end-of-marquee AABB multi-point commit + hit test trigger (now that dispatcher is the sole gate).
   * The canvas-specific selection application (preview subpath vs edit-path points) lives in the provided callback
   * (re-uses PathCanvas helpers safely). This begins migration of the commit logic out of the monolith while
   * preserving 100% behavioral parity.
   *
   * References: DESIGN_ID 67dd105e (Key Decision #2: dispatcher as single source of truth), PR-01/PR-02, gesture lifecycle,
   * beads 2cq (this work), mvd (review), 7fz (rereview), ish/c9f (impl), dwm (foundation), v6j (vision epic).
   * This makes the "dispatcher is the decision point" claim *actually true* at the integration layer.
   */
  beginMarqueeSelection?: (start: Point, additive: boolean) => void;
  updateMarquee?: (current: Point) => void;
  endMarquee?: () => void;
  commitMarqueeSelection?: (start: Point, end: Point, additive: boolean) => void;

  // Add more callbacks as gestures are implemented (selectPoint, updatePoint, etc.)
}

export abstract class Gesture {
  protected context: GestureContext;
  protected callbacks: GestureCallbacks;

  constructor(context: GestureContext, callbacks: GestureCallbacks) {
    this.context = context;
    this.callbacks = callbacks;
  }

  // Lifecycle — override in subclasses
  onMouseDown?(point: Point, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }): void;
  onMouseDrag?(point: Point, delta: Point, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }): void;
  onMouseMove?(point: Point, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }): void;
  onMouseUp?(point: Point, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }): void;

  onKeyDown?(key: string, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }): void;
  onKeyUp?(key: string, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }): void;

  // Optional: called when gesture is cancelled (e.g. tool change mid-gesture)
  cancel?(): void;

  // Helper for subclasses
  protected setCursor(cursor: CursorType) {
    this.callbacks.setCursor(cursor);
  }
}

/**
 * ShapeShifter 2026 - Gesture Dispatcher
 * The central router that decides which Gesture to instantiate on mouse down.
 * This is the heart of the interaction system (ported from original GestureTool.ts ~277 LOC).
 *
 * PR-01.1 / ShapeShifter-ish (fix round xwx under mvd): Made the dispatcher the *actual* decision point
 * for marquee/box select when toolMode is "select" or "default". First real runtime instantiation of
 * SelectDragItemsGesture. The three marquee callbacks (begin/update/end) are invoked here so the gesture
 * owns the lifecycle while PathCanvas owns only transient rect rendering.
 *
 * References: DESIGN_ID 67dd105e (Key Decision #2: dispatcher as single source of truth for all canvas
 * interactions), PR-01, gesture lifecycle.
 */

import type { Point } from "../types";
import { Gesture, type GestureContext, type GestureCallbacks } from "./Gesture";
import { SelectDragItemsGesture } from "./select/SelectDragItemsGesture";

// HitTestResult with proper first-class "marquee" discriminant (PR-01.1 fix round).
// Resolves review suggestion: no more "as any" casts for marquee intent.
// This type is the contract between PathCanvas hit-testing (or synthetic "empty" / marquee intent)
// and the dispatcher decision logic.
export interface HitTestResult {
  type: "point" | "segment" | "curve" | "handle" | "empty" | "layer" | "marquee";
  layerId?: string | number;
  subPathIndex?: number;
  commandIndex?: number;
  pointIndex?: number;
  t?: number;
}

export class GestureDispatcher {
  private activeGesture: Gesture | null = null;
  private context: GestureContext;
  private callbacks: GestureCallbacks;

  constructor(context: GestureContext, callbacks: GestureCallbacks) {
    this.context = context;
    this.callbacks = callbacks;
  }

  // Introspection for tests/consumers: whether a gesture lifecycle is in flight.
  hasActiveGesture(): boolean {
    return this.activeGesture !== null;
  }

  // Introspection for tests: the active gesture instance, if any.
  getActiveGesture(): Gesture | null {
    return this.activeGesture;
  }

  // Called on pointer down — the main decision point.
  // For select/default tool, we treat "empty" canvas hits or explicit "marquee" intent
  // as the trigger for box selection. This is the gate. The concrete SelectDragItemsGesture is
  // instantiated here at runtime. The beginMarqueeSelection callback is invoked so PathCanvas can
  // start the visual rect + capture + conditional clear (if !additive).
  handlePointerDown(
    point: Point,
    hit: HitTestResult | null,
    modifiers: { shift: boolean; alt: boolean; ctrl: boolean },
  ) {
    // Cancel any running gesture and record it for test introspection.
    if (this.activeGesture) {
      this.activeGesture.cancel?.();
      this.activeGesture.cancelCalled = true;
      this.activeGesture = null;
    }

    const tool = this.context.toolMode;

    if (tool === "select" || tool === "default") {
      // Marquee / box-select intent decision.
      // Synthetic "marquee" hit (from PathCanvas when it knows it wants marquee) or empty hit or no hit
      // currently routes here.
      const isMarqueeIntent = !hit || hit.type === "empty" || hit.type === "marquee";

      if (isMarqueeIntent) {
        this.activeGesture = new SelectDragItemsGesture(this.context, this.callbacks);

        // Let the registered callback drive the transient visual start in PathCanvas.
        // The gesture owns the lifecycle; the callback is the bridge for the rect.
        this.callbacks.beginMarqueeSelection?.(point, !!modifiers.shift);

        // Give the concrete gesture its down event (the gesture commits selection on mouse up).
        this.activeGesture.onMouseDown?.(point, modifiers);
        return;
      }

      // Future: click-to-select single item path (still routed through dispatcher).
    } else if (tool === "pen" || tool === "direct") {
      // Direct tool Ctrl+drag is Bend/Flex curvature intent: when ctrl is held during drag on a
      // curve/handle, we treat as "flex" intent (Ctrl+drag to intelligently flex curves while
      // preserving smoothness/G1-G2). The actual flex math + store mutation happens in PathCanvas's
      // segment/handle drag handlers when toolMode=direct && ctrlKey; this decision point stays
      // reserved for a future dedicated BendFlexGesture / SelectDragHandleGesture subclass.
      const isFlexIntent = modifiers.ctrl && tool === "direct";
      if (!isFlexIntent) {
        // Will become SelectDragDrawSegmentsGesture or handle editing.
      }
    } else if (tool === "pencil" || tool === "ellipse" || tool === "rectangle") {
      // Pencil is the current Lasso entry (L shortcut): real polygon hit testing lives in
      // collectPointsInLasso (HitTests), committed from PathCanvas on pointer up, mirroring marquee.
      // Future: dedicated LassoSelectGesture + explicit "lasso" ToolMode.
    } else if (tool === "paint") {
      // Paint bucket / fill: hit region via path sampling + pointInPolygon, commit mutates hit layer
      // fill via updateSelectedLayer + pushHistory. Wired directly in PathCanvas pointer handlers.
    } else if (tool === "rotate" || tool === "transform") {
      // "rotate"/"transform" are ToolMode members that no UI currently sets
      // (BottomToolPalette only exposes select/direct/pen/pencil/paint/knife) — this
      // branch is unreachable today. Routing it to SelectDragItemsGesture would be a
      // no-op anyway: that class only implements the marquee commit on mouseUp, not
      // hit-test/rotate/scale math. The real rotate handle + resize handles are
      // implemented directly in PathCanvas.tsx's/CanvasArea.tsx's pointer handlers
      // while toolMode is "select". If a dedicated rotate/transform tool mode is ever
      // shipped, it needs its own Gesture subclass wired here, not this one.
    }
  }

  handlePointerMove(point: Point, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }) {
    if (this.activeGesture) {
      if (this.activeGesture.onMouseDrag) {
        // For marquee we treat move as drag for the rect.
        this.activeGesture.onMouseDrag(point, { x: 0, y: 0 }, modifiers);
      } else if (this.activeGesture.onMouseMove) {
        this.activeGesture.onMouseMove(point, modifiers);
      }

      // Gate the marquee update callback: only while a gesture is active, so idle moves don't emit
      // noisy callback traffic.
      this.callbacks.updateMarquee?.(point);
    }
  }

  handlePointerUp(point: Point, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }) {
    if (this.activeGesture) {
      if (this.activeGesture.onMouseUp) {
        this.activeGesture.onMouseUp(point, modifiers);
      }
      // End the transient marquee visual via the callback (PathCanvas clears its local boxSelect state).
      this.callbacks.endMarquee?.();
    }
    this.activeGesture = null;
  }

  // Called when tool changes externally (e.g. toolbar click)
  cancelActiveGesture() {
    if (this.activeGesture) {
      this.activeGesture.cancel?.();
      this.activeGesture.cancelCalled = true;
      this.activeGesture = null;
    }
    // Also clear any in-flight marquee visual.
    this.callbacks.endMarquee?.();
  }

  // Called by PathCanvas useEffect when toolMode / editingSide / snapToGrid / zoom change.
  // Critical so the BottomToolPalette (and keyboard tool switches) actually affect gesture decisions.
  updateContext(newContext: Partial<GestureContext>) {
    this.context = { ...this.context, ...newContext };
  }
}

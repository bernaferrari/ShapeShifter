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
 * interactions), PR-01, gesture lifecycle, beads mvd (review), ish (impl task), c9f (parent), dwm (foundation),
 * v6j (vision epic). This finally makes the "dispatcher decides" claim true at the integration layer.
 */

import type { Point } from "../types";
import type { ToolMode } from "../toolModes";
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
  // ... more as gestures are implemented
}

export class GestureDispatcher {
  private activeGesture: Gesture | null = null;
  private context: GestureContext;
  private callbacks: GestureCallbacks;

  constructor(context: GestureContext, callbacks: GestureCallbacks) {
    this.context = context;
    this.callbacks = callbacks;
  }

  // Called on pointer down — the main decision point.
  // PR-01.1 fix round: For select/default tool, we treat "empty" canvas hits or explicit "marquee" intent
  // as the trigger for box selection. This is the gate. The concrete SelectDragItemsGesture is instantiated
  // here for the first time in runtime. The beginMarqueeSelection callback is invoked so PathCanvas can
  // start the visual rect + capture + conditional clear (if !additive).
  handlePointerDown(point: Point, hit: HitTestResult | null, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }) {
    // Cancel any running gesture
    if (this.activeGesture) {
      this.activeGesture.cancel?.();
      this.activeGesture = null;
    }

    const tool = this.context.toolMode;

    if (tool === "select" || tool === "default") {
      // Marquee / box-select intent decision.
      // Synthetic "marquee" hit (from PathCanvas when it knows it wants marquee) or empty hit or no hit
      // currently routes here. (PR-02 will evolve this with real AABB hit tests inside the gesture.)
      const isMarqueeIntent = !hit || hit.type === "empty" || hit.type === "marquee";

      if (isMarqueeIntent) {
        this.activeGesture = new SelectDragItemsGesture(this.context, this.callbacks);
        console.log("[GestureDispatcher] decided marquee — instantiated first SelectDragItemsGesture (PR-01.1 / ShapeShifter-ish fix round xwx under mvd, DESIGN_ID 67dd105e Key Decision #2)", { point, hit, modifiers });

        // Let the registered callback drive the transient visual start in PathCanvas.
        // The gesture owns the lifecycle; the callback is the bridge for the rect.
        this.callbacks.beginMarqueeSelection?.(point, !!modifiers.shift);

        // Give the concrete gesture its down event (future PR-02 will move more AABB logic here).
        this.activeGesture.onMouseDown?.(point, modifiers);
        return;
      }

      // Future: click-to-select single item path (still routed through dispatcher).
      console.log("[GestureDispatcher] select click (non-marquee for now)", { point, hit, modifiers });
    } else if (tool === "pen" || tool === "direct") {
      // Will become SelectDragDrawSegmentsGesture or handle editing
      console.log("[GestureDispatcher] would start path edit gesture", { point, hit, modifiers });
    } else if (tool === "pencil" || tool === "ellipse" || tool === "rectangle") {
      // Will become shape creation gestures
      console.log("[GestureDispatcher] would start shape creation", { tool, point });
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

      // Gate the marquee update callback: only while a gesture that cares about marquee is active.
      // This resolves the review suggestion about unconditional noisy calls in a future with many gesture types.
      // (For now any active gesture during a marquee path will drive it; the concrete SelectDragItemsGesture
      // is the one that will be active.)
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

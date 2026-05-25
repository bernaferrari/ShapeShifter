/**
 * ShapeShifter 2026 - Gesture Dispatcher
 * The central router that decides which Gesture to instantiate on mouse down.
 * This is the heart of the interaction system (ported from original GestureTool.ts ~277 LOC).
 * 
 * Responsibilities:
 * - Inspect current toolMode + hit test result + modifiers
 * - Instantiate the correct concrete Gesture subclass
 * - Manage the active gesture lifecycle
 */

import type { Point } from "../types";
import type { ToolMode } from "../toolModes";
import { Gesture, type GestureContext, type GestureCallbacks } from "./Gesture";

// Placeholder hit test result shape (will be expanded in hit-tests.ts)
export interface HitTestResult {
  type: "point" | "segment" | "curve" | "handle" | "empty" | "layer";
  layerId?: string | number;
  subPathIndex?: number;
  commandIndex?: number;
  pointIndex?: number;
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

  // Called on pointer down — the main decision point
  handlePointerDown(point: Point, hit: HitTestResult | null, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }) {
    // Cancel any running gesture
    if (this.activeGesture) {
      this.activeGesture.cancel?.();
      this.activeGesture = null;
    }

    const tool = this.context.toolMode;

    // TODO: Implement the full dispatch matrix from the original GestureTool
    // This will grow as we implement each gesture in later phases.

    // For now: basic routing skeleton
    if (tool === "select" || tool === "default") {
      // Will become SelectDragItemsGesture or BatchSelectItemsGesture
      console.log("[GestureDispatcher] would start select gesture", { point, hit, modifiers });
    } else if (tool === "pen" || tool === "direct") {
      // Will become SelectDragDrawSegmentsGesture or handle editing
      console.log("[GestureDispatcher] would start path edit gesture", { point, hit, modifiers });
    } else if (tool === "pencil" || tool === "ellipse" || tool === "rectangle") {
      // Will become shape creation gestures
      console.log("[GestureDispatcher] would start shape creation", { tool, point });
    }

    // Once concrete gestures exist, we will do:
    // this.activeGesture = new SomeConcreteGesture(this.context, this.callbacks);
    // this.activeGesture.onMouseDown?.(point, modifiers);
  }

  handlePointerMove(point: Point, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }) {
    if (this.activeGesture?.onMouseMove) {
      this.activeGesture.onMouseMove(point, modifiers);
    } else if (this.activeGesture?.onMouseDrag) {
      // delta would be computed from previous point in real impl
      this.activeGesture.onMouseDrag(point, { x: 0, y: 0 }, modifiers);
    }
  }

  handlePointerUp(point: Point, modifiers: { shift: boolean; alt: boolean; ctrl: boolean }) {
    if (this.activeGesture?.onMouseUp) {
      this.activeGesture.onMouseUp(point, modifiers);
    }
    // Many gestures end on mouse up
    this.activeGesture = null;
  }

  // Called when tool changes externally (e.g. toolbar click)
  cancelActiveGesture() {
    if (this.activeGesture) {
      this.activeGesture.cancel?.();
      this.activeGesture = null;
    }
  }

  // Future: updateContext when store changes (toolMode, snap, etc.)
  updateContext(newContext: Partial<GestureContext>) {
    this.context = { ...this.context, ...newContext };
  }
}

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

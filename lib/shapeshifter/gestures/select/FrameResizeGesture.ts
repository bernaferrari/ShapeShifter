import type { Point } from "../../types";

export type FrameResizeHandle = "se" | "e" | "s";

export interface FrameResizeBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FrameResizeModifiers {
  bypassSnap: boolean;
}

interface FrameResizeCallbacks {
  beginTransaction: () => void;
  applySize: (size: { width: number; height: number }) => void;
  commit?: () => void;
  rollback?: () => void;
}

/** Captured frame-resize lifecycle with one lazy undo boundary. */
export class FrameResizeGesture {
  private moved = false;
  private finished = false;
  private lastSize: { width: number; height: number };

  constructor(
    private readonly bounds: FrameResizeBounds,
    private readonly handle: FrameResizeHandle,
    private readonly callbacks: FrameResizeCallbacks,
  ) {
    this.lastSize = { width: bounds.w, height: bounds.h };
  }

  update(point: Point, modifiers: FrameResizeModifiers) {
    if (this.finished) return { ...this.lastSize };
    let width = this.handle === "s" ? this.bounds.w : point.x - this.bounds.x;
    let height = this.handle === "e" ? this.bounds.h : point.y - this.bounds.y;
    width = Math.max(1, modifiers.bypassSnap ? Number(width.toFixed(2)) : Math.round(width));
    height = Math.max(1, modifiers.bypassSnap ? Number(height.toFixed(2)) : Math.round(height));
    if (
      Math.abs(width - this.lastSize.width) <= 1e-6 &&
      Math.abs(height - this.lastSize.height) <= 1e-6
    ) {
      return { ...this.lastSize };
    }
    if (!this.moved) {
      this.callbacks.beginTransaction();
      this.moved = true;
    }
    this.lastSize = { width, height };
    this.callbacks.applySize(this.lastSize);
    return { ...this.lastSize };
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    if (this.moved) this.callbacks.commit?.();
  }

  cancel() {
    if (this.finished) return;
    this.finished = true;
    if (this.moved) this.callbacks.rollback?.();
  }

  get isMoved() {
    return this.moved;
  }
}

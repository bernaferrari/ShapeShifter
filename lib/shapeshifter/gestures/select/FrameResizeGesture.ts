import type { Point } from "../../types";

export type FrameResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

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
  applyBounds: (bounds: FrameResizeBounds) => void;
  commit?: () => void;
  rollback?: () => void;
}

/** Resize the boundary without moving the opposite edge; one lazy undo boundary. */
export class FrameResizeGesture {
  private moved = false;
  private finished = false;
  private lastBounds: FrameResizeBounds;
  private grabOffset: Point;

  constructor(
    private readonly bounds: FrameResizeBounds,
    private readonly handle: FrameResizeHandle,
    private readonly callbacks: FrameResizeCallbacks,
    pointer?: Point,
  ) {
    this.lastBounds = { ...bounds };
    const edge = {
      x: bounds.x + (handle.includes("w") ? 0 : handle.includes("e") ? bounds.w : bounds.w / 2),
      y: bounds.y + (handle.includes("n") ? 0 : handle.includes("s") ? bounds.h : bounds.h / 2),
    };
    this.grabOffset = pointer ? { x: pointer.x - edge.x, y: pointer.y - edge.y } : { x: 0, y: 0 };
  }

  update(point: Point, modifiers: FrameResizeModifiers) {
    if (this.finished || !Number.isFinite(point.x) || !Number.isFinite(point.y))
      return { ...this.lastBounds };
    const x = point.x - this.grabOffset.x;
    const y = point.y - this.grabOffset.y;
    const snap = (value: number, original: number) =>
      Math.abs(value - original) <= 1e-6
        ? original
        : Math.max(1, modifiers.bypassSnap ? Number(value.toFixed(2)) : Math.round(value));
    const w = this.handle.includes("e")
      ? snap(x - this.bounds.x, this.bounds.w)
      : this.handle.includes("w")
        ? snap(this.bounds.x + this.bounds.w - x, this.bounds.w)
        : this.bounds.w;
    const h = this.handle.includes("s")
      ? snap(y - this.bounds.y, this.bounds.h)
      : this.handle.includes("n")
        ? snap(this.bounds.y + this.bounds.h - y, this.bounds.h)
        : this.bounds.h;
    const next = {
      x: this.handle.includes("w") ? this.bounds.x + this.bounds.w - w : this.bounds.x,
      y: this.handle.includes("n") ? this.bounds.y + this.bounds.h - h : this.bounds.y,
      w,
      h,
    };
    if (
      Object.keys(next).every(
        (key) =>
          Math.abs(
            next[key as keyof FrameResizeBounds] - this.lastBounds[key as keyof FrameResizeBounds],
          ) <= 1e-6,
      )
    )
      return { ...this.lastBounds };
    if (!this.moved) {
      this.callbacks.beginTransaction();
      this.moved = true;
    }
    this.lastBounds = next;
    this.callbacks.applyBounds(next);
    return { ...next };
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

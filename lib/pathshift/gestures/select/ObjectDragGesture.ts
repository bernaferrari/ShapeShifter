import type { Point } from "../../types";

export interface ObjectDragModifiers {
  shift: boolean;
  alt: boolean;
  /** Cmd/Ctrl bypasses grid and smart-guide snapping. */
  bypassSnap: boolean;
}

export interface ObjectDragResult {
  start: Point;
  end: Point;
  applied: Point;
  moved: boolean;
  cloned: boolean;
}

export interface ObjectDragCallbacks {
  /** Called exactly once before the first mutation, including Alt-clone. */
  beginTransaction: () => void;
  cloneSelection: () => void;
  /** Resolve grid/smart-guide snapping for the constrained total delta. */
  resolveTotalDelta?: (total: Point, modifiers: ObjectDragModifiers) => Point;
  /** Apply only the incremental delta since the preceding update. */
  applyDelta: (delta: Point, total: Point) => void;
  commit: (result: ObjectDragResult) => void;
  /** Reverse an in-flight mutation when Escape/tool-switch cancels the gesture. */
  rollback?: (applied: Point) => void;
  cancelled?: () => void;
}

const EPSILON = 1e-6;
const CLONE_THRESHOLD = 2;

/**
 * Framework-independent object drag transaction.
 *
 * The canvas supplies coordinate conversion, snapping, and store mutations; this
 * class is the single authority for lifecycle, axis locking, incremental deltas,
 * Alt-clone, history start, commit, and cancel semantics.
 */
export class ObjectDragGesture {
  private readonly start: Point;
  private readonly callbacks: ObjectDragCallbacks;
  private applied: Point = { x: 0, y: 0 };
  private moved = false;
  private cloned = false;
  private transactionStarted = false;
  private finished = false;

  constructor(start: Point, callbacks: ObjectDragCallbacks) {
    this.start = { ...start };
    this.callbacks = callbacks;
  }

  update(point: Point, modifiers: ObjectDragModifiers): Point {
    if (this.finished) return { ...this.applied };

    let total = {
      x: point.x - this.start.x,
      y: point.y - this.start.y,
    };
    if (modifiers.shift) {
      if (Math.abs(total.x) >= Math.abs(total.y)) total.y = 0;
      else total.x = 0;
    }

    if (this.callbacks.resolveTotalDelta) {
      total = this.callbacks.resolveTotalDelta(total, modifiers);
    }

    const delta = {
      x: total.x - this.applied.x,
      y: total.y - this.applied.y,
    };
    if (Math.abs(delta.x) <= EPSILON && Math.abs(delta.y) <= EPSILON) {
      return { ...this.applied };
    }

    if (!this.transactionStarted) {
      this.callbacks.beginTransaction();
      this.transactionStarted = true;
    }
    if (modifiers.alt && !this.cloned && Math.hypot(total.x, total.y) > CLONE_THRESHOLD) {
      this.callbacks.cloneSelection();
      this.cloned = true;
    }

    this.callbacks.applyDelta(delta, total);
    this.applied = { ...total };
    this.moved = true;
    return { ...this.applied };
  }

  finish(point: Point): ObjectDragResult {
    const result = this.result(point);
    if (!this.finished) {
      this.finished = true;
      if (this.moved) this.callbacks.commit(result);
    }
    return result;
  }

  cancel(): ObjectDragResult {
    const result = this.result({
      x: this.start.x + this.applied.x,
      y: this.start.y + this.applied.y,
    });
    if (!this.finished) {
      this.finished = true;
      if (this.moved) this.callbacks.rollback?.(this.applied);
      this.callbacks.cancelled?.();
    }
    return result;
  }

  get isMoved() {
    return this.moved;
  }

  private result(end: Point): ObjectDragResult {
    return {
      start: { ...this.start },
      end: { ...end },
      applied: { ...this.applied },
      moved: this.moved,
      cloned: this.cloned,
    };
  }
}

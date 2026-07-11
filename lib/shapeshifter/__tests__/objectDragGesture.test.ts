import { describe, expect, it, vi } from "vitest";
import { ObjectDragGesture } from "../gestures/select/ObjectDragGesture";

const modifiers = { shift: false, alt: false, bypassSnap: false };

describe("ObjectDragGesture", () => {
  it("owns one history boundary and emits incremental deltas", () => {
    const begin = vi.fn();
    const apply = vi.fn();
    const commit = vi.fn();
    const gesture = new ObjectDragGesture(
      { x: 10, y: 20 },
      {
        beginTransaction: begin,
        cloneSelection: vi.fn(),
        applyDelta: apply,
        commit,
      },
    );

    gesture.update({ x: 15, y: 23 }, modifiers);
    gesture.update({ x: 18, y: 30 }, modifiers);
    gesture.finish({ x: 18, y: 30 });

    expect(begin).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenNthCalledWith(1, { x: 5, y: 3 }, { x: 5, y: 3 });
    expect(apply).toHaveBeenNthCalledWith(2, { x: 3, y: 7 }, { x: 8, y: 10 });
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({ applied: { x: 8, y: 10 }, moved: true }),
    );
  });

  it("locks to the dominant axis before snapping", () => {
    const resolve = vi.fn((point: { x: number; y: number }) => point);
    const apply = vi.fn();
    const gesture = new ObjectDragGesture(
      { x: 0, y: 0 },
      {
        beginTransaction: vi.fn(),
        cloneSelection: vi.fn(),
        resolveTotalDelta: resolve,
        applyDelta: apply,
        commit: vi.fn(),
      },
    );

    gesture.update(
      { x: 12, y: 4 },
      { shift: true, alt: false, bypassSnap: false },
    );

    expect(resolve).toHaveBeenCalledWith(
      { x: 12, y: 0 },
      expect.objectContaining({ shift: true }),
    );
    expect(apply).toHaveBeenCalledWith({ x: 12, y: 0 }, { x: 12, y: 0 });
  });

  it("Alt-clones once inside the same transaction", () => {
    const order: string[] = [];
    const clone = vi.fn(() => order.push("clone"));
    const gesture = new ObjectDragGesture(
      { x: 0, y: 0 },
      {
        beginTransaction: () => order.push("begin"),
        cloneSelection: clone,
        applyDelta: () => order.push("apply"),
        commit: vi.fn(),
      },
    );

    gesture.update({ x: 5, y: 0 }, { ...modifiers, alt: true });
    gesture.update({ x: 10, y: 0 }, { ...modifiers, alt: true });

    expect(order.slice(0, 3)).toEqual(["begin", "clone", "apply"]);
    expect(clone).toHaveBeenCalledTimes(1);
  });

  it("does not create history or commit for a click without movement", () => {
    const begin = vi.fn();
    const commit = vi.fn();
    const gesture = new ObjectDragGesture(
      { x: 2, y: 3 },
      {
        beginTransaction: begin,
        cloneSelection: vi.fn(),
        applyDelta: vi.fn(),
        commit,
      },
    );

    gesture.finish({ x: 2, y: 3 });

    expect(begin).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("rolls back the full applied delta when cancelled", () => {
    const rollback = vi.fn();
    const cancelled = vi.fn();
    const gesture = new ObjectDragGesture(
      { x: 0, y: 0 },
      {
        beginTransaction: vi.fn(),
        cloneSelection: vi.fn(),
        applyDelta: vi.fn(),
        commit: vi.fn(),
        rollback,
        cancelled,
      },
    );
    gesture.update({ x: 7, y: -3 }, modifiers);

    gesture.cancel();
    gesture.cancel();

    expect(rollback).toHaveBeenCalledTimes(1);
    expect(rollback).toHaveBeenCalledWith({ x: 7, y: -3 });
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});

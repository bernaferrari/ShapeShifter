import { describe, expect, it, vi } from "vitest";
import { FrameResizeGesture, type FrameResizeHandle } from "../gestures/select/FrameResizeGesture";

describe("FrameResizeGesture", () => {
  it.each([
    ["nw", { x: 5, y: 10, w: 105, h: 90 }],
    ["n", { x: 10, y: 10, w: 100, h: 90 }],
    ["ne", { x: 10, y: 10, w: 1, h: 90 }],
    ["e", { x: 10, y: 20, w: 1, h: 80 }],
    ["se", { x: 10, y: 20, w: 1, h: 1 }],
    ["s", { x: 10, y: 20, w: 100, h: 1 }],
    ["sw", { x: 5, y: 20, w: 105, h: 1 }],
    ["w", { x: 5, y: 20, w: 105, h: 80 }],
  ] as const)("resizes %s while keeping the opposite edges fixed", (handle, expected) => {
    const apply = vi.fn();
    const gesture = new FrameResizeGesture({ x: 10, y: 20, w: 100, h: 80 }, handle, {
      beginTransaction: vi.fn(),
      applyBounds: apply,
    });
    expect(gesture.update({ x: 5, y: 10 }, { bypassSnap: true })).toEqual(expected);
    expect(apply).toHaveBeenCalledWith(expected);
  });

  it.each(["nw", "n", "ne", "e", "se", "s", "sw", "w"] as FrameResizeHandle[])(
    "keeps an off-center %s grab from jumping on its first move",
    (handle) => {
      const begin = vi.fn();
      const gesture = new FrameResizeGesture(
        { x: 10, y: 20, w: 100, h: 80 },
        handle,
        {
          beginTransaction: begin,
          applyBounds: vi.fn(),
        },
        { x: 107, y: 98 },
      );
      expect(gesture.update({ x: 107, y: 98 }, { bypassSnap: true })).toEqual({
        x: 10,
        y: 20,
        w: 100,
        h: 80,
      });
      expect(begin).not.toHaveBeenCalled();
    },
  );

  it("clamps top-left crossings without moving the right or bottom edge", () => {
    const gesture = new FrameResizeGesture({ x: 10, y: 20, w: 100, h: 80 }, "nw", {
      beginTransaction: vi.fn(),
      applyBounds: vi.fn(),
    });
    expect(gesture.update({ x: 200, y: 200 }, { bypassSnap: true })).toEqual({
      x: 109,
      y: 99,
      w: 1,
      h: 1,
    });
  });

  it("preserves fractional dimensions on the untouched axis", () => {
    const gesture = new FrameResizeGesture({ x: 10.25, y: 20, w: 100, h: 80.75 }, "w", {
      beginTransaction: vi.fn(),
      applyBounds: vi.fn(),
    });
    expect(gesture.update({ x: 5.1, y: 100 }, { bypassSnap: false })).toEqual({
      x: 5.25,
      y: 20,
      w: 105,
      h: 80.75,
    });
  });

  it("does not snap a fractional boundary before dragging and restores it exactly on return", () => {
    const begin = vi.fn();
    const bounds = { x: 10.25, y: 20.5, w: 100.25, h: 80.75 };
    const gesture = new FrameResizeGesture(
      bounds,
      "nw",
      {
        beginTransaction: begin,
        applyBounds: vi.fn(),
      },
      { x: 8, y: 19 },
    );
    expect(gesture.update({ x: 8, y: 19 }, { bypassSnap: false })).toEqual(bounds);
    expect(begin).not.toHaveBeenCalled();
    gesture.update({ x: 5, y: 10 }, { bypassSnap: false });
    expect(gesture.update({ x: 8, y: 19 }, { bypassSnap: false })).toEqual(bounds);
  });

  it("starts history lazily and constrains edge handles", () => {
    const begin = vi.fn();
    const apply = vi.fn();
    const gesture = new FrameResizeGesture({ x: 10, y: 20, w: 100, h: 80 }, "e", {
      beginTransaction: begin,
      applyBounds: apply,
    });
    gesture.update({ x: 135.4, y: 999 }, { bypassSnap: false });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ x: 10, y: 20, w: 125, h: 80 });
  });

  it("does not create history for a click without movement", () => {
    const begin = vi.fn();
    const commit = vi.fn();
    const gesture = new FrameResizeGesture({ x: 0, y: 0, w: 24, h: 24 }, "se", {
      beginTransaction: begin,
      applyBounds: vi.fn(),
      commit,
    });
    gesture.finish();
    expect(begin).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("rolls back a cancelled resize exactly once", () => {
    const rollback = vi.fn();
    const gesture = new FrameResizeGesture({ x: 0, y: 0, w: 24, h: 24 }, "se", {
      beginTransaction: vi.fn(),
      applyBounds: vi.fn(),
      rollback,
    });
    gesture.update({ x: 30, y: 40 }, { bypassSnap: true });
    gesture.cancel();
    gesture.cancel();
    expect(rollback).toHaveBeenCalledTimes(1);
  });
});

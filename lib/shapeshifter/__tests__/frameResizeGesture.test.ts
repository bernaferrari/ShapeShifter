import { describe, expect, it, vi } from "vitest";
import { FrameResizeGesture } from "../gestures/select/FrameResizeGesture";

describe("FrameResizeGesture", () => {
  it("starts history lazily and constrains edge handles", () => {
    const begin = vi.fn();
    const apply = vi.fn();
    const gesture = new FrameResizeGesture(
      { x: 10, y: 20, w: 100, h: 80 },
      "e",
      { beginTransaction: begin, applySize: apply },
    );
    gesture.update({ x: 135.4, y: 999 }, { bypassSnap: false });
    expect(begin).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenCalledWith({ width: 125, height: 80 });
  });

  it("does not create history for a click without movement", () => {
    const begin = vi.fn();
    const commit = vi.fn();
    const gesture = new FrameResizeGesture(
      { x: 0, y: 0, w: 24, h: 24 },
      "se",
      { beginTransaction: begin, applySize: vi.fn(), commit },
    );
    gesture.finish();
    expect(begin).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it("rolls back a cancelled resize exactly once", () => {
    const rollback = vi.fn();
    const gesture = new FrameResizeGesture(
      { x: 0, y: 0, w: 24, h: 24 },
      "se",
      { beginTransaction: vi.fn(), applySize: vi.fn(), rollback },
    );
    gesture.update({ x: 30, y: 40 }, { bypassSnap: true });
    gesture.cancel();
    gesture.cancel();
    expect(rollback).toHaveBeenCalledTimes(1);
  });
});

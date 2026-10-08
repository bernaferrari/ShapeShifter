import { describe, expect, it, vi } from "vitest";
import { GestureDispatcher } from "../GestureDispatcher";
import type { GestureCallbacks } from "../Gesture";
import { SelectDragItemsGesture } from "../select/SelectDragItemsGesture";

/**
 * Regression coverage for the GestureDispatcher marquee contract: the dispatcher
 * (not the canvas) is the decision point for box/marquee selection. A prior bad
 * merge reduced handlePointerDown to console.log placeholders, silently killing
 * marquee selection in PathCanvas while these callbacks kept being wired.
 */

const modifiers = { shift: false, alt: false, ctrl: false };

function makeContext(toolMode: "select" | "default" | "direct" | "pen") {
  return { toolMode, editingSide: "from" as const, snapToGrid: false, zoom: 1 };
}

function makeCallbacks(): GestureCallbacks & Record<string, ReturnType<typeof vi.fn>> {
  return {
    setCursor: vi.fn(),
    pushHistory: vi.fn(),
    beginMarqueeSelection: vi.fn(),
    updateMarquee: vi.fn(),
    endMarquee: vi.fn(),
    commitMarqueeSelection: vi.fn(),
  };
}

describe("GestureDispatcher", () => {
  it("instantiates a real gesture and drives the full marquee lifecycle on select/default", () => {
    for (const toolMode of ["select", "default"] as const) {
      const callbacks = makeCallbacks();
      const dispatcher = new GestureDispatcher(makeContext(toolMode), callbacks);

      // No active gesture before pointer down.
      expect(dispatcher.hasActiveGesture()).toBe(false);

      dispatcher.handlePointerDown({ x: 1, y: 2 }, null, modifiers);
      expect(callbacks.beginMarqueeSelection).toHaveBeenCalledTimes(1);
      expect(callbacks.beginMarqueeSelection).toHaveBeenCalledWith({ x: 1, y: 2 }, false);
      expect(dispatcher.hasActiveGesture()).toBe(true);
      expect(dispatcher.getActiveGesture()).toBeInstanceOf(SelectDragItemsGesture);

      dispatcher.handlePointerMove({ x: 5, y: 6 }, modifiers);
      expect(callbacks.updateMarquee).toHaveBeenCalledWith({ x: 5, y: 6 });

      dispatcher.handlePointerUp({ x: 8, y: 9 }, modifiers);
      expect(callbacks.commitMarqueeSelection).toHaveBeenCalledTimes(1);
      expect(callbacks.commitMarqueeSelection).toHaveBeenCalledWith(
        { x: 1, y: 2 },
        { x: 8, y: 9 },
        false,
      );
      expect(callbacks.endMarquee).toHaveBeenCalledTimes(1);
      expect(dispatcher.hasActiveGesture()).toBe(false);
    }
  });

  it("treats an explicit empty hit as marquee intent and forwards shift additivity", () => {
    const callbacks = makeCallbacks();
    const dispatcher = new GestureDispatcher(makeContext("select"), callbacks);

    dispatcher.handlePointerDown({ x: 0, y: 0 }, { type: "empty" }, { ...modifiers, shift: true });
    expect(callbacks.beginMarqueeSelection).toHaveBeenCalledWith({ x: 0, y: 0 }, true);

    dispatcher.handlePointerUp({ x: 4, y: 4 }, { ...modifiers, shift: true });
    expect(callbacks.commitMarqueeSelection).toHaveBeenCalledWith(
      { x: 0, y: 0 },
      { x: 4, y: 4 },
      true,
    );
  });

  it("does not start a marquee when the hit lands on a real item", () => {
    const callbacks = makeCallbacks();
    const dispatcher = new GestureDispatcher(makeContext("select"), callbacks);

    dispatcher.handlePointerDown(
      { x: 3, y: 3 },
      { type: "point", layerId: "l1", pointIndex: 0 },
      modifiers,
    );

    expect(callbacks.beginMarqueeSelection).not.toHaveBeenCalled();
    expect(dispatcher.hasActiveGesture()).toBe(false);

    // Moves with no active gesture must not emit callback traffic either.
    dispatcher.handlePointerMove({ x: 9, y: 9 }, modifiers);
    expect(callbacks.updateMarquee).not.toHaveBeenCalled();
  });

  it("never dispatches marquee for non-select tools", () => {
    for (const toolMode of ["pen", "direct"] as const) {
      const callbacks = makeCallbacks();
      const dispatcher = new GestureDispatcher(makeContext(toolMode), callbacks);

      dispatcher.handlePointerDown({ x: 0, y: 0 }, { type: "marquee" }, modifiers);
      dispatcher.handlePointerMove({ x: 5, y: 5 }, modifiers);
      dispatcher.handlePointerUp({ x: 6, y: 6 }, modifiers);

      expect(callbacks.beginMarqueeSelection).not.toHaveBeenCalled();
      expect(callbacks.updateMarquee).not.toHaveBeenCalled();
      expect(callbacks.commitMarqueeSelection).not.toHaveBeenCalled();
    }
  });

  it("cancelActiveGesture clears the in-flight visual so a later up cannot commit", () => {
    const callbacks = makeCallbacks();
    const dispatcher = new GestureDispatcher(makeContext("select"), callbacks);

    dispatcher.handlePointerDown({ x: 0, y: 0 }, { type: "marquee" }, modifiers);
    dispatcher.cancelActiveGesture();

    expect(callbacks.endMarquee).toHaveBeenCalled();
    expect(dispatcher.hasActiveGesture()).toBe(false);

    dispatcher.handlePointerUp({ x: 4, y: 4 }, modifiers);
    expect(callbacks.commitMarqueeSelection).not.toHaveBeenCalled();
  });

  it("a second pointer down cancels the first gesture instead of stacking", () => {
    const callbacks = makeCallbacks();
    const dispatcher = new GestureDispatcher(makeContext("select"), callbacks);

    dispatcher.handlePointerDown({ x: 0, y: 0 }, { type: "marquee" }, modifiers);
    const first = dispatcher.getActiveGesture();
    dispatcher.handlePointerDown({ x: 10, y: 10 }, { type: "marquee" }, modifiers);
    expect(first?.cancelCalled === true || first !== dispatcher.getActiveGesture()).toBe(true);

    dispatcher.handlePointerUp({ x: 12, y: 12 }, modifiers);
    // Exactly one commit — from the second gesture's lifecycle.
    expect(callbacks.commitMarqueeSelection).toHaveBeenCalledTimes(1);
    expect(callbacks.commitMarqueeSelection).toHaveBeenCalledWith(
      { x: 10, y: 10 },
      { x: 12, y: 12 },
      false,
    );
  });

  it("updateContext changes tool decisions mid-session without rebuilding the dispatcher", () => {
    const callbacks = makeCallbacks();
    const dispatcher = new GestureDispatcher(makeContext("select"), callbacks);

    dispatcher.updateContext({ toolMode: "pen" });
    dispatcher.handlePointerDown({ x: 0, y: 0 }, { type: "marquee" }, modifiers);
    expect(callbacks.beginMarqueeSelection).not.toHaveBeenCalled();
  });

  it("emits no console output during the marquee lifecycle", () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const callbacks = makeCallbacks();
    const dispatcher = new GestureDispatcher(makeContext("select"), callbacks);

    dispatcher.handlePointerDown({ x: 0, y: 0 }, { type: "marquee" }, modifiers);
    dispatcher.handlePointerMove({ x: 5, y: 5 }, modifiers);
    dispatcher.handlePointerUp({ x: 8, y: 8 }, modifiers);

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "../editorStore";

afterEach(() => vi.unstubAllGlobals());

describe("manual camera gesture ownership", () => {
  it("focuses an offscreen frame without changing zoom or viewport dimensions", () => {
    const state = useEditorStore.getState();
    state.resetProject();
    state.setWorldViewport({ x: -500, y: -500, w: 100, h: 130, scale: 3 });
    state.bringFrameIntoView(useEditorStore.getState().frames[0]!.id, { animate: false });
    expect(useEditorStore.getState().worldViewport).toMatchObject({ w: 100, h: 130, scale: 3 });
  });
  it("prevents a queued frame-focus animation from overwriting a pinch", () => {
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const state = useEditorStore.getState();
    state.resetProject();
    state.setWorldViewport({ x: -500, y: -500, w: 100, h: 100, scale: 1 });
    state.bringFrameIntoView(useEditorStore.getState().frames[0]!.id, { animate: true });
    expect(callbacks).toHaveLength(1);
    const manual = { x: 12, y: 24, w: 75, h: 100, scale: 2 };
    state.setWorldViewport(manual);
    callbacks[0]!(performance.now());
    expect(useEditorStore.getState().worldViewport).toEqual(manual);
    expect(callbacks).toHaveLength(1);
  });
});

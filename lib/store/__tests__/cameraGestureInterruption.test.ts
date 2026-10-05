import { afterEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "../editorStore";
import { computeFramesViewport } from "../actions/cameraActions";

afterEach(() => {
  useEditorStore.getState().setWorldViewport({});
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("manual camera gesture ownership", () => {
  it("glides to fit through intermediate views and allows a pan to interrupt it", () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const callbacks: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const state = useEditorStore.getState();
    state.resetProject();
    const initial = { x: -500, y: -500, w: 400, h: 400, scale: 2 };
    state.setWorldViewport(initial);
    const target = computeFramesViewport(useEditorStore.getState().frames);
    state.fitWorldToFrames();
    expect(useEditorStore.getState().worldViewport).toEqual(initial);
    now = 110;
    callbacks[0]!(now);
    const midway = useEditorStore.getState().worldViewport;
    expect(midway.x).toBeGreaterThan(initial.x);
    expect(midway.x).toBeLessThan(target.x);
    expect(midway.w).toBeLessThan(initial.w);
    expect(midway.w).toBeGreaterThan(target.w);
    now = 220;
    callbacks[1]!(now);
    expect(useEditorStore.getState().worldViewport).toEqual(target);

    state.setWorldViewport(initial);
    state.fitWorldToFrames();
    const pending = callbacks.at(-1)!;
    const manual = { ...initial, x: 12, y: 24 };
    state.setWorldViewport(manual);
    now += 300;
    pending(now);
    expect(useEditorStore.getState().worldViewport).toEqual(manual);
  });

  it("fits immediately when reduced motion is requested", () => {
    vi.stubGlobal("requestAnimationFrame", vi.fn());
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const state = useEditorStore.getState();
    state.resetProject();
    state.setWorldViewport({ x: -500, y: -500, w: 400, h: 400 });
    state.fitWorldToFrames();
    expect(useEditorStore.getState().worldViewport).toEqual(
      computeFramesViewport(useEditorStore.getState().frames),
    );
    expect(requestAnimationFrame).not.toHaveBeenCalled();
  });

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

// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import { advancePlaybackTime } from "@/lib/shapeshifter/motion/previewRange";
import { useEditorPlayback } from "../useEditorPlayback";
import {
  renderEditorComponent,
  type RenderedEditorComponent,
} from "../../__tests__/renderEditorComponent";

let rendered: RenderedEditorComponent | null;
let baseline: ReturnType<typeof useEditorStore.getState>;
let scheduled: Map<number, FrameRequestCallback>;
let nextId: number;
beforeEach(() => {
  baseline = useEditorStore.getState();
  useEditorStore.getState().resetProject();
  scheduled = new Map();
  nextId = 0;
  vi.spyOn(performance, "now").mockReturnValue(0);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    scheduled.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => scheduled.delete(id));
});
afterEach(() => {
  rendered?.unmount();
  rendered = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useEditorStore.setState(baseline, true);
});
function Harness() {
  useEditorPlayback();
  return null;
}
function frame(time: number) {
  const [id, callback] = scheduled.entries().next().value!;
  scheduled.delete(id);
  React.act(() => callback(time));
}

describe("work-area playback", () => {
  it("loops within the selected range, preserving all authored timing and one idle RAF boundary", () => {
    const store = useEditorStore.getState();
    const original = store.animation.blocks;
    const historyLength = store.history.length;
    store.setTimelinePreviewRange({ start: 200, end: 400 });
    useEditorStore.setState({ progress: 0.35, isPlaying: true });
    rendered = renderEditorComponent(<Harness />);
    frame(75);
    expect(useEditorStore.getState().progress).toBe(0.225);
    expect(useEditorStore.getState().animation.blocks).toBe(original);
    expect(useEditorStore.getState().history).toHaveLength(historyLength);
    React.act(() => store.togglePlayback());
    expect(scheduled.size).toBe(0);
    expect(useEditorStore.getState().progress).toBe(0.225);
  });

  it("does no paused preview work and resets the range when its owner changes", () => {
    const store = useEditorStore.getState();
    store.setProgress(0.9);
    store.setTimelinePreviewRange({ start: 200, end: 400 });
    const animation = useEditorStore.getState().animation;
    rendered = renderEditorComponent(<Harness />);
    expect(scheduled.size).toBe(0);
    expect(useEditorStore.getState().progress).toBe(0.9);
    expect(useEditorStore.getState().animation).toBe(animation);
    const nextOwner = store.frames.find((frame) => frame.id !== store.selectedFrameId)!;
    React.act(() => store.selectFrame(nextOwner.id));
    expect(useEditorStore.getState().timelinePreviewRange).toBeNull();
  });

  it("returns to full-duration playback after clearing the preview range", () => {
    const store = useEditorStore.getState();
    store.setTimelinePreviewRange({ start: 200, end: 400 });
    store.setTimelinePreviewRange(null);
    useEditorStore.setState({ progress: 0.95, isPlaying: true });
    rendered = renderEditorComponent(<Harness />);
    frame(75);
    expect(useEditorStore.getState().progress).toBe(0.025);
  });

  it("handles multiple wraps and stops at the range end when looping is disabled", () => {
    expect(advancePlaybackTime(350, 75, 1, 1000, { start: 200, end: 400 }, true)).toEqual({
      time: 225,
      finished: false,
    });
    expect(advancePlaybackTime(375, 525, 1, 1000, { start: 200, end: 400 }, true)).toEqual({
      time: 300,
      finished: false,
    });
    expect(advancePlaybackTime(350, 75, 1, 1000, { start: 200, end: 400 }, false)).toEqual({
      time: 400,
      finished: true,
    });
    expect(advancePlaybackTime(900, 10, 1, 1000, { start: 200, end: 400 }, true)).toEqual({
      time: 210,
      finished: false,
    });
  });
});

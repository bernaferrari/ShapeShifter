// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditorStore } from "@/lib/store/editorStore";
import {
  advancePlaybackTime,
  advanceBackAndForthPlaybackTime,
} from "@/lib/pathshift/motion/previewRange";
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
  it("reflects at each endpoint and preserves the return direction across pause/resume", () => {
    const store = useEditorStore.getState();
    store.setPlaybackMode("back-and-forth");
    useEditorStore.setState({ progress: 0.95, isPlaying: true });
    const animation = useEditorStore.getState().animation;
    const history = useEditorStore.getState().history;
    rendered = renderEditorComponent(<Harness />);
    frame(75);
    expect(useEditorStore.getState().progress).toBe(0.975);
    expect(useEditorStore.getState().playbackDirection).toBe(-1);
    React.act(() => store.togglePlayback());
    expect(scheduled.size).toBe(0);
    React.act(() => store.togglePlayback());
    frame(100);
    expect(useEditorStore.getState().progress).toBe(0.875);
    expect(useEditorStore.getState().animation).toBe(animation);
    expect(useEditorStore.getState().history).toBe(history);
  });

  it("returns through the selected range and stops at its start when looping is disabled", () => {
    const store = useEditorStore.getState();
    store.setPlaybackMode("back-and-forth");
    store.setTimelinePreviewRange({ start: 200, end: 400 });
    useEditorStore.setState({ progress: 0.35, isPlaying: true, isRepeating: false });
    rendered = renderEditorComponent(<Harness />);
    frame(75);
    expect(useEditorStore.getState().progress).toBe(0.375);
    expect(useEditorStore.getState().playbackDirection).toBe(-1);
    frame(300);
    expect(useEditorStore.getState().progress).toBe(0.2);
    expect(useEditorStore.getState().isPlaying).toBe(false);
    expect(scheduled.size).toBe(0);
  });

  it("starts back-and-forth playback at the end without jumping and resets direction when scrubbing", () => {
    const store = useEditorStore.getState();
    store.setPlaybackMode("back-and-forth");
    store.setProgress(1);
    store.togglePlayback();
    rendered = renderEditorComponent(<Harness />);
    expect(useEditorStore.getState().progress).toBe(1);
    frame(50);
    expect(useEditorStore.getState().progress).toBe(0.95);
    expect(useEditorStore.getState().playbackDirection).toBe(-1);
    React.act(() => store.setProgress(0.4));
    expect(useEditorStore.getState().playbackDirection).toBe(1);
    frame(100);
    expect(useEditorStore.getState().progress).toBe(0.45);
  });

  it("keeps fractional endpoints exact while crossing several return trips", () => {
    const range = { start: 100.25, end: 300.75 };
    expect(advanceBackAndForthPlaybackTime(290.75, 10, 1, 1000, range, true, 1)).toEqual({
      time: 300.75,
      direction: -1,
      finished: false,
    });
    expect(advanceBackAndForthPlaybackTime(100.25, 0, 1, 1000, range, true, -1)).toEqual({
      time: 100.25,
      direction: 1,
      finished: false,
    });
    expect(advanceBackAndForthPlaybackTime(100.25, 850, 1, 1000, range, true, 1)).toEqual({
      time: 148.25,
      direction: 1,
      finished: false,
    });
    expect(advanceBackAndForthPlaybackTime(900, 40, 0.25, 1000, range, true, -1)).toEqual({
      time: 110.25,
      direction: 1,
      finished: false,
    });
  });

  it("starts a fresh trip after creating a frame during the return direction", () => {
    const store = useEditorStore.getState();
    store.setPlaybackMode("back-and-forth");
    useEditorStore.setState({ progress: 0.95, isPlaying: true, isRepeating: false });
    rendered = renderEditorComponent(<Harness />);
    frame(75);
    expect(useEditorStore.getState().playbackDirection).toBe(-1);
    React.act(() => store.addFrame());
    expect(useEditorStore.getState().progress).toBe(0);
    expect(useEditorStore.getState().isPlaying).toBe(false);
    React.act(() => store.togglePlayback());
    frame(50);
    expect(useEditorStore.getState().progress).toBe(0.05);
    expect(useEditorStore.getState().playbackDirection).toBe(1);
    expect(useEditorStore.getState().isPlaying).toBe(true);
  });

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

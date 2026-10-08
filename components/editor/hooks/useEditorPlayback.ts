"use client";

import { useEffect } from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import {
  advanceBackAndForthPlaybackTime,
  advancePlaybackTime,
  resolveTimelinePreviewRange,
} from "@/lib/pathshift/motion/previewRange";

/** Runs the playhead only while playback is active, avoiding an idle RAF loop. */
export function useEditorPlayback() {
  const isPlaying = useEditorStore((state) => state.isPlaying);

  useEffect(() => {
    if (!isPlaying) return;

    let frameId = 0;
    let previousTime = performance.now();
    const tick = (time: number) => {
      const store = useEditorStore.getState();
      const elapsed = time - previousTime;
      previousTime = time;
      const duration = Math.max(1, store.animation.duration);
      const speed = store.isSlowMotion ? 0.25 : store.speed;
      const range = resolveTimelinePreviewRange(
        store.timelinePreviewRange,
        store.selectedFrameId,
        duration,
      );
      const args = [
        store.progress * duration,
        elapsed,
        speed,
        duration,
        range,
        store.isRepeating,
      ] as const;
      const next =
        store.playbackMode === "back-and-forth"
          ? advanceBackAndForthPlaybackTime(...args, store.playbackDirection)
          : { ...advancePlaybackTime(...args), direction: 1 as const };
      useEditorStore.setState({
        progress: next.time / duration,
        playbackDirection: next.direction,
        ...(next.finished && { isPlaying: false }),
      });
      if (!next.finished) frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying]);

  return isPlaying;
}

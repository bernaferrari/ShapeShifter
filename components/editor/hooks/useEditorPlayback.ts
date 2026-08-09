"use client";

import { useEffect } from "react";
import { useEditorStore } from "@/lib/store/editorStore";

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
      const nextProgress = store.progress + (elapsed * speed) / duration;

      if (nextProgress >= 1) {
        if (store.isRepeating) store.setProgress(nextProgress % 1);
        else {
          store.setProgress(1);
          store.togglePlayback();
        }
      } else {
        store.setProgress(nextProgress);
      }

      frameId = requestAnimationFrame(tick);
    };

    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [isPlaying]);

  return isPlaying;
}

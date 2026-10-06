"use client";

import { useEditorStore } from "@/lib/store/editorStore";
import { adjacentKeyframeTime } from "@/lib/shapeshifter/motion/timelineKeyframes";

const adjacent = (direction: -1 | 1) => {
  const { animation, progress } = useEditorStore.getState();
  const duration = Math.max(1, animation.duration);
  return adjacentKeyframeTime(animation.blocks, duration, progress * duration, direction);
};

/** Pauses and moves the playhead to the previous or next keyframe. */
export function stepToKeyframe(direction: -1 | 1) {
  const time = adjacent(direction);
  if (time === undefined) return;
  const store = useEditorStore.getState();
  if (store.isPlaying) store.togglePlayback();
  store.setProgress(time / Math.max(1, store.animation.duration));
}

/** Whether ‹ and › have somewhere to go, recomputed only when the answer changes. */
export function useKeyframeStops() {
  const hasPrevious = useEditorStore(() => adjacent(-1) !== undefined);
  const hasNext = useEditorStore(() => adjacent(1) !== undefined);
  return { hasPrevious, hasNext };
}

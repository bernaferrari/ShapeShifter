import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TimelineTimeUnit } from "./timelineScale";

export const TIMELINE_FRAME_RATES = [24, 30, 60] as const;

interface TimelineViewSettings {
  unit: TimelineTimeUnit;
  fps: number;
  snapping: boolean;
  showNextPose: boolean;
  /** After Effects' U: hide layers with no animation anywhere inside them. */
  animatedOnly: boolean;
  /** After Effects' graph editor: value curves instead of keyframe rows. */
  graph: boolean;
  setUnit: (unit: TimelineTimeUnit) => void;
  setFps: (fps: number) => void;
  setSnapping: (snapping: boolean) => void;
  setShowNextPose: (showNextPose: boolean) => void;
  setAnimatedOnly: (animatedOnly: boolean) => void;
  setGraph: (graph: boolean) => void;
}

/** View-only timeline preferences. They never touch the document or undo history. */
export const useTimelineViewSettings = create<TimelineViewSettings>()(
  persist(
    (set) => ({
      unit: "milliseconds",
      fps: 30,
      snapping: true,
      showNextPose: false,
      animatedOnly: false,
      graph: false,
      setUnit: (unit) => set({ unit }),
      setFps: (fps) => set({ fps }),
      setSnapping: (snapping) => set({ snapping }),
      setShowNextPose: (showNextPose) => set({ showNextPose }),
      setAnimatedOnly: (animatedOnly) => set({ animatedOnly }),
      setGraph: (graph) => set({ graph }),
    }),
    {
      name: "pathshift:timeline-view",
      partialize: ({ unit, fps, snapping, showNextPose, animatedOnly, graph }) => ({
        graph,
        unit,
        fps,
        snapping,
        showNextPose,
        animatedOnly,
      }),
    },
  ),
);

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { TimelineTimeUnit } from "./timelineScale";

export const TIMELINE_FRAME_RATES = [24, 30, 60] as const;

interface TimelineViewSettings {
  unit: TimelineTimeUnit;
  fps: number;
  snapping: boolean;
  setUnit: (unit: TimelineTimeUnit) => void;
  setFps: (fps: number) => void;
  setSnapping: (snapping: boolean) => void;
}

/** View-only timeline preferences. They never touch the document or undo history. */
export const useTimelineViewSettings = create<TimelineViewSettings>()(
  persist(
    (set) => ({
      unit: "milliseconds",
      fps: 30,
      snapping: true,
      setUnit: (unit) => set({ unit }),
      setFps: (fps) => set({ fps }),
      setSnapping: (snapping) => set({ snapping }),
    }),
    {
      name: "shapeshifter:timeline-view",
      partialize: ({ unit, fps, snapping }) => ({ unit, fps, snapping }),
    },
  ),
);

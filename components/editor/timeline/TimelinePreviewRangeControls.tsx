"use client";

import React from "react";
import { Repeat1 } from "lucide-react";
import { useEditorStore } from "@/lib/store/editorStore";
import { resolveTimelinePreviewRange } from "@/lib/shapeshifter/motion/previewRange";
import { cn } from "@/lib/utils";
import type { TimelineTimeUnit } from "./timelineScale";

export function TimelinePreviewRangeControls({
  unit,
  fps,
}: {
  unit: TimelineTimeUnit;
  fps: number;
}) {
  const animation = useEditorStore((state) => state.animation);
  const ownerId = useEditorStore((state) => state.selectedFrameId);
  const stored = useEditorStore((state) => state.timelinePreviewRange);
  const selectedIds = useEditorStore((state) => state.selectedBlockIds);
  const range = resolveTimelinePreviewRange(stored, ownerId, animation.duration);
  const blocks = animation.blocks.filter((block) => selectedIds.includes(block.id));
  const text = (time: number) =>
    String(Number((unit === "frames" ? (time * fps) / 1000 : time).toFixed(3)));
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <button
        type="button"
        aria-label="Preview selected motion range"
        aria-pressed={Boolean(range)}
        disabled={!range && !blocks.length}
        title={
          range
            ? `Preview range ${text(range.start)}–${text(range.end)} ${unit === "frames" ? "frames" : "ms"} · Click to preview full animation`
            : "Loop only the selected motion's time range"
        }
        onClick={() => {
          const store = useEditorStore.getState();
          store.setTimelinePreviewRange(
            range
              ? null
              : {
                  start: Math.min(...blocks.map((block) => block.startTime)),
                  end: Math.max(...blocks.map((block) => block.endTime)),
                },
          );
        }}
        className={cn(
          "flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[10px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-35",
          range
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground",
        )}
      >
        <Repeat1 className="size-3.5" />
        <span>
          {range
            ? `${text(range.start)}–${text(range.end)} ${unit === "frames" ? "f" : "ms"}`
            : "Range"}
        </span>
      </button>
      {range && (
        <button
          type="button"
          aria-label="Preview full animation"
          title="Reset preview range to the full duration"
          onClick={() => useEditorStore.getState().setTimelinePreviewRange(null)}
          className="h-6 shrink-0 rounded px-1.5 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Full
        </button>
      )}
    </div>
  );
}

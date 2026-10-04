"use client";

import React from "react";
import { ChevronLeft, ChevronRight, SkipBack, SkipForward } from "lucide-react";
import { useEditorStore } from "@/lib/store/editorStore";

export function TimelineTransportButtons({ fps }: { fps: number }) {
  const progress = useEditorStore((state) => state.progress);
  const animation = useEditorStore((state) => state.animation);
  const selectedIds = useEditorStore((state) => state.selectedBlockIds);
  const time = progress * animation.duration;
  const selectedTracks = new Set(
    animation.blocks
      .filter((block) => selectedIds.includes(block.id))
      .map((block) => `${block.layerId}\0${block.propertyName}`),
  );
  const blocks = selectedTracks.size
    ? animation.blocks.filter((block) =>
        selectedTracks.has(`${block.layerId}\0${block.propertyName}`),
      )
    : animation.blocks;
  const times = [...new Set(blocks.flatMap((block) => [block.startTime, block.endTime]))].sort(
    (a, b) => a - b,
  );
  const previous = times.filter((value) => value < time - 0.001).at(-1);
  const next = times.find((value) => value > time + 0.001);
  const seek = (time: number) => {
    const store = useEditorStore.getState();
    if (store.isPlaying) store.togglePlayback();
    store.setProgress(time / Math.max(1, store.animation.duration));
  };
  const controls = [
    {
      label: "Previous keyframe",
      icon: SkipBack,
      time: previous,
      disabled: previous === undefined,
    },
    {
      label: "Step back one frame",
      icon: ChevronLeft,
      time: time - 1000 / fps,
      disabled: progress <= 0,
    },
    {
      label: "Step forward one frame",
      icon: ChevronRight,
      time: time + 1000 / fps,
      disabled: progress >= 1,
    },
    { label: "Next keyframe", icon: SkipForward, time: next, disabled: next === undefined },
  ];
  return (
    <div className="flex items-center gap-0.5">
      {controls.map(({ label, icon: Icon, time, disabled }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          title={label}
          disabled={disabled}
          onClick={() => seek(time!)}
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-35"
        >
          <Icon className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

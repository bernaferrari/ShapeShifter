"use client";

import React from "react";
import { DiamondPlus } from "lucide-react";
import { useEditorStore } from "@/lib/store/editorStore";

export function TimelineInsertKeyframeButton({
  blockId,
  label = "Insert keyframe at playhead",
  iconOnly = false,
}: {
  blockId?: string;
  label?: string;
  iconOnly?: boolean;
}) {
  const progress = useEditorStore((state) => state.progress);
  const animation = useEditorStore((state) => state.animation);
  const selectedIds = useEditorStore((state) => state.selectedBlockIds);
  const time = progress * animation.duration;
  const trackKey = (block: (typeof animation.blocks)[number]) =>
    `${block.layerId}\0${block.propertyName}`;
  const tracks = new Set(
    animation.blocks.filter((block) => selectedIds.includes(block.id)).map(trackKey),
  );
  const candidates = [...animation.blocks]
    .sort((a, b) => b.startTime - a.startTime)
    .filter(
      (block) =>
        (blockId ? block.id === blockId : tracks.has(trackKey(block))) &&
        time >= block.startTime + 1 &&
        time <= block.endTime - 1,
    )
    .filter(
      (block, index, matches) =>
        matches.findIndex((item) => trackKey(item) === trackKey(block)) === index,
    );
  const retimesCurve = candidates.some(
    (block) => !block.interpolator || block.interpolator === "ACCELERATE_DECELERATE",
  );
  return (
    <button
      type="button"
      aria-label={label}
      title={
        candidates.length
          ? `${label} · ${Number(time.toFixed(3))} ms${candidates.length > 1 ? ` · ${candidates.length} tracks` : ""}${retimesCurve ? " · Applies Accelerate–decelerate to each new segment, changing transition timing" : ""}`
          : "Select an animation and move the playhead between its keyframes"
      }
      disabled={!candidates.length}
      onClick={() => {
        const store = useEditorStore.getState();
        const currentTime = store.progress * store.animation.duration;
        if (store.isPlaying) store.togglePlayback();
        store.beginHistoryGesture();
        try {
          const insertedIds: string[] = [];
          for (const candidate of candidates) {
            if (store.insertTimelineKeyframe(candidate.id, currentTime))
              insertedIds.push(...useEditorStore.getState().selectedBlockIds);
          }
          if (insertedIds.length) store.selectBlocks(insertedIds);
        } finally {
          store.endHistoryGesture();
        }
      }}
      className={
        iconOnly
          ? "grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-35"
          : "flex h-6 shrink-0 items-center gap-1 rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-35"
      }
    >
      <DiamondPlus className="size-3.5" />
      {!iconOnly && <span>Keyframe</span>}
    </button>
  );
}

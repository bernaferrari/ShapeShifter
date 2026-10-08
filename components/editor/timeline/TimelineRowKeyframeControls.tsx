"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Layer, TimelineBlock } from "@/lib/pathshift/types";
import {
  KEYFRAME_TIME_EPSILON,
  sameKeyframeTime,
  trackKeyframes,
} from "@/lib/pathshift/motion/timelineKeyframes";
import { useEditorStore } from "@/lib/store/editorStore";
import { KeyframeDiamond } from "../KeyframeDiamond";

/** Layer morphs and property tracks share the same ‹ ◆ › authoring controls. */
export function TimelineRowKeyframeControls({
  frameId,
  layer,
  propertyName,
  label,
  blocks,
  compact = false,
}: {
  frameId: string;
  layer: Layer;
  propertyName: string;
  label: string;
  blocks: TimelineBlock[];
  compact?: boolean;
}) {
  const currentTime = (state: ReturnType<typeof useEditorStore.getState>) =>
    state.selectedFrameId === frameId ? state.progress * state.animation.duration : 0;
  const times = blocks.flatMap((block) => [block.startTime, block.endTime]);
  // Subscribe to stops and keyed state, so playback doesn't redraw every row each frame.
  const previous = useEditorStore((state) => {
    const time = currentTime(state);
    return times.reduce<number | undefined>(
      (nearest, candidate) =>
        candidate < time - KEYFRAME_TIME_EPSILON && (nearest === undefined || candidate > nearest)
          ? candidate
          : nearest,
      undefined,
    );
  });
  const next = useEditorStore((state) => {
    const time = currentTime(state);
    return times.reduce<number | undefined>(
      (nearest, candidate) =>
        candidate > time + KEYFRAME_TIME_EPSILON && (nearest === undefined || candidate < nearest)
          ? candidate
          : nearest,
      undefined,
    );
  });
  const active = useEditorStore((state) =>
    times.some((time) => sameKeyframeTime(time, currentTime(state))),
  );
  const selectTrack = () => {
    let state = useEditorStore.getState();
    if (state.selectedFrameId !== frameId) state.selectFrame(frameId);
    state = useEditorStore.getState();
    if (state.isPlaying) state.togglePlayback();
    state.selectLayer(layer.id);
    useEditorStore.getState().selectBlocks(
      useEditorStore
        .getState()
        .animation.blocks.filter(
          (block) =>
            String(block.layerId) === String(layer.id) && block.propertyName === propertyName,
        )
        .map((block) => block.id),
    );
  };
  const seek = (time: number) => {
    selectTrack();
    const state = useEditorStore.getState();
    const key = trackKeyframes(
      state.animation.blocks.filter(
        (block) =>
          String(block.layerId) === String(layer.id) && block.propertyName === propertyName,
      ),
    ).find((item) => sameKeyframeTime(item.time, time));
    if (key) state.selectTimelineKeyframe(key.blockId, key.edge, false);
  };
  const toggle = () => {
    if (useEditorStore.getState().selectedFrameId !== frameId)
      useEditorStore.getState().selectFrame(frameId);
    useEditorStore.getState().addKeyframeAtPlayhead(layer.id, propertyName);
  };
  const keyLabel = active
    ? `Select ${label} keyframe`
    : blocks.length
      ? `Add ${label} keyframe`
      : `Animate ${label}`;

  return (
    <span
      className="flex shrink-0 items-center"
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") event.stopPropagation();
      }}
    >
      {!compact && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Previous ${label} keyframe`}
          title={`Previous ${label} keyframe`}
          disabled={previous === undefined}
          className="text-muted-foreground disabled:opacity-25"
          onClick={(event) => {
            event.stopPropagation();
            if (previous !== undefined) seek(previous);
          }}
        >
          <ChevronLeft className="size-3" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-xs"
        className="pointer-coarse:size-11"
        aria-label={keyLabel}
        aria-pressed={active}
        title={keyLabel}
        disabled={layer.locked}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
      >
        <KeyframeDiamond active={active} size={7} />
      </Button>
      {!compact && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Next ${label} keyframe`}
          title={`Next ${label} keyframe`}
          disabled={next === undefined}
          className="text-muted-foreground disabled:opacity-25"
          onClick={(event) => {
            event.stopPropagation();
            if (next !== undefined) seek(next);
          }}
        >
          <ChevronRight className="size-3" />
        </Button>
      )}
    </span>
  );
}

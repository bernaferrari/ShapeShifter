"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Layer, TimelineBlock } from "@/lib/shapeshifter/types";
import { layerAtTime, pathDAtTime } from "@/lib/shapeshifter/playheadResolve";
import { useEditorStore } from "@/lib/store/editorStore";
import { TimelineKeyframeDiamond } from "./TimelinePropertyBlock";

/** Layer morphs and property tracks share the same ‹ ◆ › authoring controls. */
export function TimelineRowKeyframeControls({
  frameId,
  layer,
  propertyName,
  label,
  blocks,
}: {
  frameId: string;
  layer: Layer;
  propertyName: string;
  label: string;
  blocks: TimelineBlock[];
}) {
  const currentTime = (state: ReturnType<typeof useEditorStore.getState>) =>
    state.selectedFrameId === frameId ? state.progress * state.animation.duration : 0;
  const times = blocks.flatMap((block) => [block.startTime, block.endTime]);
  // Subscribe to stops and keyed state, so playback doesn't redraw every row each frame.
  const previous = useEditorStore((state) => {
    const time = currentTime(state);
    return times.reduce<number | undefined>(
      (nearest, candidate) =>
        candidate < time - 0.5 && (nearest === undefined || candidate > nearest)
          ? candidate
          : nearest,
      undefined,
    );
  });
  const next = useEditorStore((state) => {
    const time = currentTime(state);
    return times.reduce<number | undefined>(
      (nearest, candidate) =>
        candidate > time + 0.5 && (nearest === undefined || candidate < nearest)
          ? candidate
          : nearest,
      undefined,
    );
  });
  const active = useEditorStore((state) =>
    times.some((time) => Math.abs(time - currentTime(state)) <= 0.5),
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
    state.setProgress(time / Math.max(1, state.animation.duration));
  };
  const toggle = () => {
    selectTrack();
    const state = useEditorStore.getState();
    const time = state.progress * state.animation.duration;
    const track = state.animation.blocks.filter(
      (block) => String(block.layerId) === String(layer.id) && block.propertyName === propertyName,
    );
    const keyed = track.find(
      (block) => Math.abs(block.startTime - time) <= 0.5 || Math.abs(block.endTime - time) <= 0.5,
    );
    state.beginHistoryGesture();
    try {
      if (keyed) {
        if (track.length === 1 && keyed.startTime === keyed.endTime)
          state.removeTimelineProperty(layer.id, propertyName);
        else
          state.removeTimelineKeyframe(
            keyed.id,
            Math.abs(keyed.startTime - time) <= 0.5 ? "start" : "end",
          );
      } else {
        const pose = layerAtTime(layer, state.animation.blocks, time, state.animation.duration);
        const value =
          propertyName === "pathData"
            ? pathDAtTime(
                layer,
                state.animation.blocks,
                time,
                state.animation.duration,
                state.progress,
              )
            : (pose as unknown as Record<string, string | number>)[propertyName];
        if (!track.length) state.addTimelineBlock(layer.id, propertyName);
        if (value !== undefined)
          useEditorStore.getState().setPropertiesAtPlayhead(layer.id, { [propertyName]: value });
      }
    } finally {
      useEditorStore.getState().endHistoryGesture();
    }
  };
  const keyLabel = active
    ? `Remove ${label} keyframe`
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
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={keyLabel}
        aria-pressed={active}
        title={keyLabel}
        disabled={layer.locked}
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
      >
        <TimelineKeyframeDiamond active={active} size={7} />
      </Button>
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
    </span>
  );
}

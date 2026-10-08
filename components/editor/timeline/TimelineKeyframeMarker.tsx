"use client";

import React from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import { holdToDrag } from "@/lib/touchIntent";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import {
  sameKeyframeTime,
  timelineKeyframeRange,
  type TrackKeyframe,
} from "@/lib/shapeshifter/motion/timelineKeyframes";
import type { TimelineBlock } from "@/lib/shapeshifter/types";
import { KeyframeDiamond } from "../KeyframeDiamond";
import { TimelineKeyframeEditor } from "./TimelineKeyframeEditor";
import { useTimelineGesture } from "./useTimelineGesture";
import type { TimelineSnapTarget } from "./timelineTiming";

export function TimelineKeyframeMarker({
  block,
  edge,
  keys,
  duration,
  gridStep,
  keyboardStep,
  snapping,
  onSnapChange,
}: {
  block: TimelineBlock;
  edge: "start" | "end";
  keys: TrackKeyframe[];
  duration: number;
  gridStep: number;
  keyboardStep: number;
  snapping: boolean;
  onSnapChange?: (target: TimelineSnapTarget | null) => void;
}) {
  const time = edge === "start" ? block.startTime : block.endTime;
  const label = propertyLabel(block.propertyName);
  const selected = useEditorStore(
    (state) => state.selectedKeyframe?.blockId === block.id && state.selectedKeyframe.edge === edge,
  );
  const current = useEditorStore((state) =>
    sameKeyframeTime(state.progress * state.animation.duration, time),
  );
  const open = useEditorStore(
    (state) =>
      state.keyframeEditorOpen &&
      state.selectedKeyframe?.blockId === block.id &&
      state.selectedKeyframe.edge === edge &&
      !state.isPlaying,
  );
  const gesture = useTimelineGesture({ gridStep, snapping, onSnapChange });
  const suppressClick = React.useRef(false);
  const index = keys.findIndex((key) => key.blockId === block.id && key.edge === edge);
  const previous = keys[index - 1];
  const next = keys[index + 1];
  // Adjacent keys divide the lane at their midpoint; dense keys never steal each other's taps.
  const hitSpan = Math.min(
    previous ? time - previous.time : Infinity,
    next ? next.time - time : Infinity,
  );
  const select = (show = true) =>
    useEditorStore.getState().selectTimelineKeyframe(block.id, edge, show);
  const end = (event: React.PointerEvent<HTMLElement>, cancelled = false) => {
    suppressClick.current = gesture.moved.current;
    gesture.end(event, cancelled);
  };
  return (
    <TimelineKeyframeEditor
      block={block}
      edge={edge}
      duration={duration}
      keys={keys}
      open={open}
      onOpenChange={(show) => {
        const state = useEditorStore.getState();
        if (state.selectedKeyframe?.blockId === block.id && state.selectedKeyframe.edge === edge)
          state.setKeyframeEditorOpen(show);
      }}
      trigger={
        <button
          type="button"
          data-timeline-keyframe-block-id={block.id}
          data-timeline-keyframe-edge={edge}
          data-keyframe-current={current}
          aria-pressed={selected}
          aria-label={`${label} ${edge} keyframe at ${time} milliseconds`}
          title={`${label} keyframe · ${time} ms · Click to edit · Hold and drag to retime`}
          className="pointer-events-auto absolute top-1/2 z-10 flex size-5 pointer-coarse:size-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-sm p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-foreground"
          style={{
            left: `${(time / duration) * 100}%`,
            maxWidth: Number.isFinite(hitSpan) ? `${(hitSpan / duration) * 100}%` : undefined,
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            if (event.pointerType !== "touch") event.stopPropagation();
            holdToDrag<React.PointerEvent<HTMLElement>>((pointer) => {
              const progress = useEditorStore.getState().progress;
              select(false);
              useEditorStore.getState().setProgress(progress);
              suppressClick.current = false;
              gesture.begin(pointer, [block.id], edge);
            })(event);
          }}
          onPointerMove={gesture.move}
          onPointerUp={(event) => end(event)}
          onPointerCancel={(event) => end(event, true)}
          onLostPointerCapture={(event) => end(event, true)}
          onClick={(event) => {
            event.stopPropagation();
            if (suppressClick.current) {
              suppressClick.current = false;
              return;
            }
            select();
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            select();
          }}
          onContextMenu={(event) => {
            event.preventDefault();
            event.stopPropagation();
            select();
          }}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              const neighbor = event.key === "ArrowUp" ? previous : next;
              if (neighbor)
                useEditorStore.getState().selectTimelineKeyframe(neighbor.blockId, neighbor.edge);
              return;
            }
            select(false);
            const [min, max] = timelineKeyframeRange(
              useEditorStore.getState().animation.blocks,
              block,
              edge,
              duration,
            );
            const value = Math.max(
              min,
              Math.min(
                max,
                time +
                  (event.key === "ArrowLeft" ? -1 : 1) * keyboardStep * (event.shiftKey ? 10 : 1),
              ),
            );
            useEditorStore.getState().updateTimelineKeyframe(block.id, edge, { time: value });
            useEditorStore.getState().setProgress(value / duration);
          }}
        >
          <KeyframeDiamond active={current} selected={selected} size={9} />
        </button>
      }
    />
  );
}

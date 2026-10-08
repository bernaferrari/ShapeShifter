"use client";

import React from "react";
import { TimelineKeyframeMarker } from "./TimelineKeyframeMarker";
import { TimelineSegmentEasing } from "./TimelineSegmentEasing";
import { trackKeyframes, type TrackKeyframe } from "@/lib/pathshift/motion/timelineKeyframes";
import { propertyLabel } from "@/lib/pathshift/propertyLabels";
import type { TimelineBlock } from "@/lib/pathshift/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { holdToDrag, usePressType } from "@/lib/touchIntent";
import { cn } from "@/lib/utils";
import type { TimelineSnapTarget } from "./timelineTiming";
import { useTimelineGesture } from "./useTimelineGesture";

export function TimelinePropertyBlock({
  block,
  duration,
  selected,
  gridStep = 50,
  keyboardStep = 1,
  snapping = true,
  onSnapChange,
  trackKeys,
}: {
  block: TimelineBlock;
  duration: number;
  selected: boolean;
  gridStep?: number;
  keyboardStep?: number;
  snapping?: boolean;
  onSnapChange?: (target: TimelineSnapTarget | null) => void;
  trackKeys?: TrackKeyframe[];
}) {
  const gesture = useTimelineGesture({ gridStep, snapping, onSnapChange });
  const blocks = useEditorStore((state) => (trackKeys ? undefined : state.animation.blocks));
  const keys = React.useMemo(
    () =>
      trackKeys ??
      trackKeyframes(
        (blocks ?? []).filter(
          (item) =>
            String(item.layerId) === String(block.layerId) &&
            item.propertyName === block.propertyName,
        ),
      ),
    [blocks, block.layerId, block.propertyName, trackKeys],
  );
  const suppressClickRef = React.useRef(false);
  const label = propertyLabel(block.propertyName);
  const startPct = (block.startTime / duration) * 100;
  const endPct = (block.endTime / duration) * 100;

  const press = usePressType();
  // Touch picks a segment or keyframe up only after a still hold, so a swipe
  // that starts on one scrolls the timeline instead of retiming it.
  const pickUp =
    (start: (event: React.PointerEvent<HTMLElement>) => void) =>
    (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      if (event.pointerType !== "touch") event.stopPropagation();
      holdToDrag(start)(event);
    };

  const handleDragStart = pickUp((event) => {
    const store = useEditorStore.getState();
    const previous = store.selectedBlockIds;
    const modified = event.shiftKey || event.metaKey || event.ctrlKey;
    const ids = modified
      ? previous.includes(block.id)
        ? previous.filter((id) => id !== block.id)
        : [...previous, block.id]
      : previous.includes(block.id)
        ? previous
        : [block.id];
    if (String(store.selectedLayerId) !== String(block.layerId) || store.selectionKind !== "layer")
      store.selectLayer(block.layerId);
    store.selectBlocks(ids);
    suppressClickRef.current = false;
    if (ids.includes(block.id)) gesture.begin(event, ids);
  });

  const endGesture = (event: React.PointerEvent<HTMLElement>, cancelled = false) => {
    suppressClickRef.current = gesture.moved.current;
    gesture.end(event, cancelled);
  };

  return (
    <div className="group/segment pointer-events-none absolute inset-0 z-[1]">
      <button
        type="button"
        data-timeline-block-id={block.id}
        aria-label={`Select ${label} animation from ${block.startTime} to ${block.endTime} milliseconds`}
        aria-pressed={selected}
        className={cn(
          "pointer-events-auto absolute top-1/2 h-5 -translate-y-1/2 cursor-grab touch-none rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing",
          selected ? "text-primary" : "text-primary/80 hover:text-primary",
        )}
        style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        title={`${label}: ${block.startTime}–${block.endTime} ms · Snap to keys and playhead · Alt-drag for precise timing`}
        onPointerDownCapture={press.onPointerDownCapture}
        onPointerDown={handleDragStart}
        onPointerMove={gesture.move}
        onPointerUp={(event) => endGesture(event)}
        onPointerCancel={(event) => endGesture(event, true)}
        onLostPointerCapture={(event) => endGesture(event, true)}
        onClick={(event) => {
          event.stopPropagation();
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (event.detail === 0 || press.ref.current === "touch") {
            const store = useEditorStore.getState();
            store.selectLayer(block.layerId);
            store.selectBlocks([block.id]);
          }
        }}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
          event.preventDefault();
          if (event.key === "ArrowUp" || event.key === "ArrowDown") return;
          useEditorStore
            .getState()
            .moveTimelineBlocks(
              selected ? useEditorStore.getState().selectedBlockIds : [block.id],
              (event.key === "ArrowLeft" ? -1 : 1) * keyboardStep * (event.shiftKey ? 10 : 1),
            );
        }}
      >
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-current transition-opacity",
            selected ? "opacity-100" : "opacity-60",
          )}
        />
      </button>
      {keys
        .filter((key) => key.blockId === block.id)
        .map((key) => (
          <TimelineKeyframeMarker
            key={key.edge}
            block={block}
            edge={key.edge}
            keys={keys}
            duration={duration}
            gridStep={gridStep}
            keyboardStep={keyboardStep}
            snapping={snapping}
            onSnapChange={onSnapChange}
          />
        ))}
      {block.startTime !== block.endTime && (
        <TimelineSegmentEasing block={block} startPct={startPct} endPct={endPct} />
      )}
    </div>
  );
}

"use client";

import React from "react";
import { useInspectorView } from "../inspector/inspectorView";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import type { TimelineBlock } from "@/lib/shapeshifter/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { holdToDrag, usePressType } from "@/lib/touchIntent";
import { cn } from "@/lib/utils";
import type { TimelineSnapTarget } from "./timelineTiming";
import { useTimelineGesture } from "./useTimelineGesture";
import { TimelineKeyframeEditor } from "./TimelineKeyframeEditor";
import {
  interpolatorControlPoints,
  timelineKeyframeRange,
} from "@/lib/shapeshifter/motion/timelineKeyframes";

export function TimelineKeyframeDiamond({
  active,
  size = 7,
  className,
}: {
  active?: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "block shrink-0 rotate-45 rounded-[0.5px] border border-solid transition-colors",
        active ? "bg-primary" : "bg-card hover:bg-primary/20",
        className,
      )}
      style={{
        width: size,
        height: size,
        boxSizing: "border-box",
        borderColor: "var(--primary)",
        borderWidth: 1.25,
        backgroundColor: active ? "var(--primary)" : undefined,
        transformOrigin: "center center",
      }}
      aria-hidden
    />
  );
}

export function TimelinePropertyBlock({
  block,
  duration,
  selected,
  gridStep = 50,
  keyboardStep = 1,
  snapping = true,
  onSnapChange,
}: {
  block: TimelineBlock;
  duration: number;
  selected: boolean;
  gridStep?: number;
  keyboardStep?: number;
  snapping?: boolean;
  onSnapChange?: (target: TimelineSnapTarget | null) => void;
}) {
  const gesture = useTimelineGesture({ gridStep, snapping, onSnapChange });
  const [editingEdge, setEditingEdge] = React.useState<"start" | "end" | null>(null);
  const suppressClickRef = React.useRef(false);
  const label = propertyLabel(block.propertyName);
  const interpolator = block.interpolator || "ACCELERATE_DECELERATE";
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

  const handleResizeStart = (edge: "start" | "end") =>
    pickUp((event) => {
      const store = useEditorStore.getState();
      store.selectLayer(block.layerId);
      store.selectBlocks([block.id]);
      suppressClickRef.current = false;
      gesture.begin(event, [block.id], edge);
    });

  const endGesture = (event: React.PointerEvent<HTMLElement>, cancelled = false) => {
    suppressClickRef.current = gesture.moved.current;
    gesture.end(event, cancelled);
  };

  const jumpTo = (milliseconds: number) => {
    const store = useEditorStore.getState();
    if (store.isPlaying) store.togglePlayback();
    store.setProgress(Math.max(0, Math.min(1, milliseconds / duration)));
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
      {(block.startTime === block.endTime
        ? ["start" as const]
        : ["start" as const, "end" as const]
      ).map((edge) => {
        const milliseconds = edge === "start" ? block.startTime : block.endTime;
        return (
          <TimelineKeyframeEditor
            key={edge}
            block={block}
            edge={edge}
            duration={duration}
            open={editingEdge === edge}
            onOpenChange={(open) => setEditingEdge(open ? edge : null)}
            trigger={
              <button
                type="button"
                data-timeline-keyframe-block-id={block.id}
                data-timeline-keyframe-edge={edge}
                className="pointer-events-auto absolute top-1/2 z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-sm p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                style={{ left: `${edge === "start" ? startPct : endPct}%` }}
                title={`Keyframe @ ${milliseconds} ms · Double-click or Enter to edit · Alt-drag for precise timing`}
                aria-label={`${label} ${edge} keyframe at ${milliseconds} milliseconds`}
                onPointerDown={handleResizeStart(edge)}
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
                  const store = useEditorStore.getState();
                  store.selectLayer(block.layerId);
                  store.selectBlocks([block.id]);
                  jumpTo(milliseconds);
                  if (event.detail === 0) setEditingEdge(edge);
                }}
                onKeyDown={(event) => {
                  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key))
                    return;
                  event.preventDefault();
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") return;
                  const direction = event.key === "ArrowLeft" ? -1 : 1;
                  const [min, max] = timelineKeyframeRange(
                    useEditorStore.getState().animation.blocks,
                    block,
                    edge,
                    duration,
                  );
                  const time = Math.max(
                    min,
                    Math.min(
                      max,
                      milliseconds + direction * keyboardStep * (event.shiftKey ? 10 : 1),
                    ),
                  );
                  if (time !== milliseconds)
                    useEditorStore.getState().updateTimelineKeyframe(block.id, edge, { time });
                  jumpTo(time);
                }}
                onDoubleClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setEditingEdge(edge);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  const store = useEditorStore.getState();
                  store.selectLayer(block.layerId);
                  store.selectBlocks([block.id]);
                  jumpTo(milliseconds);
                  setEditingEdge(edge);
                }}
              >
                <TimelineKeyframeDiamond active={selected} size={9} />
              </button>
            }
          />
        );
      })}
      {/* Easing lives in the middle of the segment and only appears on hover (Figma). */}
      <div
        className="pointer-events-auto absolute top-1/2 z-[3] -translate-x-1/2 -translate-y-1/2"
        style={{ left: `${(startPct + endPct) / 2}%` }}
      >
        <button
          type="button"
          className="grid size-5 place-items-center rounded-md border border-border bg-card text-primary opacity-0 shadow-sm outline-none transition-opacity hover:bg-muted focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/segment:opacity-100 pointer-coarse:size-6 pointer-coarse:opacity-100"
          // Keep the chip square on phones, where buttons otherwise default to 44px tall.
          style={{ minHeight: 0 }}
          title="Easing"
          aria-label={`Edit ${label} easing`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            const store = useEditorStore.getState();
            store.selectLayer(block.layerId);
            store.selectBlocks([block.id]);
            useInspectorView.getState().openEasing(block.id);
          }}
        >
          <EasingGlyph points={interpolatorControlPoints(interpolator)} size={11} />
        </button>
      </div>
    </div>
  );
}

/** A tiny drawing of an easing curve, used for presets and the segment chip. */
function EasingGlyph({
  points,
  size,
  className,
}: {
  points: [number, number, number, number];
  size: number;
  className?: string;
}) {
  const [x1, y1, x2, y2] = points;
  const p = (x: number, y: number) => `${1 + x * 10} ${11 - y * 10}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d={`M${p(0, 0)} C${p(x1, y1)} ${p(x2, y2)} ${p(1, 1)}`}
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

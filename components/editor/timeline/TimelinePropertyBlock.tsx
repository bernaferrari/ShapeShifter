"use client";

import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import type { InterpolatorName, TimelineBlock } from "@/lib/shapeshifter/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { cn } from "@/lib/utils";
import { LiveEasingCurve } from "./TimelineLiveState";
import { snapTimeOffset } from "./timelineTiming";
import {
  interpolatorControlPoints,
  timelineBlockStartRange,
  timelineKeyframeRange,
} from "@/lib/shapeshifter/motion/timelineKeyframes";

const INTERPOLATOR_OPTIONS: { value: InterpolatorName | string; label: string; hint: string }[] = [
  { value: "FAST_OUT_SLOW_IN", label: "Standard", hint: "Smooth acceleration and settling" },
  { value: "LINEAR_OUT_SLOW_IN", label: "Decelerate", hint: "Fast start, gentle finish" },
  { value: "FAST_OUT_LINEAR_IN", label: "Accelerate", hint: "Gentle start, fast finish" },
  {
    value: "ACCELERATE_DECELERATE",
    label: "Accelerate–decelerate",
    hint: "Balanced start and finish",
  },
  { value: "LINEAR", label: "Linear", hint: "Constant speed" },
];

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

type DragSession = {
  startX: number;
  originalStart: number;
  originalEnd: number;
  historyRecorded: boolean;
  moved: boolean;
};

type ResizeSession = DragSession & { edge: "start" | "end" };

function trackWidth(element: HTMLElement): number {
  const track = element.closest("[data-timeline-row]") as HTMLElement | null;
  return Math.max(1, track?.getBoundingClientRect().width ?? 300);
}

export function TimelinePropertyBlock({
  block,
  duration,
  selected,
  gridStep = 50,
  keyboardStep = 1,
}: {
  block: TimelineBlock;
  duration: number;
  selected: boolean;
  gridStep?: number;
  keyboardStep?: number;
}) {
  const dragRef = React.useRef<DragSession | null>(null);
  const resizeRef = React.useRef<ResizeSession | null>(null);
  const easingEditRef = React.useRef<{ changed: boolean } | null>(null);
  const suppressClickRef = React.useRef(false);
  const label = propertyLabel(block.propertyName);
  const interpolator = block.interpolator || "ACCELERATE_DECELERATE";
  const startPct = (block.startTime / duration) * 100;
  const endPct = (block.endTime / duration) * 100;

  const recordGestureHistory = (session: DragSession) => {
    if (session.historyRecorded) return;
    useEditorStore.getState().pushHistory();
    session.historyRecorded = true;
  };

  const finishPointerGesture = (
    event: React.PointerEvent,
    session: DragSession | null,
    cancelled: boolean,
  ) => {
    if (cancelled && session?.historyRecorded) {
      useEditorStore.getState().cancelLastHistoryTransaction();
    }
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // The element can lose capture when the browser cancels the gesture.
    }
  };

  const handleDragStart = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      originalStart: block.startTime,
      originalEnd: block.endTime,
      historyRecorded: false,
      moved: false,
    };
    suppressClickRef.current = false;
    const store = useEditorStore.getState();
    if (String(store.selectedLayerId) !== String(block.layerId) || store.selectionKind !== "layer")
      store.selectLayer(block.layerId);
    if (event.shiftKey || event.metaKey || event.ctrlKey) store.toggleBlockSelection(block.id);
    else store.selectBlocks([block.id]);
  };

  const handleDragMove = (event: React.PointerEvent) => {
    const session = dragRef.current;
    if (!session) return;
    const deltaTime =
      ((event.clientX - session.startX) / trackWidth(event.currentTarget as HTMLElement)) *
      duration;
    const [min, max] = timelineBlockStartRange(
      useEditorStore.getState().animation.blocks,
      block,
      duration,
    );
    const nextStart = Math.max(
      min,
      Math.min(max, session.originalStart + snapTimeOffset(deltaTime, event.altKey, gridStep)),
    );
    if (nextStart === block.startTime) return;
    session.moved = true;
    recordGestureHistory(session);
    useEditorStore
      .getState()
      .moveTimelineBlock(block.id, nextStart - block.startTime, { recordHistory: false });
  };

  const endDrag = (event: React.PointerEvent, cancelled = false) => {
    const session = dragRef.current;
    dragRef.current = null;
    suppressClickRef.current = Boolean(session?.moved);
    finishPointerGesture(event, session, cancelled);
  };

  const handleResizeStart = (edge: "start" | "end") => (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeRef.current = {
      edge,
      startX: event.clientX,
      originalStart: block.startTime,
      originalEnd: block.endTime,
      historyRecorded: false,
      moved: false,
    };
    suppressClickRef.current = false;
    const store = useEditorStore.getState();
    if (String(store.selectedLayerId) !== String(block.layerId) || store.selectionKind !== "layer")
      store.selectLayer(block.layerId);
    store.selectBlocks([block.id]);
  };

  const handleResizeMove = (event: React.PointerEvent) => {
    const session = resizeRef.current;
    if (!session) return;
    const deltaTime =
      ((event.clientX - session.startX) / trackWidth(event.currentTarget as HTMLElement)) *
      duration;
    const [min, max] = timelineKeyframeRange(
      useEditorStore.getState().animation.blocks,
      block,
      session.edge,
      duration,
    );
    const original = session.edge === "start" ? session.originalStart : session.originalEnd;
    const time = Math.max(
      min,
      Math.min(max, original + snapTimeOffset(deltaTime, event.altKey, gridStep)),
    );
    if (time === (session.edge === "start" ? block.startTime : block.endTime)) return;
    session.moved = true;
    recordGestureHistory(session);
    useEditorStore
      .getState()
      .updateTimelineKeyframe(block.id, session.edge, { time }, { recordHistory: false });
  };

  const endResize = (event: React.PointerEvent, cancelled = false) => {
    const session = resizeRef.current;
    resizeRef.current = null;
    suppressClickRef.current = Boolean(session?.moved);
    finishPointerGesture(event, session, cancelled);
  };

  const jumpTo = (milliseconds: number) => {
    const store = useEditorStore.getState();
    if (store.isPlaying) store.togglePlayback();
    store.setProgress(Math.max(0, Math.min(1, milliseconds / duration)));
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-[1]">
      <button
        type="button"
        data-timeline-block-id={block.id}
        aria-label={`Select ${label} animation from ${block.startTime} to ${block.endTime} milliseconds`}
        aria-pressed={selected}
        className={cn(
          "pointer-events-auto absolute top-1/2 h-5 -translate-y-1/2 cursor-grab touch-none rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing",
          selected ? "text-primary" : "text-primary/60 hover:text-primary",
        )}
        style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        title={`${label}: ${block.startTime}–${block.endTime} ms · Alt-drag for precise timing`}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={(event) => endDrag(event)}
        onPointerCancel={(event) => endDrag(event, true)}
        onClick={(event) => {
          event.stopPropagation();
          if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
          }
          if (event.detail === 0) {
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
            .moveTimelineBlock(
              block.id,
              (event.key === "ArrowLeft" ? -1 : 1) * keyboardStep * (event.shiftKey ? 10 : 1),
            );
        }}
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-current"
        />
      </button>
      {(["start", "end"] as const).map((edge) => {
        const milliseconds = edge === "start" ? block.startTime : block.endTime;
        return (
          <button
            key={edge}
            type="button"
            data-timeline-keyframe-block-id={block.id}
            data-timeline-keyframe-edge={edge}
            className="pointer-events-auto absolute top-1/2 z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none items-center justify-center rounded-sm p-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
            style={{ left: `${edge === "start" ? startPct : endPct}%` }}
            title={`Keyframe @ ${milliseconds} ms · Alt-drag for precise timing · Arrow keys to nudge`}
            aria-label={`${label} ${edge} keyframe at ${milliseconds} milliseconds`}
            onPointerDown={handleResizeStart(edge)}
            onPointerMove={handleResizeMove}
            onPointerUp={(event) => endResize(event)}
            onPointerCancel={(event) => endResize(event, true)}
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
            }}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
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
                Math.min(max, milliseconds + direction * keyboardStep * (event.shiftKey ? 10 : 1)),
              );
              if (time !== milliseconds)
                useEditorStore.getState().updateTimelineKeyframe(block.id, edge, { time });
              jumpTo(time);
            }}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              useEditorStore.getState().removeTimelineKeyframe(block.id, edge);
            }}
          >
            <TimelineKeyframeDiamond active={selected} />
          </button>
        );
      })}
      {selected && (
        <div
          className="pointer-events-auto absolute -top-4 z-[3] -translate-x-1/2"
          style={{ left: `${(startPct + endPct) / 2}%` }}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="flex size-5 items-center justify-center rounded-[3px] border border-border bg-card text-primary shadow-sm outline-none hover:border-primary/45 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  title={`Interpolator: ${INTERPOLATOR_OPTIONS.find((option) => option.value === interpolator)?.label ?? interpolator}`}
                  aria-label={`Edit ${label} easing`}
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={(event) => event.stopPropagation()}
                />
              }
            >
              {interpolator === "LINEAR" ? (
                <svg width="11" height="9" viewBox="0 0 12 10" fill="none" aria-hidden>
                  <path
                    d="M1.5 8.5 L10.5 1.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              ) : (
                <svg width="11" height="9" viewBox="0 0 12 10" fill="none" aria-hidden>
                  <path
                    d="M1 8.5C3.5 8.5 4 1.5 11 1.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="w-56 text-xs" side="top">
              <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                Easing
              </div>
              <div
                className="flex justify-center border-b border-border/60 px-2 py-2"
                onPointerDown={(event) => event.stopPropagation()}
              >
                <LiveEasingCurve
                  block={block}
                  size={88}
                  points={interpolatorControlPoints(interpolator)}
                  onEditStart={() => {
                    easingEditRef.current = { changed: false };
                  }}
                  onEditEnd={() => {
                    easingEditRef.current = null;
                  }}
                  onEditCancel={() => {
                    if (easingEditRef.current?.changed)
                      useEditorStore.getState().cancelLastHistoryTransaction();
                    easingEditRef.current = null;
                  }}
                  onChange={([x1, y1, x2, y2]) => {
                    const next = `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`;
                    if (next === block.interpolator) return;
                    const session = easingEditRef.current;
                    if (session && !session.changed) {
                      useEditorStore.getState().pushHistory();
                      session.changed = true;
                    }
                    useEditorStore
                      .getState()
                      .updateTimelineBlock(
                        block.id,
                        { interpolator: next },
                        { recordHistory: !session },
                      );
                  }}
                />
              </div>
              {INTERPOLATOR_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  className={cn(interpolator === option.value && "bg-primary/10 text-primary")}
                  onClick={(event) => {
                    event.stopPropagation();
                    useEditorStore
                      .getState()
                      .updateTimelineBlock(block.id, { interpolator: option.value });
                  }}
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span>{option.label}</span>
                    <span className="text-[10px] text-muted-foreground">{option.hint}</span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}

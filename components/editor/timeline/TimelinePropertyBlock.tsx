"use client";

import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { INTERPOLATOR_CURVES } from "@/lib/shapeshifter/interpolators";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import type { InterpolatorName, TimelineBlock } from "@/lib/shapeshifter/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { cn } from "@/lib/utils";
import { LiveEasingCurve } from "./TimelineLiveState";

const FIGMA_BLUE = "#0C8CE9";
const SNAP_MS = 50;

const INTERPOLATOR_OPTIONS: { value: InterpolatorName | string; label: string; hint: string }[] = [
  { value: "FAST_OUT_SLOW_IN", label: "Standard", hint: "fast_out_slow_in" },
  { value: "LINEAR_OUT_SLOW_IN", label: "Decelerate", hint: "linear_out_slow_in" },
  { value: "FAST_OUT_LINEAR_IN", label: "Accelerate", hint: "fast_out_linear_in" },
  { value: "ACCELERATE_DECELERATE", label: "Accelerate–decelerate", hint: "accelerate_decelerate" },
  { value: "LINEAR", label: "Linear", hint: "linear" },
];

function curvePointsFor(interpolator: string | undefined): [number, number, number, number] {
  if (interpolator && interpolator in INTERPOLATOR_CURVES) {
    return INTERPOLATOR_CURVES[interpolator as InterpolatorName];
  }
  const match = interpolator?.match(
    /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/i,
  );
  if (match) return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  return INTERPOLATOR_CURVES.FAST_OUT_SLOW_IN;
}

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
        active ? "bg-[#0C8CE9]" : "bg-[#2C2C2C] hover:bg-[#0C8CE9]/20",
        className,
      )}
      style={{
        width: size,
        height: size,
        boxSizing: "border-box",
        borderColor: FIGMA_BLUE,
        borderWidth: 1.25,
        backgroundColor: active ? FIGMA_BLUE : undefined,
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
};

type ResizeSession = DragSession & { edge: "start" | "end" };

function trackWidth(element: HTMLElement): number {
  const track = element.closest("[data-timeline-row]") as HTMLElement | null;
  return Math.max(1, track?.getBoundingClientRect().width ?? 300);
}

function snap(value: number): number {
  return Math.round(value / SNAP_MS) * SNAP_MS;
}

export function TimelinePropertyBlock({
  block,
  duration,
  selected,
}: {
  block: TimelineBlock;
  duration: number;
  selected: boolean;
}) {
  const dragRef = React.useRef<DragSession | null>(null);
  const resizeRef = React.useRef<ResizeSession | null>(null);
  const easingEditRef = React.useRef(false);
  const label = propertyLabel(block.propertyName);
  const interpolator = block.interpolator || "FAST_OUT_SLOW_IN";
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
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    dragRef.current = {
      startX: event.clientX,
      originalStart: block.startTime,
      originalEnd: block.endTime,
      historyRecorded: false,
    };
    useEditorStore.getState().selectBlocks([block.id]);
  };

  const handleDragMove = (event: React.PointerEvent) => {
    const session = dragRef.current;
    if (!session) return;
    const deltaTime =
      ((event.clientX - session.startX) / trackWidth(event.currentTarget as HTMLElement)) *
      duration;
    const blockDuration = session.originalEnd - session.originalStart;
    const nextStart = Math.max(
      0,
      Math.min(duration - blockDuration, snap(session.originalStart + deltaTime)),
    );
    if (nextStart === block.startTime) return;
    recordGestureHistory(session);
    useEditorStore
      .getState()
      .updateTimelineBlock(
        block.id,
        { startTime: nextStart, endTime: nextStart + blockDuration },
        { recordHistory: false },
      );
  };

  const endDrag = (event: React.PointerEvent, cancelled = false) => {
    const session = dragRef.current;
    dragRef.current = null;
    finishPointerGesture(event, session, cancelled);
  };

  const handleResizeStart = (edge: "start" | "end") => (event: React.PointerEvent) => {
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    resizeRef.current = {
      edge,
      startX: event.clientX,
      originalStart: block.startTime,
      originalEnd: block.endTime,
      historyRecorded: false,
    };
    useEditorStore.getState().selectBlocks([block.id]);
  };

  const handleResizeMove = (event: React.PointerEvent) => {
    const session = resizeRef.current;
    if (!session) return;
    const deltaTime =
      ((event.clientX - session.startX) / trackWidth(event.currentTarget as HTMLElement)) *
      duration;
    const nextStart =
      session.edge === "start"
        ? Math.max(
            0,
            Math.min(session.originalEnd - SNAP_MS, snap(session.originalStart + deltaTime)),
          )
        : session.originalStart;
    const nextEnd =
      session.edge === "end"
        ? Math.max(
            session.originalStart + SNAP_MS,
            Math.min(duration, snap(session.originalEnd + deltaTime)),
          )
        : session.originalEnd;
    if (nextStart === block.startTime && nextEnd === block.endTime) return;
    recordGestureHistory(session);
    useEditorStore
      .getState()
      .updateTimelineBlock(
        block.id,
        { startTime: nextStart, endTime: nextEnd },
        { recordHistory: false },
      );
  };

  const endResize = (event: React.PointerEvent, cancelled = false) => {
    const session = resizeRef.current;
    resizeRef.current = null;
    finishPointerGesture(event, session, cancelled);
  };

  const jumpTo = (milliseconds: number) => {
    useEditorStore.getState().setProgress(Math.max(0, Math.min(1, milliseconds / duration)));
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-[1]">
      <div
        className={cn(
          "pointer-events-auto absolute top-1/2 h-px -translate-y-1/2 cursor-grab active:cursor-grabbing",
          selected ? "bg-[#0C8CE9]/55" : "bg-[#0C8CE9]/35 hover:bg-[#0C8CE9]/50",
        )}
        style={{ left: `${startPct}%`, width: `${Math.max(0, endPct - startPct)}%` }}
        title={`${label}: ${block.startTime}–${block.endTime}ms`}
        onPointerDown={handleDragStart}
        onPointerMove={handleDragMove}
        onPointerUp={(event) => endDrag(event)}
        onPointerCancel={(event) => endDrag(event, true)}
        onClick={(event) => {
          event.stopPropagation();
          useEditorStore.getState().toggleBlockSelection(block.id);
        }}
      />
      {(["start", "end"] as const).map((edge) => {
        const milliseconds = edge === "start" ? block.startTime : block.endTime;
        return (
          <button
            key={edge}
            type="button"
            className="pointer-events-auto absolute top-1/2 z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center p-0"
            style={{ left: `${edge === "start" ? startPct : endPct}%` }}
            title={`Keyframe @ ${milliseconds}ms`}
            aria-label={`${label} ${edge} keyframe at ${milliseconds} milliseconds`}
            onPointerDown={handleResizeStart(edge)}
            onPointerMove={handleResizeMove}
            onPointerUp={(event) => endResize(event)}
            onPointerCancel={(event) => endResize(event, true)}
            onClick={(event) => {
              event.stopPropagation();
              useEditorStore.getState().selectBlocks([block.id]);
              jumpTo(milliseconds);
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
                  className="flex size-4 items-center justify-center rounded-[3px] border border-white/12 bg-[#2C2C2C] text-[#0C8CE9] shadow-sm outline-none hover:border-[#0C8CE9]/45 hover:bg-[#333] active:scale-[0.96]"
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
                  size={88}
                  points={curvePointsFor(interpolator)}
                  onEditStart={() => {
                    useEditorStore.getState().pushHistory();
                    easingEditRef.current = true;
                  }}
                  onEditEnd={() => {
                    easingEditRef.current = false;
                  }}
                  onEditCancel={() => {
                    if (easingEditRef.current)
                      useEditorStore.getState().cancelLastHistoryTransaction();
                    easingEditRef.current = false;
                  }}
                  onChange={([x1, y1, x2, y2]) => {
                    useEditorStore
                      .getState()
                      .updateTimelineBlock(
                        block.id,
                        { interpolator: `cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})` },
                        { recordHistory: !easingEditRef.current },
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
                    <span className="font-mono text-[10px] text-muted-foreground/80">
                      {option.hint}
                    </span>
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

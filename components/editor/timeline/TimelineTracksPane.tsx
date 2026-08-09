"use client";

import React from "react";
import { X } from "lucide-react";
import { pathToString } from "@/lib/shapeshifter/pathUtils";
import type { TimelineBlock } from "@/lib/shapeshifter/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { cn } from "@/lib/utils";
import { TimelineKeyframeDiamond, TimelinePropertyBlock } from "./TimelinePropertyBlock";
import type { TimelineProjection, TimelineRow } from "./timelineProjection";

const ROW_SELECTED = "bg-[#0C8CE9]/20";
const ROW_LAYER_HEIGHT = 30;
const ROW_PROPERTY_HEIGHT = 28;
const OBJECT_CLIP_HEIGHT = 18;

type ObjectSpan = { start: number; end: number; blocks: TimelineBlock[] };
type DragSession = {
  startX: number;
  historyRecorded: boolean;
  items: { id: string; originalStart: number; originalEnd: number }[];
};

function ReadonlyPropertyRail({ block, duration }: { block: TimelineBlock; duration: number }) {
  const start = (block.startTime / duration) * 100;
  const end = (block.endTime / duration) * 100;
  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="absolute top-1/2 h-px -translate-y-1/2 bg-white/12"
        style={{ left: `${start}%`, width: `${Math.max(1.2, end - start)}%` }}
      />
      {[start, end].map((position, index) => (
        <span
          key={index}
          className="absolute top-1/2 flex size-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
          style={{ left: `${position}%` }}
        >
          <TimelineKeyframeDiamond size={6} />
        </span>
      ))}
    </div>
  );
}

function TimelineObjectClip({
  span,
  duration,
  selected,
  interactive,
}: {
  span: ObjectSpan;
  duration: number;
  selected: boolean;
  interactive: boolean;
}) {
  const dragRef = React.useRef<DragSession | null>(null);
  const left = (span.start / duration) * 100;
  const width = Math.max(1.2, ((span.end - span.start) / duration) * 100);
  const primaryId = span.blocks[0]?.id;

  const endDrag = (event: React.PointerEvent, cancelled = false) => {
    const session = dragRef.current;
    dragRef.current = null;
    if (cancelled && session?.historyRecorded) {
      useEditorStore.getState().cancelLastHistoryTransaction();
    }
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // Capture may already be released by the browser.
    }
  };

  return (
    <div
      className={cn(
        "absolute top-1/2 z-[1] flex -translate-y-1/2 items-center justify-center overflow-hidden rounded-sm border",
        interactive ? "cursor-grab active:cursor-grabbing" : "pointer-events-none",
        selected
          ? "border-[#0C8CE9]/45 bg-[#0C8CE9] shadow-[0_0_0_1px_rgba(12,140,233,0.2)]"
          : "border-white/[0.08] bg-[#555555] hover:bg-[#5C5C5C]",
      )}
      style={{ left: `${left}%`, width: `${width}%`, height: OBJECT_CLIP_HEIGHT }}
      title={`Path · ${span.start}–${span.end}ms`}
      onPointerDown={
        interactive
          ? (event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              dragRef.current = {
                startX: event.clientX,
                historyRecorded: false,
                items: span.blocks.map((block) => ({
                  id: block.id,
                  originalStart: block.startTime,
                  originalEnd: block.endTime,
                })),
              };
              useEditorStore.getState().selectBlocks(span.blocks.map((block) => block.id));
            }
          : undefined
      }
      onPointerMove={(event) => {
        const session = dragRef.current;
        if (!session || !primaryId || !session.items.some((item) => item.id === primaryId)) return;
        const track = event.currentTarget.closest("[data-timeline-row]") as HTMLElement | null;
        const trackWidth = Math.max(1, track?.getBoundingClientRect().width ?? 300);
        const deltaTime = ((event.clientX - session.startX) / trackWidth) * duration;
        let shift = deltaTime;
        for (const item of session.items) {
          const itemDuration = item.originalEnd - item.originalStart;
          const proposed = item.originalStart + shift;
          if (proposed < 0) shift = -item.originalStart;
          if (proposed > duration - itemDuration) {
            shift = duration - itemDuration - item.originalStart;
          }
        }
        const nextItems = session.items.map((item) => {
          const itemDuration = item.originalEnd - item.originalStart;
          const snappedStart = Math.round((item.originalStart + shift) / 50) * 50;
          const startTime = Math.max(0, Math.min(duration - itemDuration, snappedStart));
          return { item, startTime, endTime: startTime + itemDuration };
        });
        const store = useEditorStore.getState();
        if (
          !session.historyRecorded &&
          nextItems.some(
            ({ item, startTime, endTime }) =>
              startTime !== item.originalStart || endTime !== item.originalEnd,
          )
        ) {
          store.pushHistory();
          session.historyRecorded = true;
        }
        for (const { item, startTime, endTime } of nextItems) {
          store.updateTimelineBlock(item.id, { startTime, endTime }, { recordHistory: false });
        }
      }}
      onPointerUp={(event) => endDrag(event)}
      onPointerCancel={(event) => endDrag(event, true)}
      onClick={(event) => {
        event.stopPropagation();
        if (span.blocks.length) {
          useEditorStore.getState().selectBlocks(span.blocks.map((block) => block.id));
        }
      }}
    >
      <span className="pointer-events-none absolute inset-y-[2px] left-[2.5px] w-[1.5px] rounded-full bg-white/35" />
      <span className="pointer-events-none absolute inset-y-[2px] right-[2.5px] w-[1.5px] rounded-full bg-white/35" />
      {width > 12 && (
        <span
          className={cn(
            "pointer-events-none truncate px-2 text-[9px] font-medium",
            selected ? "text-white/95" : "text-white/50",
          )}
        >
          Path
        </span>
      )}
    </div>
  );
}

interface TimelineTracksPaneProps {
  rows: TimelineRow[];
  blocksForLayer: TimelineProjection["blocksForLayer"];
  blocksForProperty: TimelineProjection["blocksForProperty"];
  rulerMajorCount: number;
  empty: boolean;
  emptyHintDismissed: boolean;
  onDismissEmptyHint: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
}

export function TimelineTracksPane({
  rows,
  blocksForLayer,
  blocksForProperty,
  rulerMajorCount,
  empty,
  emptyHintDismissed,
  onDismissEmptyHint,
  scrollRef,
  onScroll,
}: TimelineTracksPaneProps) {
  const frames = useEditorStore((state) => state.frames);
  const selectedFrameId = useEditorStore((state) => state.selectedFrameId);
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId);
  const selectedBlockIds = useEditorStore((state) => state.selectedBlockIds);
  const animation = useEditorStore((state) => state.animation);
  const selectionKind = useEditorStore((state) => state.selectionKind);
  const hasCanvasSelection = useEditorStore((state) => state.hasCanvasSelection);

  return (
    <div
      ref={scrollRef}
      className="relative min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden bg-[#242424]"
      onScroll={onScroll}
    >
      <div
        className="relative min-h-full"
        style={
          empty
            ? undefined
            : {
                backgroundImage: `repeating-linear-gradient(
                  90deg,
                  transparent 0,
                  transparent calc(${100 / rulerMajorCount}% - 1px),
                  rgba(255,255,255,0.035) calc(${100 / rulerMajorCount}% - 1px),
                  rgba(255,255,255,0.035) calc(${100 / rulerMajorCount}%)
                )`,
              }
        }
      >
        {empty && !emptyHintDismissed && (
          <div className="absolute inset-0 z-[5] flex items-center justify-center p-6">
            <div className="relative w-full max-w-[300px] rounded-xl border border-white/10 bg-[#2C2C2C]/95 px-5 py-4 text-center shadow-lg">
              <button
                type="button"
                className="absolute right-2 top-2 grid size-7 place-items-center rounded-md text-white/40 hover:bg-white/10 hover:text-white/80"
                aria-label="Dismiss"
                onClick={onDismissEmptyHint}
              >
                <X className="size-3.5" />
              </button>
              <div className="text-[13px] font-medium text-white/90">No animations yet</div>
              <div className="mt-1.5 text-[12px] leading-relaxed text-white/45">
                Select a layer and animate a property, or use a layer menu.
              </div>
            </div>
          </div>
        )}

        {rows.map((row) => {
          if (row.kind === "frame") {
            return (
              <div
                key={row.key}
                data-timeline-row
                className={cn(
                  "relative border-b border-white/[0.03]",
                  row.frameId === selectedFrameId && "bg-white/[0.025]",
                )}
                style={{ height: ROW_LAYER_HEIGHT }}
                onClick={() => useEditorStore.getState().selectFrame(row.frameId)}
              />
            );
          }

          const isObject = row.kind === "object";
          const frameAnimation =
            row.frameId === selectedFrameId
              ? animation
              : (frames.find((frame) => frame.id === row.frameId)?.animation ?? animation);
          const duration = Math.max(1, frameAnimation.duration || 1000);
          const propertyBlocks =
            row.kind === "property"
              ? blocksForProperty(row.frameId, row.layer.id, row.propertyName)
              : [];
          const morphBlocks = isObject
            ? blocksForLayer(row.frameId, row.layer.id).filter(
                (block) => block.propertyName === "pathData",
              )
            : [];
          const propertySelected =
            row.kind === "property" &&
            hasCanvasSelection &&
            selectionKind === "layer" &&
            row.frameId === selectedFrameId &&
            propertyBlocks.length > 0 &&
            propertyBlocks.every((block) => selectedBlockIds.includes(block.id));
          const objectSelected =
            isObject &&
            hasCanvasSelection &&
            selectionKind === "layer" &&
            row.frameId === selectedFrameId &&
            String(selectedLayerId) === String(row.layer.id);
          const implicitMorph =
            isObject &&
            morphBlocks.length === 0 &&
            row.layer.type !== "group" &&
            row.layer.to &&
            pathToString(row.layer.from) !== pathToString(row.layer.to);
          const objectSpan: ObjectSpan | null = isObject
            ? morphBlocks.length
              ? {
                  start: Math.min(...morphBlocks.map((block) => block.startTime)),
                  end: Math.max(...morphBlocks.map((block) => block.endTime)),
                  blocks: morphBlocks,
                }
              : implicitMorph
                ? { start: 0, end: duration, blocks: [] }
                : null
            : null;

          return (
            <div
              key={row.key}
              data-timeline-row
              className={cn(
                "relative border-b border-white/[0.03]",
                propertySelected || objectSelected ? ROW_SELECTED : "bg-transparent",
                row.kind === "property" && !propertySelected && "hover:bg-white/[0.02]",
                isObject && !objectSelected && "hover:bg-white/[0.02]",
              )}
              style={{ height: isObject ? ROW_LAYER_HEIGHT : ROW_PROPERTY_HEIGHT }}
              onClick={() => {
                const store = useEditorStore.getState();
                if (row.frameId !== store.selectedFrameId) store.selectFrame(row.frameId);
                if (row.kind === "property") {
                  store.selectBlocks(propertyBlocks.map((block) => block.id));
                } else {
                  store.selectLayer(row.layer.id);
                  if (objectSpan?.blocks.length) {
                    store.selectBlocks(objectSpan.blocks.map((block) => block.id));
                  }
                }
              }}
            >
              {row.kind === "property" &&
                propertyBlocks.map((block) =>
                  row.frameId === selectedFrameId ? (
                    <TimelinePropertyBlock
                      key={block.id}
                      block={block}
                      duration={duration}
                      selected={selectedBlockIds.includes(block.id)}
                    />
                  ) : (
                    <ReadonlyPropertyRail key={block.id} block={block} duration={duration} />
                  ),
                )}
              {objectSpan && (
                <TimelineObjectClip
                  span={objectSpan}
                  duration={duration}
                  selected={
                    objectSelected ||
                    (row.frameId === selectedFrameId &&
                      objectSpan.blocks.some((block) => selectedBlockIds.includes(block.id)))
                  }
                  interactive={row.frameId === selectedFrameId && objectSpan.blocks.length > 0}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

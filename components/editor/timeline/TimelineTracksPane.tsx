"use client";

import React from "react";
import { TriangleAlert, X } from "lucide-react";
import type { FormatProfile } from "@/lib/shapeshifter/formatCapabilities";
import { pathToString } from "@/lib/shapeshifter/pathUtils";
import type { TimelineBlock } from "@/lib/shapeshifter/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { cn } from "@/lib/utils";
import { TimelineKeyframeDiamond, TimelinePropertyBlock } from "./TimelinePropertyBlock";
import type { TimelineProjection, TimelineRow } from "./timelineProjection";
import type { TimelineSnapTarget } from "./timelineTiming";
import { useTimelineGesture } from "./useTimelineGesture";

const ROW_SELECTED = "bg-primary/10";
const ROW_LAYER_HEIGHT = 30;
const ROW_PROPERTY_HEIGHT = 28;
const OBJECT_CLIP_HEIGHT = 18;

type ObjectSpan = { start: number; end: number; blocks: TimelineBlock[] };
function ReadonlyPropertyRail({ block, duration }: { block: TimelineBlock; duration: number }) {
  const start = (block.startTime / duration) * 100;
  const end = (block.endTime / duration) * 100;
  return (
    <div className="pointer-events-none absolute inset-0">
      <div
        className="absolute top-1/2 h-px -translate-y-1/2 bg-muted-foreground/35"
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
  gridStep,
  keyboardStep,
  snapping,
  onSnapChange,
}: {
  span: ObjectSpan;
  duration: number;
  selected: boolean;
  interactive: boolean;
  gridStep: number;
  keyboardStep: number;
  snapping: boolean;
  onSnapChange: (target: TimelineSnapTarget | null) => void;
}) {
  const gesture = useTimelineGesture({ gridStep, snapping, onSnapChange });
  const left = (span.start / duration) * 100;
  const width = Math.max(1.2, ((span.end - span.start) / duration) * 100);
  const primaryId = span.blocks[0]?.id;

  return (
    <button
      type="button"
      tabIndex={interactive ? 0 : -1}
      data-timeline-block-id={primaryId}
      aria-label={`Path animation from ${span.start} to ${span.end} milliseconds`}
      aria-pressed={selected}
      className={cn(
        "absolute top-1/2 z-[1] flex -translate-y-1/2 items-center justify-center overflow-hidden rounded-sm border touch-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring",
        interactive ? "cursor-grab active:cursor-grabbing" : "pointer-events-none",
        selected
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-muted text-muted-foreground hover:bg-accent",
      )}
      style={{ left: `${left}%`, width: `${width}%`, height: OBJECT_CLIP_HEIGHT }}
      title={`Path · ${span.start}–${span.end} ms · Snap to keys and playhead · Alt-drag for precise timing`}
      onPointerDown={
        interactive
          ? (event) => {
              if (event.button !== 0) return;
              event.stopPropagation();
              const store = useEditorStore.getState();
              const ids = span.blocks.map((block) => block.id);
              if (span.blocks[0]) store.selectLayer(span.blocks[0].layerId);
              store.selectBlocks(ids);
              gesture.begin(event, ids);
            }
          : undefined
      }
      onPointerMove={gesture.move}
      onPointerUp={(event) => gesture.end(event)}
      onPointerCancel={(event) => gesture.end(event, true)}
      onLostPointerCapture={(event) => gesture.end(event, true)}
      onClick={(event) => {
        event.stopPropagation();
        if (span.blocks.length) {
          const store = useEditorStore.getState();
          store.selectLayer(span.blocks[0]!.layerId);
          store.selectBlocks(span.blocks.map((block) => block.id));
        }
      }}
      onKeyDown={(event) => {
        if (
          !interactive ||
          !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)
        )
          return;
        event.preventDefault();
        if (event.key === "ArrowUp" || event.key === "ArrowDown") return;
        useEditorStore.getState().moveTimelineBlocks(
          span.blocks.map((block) => block.id),
          (event.key === "ArrowLeft" ? -1 : 1) * keyboardStep * (event.shiftKey ? 10 : 1),
        );
      }}
    >
      <span className="pointer-events-none absolute inset-y-[2px] left-[2.5px] w-[1.5px] rounded-full bg-current opacity-40" />
      <span className="pointer-events-none absolute inset-y-[2px] right-[2.5px] w-[1.5px] rounded-full bg-current opacity-40" />
      {width > 12 && (
        <span
          className={cn(
            "pointer-events-none truncate px-2 text-[9px] font-medium",
            selected ? "text-primary-foreground" : "text-muted-foreground",
          )}
        >
          Path
        </span>
      )}
    </button>
  );
}

interface TimelineTracksPaneProps {
  rows: TimelineRow[];
  blocksForLayer: TimelineProjection["blocksForLayer"];
  blocksForProperty: TimelineProjection["blocksForProperty"];
  contentWidth: number;
  majorStep: number;
  gridStep: number;
  keyboardStep: number;
  snapping: boolean;
  onSnapChange: (target: TimelineSnapTarget | null) => void;
  empty: boolean;
  emptyHintDismissed: boolean;
  onDismissEmptyHint: () => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  /** When set, property rows carrying a capabilityNote get a warning glyph. */
  formatProfile?: FormatProfile;
}

export function TimelineTracksPane({
  rows,
  blocksForLayer,
  blocksForProperty,
  contentWidth,
  majorStep,
  gridStep,
  keyboardStep,
  snapping,
  onSnapChange,
  empty,
  emptyHintDismissed,
  onDismissEmptyHint,
  scrollRef,
  onScroll,
  formatProfile,
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
      className="relative min-h-0 min-w-0 flex-1 overflow-auto bg-background"
      aria-label="Animation tracks"
      tabIndex={-1}
      onScroll={onScroll}
    >
      <div
        data-timeline-content
        className="relative min-h-full"
        style={{
          width: contentWidth,
          minWidth: "100%",
          ...(!empty && {
            backgroundImage: "linear-gradient(to right, var(--border) 1px, transparent 1px)",
            backgroundSize: `${(contentWidth * majorStep) / Math.max(1, animation.duration)}px 100%`,
          }),
        }}
      >
        {empty && !emptyHintDismissed && (
          <div className="absolute inset-0 z-[5] flex items-center justify-center p-6">
            <div className="relative w-full max-w-[300px] rounded-lg border border-border bg-card px-5 py-4 text-center shadow-sm">
              <button
                type="button"
                className="absolute right-2 top-2 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Dismiss"
                onClick={onDismissEmptyHint}
              >
                <X className="size-3.5" />
              </button>
              <div className="text-[13px] font-medium text-foreground">No animations yet</div>
              <div className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                Select a layer, open Motion, and choose a property to animate.
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
                  "relative border-b border-border/50",
                  row.frameId === selectedFrameId && "bg-muted/35",
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
                "relative border-b border-border/50",
                propertySelected || objectSelected ? ROW_SELECTED : "bg-transparent",
                row.kind === "property" && !propertySelected && "hover:bg-muted/35",
                isObject && !objectSelected && "hover:bg-muted/35",
              )}
              style={{ height: isObject ? ROW_LAYER_HEIGHT : ROW_PROPERTY_HEIGHT }}
              onClick={() => {
                const store = useEditorStore.getState();
                if (row.frameId !== store.selectedFrameId) store.selectFrame(row.frameId);
                if (row.kind === "property") {
                  store.selectLayer(row.layer.id);
                  store.selectBlocks(propertyBlocks.map((block) => block.id));
                } else {
                  store.selectLayer(row.layer.id);
                  if (objectSpan?.blocks.length) {
                    store.selectBlocks(objectSpan.blocks.map((block) => block.id));
                  }
                }
              }}
            >
              {formatProfile && row.kind === "property" && row.capabilityNote && (
                <span
                  className="absolute left-1 top-1/2 z-[2] flex -translate-y-1/2 items-center gap-1 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground"
                  title={row.capabilityNote}
                >
                  <TriangleAlert className="size-3" />
                </span>
              )}
              {row.kind === "property" &&
                propertyBlocks.map((block) =>
                  row.frameId === selectedFrameId ? (
                    <TimelinePropertyBlock
                      key={block.id}
                      block={block}
                      duration={duration}
                      selected={selectedBlockIds.includes(block.id)}
                      gridStep={gridStep}
                      keyboardStep={keyboardStep}
                      snapping={snapping}
                      onSnapChange={onSnapChange}
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
                  gridStep={gridStep}
                  keyboardStep={keyboardStep}
                  snapping={snapping}
                  onSnapChange={onSnapChange}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

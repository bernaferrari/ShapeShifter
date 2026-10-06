"use client";

import React from "react";
import { TriangleAlert, X } from "lucide-react";
import type { FormatProfile } from "@/lib/shapeshifter/formatCapabilities";
import type { TimelineBlock } from "@/lib/shapeshifter/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { cn } from "@/lib/utils";
import { TimelineKeyframeDiamond, TimelinePropertyBlock } from "./TimelinePropertyBlock";
import type { TimelineProjection, TimelineRow } from "./timelineProjection";
import type { TimelineSnapTarget } from "./timelineTiming";
import { ROW_COMPACT_HEIGHT, ROW_LAYER_HEIGHT, ROW_PROPERTY_HEIGHT } from "./timelineLayout";

const ROW_SELECTED = "bg-primary/10";

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

interface TimelineTracksPaneProps {
  rows: TimelineRow[];
  compact?: boolean;
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
  /** When set, property rows carrying a capabilityNote get a warning glyph. */
  formatProfile?: FormatProfile;
  /** Lane inset on both ends, matching the ruler's offset. */
  gutter: number;
}

export function TimelineTracksPane({
  rows,
  compact = false,
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
  formatProfile,
  gutter,
}: TimelineTracksPaneProps) {
  const frames = useEditorStore((state) => state.frames);
  const selectedFrameId = useEditorStore((state) => state.selectedFrameId);
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId);
  const selectedBlockIds = useEditorStore((state) => state.selectedBlockIds);
  const animation = useEditorStore((state) => state.animation);
  const selectionKind = useEditorStore((state) => state.selectionKind);
  const hasCanvasSelection = useEditorStore((state) => state.hasCanvasSelection);

  return (
    <div className="relative min-w-0 flex-1 overflow-clip bg-background" data-timeline-segments>
      <div
        data-timeline-content
        className="relative min-h-full"
        style={{
          width: contentWidth + gutter * 2,
          minWidth: "100%",
          ...(!empty && {
            backgroundImage: "linear-gradient(to right, var(--border) 1px, transparent 1px)",
            backgroundSize: `${(contentWidth * majorStep) / Math.max(1, animation.duration)}px 100%`,
            backgroundPosition: `${gutter}px 0`,
          }),
        }}
      >
        {empty && !emptyHintDismissed && (
          <div className="absolute inset-0 z-[5] flex items-center justify-center p-6">
            <div className="relative w-full max-w-[300px] rounded-xl bg-card px-5 py-4 text-center [box-shadow:var(--elevation-floating)]">
              <button
                type="button"
                className="absolute right-2 top-2 grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Dismiss"
                onClick={onDismissEmptyHint}
              >
                <X className="size-3.5" />
              </button>
              <div className="text-[13px] font-medium text-foreground">Nothing is animated yet</div>
              <div className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                Select a layer and click{" "}
                <span className="inline-block size-[7px] rotate-45 rounded-[1px] border border-muted-foreground align-middle" />{" "}
                next to any property.
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
                style={{ height: compact ? ROW_COMPACT_HEIGHT : ROW_LAYER_HEIGHT }}
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
          const trackBlocks = isObject ? morphBlocks : propertyBlocks;

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
              style={{
                height: compact
                  ? ROW_COMPACT_HEIGHT
                  : isObject
                    ? ROW_LAYER_HEIGHT
                    : ROW_PROPERTY_HEIGHT,
              }}
              onClick={() => {
                const store = useEditorStore.getState();
                if (row.frameId !== store.selectedFrameId) store.selectFrame(row.frameId);
                if (row.kind === "property") {
                  store.selectLayer(row.layer.id);
                  store.selectBlocks(propertyBlocks.map((block) => block.id));
                } else {
                  store.selectLayer(row.layer.id);
                  if (morphBlocks.length) store.selectBlocks(morphBlocks.map((block) => block.id));
                }
              }}
            >
              {formatProfile && row.capabilityNote && (
                <span
                  className="absolute left-1 top-1/2 z-[2] flex -translate-y-1/2 items-center gap-1 rounded bg-muted px-1 py-px text-[10px] text-muted-foreground"
                  title={row.capabilityNote}
                >
                  <TriangleAlert className="size-3" />
                </span>
              )}
              <div
                data-timeline-lane
                className="absolute inset-y-0"
                style={{ left: gutter, width: contentWidth }}
              >
                {trackBlocks.map((block) =>
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
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

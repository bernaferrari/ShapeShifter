"use client";

import React from "react";
import { ChevronRight, Crop, Folder, Spline } from "lucide-react";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import { useEditorStore } from "@/lib/store/editorStore";
import { cn } from "@/lib/utils";
import { TimelineKeyframeDiamond } from "./TimelinePropertyBlock";
import { TimelinePropertyValue } from "./TimelineLiveState";
import type { TimelineProjection, TimelineRow } from "./timelineProjection";

const SELECTION_COLOR = "var(--primary)";
const ROW_SELECTED = "bg-primary/10";
const ROW_LAYER_HEIGHT = 30;
const ROW_PROPERTY_HEIGHT = 28;

interface TimelineLayersPaneProps {
  rows: TimelineRow[];
  width: number;
  compact?: boolean;
  onToggleFrame: (frameId: string) => void;
  onToggleGroup: (rowKey: string) => void;
  blocksForLayer: TimelineProjection["blocksForLayer"];
  blocksForProperty: TimelineProjection["blocksForProperty"];
}

export function TimelineLayersPane({
  rows,
  width,
  compact = false,
  onToggleFrame,
  onToggleGroup,
  blocksForLayer,
  blocksForProperty,
}: TimelineLayersPaneProps) {
  const selectedFrameId = useEditorStore((state) => state.selectedFrameId);
  const selectedLayerRefs = useEditorStore((state) => state.selectedLayerRefs);
  const selectedBlockIds = useEditorStore((state) => state.selectedBlockIds);
  const selectionKind = useEditorStore((state) => state.selectionKind);
  const hasCanvasSelection = useEditorStore((state) => state.hasCanvasSelection);
  const animationDuration = useEditorStore((state) => state.animation.duration);
  const frames = useEditorStore((state) => state.frames);
  const [renamingLayerKey, setRenamingLayerKey] = React.useState<string | null>(null);

  const jumpTo = (milliseconds: number) => {
    const store = useEditorStore.getState();
    if (store.isPlaying) store.togglePlayback();
    store.setProgress(
      Math.max(0, Math.min(1, milliseconds / Math.max(1, store.animation.duration))),
    );
  };

  return (
    <div
      className={cn(
        "sticky left-0 z-10 shrink-0 border-r border-border",
        compact ? "bg-sidebar" : "bg-card",
      )}
      data-timeline-layer-names
      style={{ width }}
    >
      {rows.map((row) => {
        if (row.kind === "frame") {
          const isActive =
            hasCanvasSelection && selectionKind === "frame" && row.frameId === selectedFrameId;
          return (
            <div
              key={row.key}
              role="button"
              tabIndex={0}
              className={cn(
                "group flex w-full items-center gap-1 pr-2 text-left",
                isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted",
              )}
              style={{ height: compact ? 44 : ROW_LAYER_HEIGHT, paddingLeft: compact ? 12 : 8 }}
              onClick={() => useEditorStore.getState().selectFrame(row.frameId)}
              onKeyDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  useEditorStore.getState().selectFrame(row.frameId);
                }
              }}
            >
              <button
                type="button"
                className="grid size-4 shrink-0 place-items-center rounded-sm hover:bg-muted"
                aria-label={row.expanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFrame(row.frameId);
                }}
              >
                <ChevronRight
                  className={cn("h-2.5 w-2.5 text-muted-foreground", row.expanded && "rotate-90")}
                />
              </button>
              <span className="min-w-0 flex-1 select-none truncate text-[11px] font-normal tracking-[-0.01em]">
                {row.name}
              </span>
            </div>
          );
        }

        if (row.kind === "object") {
          const isSelected =
            hasCanvasSelection &&
            selectionKind === "layer" &&
            selectedLayerRefs.some(
              (reference) =>
                reference.ownerId === row.frameId &&
                String(reference.layerId) === String(row.layer.id),
            );
          const selectRow = () => {
            const store = useEditorStore.getState();
            if (row.frameId !== store.selectedFrameId) store.selectFrame(row.frameId);
            store.selectLayer(row.layer.id);
            const morphBlocks = blocksForLayer(row.frameId, row.layer.id).filter(
              (block) => block.propertyName === "pathData",
            );
            if (morphBlocks.length) store.selectBlocks(morphBlocks.map((block) => block.id));
          };
          return (
            <div
              key={row.key}
              role="button"
              tabIndex={0}
              className={cn(
                "group flex w-full items-center gap-1 pr-1.5 text-left",
                isSelected ? `${ROW_SELECTED} text-foreground` : "text-foreground hover:bg-muted",
              )}
              style={{ height: compact ? 44 : ROW_LAYER_HEIGHT, paddingLeft: 6 + row.depth * 12 }}
              onClick={(event) => {
                const store = useEditorStore.getState();
                if (event.shiftKey) {
                  const key = `${row.frameId}:${String(row.layer.id)}`;
                  const exists = store.selectedLayerRefs.some(
                    (reference) => `${reference.ownerId}:${String(reference.layerId)}` === key,
                  );
                  store.selectLayerRefs(
                    exists
                      ? store.selectedLayerRefs.filter(
                          (reference) =>
                            `${reference.ownerId}:${String(reference.layerId)}` !== key,
                        )
                      : [
                          ...store.selectedLayerRefs,
                          { ownerId: row.frameId, layerId: row.layer.id },
                        ],
                  );
                  return;
                }
                selectRow();
              }}
              onKeyDown={(event) => {
                if (
                  event.target === event.currentTarget &&
                  (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  selectRow();
                }
              }}
            >
              <span className="grid size-4 shrink-0 place-items-center">
                {row.expandable && (
                  <button
                    type="button"
                    className="grid size-4 place-items-center rounded-sm hover:bg-muted"
                    aria-label={row.expanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleGroup(row.key);
                    }}
                  >
                    <ChevronRight
                      className={cn(
                        "h-2.5 w-2.5 text-muted-foreground",
                        row.expanded && "rotate-90",
                      )}
                    />
                  </button>
                )}
              </span>
              <span
                className="grid size-3.5 shrink-0 place-items-center"
                style={{ color: isSelected ? SELECTION_COLOR : "var(--muted-foreground)" }}
                aria-hidden
              >
                {row.layer.type === "group" ? (
                  <Folder className="size-3" />
                ) : row.layer.type === "clipPath" ? (
                  <Crop className="size-3" />
                ) : (
                  <Spline className="size-3" />
                )}
              </span>
              {renamingLayerKey === row.key ? (
                <input
                  autoFocus
                  aria-label={`Rename ${row.name}`}
                  defaultValue={row.name}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={(event) => {
                    const name = event.currentTarget.value.trim();
                    if (name && name !== row.name)
                      useEditorStore.getState().renameOwnedLayer(row.frameId, row.layer.id, name);
                    setRenamingLayerKey(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      event.currentTarget.value = row.name;
                      setRenamingLayerKey(null);
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="h-4 min-w-0 flex-1 rounded-sm border border-primary bg-background px-1 text-[11px] text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                />
              ) : (
                <span
                  className="min-w-0 flex-1 select-none truncate text-[11px] font-normal tracking-[-0.01em]"
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    selectRow();
                    setRenamingLayerKey(row.key);
                  }}
                >
                  {row.name}
                </span>
              )}
            </div>
          );
        }

        const blocks = blocksForProperty(row.frameId, row.layer.id, row.propertyName);
        const blockIds = blocks.map((block) => block.id);
        const isSelected =
          row.frameId === selectedFrameId &&
          blockIds.length > 0 &&
          blockIds.every((id) => selectedBlockIds.includes(id));
        const first = blocks[0];
        const earliest = blocks.reduce(
          (minimum, block) => Math.min(minimum, block.startTime),
          Number.POSITIVE_INFINITY,
        );
        const latest = blocks.reduce((maximum, block) => Math.max(maximum, block.endTime), 0);
        const selectProperty = () => {
          const store = useEditorStore.getState();
          if (row.frameId !== store.selectedFrameId) store.selectFrame(row.frameId);
          store.selectLayer(row.layer.id);
          store.selectBlocks(blockIds);
        };

        return (
          <div
            key={row.key}
            className={cn(
              "group flex w-full items-center gap-0.5 pr-1.5 text-left",
              isSelected ? ROW_SELECTED : "hover:bg-muted/60",
            )}
            style={{
              height: compact ? 44 : ROW_PROPERTY_HEIGHT,
              paddingLeft: (compact ? 12 : 24) + row.depth * 6,
            }}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={`Select ${propertyLabel(row.propertyName)} track for ${row.layer.name}`}
            onClick={selectProperty}
            onKeyDown={(event) => {
              if (
                event.target === event.currentTarget &&
                (event.key === "Enter" || event.key === " ")
              ) {
                event.preventDefault();
                selectProperty();
              }
            }}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[11px]",
                isSelected ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {propertyLabel(row.propertyName)}
            </span>
            {!compact && (
              <div
                className={cn(
                  "flex shrink-0 items-center transition-opacity",
                  isSelected
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100",
                )}
              >
                <button
                  type="button"
                  aria-label={`Jump to first ${propertyLabel(row.propertyName)} keyframe`}
                  className="grid size-4 place-items-center rounded text-muted-foreground hover:bg-muted disabled:opacity-20"
                  disabled={!Number.isFinite(earliest)}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (Number.isFinite(earliest)) {
                      selectProperty();
                      jumpTo(earliest);
                    }
                  }}
                >
                  <ChevronRight className="h-2.5 w-2.5 rotate-180" strokeWidth={2} />
                </button>
                <button
                  type="button"
                  aria-label={`Select ${propertyLabel(row.propertyName)} keyframes`}
                  className="grid size-4 place-items-center rounded hover:bg-muted"
                  onClick={(event) => {
                    event.stopPropagation();
                    selectProperty();
                  }}
                >
                  <TimelineKeyframeDiamond active={isSelected} size={6} />
                </button>
                <button
                  type="button"
                  aria-label={`Jump to last ${propertyLabel(row.propertyName)} keyframe`}
                  className="grid size-4 place-items-center rounded text-muted-foreground hover:bg-muted disabled:opacity-20"
                  disabled={!latest}
                  onClick={(event) => {
                    event.stopPropagation();
                    if (latest) {
                      selectProperty();
                      jumpTo(latest);
                    }
                  }}
                >
                  <ChevronRight className="h-2.5 w-2.5" strokeWidth={2} />
                </button>
              </div>
            )}
            {width >= 200 && (
              <TimelinePropertyValue
                block={first}
                blocks={blocks}
                duration={
                  row.frameId === selectedFrameId
                    ? animationDuration
                    : (frames.find((frame) => frame.id === row.frameId)?.animation?.duration ??
                      animationDuration)
                }
                propertyName={row.propertyName}
                selected={isSelected}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

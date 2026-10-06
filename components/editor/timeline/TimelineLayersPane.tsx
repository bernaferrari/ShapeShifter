"use client";

import React from "react";
import { ChevronRight, Crop, Folder } from "lucide-react";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import { useEditorStore } from "@/lib/store/editorStore";
import { cn } from "@/lib/utils";
import { TextSizedInput } from "../TextSizedInput";
import { TimelineKeyframeDiamond } from "./TimelinePropertyBlock";
import { TimelinePropertyValue } from "./TimelineLiveState";
import type { TimelineProjection, TimelineRow } from "./timelineProjection";
import {
  ROW_COMPACT_HEIGHT,
  ROW_LAYER_HEIGHT,
  ROW_PROPERTY_HEIGHT,
  TIMELINE_ROW_PADDING,
  timelineTreeColumns,
} from "./timelineLayout";

const SELECTION_COLOR = "var(--primary)";
const ROW_SELECTED = "bg-primary/10";

const sameLayer = (row: TimelineRow | undefined, frameId: string, layerId: string | number) =>
  row?.kind === "property" && row.frameId === frameId && String(row.layer.id) === String(layerId);

/** Connects a layer to its property rows: a stem from the icon, then an elbow into the last row. */
function TreeGuide({
  left,
  label,
  part,
  active,
}: {
  left: number;
  label: number;
  part: "stem" | "through" | "last";
  active: boolean;
}) {
  const color = active ? "border-primary/45" : "border-muted-foreground/25";
  if (part === "last")
    return (
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-0 h-1/2 rounded-bl-[4px] border-b border-l",
          color,
        )}
        style={{ left, width: label - left - 3 }}
      />
    );
  return (
    <span
      aria-hidden
      className={cn("pointer-events-none absolute bottom-0 border-l", color)}
      style={{ left, top: part === "stem" ? "calc(50% + 7px)" : 0 }}
    />
  );
}

interface TimelineLayersPaneProps {
  rows: TimelineRow[];
  width: number;
  compact?: boolean;
  onToggleFrame: (frameId: string) => void;
  onToggleGroup: (rowKey: string) => void;
  blocksForLayer: TimelineProjection["blocksForLayer"];
  blocksForProperty: TimelineProjection["blocksForProperty"];
}

function TimelineRenameInput({
  name,
  onCommit,
  onCancel,
}: {
  name: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = React.useState(name);
  // Enter commits and unmounts, which also blurs; settle only once.
  const settled = React.useRef(false);
  const settle = (commit: boolean) => {
    if (settled.current) return;
    settled.current = true;
    if (commit) onCommit(draft.trim());
    else onCancel();
  };
  return (
    <TextSizedInput
      autoFocus
      fit="fill"
      fontSize={11}
      lineHeight={18}
      className="-ml-0.5"
      value={draft}
      aria-label={`Rename ${name}`}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => settle(true)}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== "Escape") return;
        event.preventDefault();
        settle(event.key === "Enter");
      }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    />
  );
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

  const isLayerSelected = (frameId: string, layerId: string | number) =>
    hasCanvasSelection &&
    selectionKind === "layer" &&
    selectedLayerRefs.some(
      (reference) => reference.ownerId === frameId && String(reference.layerId) === String(layerId),
    );

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
      {rows.map((row, index) => {
        const height = compact
          ? ROW_COMPACT_HEIGHT
          : row.kind === "property"
            ? ROW_PROPERTY_HEIGHT
            : ROW_LAYER_HEIGHT;
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
              style={{ height, paddingLeft: TIMELINE_ROW_PADDING }}
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
          const isSelected = isLayerSelected(row.frameId, row.layer.id);
          const columns = timelineTreeColumns(row.depth);
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
                "group relative flex w-full items-center gap-1 pr-1.5 text-left",
                isSelected ? `${ROW_SELECTED} text-foreground` : "text-foreground hover:bg-muted",
              )}
              style={{ height, paddingLeft: columns.start }}
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
              {sameLayer(rows[index + 1], row.frameId, row.layer.id) && (
                <TreeGuide
                  left={columns.guide}
                  label={columns.label}
                  part="stem"
                  active={isSelected}
                />
              )}
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
              {/* Paths are the norm, so only groups and masks earn a glyph. */}
              {(row.layer.type === "group" || row.layer.type === "clipPath") && (
                <span
                  className="grid size-3.5 shrink-0 place-items-center"
                  style={{ color: isSelected ? SELECTION_COLOR : "var(--muted-foreground)" }}
                  aria-hidden
                >
                  {row.layer.type === "group" ? (
                    <Folder className="size-3" />
                  ) : (
                    <Crop className="size-3" />
                  )}
                </span>
              )}
              {renamingLayerKey === row.key ? (
                <TimelineRenameInput
                  name={row.name}
                  onCommit={(name) => {
                    if (name && name !== row.name)
                      useEditorStore.getState().renameOwnedLayer(row.frameId, row.layer.id, name);
                    setRenamingLayerKey(null);
                  }}
                  onCancel={() => setRenamingLayerKey(null)}
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
        const columns = timelineTreeColumns(row.depth - 1);
        const isLast = !sameLayer(rows[index + 1], row.frameId, row.layer.id);
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
              "group relative flex w-full items-center gap-0.5 pr-1.5 text-left",
              isSelected ? ROW_SELECTED : "hover:bg-muted/60",
            )}
            style={{ height, paddingLeft: columns.label }}
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
            <TreeGuide
              left={columns.guide}
              label={columns.label}
              part={isLast ? "last" : "through"}
              active={isLayerSelected(row.frameId, row.layer.id)}
            />
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

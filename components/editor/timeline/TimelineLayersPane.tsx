"use client";

import React from "react";
import { ChevronRight, Square } from "lucide-react";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import { useEditorStore } from "@/lib/store/editorStore";
import { cn } from "@/lib/utils";
import { TimelineKeyframeDiamond } from "./TimelinePropertyBlock";
import { TimelinePropertyValue } from "./TimelineLiveState";
import type { TimelineProjection, TimelineRow } from "./timelineProjection";

const FIGMA_BLUE = "#0C8CE9";
const ROW_SELECTED = "bg-[#0C8CE9]/20";
const ROW_LAYER_HEIGHT = 30;
const ROW_PROPERTY_HEIGHT = 28;

interface TimelineLayersPaneProps {
  rows: TimelineRow[];
  width: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onScroll: () => void;
  onToggleFrame: (frameId: string) => void;
  onToggleGroup: (rowKey: string) => void;
  blocksForLayer: TimelineProjection["blocksForLayer"];
  blocksForProperty: TimelineProjection["blocksForProperty"];
}

export function TimelineLayersPane({
  rows,
  width,
  scrollRef,
  onScroll,
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
  const [renamingLayerKey, setRenamingLayerKey] = React.useState<string | null>(null);

  const jumpTo = (milliseconds: number) => {
    useEditorStore
      .getState()
      .setProgress(Math.max(0, Math.min(1, milliseconds / Math.max(1, animationDuration))));
  };

  return (
    <div
      ref={scrollRef}
      className="min-h-0 shrink-0 overflow-y-auto overflow-x-hidden border-r border-white/[0.06]"
      style={{ width }}
      onScroll={onScroll}
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
                isActive ? "bg-white/[0.05] text-white/90" : "text-white/55 hover:bg-white/[0.03]",
              )}
              style={{ height: ROW_LAYER_HEIGHT, paddingLeft: 8 }}
              onClick={() => useEditorStore.getState().selectFrame(row.frameId)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  useEditorStore.getState().selectFrame(row.frameId);
                }
              }}
            >
              <button
                type="button"
                className="grid size-4 shrink-0 place-items-center rounded-sm hover:bg-white/[0.08]"
                aria-label={row.expanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFrame(row.frameId);
                }}
              >
                <ChevronRight
                  className={cn(
                    "h-2.5 w-2.5 text-white/30 transition-transform duration-100",
                    row.expanded && "rotate-90",
                  )}
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
                isSelected ? `${ROW_SELECTED} text-white` : "text-white/80 hover:bg-white/[0.03]",
              )}
              style={{ height: ROW_LAYER_HEIGHT, paddingLeft: 6 + row.depth * 12 }}
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
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectRow();
                }
              }}
            >
              <span className="grid size-4 shrink-0 place-items-center">
                {row.expandable && (
                  <button
                    type="button"
                    className="grid size-4 place-items-center rounded-sm hover:bg-white/[0.08]"
                    aria-label={row.expanded ? `Collapse ${row.name}` : `Expand ${row.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleGroup(row.key);
                    }}
                  >
                    <ChevronRight
                      className={cn(
                        "h-2.5 w-2.5 text-white/30 transition-transform duration-100",
                        row.expanded && "rotate-90",
                      )}
                    />
                  </button>
                )}
              </span>
              <span
                className="flex size-[12px] shrink-0 items-center justify-center rounded-[2px] border"
                style={{
                  borderColor: isSelected ? FIGMA_BLUE : "rgba(255,255,255,0.28)",
                  background: "transparent",
                }}
                aria-hidden
              >
                <Square
                  className="size-[7px]"
                  style={{ color: isSelected ? FIGMA_BLUE : "rgba(255,255,255,0.35)" }}
                  strokeWidth={1.75}
                />
              </span>
              {renamingLayerKey === row.key ? (
                <input
                  autoFocus
                  defaultValue={row.name}
                  onFocus={(event) => event.currentTarget.select()}
                  onBlur={(event) => {
                    useEditorStore.getState().updateSelectedLayer({ name: event.target.value });
                    setRenamingLayerKey(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      useEditorStore
                        .getState()
                        .updateSelectedLayer({ name: event.currentTarget.value });
                      setRenamingLayerKey(null);
                    } else if (event.key === "Escape") {
                      setRenamingLayerKey(null);
                    }
                  }}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="h-4 min-w-0 flex-1 rounded-sm border border-primary bg-black/40 px-1 text-[11px] text-white outline-none"
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
              isSelected ? ROW_SELECTED : "hover:bg-white/[0.025]",
            )}
            style={{ height: ROW_PROPERTY_HEIGHT, paddingLeft: 24 + row.depth * 6 }}
            onClick={selectProperty}
          >
            <span
              className={cn(
                "min-w-0 flex-1 truncate text-[11px]",
                isSelected ? "text-white/90" : "text-white/45",
              )}
            >
              {propertyLabel(row.propertyName)}
            </span>
            <div
              className={cn(
                "flex shrink-0 items-center",
                isSelected ? "opacity-100" : "opacity-50 group-hover:opacity-100",
              )}
            >
              <button
                type="button"
                aria-label={`Jump to first ${propertyLabel(row.propertyName)} keyframe`}
                className="grid size-4 place-items-center rounded text-white/35 hover:bg-white/[0.08] disabled:opacity-20"
                disabled={!Number.isFinite(earliest)}
                onClick={(event) => {
                  event.stopPropagation();
                  if (Number.isFinite(earliest)) jumpTo(earliest);
                }}
              >
                <ChevronRight className="h-2.5 w-2.5 rotate-180" strokeWidth={2} />
              </button>
              <button
                type="button"
                aria-label={`Select ${propertyLabel(row.propertyName)} keyframes`}
                className="grid size-4 place-items-center rounded hover:bg-white/[0.08]"
                onClick={(event) => {
                  event.stopPropagation();
                  useEditorStore.getState().selectBlocks(blockIds);
                }}
              >
                <TimelineKeyframeDiamond active={isSelected} size={6} />
              </button>
              <button
                type="button"
                aria-label={`Jump to last ${propertyLabel(row.propertyName)} keyframe`}
                className="grid size-4 place-items-center rounded text-white/35 hover:bg-white/[0.08] disabled:opacity-20"
                disabled={!latest}
                onClick={(event) => {
                  event.stopPropagation();
                  if (latest) jumpTo(latest);
                }}
              >
                <ChevronRight className="h-2.5 w-2.5" strokeWidth={2} />
              </button>
            </div>
            <TimelinePropertyValue
              block={first}
              propertyName={row.propertyName}
              selected={isSelected}
            />
          </div>
        );
      })}
    </div>
  );
}

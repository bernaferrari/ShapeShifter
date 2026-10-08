"use client";

import React from "react";
import { Trash2, X, ChevronLeft, ChevronRight, PenTool } from "lucide-react";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import { parseEditorColor } from "@/lib/shapeshifter/playheadResolve";
import { validatePathData } from "@/lib/shapeshifter/path/pathValidation";
import {
  linkedTimelineKeyframe,
  trackKeyframes,
  type TrackKeyframe,
  timelineKeyframeRange,
} from "@/lib/shapeshifter/motion/timelineKeyframes";
import { createLayerTreeModel } from "@/lib/shapeshifter/scene/layerHierarchy";
import {
  isTimelineNumberValid,
  timelineNumberRange,
} from "@/lib/shapeshifter/motion/timelineProperties";
import type { TimelineBlock } from "@/lib/shapeshifter/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { EasingPanel } from "../inspector/EasingPanel";
import { useTimelineViewSettings } from "./timelineViewSettings";
import { timelineTimeFactor, formatTimeNumber, timelineUnitSuffix } from "./timelineScale";
import { MotionField, numericValue, validNumber } from "../inspector/MotionField";

/** Direct endpoint editing is explicit; double-click never destroys a keyframe. */
export function TimelineKeyframeEditor({
  block,
  edge,
  duration,
  open,
  onOpenChange,
  trigger,
  keys,
}: {
  block: TimelineBlock;
  edge: "start" | "end";
  duration: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  keys?: TrackKeyframe[];
  trigger: React.ReactElement<React.ComponentPropsWithRef<"button">>;
}) {
  const popupRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const timeRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const blocks = useEditorStore((state) => state.animation.blocks);
  const lastPose =
    block.startTime === block.endTime &&
    blocks.filter(
      (item) =>
        String(item.layerId) === String(block.layerId) && item.propertyName === block.propertyName,
    ).length === 1;
  const layers = useEditorStore((state) => state.layers);
  const locked = React.useMemo(() => {
    if (!open) return false;
    const tree = createLayerTreeModel(layers);
    const layer = tree.allLayers.find((item) => String(item.id) === String(block.layerId));
    return !layer || layer.locked || tree.ancestorsOf(layer.id).some((parent) => parent.locked);
  }, [open, layers, block.layerId]);
  const label = propertyLabel(block.propertyName);
  const unitSetting = useTimelineViewSettings((state) => state.unit);
  const fps = useTimelineViewSettings((state) => state.fps);
  const timeFactor = timelineTimeFactor(unitSetting, fps);
  const stops =
    keys ??
    trackKeyframes(
      blocks.filter(
        (item) =>
          String(item.layerId) === String(block.layerId) &&
          item.propertyName === block.propertyName,
      ),
    );
  const index = stops.findIndex((item) => item.blockId === block.id && item.edge === edge);
  const [showEasing, setShowEasing] = React.useState(false);
  const time = edge === "start" ? block.startTime : block.endTime;
  const value = edge === "start" ? block.fromValue : block.toValue;
  const kind =
    block.propertyName === "pathData" || block.type === "path"
      ? "path"
      : block.type === "color" || ["fillColor", "strokeColor"].includes(block.propertyName)
        ? "color"
        : "number";
  const multiplier = [
    "scaleX",
    "scaleY",
    "alpha",
    "fillAlpha",
    "strokeAlpha",
    "trimPathStart",
    "trimPathEnd",
    "trimPathOffset",
  ].includes(block.propertyName)
    ? 100
    : 1;
  const unit = multiplier === 100 ? "%" : block.propertyName === "rotation" ? "°" : undefined;
  const seek = (next: number) => {
    const state = useEditorStore.getState();
    useEditorStore.setState({ isPlaying: false });
    state.setProgress(next / Math.max(1, state.animation.duration));
  };
  const valueField = (
    <MotionField
      key={`${block.id}-${edge}-value`}
      label="Value"
      ariaLabel={`${label} keyframe value`}
      disabled={locked}
      onCancel={() => onOpenChange(false)}
      value={kind === "number" ? Number((Number(value) * multiplier).toFixed(6)) : value}
      color={kind === "color"}
      multiline={kind === "path"}
      suffix={kind === "number" ? unit : undefined}
      validate={
        kind === "path"
          ? validatePathData
          : kind === "color"
            ? (raw) => (parseEditorColor(raw) ? null : "Enter a hex or RGB color.")
            : (raw) => {
                const error = validNumber(raw);
                if (error) return error;
                if (isTimelineNumberValid(block.propertyName, numericValue(raw) / multiplier))
                  return null;
                const [min, max] = timelineNumberRange(block.propertyName);
                return `Use ${min * multiplier}–${max * multiplier}${unit ? ` ${unit}` : ""}.`;
              }
      }
      onCommit={(raw) => {
        useEditorStore.getState().updateTimelineKeyframe(block.id, edge, {
          value: kind === "number" ? numericValue(raw) / multiplier : raw.trim(),
        });
        seek(time);
      }}
    />
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (!next) onOpenChange(false);
      }}
    >
      <PopoverTrigger render={React.cloneElement(trigger, { ref: triggerRef })} />
      <PopoverContent
        side="top"
        sideOffset={10}
        ref={popupRef}
        initialFocus={popupRef}
        aria-label={`${label} ${edge} keyframe editor`}
        className="w-72 pointer-coarse:w-[min(360px,calc(100vw-24px))] max-h-[min(520px,70dvh)] overflow-y-auto max-w-[calc(100vw-16px)] gap-2.5 rounded-xl p-3 duration-0 data-open:animate-none data-closed:animate-none"
        finalFocus={() => {
          const key = useEditorStore.getState().selectedKeyframe;
          const selected =
            key &&
            document.querySelector<HTMLElement>(
              `[data-timeline-keyframe-block-id="${CSS.escape(key.blockId)}"][data-timeline-keyframe-edge="${key.edge}"]`,
            );
          return (
            selected || (triggerRef.current?.isConnected ? triggerRef.current : returnFocus.current)
          );
        }}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <PopoverTitle className="min-w-0 flex-1 text-[12px] font-semibold">
            {label}{" "}
            <span className="font-normal text-muted-foreground pointer-coarse:block">
              <span className="pointer-coarse:hidden">· </span>
              {index + 1} of {stops.length}
            </span>
          </PopoverTitle>
          {([-1, 1] as const).map((direction) => {
            const neighbor = stops[index + direction];
            const Icon = direction === -1 ? ChevronLeft : ChevronRight;
            return (
              <button
                key={direction}
                type="button"
                aria-label={`${direction === -1 ? "Previous" : "Next"} ${label} keyframe`}
                disabled={!neighbor}
                className="grid size-6 pointer-coarse:size-11 shrink-0 place-items-center rounded-md hover:bg-muted disabled:opacity-30"
                onClick={() =>
                  neighbor &&
                  useEditorStore.getState().selectTimelineKeyframe(neighbor.blockId, neighbor.edge)
                }
              >
                <Icon className="size-4" />
              </button>
            );
          })}
          <button
            type="button"
            aria-label={`Delete ${label} ${edge} keyframe`}
            disabled={locked || lastPose}
            title={
              lastPose
                ? "Use Remove animation to stop animating this property"
                : linkedTimelineKeyframe(useEditorStore.getState().animation.blocks, block, edge)
                  ? "Delete keyframe (joins the adjacent segments)"
                  : "Delete this keyframe; keep the remaining poses"
            }
            onClick={() => {
              returnFocus.current =
                triggerRef.current
                  ?.closest("section")
                  ?.querySelector<HTMLElement>('[aria-label="Animation tracks"]') ?? null;
              onOpenChange(false);
              useEditorStore.getState().removeTimelineKeyframe(block.id, edge);
              queueMicrotask(() => {
                if (!triggerRef.current?.isConnected) returnFocus.current?.focus();
              });
            }}
            className="grid size-6 pointer-coarse:size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
          >
            <Trash2 className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Close keyframe editor"
            onClick={() => onOpenChange(false)}
            className="grid size-6 pointer-coarse:size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <MotionField
          key={`${block.id}-${edge}-time`}
          label="Time"
          ariaLabel={`${label} keyframe time`}
          value={formatTimeNumber(time * timeFactor)}
          suffix={timelineUnitSuffix(unitSetting)}
          fieldRef={(element) => {
            timeRef.current = element;
          }}
          disabled={locked}
          onCancel={() => onOpenChange(false)}
          validate={(raw) => {
            const error = validNumber(raw);
            if (error) return error;
            const [min, max] = timelineKeyframeRange(
              useEditorStore.getState().animation.blocks,
              block,
              edge,
              duration,
            );
            return numericValue(raw) / timeFactor >= min && numericValue(raw) / timeFactor <= max
              ? null
              : `Use ${formatTimeNumber(min * timeFactor)}–${formatTimeNumber(max * timeFactor)} ${timelineUnitSuffix(unitSetting)}.`;
          }}
          onCommit={(raw) => {
            useEditorStore
              .getState()
              .updateTimelineKeyframe(block.id, edge, { time: numericValue(raw) / timeFactor });
            seek(numericValue(raw) / timeFactor);
          }}
        />
        {kind === "path" && (
          <button
            type="button"
            disabled={locked}
            className="flex h-9 pointer-coarse:h-11 items-center justify-center gap-2 rounded-md bg-primary text-sm text-primary-foreground disabled:opacity-50"
            onClick={() => {
              useEditorStore.getState().selectTimelineKeyframe(block.id, edge, false);
              useEditorStore.getState().setToolMode("direct");
              useEditorStore.getState().syncPathEditingWithPlayhead();
              onOpenChange(false);
            }}
          >
            <PenTool className="size-4" />
            Edit shape
          </button>
        )}
        {kind === "path" ? (
          <details>
            <summary className="cursor-pointer py-2 text-xs text-muted-foreground">
              Advanced path data
            </summary>
            {valueField}
          </details>
        ) : (
          valueField
        )}
        {index < stops.length - 1 && (
          <>
            <button
              type="button"
              aria-label="Keyframe easing"
              aria-expanded={showEasing}
              onClick={() => setShowEasing((value) => !value)}
              className="flex h-9 pointer-coarse:h-11 items-center justify-between rounded-md bg-secondary px-3 text-xs"
            >
              <span>Easing</span>
              <span className="text-muted-foreground">{showEasing ? "Hide" : "Edit"}</span>
            </button>
            {showEasing && <EasingPanel block={block} inline onBack={() => setShowEasing(false)} />}
          </>
        )}
        {locked && (
          <p className="text-[11px] text-muted-foreground">Unlock this layer to edit its motion.</p>
        )}
      </PopoverContent>
    </Popover>
  );
}

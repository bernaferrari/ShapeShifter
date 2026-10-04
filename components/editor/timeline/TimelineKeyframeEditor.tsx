"use client";

import React from "react";
import { Trash2, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import { parseEditorColor } from "@/lib/shapeshifter/playheadResolve";
import { validatePathData } from "@/lib/shapeshifter/path/pathValidation";
import {
  linkedTimelineKeyframe,
  timelineKeyframeRange,
} from "@/lib/shapeshifter/motion/timelineKeyframes";
import { createLayerTreeModel } from "@/lib/shapeshifter/scene/layerHierarchy";
import {
  isTimelineNumberValid,
  timelineNumberRange,
} from "@/lib/shapeshifter/motion/timelineProperties";
import type { TimelineBlock } from "@/lib/shapeshifter/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { MotionField, numericValue, validNumber } from "../inspector/MotionField";

/** Direct endpoint editing is explicit; double-click never destroys a keyframe. */
export function TimelineKeyframeEditor({
  block,
  edge,
  duration,
  open,
  onOpenChange,
  trigger,
}: {
  block: TimelineBlock;
  edge: "start" | "end";
  duration: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: React.ReactElement<React.ComponentPropsWithRef<"button">>;
}) {
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const timeRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const returnFocus = React.useRef<HTMLElement | null>(null);
  const layers = useEditorStore((state) => state.layers);
  const locked = React.useMemo(() => {
    if (!open) return false;
    const tree = createLayerTreeModel(layers);
    const layer = tree.allLayers.find((item) => String(item.id) === String(block.layerId));
    return !layer || layer.locked || tree.ancestorsOf(layer.id).some((parent) => parent.locked);
  }, [open, layers, block.layerId]);
  const label = propertyLabel(block.propertyName);
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
        initialFocus={locked ? true : timeRef}
        aria-label={`${label} ${edge} keyframe editor`}
        className="w-72 max-w-[calc(100vw-16px)] gap-3 p-3 data-open:animate-none data-closed:animate-none"
        finalFocus={() =>
          triggerRef.current?.isConnected ? triggerRef.current : returnFocus.current
        }
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center gap-2">
          <PopoverTitle className="min-w-0 flex-1 text-xs">
            {label} · {edge === "start" ? "Start" : "End"} keyframe
          </PopoverTitle>
          <button
            type="button"
            aria-label="Close keyframe editor"
            onClick={() => onOpenChange(false)}
            className="grid size-8 place-items-center rounded text-muted-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X className="size-3.5" />
          </button>
        </div>
        <MotionField
          key={`${block.id}-${edge}-time`}
          label="Time"
          ariaLabel={`${label} keyframe time`}
          value={time}
          suffix="ms"
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
            return numericValue(raw) >= min && numericValue(raw) <= max
              ? null
              : `Use ${Number(min.toFixed(3))}–${Number(max.toFixed(3))} ms.`;
          }}
          onCommit={(raw) => {
            useEditorStore
              .getState()
              .updateTimelineKeyframe(block.id, edge, { time: numericValue(raw) });
            seek(numericValue(raw));
          }}
        />
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
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          {locked
            ? "Unlock this layer and its parent groups to edit motion."
            : "Linked segments share this endpoint. Enter applies a field; Escape cancels and closes."}
        </p>
        <button
          type="button"
          aria-label={`Delete ${label} ${edge} keyframe`}
          disabled={locked}
          title={
            linkedTimelineKeyframe(useEditorStore.getState().animation.blocks, block, edge)
              ? "Join the adjacent segments"
              : "Remove this outer keyframe and its segment"
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
          className="flex h-8 items-center justify-center gap-2 rounded text-xs text-destructive hover:bg-destructive/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
          Delete keyframe
        </button>
      </PopoverContent>
    </Popover>
  );
}

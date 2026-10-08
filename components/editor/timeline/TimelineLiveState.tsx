"use client";

import { formatTimeNumber, timelineTimeFactor } from "./timelineScale";

import React from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import { EasingCurve } from "../EasingCurve";
import type { TimelineBlock } from "@/lib/pathshift/types";
import { colorAtTime, numberAtTime } from "@/lib/pathshift/playheadResolve";
import type { Layer } from "@/lib/pathshift/types";
import { cn } from "@/lib/utils";
import type { TimelineTimeUnit } from "./timelineScale";

function formatCompactValue(value: string | number | undefined, propertyName?: string): string {
  if (value == null || value === "") return "—";
  if (
    propertyName === "pathData" ||
    (typeof value === "string" && /^[MmLlHhVvCcSsQqTtAaZz]/.test(value.trim()))
  ) {
    return "Path";
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "—";
    const abs = Math.abs(value);
    if (propertyName === "rotation") return `${Number(value.toFixed(1))}°`;
    if (propertyName === "scaleX" || propertyName === "scaleY") {
      return `${Math.round(value * 100)}%`;
    }
    if (abs >= 100) return String(Math.round(value));
    if (abs >= 10) return value.toFixed(1).replace(/\.0$/, "");
    return value.toFixed(2).replace(/\.?0+$/, "");
  }
  const text = String(value);
  if (text.startsWith("#") && (text.length === 7 || text.length === 9)) {
    return text.toUpperCase();
  }
  return text.length > 10 ? `${text.slice(0, 8)}…` : text;
}

export function TimelinePlayhead({
  visible,
  layersWidth,
  color,
  contentWidth,
  viewportWidth,
  scrollLeft = 0,
  bleed = 0,
}: {
  visible: boolean;
  layersWidth: number;
  color: string;
  contentWidth?: number;
  viewportWidth?: number;
  scrollLeft?: number;
  /** Visible lane gutter on each side of the viewport the needle may still enter. */
  bleed?: number;
}) {
  const progress = useEditorStore((state) => state.progress);
  const position = contentWidth === undefined ? undefined : progress * contentWidth - scrollLeft;
  if (
    !visible ||
    (position !== undefined &&
      (position < -bleed || position > (viewportWidth ?? contentWidth!) + bleed))
  )
    return null;
  return (
    <div
      data-timeline-playhead
      className="pointer-events-none absolute top-0 bottom-0 z-[60] w-0"
      style={{
        left:
          position === undefined
            ? `calc(${layersWidth}px + (100% - ${layersWidth}px) * ${progress})`
            : layersWidth + position,
      }}
      aria-hidden
    >
      <div className="absolute left-1/2 top-0 -translate-x-1/2">
        <svg width="10" height="9" viewBox="0 0 10 9" fill="none">
          <path d="M0 0H10V5.5L5 9L0 5.5V0Z" fill={color} />
        </svg>
      </div>
      <div
        className="absolute bottom-0 left-1/2 w-px -translate-x-1/2"
        style={{ top: 9, backgroundColor: color }}
      />
    </div>
  );
}

export function TimelineCurrentTimeInput({
  color,
  unit = "milliseconds",
  fps = 30,
}: {
  color: string;
  unit?: TimelineTimeUnit;
  fps?: number;
}) {
  const progress = useEditorStore((state) => state.progress);
  const duration = useEditorStore((state) => state.animation.duration);
  const setProgress = useEditorStore((state) => state.setProgress);
  const [draft, setDraft] = React.useState<string | null>(null);
  const draftRef = React.useRef<string | null>(null);
  const cancelBlur = React.useRef(false);
  const currentMilliseconds = progress * duration;
  const multiplier = timelineTimeFactor(unit, fps);
  const commit = () => {
    const raw = draftRef.current;
    const milliseconds = Number(raw?.replace(",", "."));
    if (raw !== null && raw.trim() !== "" && Number.isFinite(milliseconds)) {
      setProgress(Math.max(0, Math.min(1, milliseconds / multiplier / Math.max(1, duration))));
    }
    setDraft(null);
    draftRef.current = null;
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? formatTimeNumber(currentMilliseconds * multiplier)}
      onFocus={(event) => {
        const store = useEditorStore.getState();
        if (store.isPlaying) store.togglePlayback();
        draftRef.current = String(store.progress * duration * multiplier);
        setDraft(draftRef.current);
        event.currentTarget.select();
      }}
      onChange={(event) => {
        draftRef.current = event.target.value;
        setDraft(event.target.value);
      }}
      onBlur={() => {
        if (cancelBlur.current) cancelBlur.current = false;
        else commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelBlur.current = true;
          draftRef.current = null;
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      aria-label={
        unit === "frames"
          ? "Current frame"
          : unit === "seconds"
            ? "Current time in seconds"
            : "Current time in milliseconds"
      }
      className="w-[8ch] min-w-0 rounded-sm border-0 bg-transparent p-0 text-right font-medium tabular-nums outline-none focus-visible:ring-1 focus-visible:ring-ring"
      style={{ color }}
    />
  );
}

export function TimelineDurationInput({
  unit = "milliseconds",
  fps = 30,
}: {
  unit?: TimelineTimeUnit;
  fps?: number;
}) {
  const duration = useEditorStore((state) => state.animation.duration);
  const setAnimationDuration = useEditorStore((state) => state.setAnimationDuration);
  const [draft, setDraft] = React.useState<string | null>(null);
  const draftRef = React.useRef<string | null>(null);
  const cancelBlur = React.useRef(false);
  const multiplier = timelineTimeFactor(unit, fps);
  const commit = () => {
    const raw = draftRef.current;
    const milliseconds = Number(raw?.replace(",", "."));
    if (raw !== null && raw.trim() !== "" && Number.isFinite(milliseconds) && milliseconds > 0) {
      setAnimationDuration(Math.max(100, milliseconds / multiplier));
    }
    setDraft(null);
    draftRef.current = null;
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft ?? formatTimeNumber(duration * multiplier)}
      onFocus={(event) => {
        draftRef.current = String(duration * multiplier);
        setDraft(draftRef.current);
        event.currentTarget.select();
      }}
      onChange={(event) => {
        draftRef.current = event.target.value;
        setDraft(event.target.value);
      }}
      onBlur={() => {
        if (cancelBlur.current) cancelBlur.current = false;
        else commit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelBlur.current = true;
          draftRef.current = null;
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      aria-label={
        unit === "frames"
          ? "Animation duration in frames"
          : unit === "seconds"
            ? "Animation duration in seconds"
            : "Animation duration in milliseconds"
      }
      className="h-4 w-[8ch] min-w-0 rounded-sm border-0 bg-transparent p-0 text-[11px] tabular-nums text-muted-foreground outline-none hover:text-foreground focus:text-foreground focus-visible:ring-1 focus-visible:ring-ring"
    />
  );
}

export function LiveEasingCurve({
  size,
  points,
  onChange,
  onEditStart,
  onEditEnd,
  onEditCancel,
  block,
}: {
  size: number;
  points: [number, number, number, number];
  onChange: (points: [number, number, number, number]) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  onEditCancel?: () => void;
  block?: TimelineBlock;
}) {
  const progress = useEditorStore((state) => state.progress);
  const duration = useEditorStore((state) => state.animation.duration);
  const curveProgress = block
    ? Math.max(
        0,
        Math.min(
          1,
          (progress * duration - block.startTime) / Math.max(1, block.endTime - block.startTime),
        ),
      )
    : progress;
  return (
    <EasingCurve
      size={size}
      points={points}
      progress={curveProgress}
      onChange={onChange}
      onEditStart={onEditStart}
      onEditEnd={onEditEnd}
      onEditCancel={onEditCancel}
    />
  );
}

export function TimelinePropertyValue({
  block,
  propertyName,
  selected,
  blocks,
  duration: trackDuration,
}: {
  block: TimelineBlock | undefined;
  propertyName: string;
  selected: boolean;
  blocks?: TimelineBlock[];
  duration?: number;
}) {
  const progress = useEditorStore((state) => state.progress);
  const duration = useEditorStore((state) => state.animation.duration);
  if (!block) return <span className="w-[48px] shrink-0" />;
  const currentTimeMs = progress * (trackDuration ?? duration);
  const trackBlocks = blocks ?? [block];
  const layer = { id: block.layerId } as Layer;
  const valueType =
    block.propertyName === "pathData" || block.type === "path"
      ? "path"
      : ["fillColor", "strokeColor"].includes(block.propertyName) || block.type === "color"
        ? "color"
        : "number";
  const value =
    valueType === "number"
      ? numberAtTime(layer, trackBlocks, propertyName, currentTimeMs, trackDuration ?? duration)
      : valueType === "color"
        ? colorAtTime(
            layer,
            trackBlocks,
            propertyName,
            currentTimeMs,
            trackDuration ?? duration,
            String(block.fromValue),
          )
        : "Path";
  if (valueType === "path") return <span className="w-[48px] shrink-0" aria-hidden />;
  const display = formatCompactValue(value, propertyName);
  const title = `${formatCompactValue(block.fromValue, propertyName)} → ${formatCompactValue(block.toValue, propertyName)}`;
  if (valueType === "color")
    return (
      <span className="flex w-[48px] shrink-0 items-center justify-end" title={title}>
        <span
          className="size-3 rounded-[3px] shadow-[inset_0_0_0_1px_var(--border)]"
          style={{ backgroundColor: String(value) }}
          aria-label={display}
        />
      </span>
    );
  return (
    <span
      className={cn(
        "w-[48px] shrink-0 truncate text-right text-[11px] tabular-nums",
        selected ? "text-foreground" : "text-muted-foreground",
      )}
      title={title}
    >
      {display}
    </span>
  );
}

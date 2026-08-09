"use client";

import React from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import { EasingCurve } from "../EasingCurve";
import type { TimelineBlock } from "@/lib/shapeshifter/types";
import { cn } from "@/lib/utils";

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
}: {
  visible: boolean;
  layersWidth: number;
  color: string;
}) {
  const progress = useEditorStore((state) => state.progress);
  if (!visible) return null;
  return (
    <div
      className="pointer-events-none absolute inset-y-0 z-[60] w-0"
      style={{ left: `calc(${layersWidth}px + (100% - ${layersWidth}px) * ${progress})` }}
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

export function TimelineCurrentTimeInput({ color }: { color: string }) {
  const progress = useEditorStore((state) => state.progress);
  const duration = useEditorStore((state) => state.animation.duration);
  const setProgress = useEditorStore((state) => state.setProgress);
  const [draft, setDraft] = React.useState<string | null>(null);
  const currentMilliseconds = progress * duration;
  const commit = () => {
    const milliseconds = Number(draft);
    if (Number.isFinite(milliseconds)) {
      setProgress(Math.max(0, Math.min(1, milliseconds / Math.max(1, duration))));
    }
    setDraft(null);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft ?? Math.round(currentMilliseconds)}
      onFocus={() => setDraft(String(Math.round(currentMilliseconds)))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      aria-label="Current time in milliseconds"
      className="w-[42px] border-0 bg-transparent p-0 font-medium tabular-nums outline-none"
      style={{ color }}
    />
  );
}

export function TimelineDurationInput() {
  const duration = useEditorStore((state) => state.animation.duration);
  const setAnimationDuration = useEditorStore((state) => state.setAnimationDuration);
  const [draft, setDraft] = React.useState<string | null>(null);
  const commit = () => {
    const milliseconds = Number(draft);
    if (Number.isFinite(milliseconds) && milliseconds > 0) {
      setAnimationDuration(Math.max(100, Math.round(milliseconds)));
    }
    setDraft(null);
  };
  return (
    <input
      type="text"
      inputMode="numeric"
      value={draft ?? String(duration)}
      onFocus={() => setDraft(String(duration))}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      aria-label="Animation duration in milliseconds"
      className="h-4 w-[42px] border-0 bg-transparent p-0 text-[11px] tabular-nums text-white/50 outline-none hover:text-white/80 focus:text-white"
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
}: {
  size: number;
  points: [number, number, number, number];
  onChange: (points: [number, number, number, number]) => void;
  onEditStart?: () => void;
  onEditEnd?: () => void;
  onEditCancel?: () => void;
}) {
  const progress = useEditorStore((state) => state.progress);
  return (
    <EasingCurve
      size={size}
      points={points}
      progress={progress}
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
}: {
  block: TimelineBlock | undefined;
  propertyName: string;
  selected: boolean;
}) {
  const progress = useEditorStore((state) => state.progress);
  const duration = useEditorStore((state) => state.animation.duration);
  if (!block) return <span className="w-[48px] shrink-0" />;
  const currentTimeMs = progress * duration;
  const display = formatCompactValue(
    currentTimeMs < (block.startTime + block.endTime) / 2 ? block.fromValue : block.toValue,
    propertyName,
  );
  const title = `${formatCompactValue(block.fromValue, propertyName)} → ${formatCompactValue(block.toValue, propertyName)}`;
  return (
    <span
      className={cn(
        "w-[48px] shrink-0 truncate text-right font-mono text-[10px] tabular-nums",
        selected ? "text-white/70" : "text-white/35",
      )}
      title={title}
    >
      {display}
    </span>
  );
}

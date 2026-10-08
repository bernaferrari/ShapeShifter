"use client";

import React from "react";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import { interpolatorControlPoints } from "@/lib/shapeshifter/motion/timelineKeyframes";
import type { TimelineBlock } from "@/lib/shapeshifter/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { ChevronDown, ChevronLeft, FlipHorizontal2, Spline } from "lucide-react";
import { PanelHeader } from "../PanelHeader";
import { LiveEasingCurve } from "../timeline/TimelineLiveState";

const EASING_OPTIONS = [
  ["FAST_OUT_SLOW_IN", "Standard"],
  ["LINEAR_OUT_SLOW_IN", "Decelerate"],
  ["FAST_OUT_LINEAR_IN", "Accelerate"],
  ["ACCELERATE_DECELERATE", "Ease in and out"],
  ["LINEAR", "Linear"],
] as const;

const formatCurve = (points: number[]) =>
  points.map((value) => Number(value.toFixed(3))).join(", ");

/**
 * The easing of one motion segment, like Figma's easing panel. Values are edited
 * at the playhead and keyframe times on the timeline, so only the curve lives here.
 */
export function EasingPanel({
  block,
  onBack,
  inline = false,
}: {
  block: TimelineBlock;
  onBack: () => void;
  inline?: boolean;
}) {
  const label = propertyLabel(block.propertyName);
  const update = (patch: Partial<TimelineBlock>) => {
    const store = useEditorStore.getState();
    const current = store.animation.blocks.find((item) => item.id === block.id);
    if (
      !current ||
      Object.entries(patch).every(([key, value]) => current[key as keyof TimelineBlock] === value)
    )
      return;
    store.updateTimelineBlock(block.id, patch);
  };
  const interpolator = block.interpolator || "ACCELERATE_DECELERATE";
  const isNamedEasing = EASING_OPTIONS.some(([value]) => value === interpolator);
  const easingEditRef = React.useRef<{ changed: boolean } | null>(null);
  const points = interpolatorControlPoints(interpolator);
  const updateCurve = (next: [number, number, number, number]) => {
    const value = `cubic-bezier(${next.map((number) => number.toFixed(8).replace(/\.?0+$/, "")).join(", ")})`;
    if (
      useEditorStore.getState().animation.blocks.find((item) => item.id === block.id)
        ?.interpolator === value
    )
      return;
    const session = easingEditRef.current;
    if (session && !session.changed) {
      useEditorStore.getState().pushHistory();
      session.changed = true;
    }
    useEditorStore
      .getState()
      .updateTimelineBlock(block.id, { interpolator: value }, { recordHistory: !session });
  };
  const parseCurve = (raw: string) => {
    const numbers = raw
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    return numbers.length === 4 && numbers.every(Number.isFinite)
      ? (numbers as [number, number, number, number])
      : null;
  };

  return (
    <div
      data-motion-block-id={block.id}
      className={inline ? "flex min-h-0 flex-col" : "flex h-full min-h-0 flex-col"}
    >
      {!inline && (
        <PanelHeader className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to properties"
            className="grid size-7 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold leading-tight">Easing</div>
            <div className="truncate text-[11px] leading-tight text-muted-foreground">
              {label} · {block.startTime}–{block.endTime} ms
            </div>
          </div>
        </PanelHeader>
      )}
      <div
        className={inline ? "min-h-0 space-y-2" : "min-h-0 flex-1 space-y-2 overflow-y-auto p-3"}
      >
        <div className="relative">
          <EasingIcon
            points={points}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <select
            value={isNamedEasing ? interpolator : "custom"}
            aria-label={`${label} easing`}
            onChange={(event) => {
              if (event.target.value !== "custom") update({ interpolator: event.target.value });
            }}
            className="h-8 pointer-coarse:h-11 w-full appearance-none rounded-md border border-transparent bg-secondary pl-8 pr-7 text-[12px] text-foreground outline-none hover:border-border focus:border-primary"
          >
            {!isNamedEasing && <option value="custom">Custom bezier</option>}
            {EASING_OPTIONS.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        </div>
        <div className="grid place-items-center rounded-lg bg-secondary/60 py-3 text-foreground">
          <LiveEasingCurve
            size={208}
            points={points}
            block={block}
            onEditStart={() => {
              easingEditRef.current = { changed: false };
            }}
            onEditEnd={() => {
              easingEditRef.current = null;
            }}
            onEditCancel={() => {
              if (easingEditRef.current?.changed)
                useEditorStore.getState().cancelLastHistoryTransaction();
              easingEditRef.current = null;
            }}
            onChange={updateCurve}
          />
        </div>
        <div className="flex items-start gap-1">
          <CurveInput
            ariaLabel={`${label} easing curve`}
            points={points}
            parse={parseCurve}
            onCommit={updateCurve}
          />
          <button
            type="button"
            onClick={() =>
              updateCurve([1 - points[2], 1 - points[3], 1 - points[0], 1 - points[1]])
            }
            aria-label="Flip curve"
            title="Flip curve"
            className="grid size-8 pointer-coarse:size-11 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <FlipHorizontal2 className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

function EasingIcon({
  points,
  className,
}: {
  points: [number, number, number, number];
  className?: string;
}) {
  const [x1, y1, x2, y2] = points;
  const p = (x: number, y: number) => `${1 + x * 12} ${13 - y * 12}`;
  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden className={className}>
      <path
        d={`M${p(0, 0)} C${p(x1, y1)} ${p(x2, y2)} ${p(1, 1)}`}
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The bezier numbers as one field, validated on Enter or when leaving the field. */
function CurveInput({
  ariaLabel,
  points,
  parse,
  onCommit,
}: {
  ariaLabel: string;
  points: [number, number, number, number];
  parse: (raw: string) => [number, number, number, number] | null;
  onCommit: (points: [number, number, number, number]) => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    const next = parse(draft);
    if (!next) return setError("Use four numbers, like 0.4, 0, 0.2, 1.");
    if (next[0] < 0 || next[0] > 1 || next[2] < 0 || next[2] > 1)
      return setError("The 1st and 3rd numbers must be between 0 and 1.");
    setError(null);
    setDraft(null);
    onCommit(next);
  };
  return (
    <div className="min-w-0 flex-1">
      <div className="relative">
        <Spline className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          aria-label={ariaLabel}
          aria-invalid={error ? true : undefined}
          value={draft ?? formatCurve(points)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              setDraft(null);
              setError(null);
            }
          }}
          className="h-8 w-full rounded-md border border-transparent bg-secondary pl-7 pr-2 text-[12px] tabular-nums text-foreground outline-none hover:border-border focus:border-primary aria-invalid:border-destructive"
        />
      </div>
      {error && (
        <p role="alert" className="mt-1 text-[11px] text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

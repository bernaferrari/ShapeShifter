"use client";

import React from "react";
import { ChevronDown, ChevronRight, Pencil, TriangleAlert } from "lucide-react";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import { parseEditorColor } from "@/lib/shapeshifter/playheadResolve";
import { areAndroidPathsMorphCompatible } from "@/lib/shapeshifter/pathUtils";
import { validatePathData } from "@/lib/shapeshifter/path/pathValidation";
import {
  isTimelineNumberValid,
  timelineNumberRange,
} from "@/lib/shapeshifter/motion/timelineProperties";
import {
  interpolatorControlPoints,
  timelineKeyframeRange,
} from "@/lib/shapeshifter/motion/timelineKeyframes";
import type { TimelineBlock } from "@/lib/shapeshifter/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { cn } from "@/lib/utils";
import { Section } from "./InspectorControls";
import { TimelineInsertKeyframeButton } from "../timeline/TimelineInsertKeyframeButton";
import { LiveEasingCurve } from "../timeline/TimelineLiveState";
import { MotionValueGraph } from "./MotionValueGraph";

const EASING_OPTIONS = [
  ["FAST_OUT_SLOW_IN", "Standard"],
  ["LINEAR_OUT_SLOW_IN", "Decelerate"],
  ["FAST_OUT_LINEAR_IN", "Accelerate"],
  ["ACCELERATE_DECELERATE", "Accelerate–decelerate"],
  ["LINEAR", "Linear"],
] as const;

/** A committed field keeps partial numbers/colors out of the animation model. */
function MotionField({
  label,
  ariaLabel,
  value,
  suffix,
  color = false,
  multiline = false,
  validate,
  onCommit,
  onPreview,
}: {
  label: string;
  ariaLabel: string;
  value: string | number;
  suffix?: string;
  color?: boolean;
  multiline?: boolean;
  validate: (raw: string) => string | null;
  onCommit: (raw: string) => void;
  onPreview?: () => void;
}) {
  const id = React.useId();
  const [draft, setDraft] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const draftRef = React.useRef<string | null>(null);
  const cancelBlur = React.useRef(false);
  const Field = multiline ? "textarea" : "input";

  const commit = () => {
    const raw = draftRef.current;
    if (raw === null) return true;
    if (raw === String(value)) {
      draftRef.current = null;
      setDraft(null);
      return true;
    }
    const message = validate(raw);
    setError(message);
    if (message) return false;
    onCommit(raw);
    draftRef.current = null;
    setDraft(null);
    return true;
  };

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center justify-between gap-1">
        <label htmlFor={id} className="text-[10px] text-muted-foreground">
          {label}
        </label>
        {onPreview && (
          <button
            type="button"
            onClick={onPreview}
            aria-label={`Preview ${ariaLabel}`}
            title={`Preview ${label.toLowerCase()} keyframe`}
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronRight className="size-3" />
          </button>
        )}
      </div>
      <div className="relative">
        {color && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 rounded-sm border border-border"
            style={{ backgroundColor: String(value) }}
          />
        )}
        <Field
          id={id}
          type={multiline ? undefined : "text"}
          inputMode={color || multiline ? "text" : "decimal"}
          aria-label={ariaLabel}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          value={draft ?? String(value)}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            draftRef.current = String(value);
            setDraft(String(value));
          }}
          onChange={(event) => {
            draftRef.current = event.target.value;
            setDraft(event.target.value);
            if (error) setError(validate(event.target.value));
          }}
          onBlur={() => {
            if (cancelBlur.current) cancelBlur.current = false;
            else commit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (commit()) event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelBlur.current = true;
              draftRef.current = null;
              setDraft(null);
              setError(null);
              event.currentTarget.blur();
            }
          }}
          className={cn(
            "h-8 w-full rounded-[4px] border border-transparent bg-muted/65 px-2 font-mono text-xs tabular-nums text-foreground outline-none hover:bg-muted focus:border-primary/70 focus:bg-background focus:ring-1 focus:ring-primary/25",
            color && "pl-7",
            multiline && "h-16 resize-y py-1.5 text-[10px] leading-relaxed",
            suffix && "pr-7",
            error && "border-destructive",
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[10px] leading-relaxed text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

const numericValue = (raw: string) => Number(raw.trim().replace(",", "."));
const validNumber = (raw: string) =>
  raw.trim() && Number.isFinite(numericValue(raw)) ? null : "Enter a number.";

export function MotionBlockEditor({
  block,
  duration,
  onEditMorph,
}: {
  block: TimelineBlock;
  duration: number;
  onEditMorph: () => void;
}) {
  const label = propertyLabel(block.propertyName);
  const valueType =
    block.propertyName === "pathData" || block.type === "path"
      ? "path"
      : ["fillColor", "strokeColor"].includes(block.propertyName) || block.type === "color"
        ? "color"
        : "number";
  const percent = [
    "scaleX",
    "scaleY",
    "alpha",
    "fillAlpha",
    "strokeAlpha",
    "trimPathStart",
    "trimPathEnd",
    "trimPathOffset",
  ].includes(block.propertyName);
  const multiplier = percent ? 100 : 1;
  const unit = percent ? "%" : block.propertyName === "rotation" ? "°" : undefined;
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
  const preview = (time: number) => {
    const store = useEditorStore.getState();
    if (store.isPlaying) store.togglePlayback();
    store.setProgress(time / Math.max(1, duration));
  };
  const interpolator = block.interpolator || "ACCELERATE_DECELERATE";
  const isNamedEasing = EASING_OPTIONS.some(([value]) => value === interpolator);
  const [showCurve, setShowCurve] = React.useState(!isNamedEasing);
  const easingEditRef = React.useRef<{ changed: boolean } | null>(null);
  const curveId = React.useId();
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
  const timingError = (raw: string, edge: "start" | "end") => {
    const error = validNumber(raw);
    if (error) return error;
    const value = numericValue(raw);
    const [min, max] = timelineKeyframeRange(
      useEditorStore.getState().animation.blocks,
      block,
      edge,
      duration,
    );
    return value < min || value > max ? `Use ${min}–${max} ms.` : null;
  };

  return (
    <div data-motion-block-id={block.id}>
      <Section
        title={`${label} keyframes`}
        action={
          <span className="font-mono text-[9px] tabular-nums text-muted-foreground">
            {block.startTime}–{block.endTime} ms
          </span>
        }
      >
        <div className={cn("grid gap-2", valueType === "path" ? "grid-cols-1" : "grid-cols-2")}>
          {(["fromValue", "toValue"] as const).map((edge) => {
            const isFrom = edge === "fromValue";
            return (
              <MotionField
                key={edge}
                label={isFrom ? "From" : "To"}
                ariaLabel={`${label} ${isFrom ? "from" : "to"} value`}
                value={
                  valueType === "number"
                    ? Number((Number(block[edge]) * multiplier).toFixed(6))
                    : block[edge]
                }
                color={valueType === "color"}
                multiline={valueType === "path"}
                suffix={valueType === "number" ? unit : undefined}
                validate={
                  valueType === "number"
                    ? (raw) => {
                        const error = validNumber(raw);
                        if (error) return error;
                        if (
                          isTimelineNumberValid(block.propertyName, numericValue(raw) / multiplier)
                        )
                          return null;
                        const [min, max] = timelineNumberRange(block.propertyName);
                        return `Use ${min * multiplier}–${max * multiplier}${unit ? ` ${unit}` : ""}.`;
                      }
                    : valueType === "color"
                      ? (raw) => (parseEditorColor(raw) ? null : "Enter a hex or RGB color.")
                      : validatePathData
                }
                onCommit={(raw) =>
                  useEditorStore
                    .getState()
                    .updateTimelineKeyframe(block.id, isFrom ? "start" : "end", {
                      value: valueType === "number" ? numericValue(raw) / multiplier : raw.trim(),
                    })
                }
                onPreview={() => preview(isFrom ? block.startTime : block.endTime)}
              />
            );
          })}
        </div>
        {valueType === "path" &&
          !areAndroidPathsMorphCompatible(String(block.fromValue), String(block.toValue)) && (
            <p className="flex gap-1.5 text-[10px] leading-relaxed text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-3 shrink-0" />
              Match path command types and counts to preview this morph.
            </p>
          )}
        {valueType === "path" && (
          <button
            type="button"
            onClick={() => {
              useEditorStore.getState().startTimelinePathEditing(block.id);
              onEditMorph();
            }}
            className="flex h-8 w-full items-center gap-2 rounded-[4px] bg-muted/65 px-2 text-left text-[11px] text-foreground hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Pencil className="size-3.5 text-muted-foreground" /> Edit start and end paths
          </button>
        )}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <MotionField
            label="Start"
            ariaLabel={`${label} start time`}
            value={block.startTime}
            suffix="ms"
            validate={(raw) => timingError(raw, "start")}
            onCommit={(raw) =>
              useEditorStore
                .getState()
                .updateTimelineKeyframe(block.id, "start", { time: numericValue(raw) })
            }
          />
          <MotionField
            label="End"
            ariaLabel={`${label} end time`}
            value={block.endTime}
            suffix="ms"
            validate={(raw) => timingError(raw, "end")}
            onCommit={(raw) =>
              useEditorStore
                .getState()
                .updateTimelineKeyframe(block.id, "end", { time: numericValue(raw) })
            }
          />
        </div>
        <label className="flex items-center gap-2 pt-1 text-[10px] text-muted-foreground">
          <span className="w-12 shrink-0">Easing</span>
          <select
            value={interpolator}
            aria-label={`${label} easing`}
            onChange={(event) => update({ interpolator: event.target.value })}
            className="h-8 min-w-0 flex-1 rounded-[4px] border border-transparent bg-muted/65 px-2 text-[11px] text-foreground outline-none hover:bg-muted focus:border-primary/70 focus:ring-1 focus:ring-primary/25"
          >
            {!isNamedEasing && <option value={interpolator}>Custom curve</option>}
            {EASING_OPTIONS.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-expanded={showCurve}
          aria-controls={curveId}
          onClick={() => setShowCurve((value) => !value)}
          className="flex h-7 w-full items-center gap-1 rounded px-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ChevronDown className={cn("size-3 transition-transform", !showCurve && "-rotate-90")} />
          Custom easing curve
        </button>
        {showCurve && (
          <div id={curveId} className="space-y-2 rounded border border-border bg-muted/15 p-2">
            <div className="flex justify-center">
              <LiveEasingCurve
                size={120}
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
            <div className="grid grid-cols-2 gap-2">
              {(["X1", "Y1", "X2", "Y2"] as const).map((coordinate, index) => (
                <MotionField
                  key={coordinate}
                  label={coordinate}
                  ariaLabel={`${label} easing ${coordinate}`}
                  value={points[index]!}
                  validate={(raw) => {
                    const error = validNumber(raw);
                    if (error) return error;
                    return index % 2 === 0 && (numericValue(raw) < 0 || numericValue(raw) > 1)
                      ? "Use 0–1 for time."
                      : null;
                  }}
                  onCommit={(raw) => {
                    const next = [...points] as typeof points;
                    next[index] = numericValue(raw);
                    updateCurve(next);
                  }}
                />
              ))}
            </div>
            <p className="text-[10px] leading-relaxed text-muted-foreground">
              Drag a handle or use arrow keys. Alt makes smaller steps. Editing creates a custom
              curve.
            </p>
          </div>
        )}
        {valueType === "number" && <MotionValueGraph block={block} />}
        <div className="flex justify-end pt-1">
          <TimelineInsertKeyframeButton
            blockId={block.id}
            label={`Insert ${label} keyframe at playhead`}
          />
        </div>
        {interpolator === "ACCELERATE_DECELERATE" && (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Inserting keeps the current pose and applies this easing to each new segment. The
            transition timing changes.
          </p>
        )}
      </Section>
    </div>
  );
}

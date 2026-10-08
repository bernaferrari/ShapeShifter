"use client";

import React from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { gradientFromSolid } from "@/lib/pathshift/gradients";
import { sharedValue } from "@/lib/pathshift/scene/inspectorSelection";
import type { FillType, GradientType, Layer } from "@/lib/pathshift/types";
import { useEditorStore } from "@/lib/store/editorStore";
import { ColorRow, GradientEditor } from "./InspectorColorControls";
import {
  InlineSelect,
  KeyframeMenu,
  KeyframeSlot,
  NumberRow,
  Row,
  Section,
  Segmented,
  TextInput,
} from "./InspectorControls";
import { useKeyframeToggles } from "./InspectorPanels";

type StrokeCap = NonNullable<Layer["strokeLinecap"]>;
type StrokeJoin = NonNullable<Layer["strokeLinejoin"]>;

const capOptions: Array<{ value: StrokeCap; label: string; icon: React.ReactNode }> = [
  {
    value: "butt",
    label: "Butt",
    icon: (
      <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
        <line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="2" />
      </svg>
    ),
  },
  {
    value: "round",
    label: "Round",
    icon: (
      <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
        <line
          x1="1"
          y1="5"
          x2="11"
          y2="5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="11" cy="5" r="1.5" fill="none" stroke="currentColor" />
      </svg>
    ),
  },
  {
    value: "square",
    label: "Square",
    icon: (
      <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
        <line
          x1="1"
          y1="5"
          x2="11"
          y2="5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="square"
        />
        <rect x="10" y="3.5" width="3" height="3" fill="none" stroke="currentColor" />
      </svg>
    ),
  },
];

const joinOptions: Array<{ value: StrokeJoin; label: string; icon: React.ReactNode }> = [
  {
    value: "miter",
    label: "Miter",
    icon: (
      <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
        <polyline
          points="1,8 7,2 13,8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="miter"
        />
      </svg>
    ),
  },
  {
    value: "round",
    label: "Round",
    icon: (
      <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
        <polyline
          points="1,8 7,2 13,8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    value: "bevel",
    label: "Bevel",
    icon: (
      <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
        <polyline
          points="1,8 7,3 13,8"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="bevel"
        />
      </svg>
    ),
  },
];

function StrokeOptionGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; icon: React.ReactNode }>;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-medium text-muted-foreground">{label}</div>
      <div className="flex items-center gap-px rounded-md bg-muted p-0.5">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={cn(
              "flex h-7 flex-1 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted/70",
              value === option.value && "bg-card text-foreground shadow-sm",
            )}
            title={option.label}
            aria-label={option.label}
          >
            {option.icon}
          </button>
        ))}
      </div>
    </div>
  );
}

function StrokeSettings({
  layer,
  onChange,
}: {
  layer: Layer;
  onChange: (patch: Partial<Layer>) => void;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        aria-label="Stroke settings"
        title="Stroke settings"
      >
        <SlidersHorizontal className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-64 gap-0 overflow-hidden rounded-xl p-0"
      >
        <div className="flex h-10 items-center justify-between border-b border-border pl-3 pr-1.5">
          <span className="text-[12px] font-semibold">Stroke</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close stroke settings"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-3 p-3">
          <StrokeOptionGroup
            label="End points"
            value={layer.strokeLinecap ?? "butt"}
            options={capOptions}
            onChange={(strokeLinecap) => onChange({ strokeLinecap })}
          />
          <StrokeOptionGroup
            label="Join"
            value={layer.strokeLinejoin ?? "miter"}
            options={joinOptions}
            onChange={(strokeLinejoin) => onChange({ strokeLinejoin })}
          />
          <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Dash</span>
            <TextInput
              ariaLabel="Stroke dash pattern"
              value={layer.strokeDasharray ?? ""}
              placeholder="e.g. 4 2"
              onChange={(strokeDasharray) =>
                onChange({ strokeDasharray: strokeDasharray || undefined })
              }
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

const wrap = (value: number) => ((value % 1) + 1) % 1;

/**
 * The visible stretch of the path, drawn on a strip that stands for its full
 * length. Ends set Start/End; dragging the stretch itself slides Offset.
 */
function TrimRangeBar({
  start,
  end,
  offset,
  disabled,
  onChange,
}: {
  start: number;
  end: number;
  offset: number;
  disabled?: boolean;
  onChange: (patch: Partial<Layer>) => void;
}) {
  const track = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef<{
    part: "start" | "end" | "offset";
    x: number;
    offset: number;
  } | null>(null);
  const full = start <= 0 && end >= 1;
  // Same mapping the renderer uses: (value + offset) mod 1, with a whole path
  // ignoring offset and a reversed pair wrapping across the seam.
  const from = full ? 0 : wrap(start + offset);
  const toRaw = full ? 1 : wrap(end + offset);
  const to = !full && toRaw === 0 && end > start ? 1 : toRaw;
  const empty = !full && start === end;
  const ranges: Array<[number, number]> = empty
    ? []
    : from <= to
      ? [[from, to]]
      : [
          [from, 1],
          [0, to],
        ];

  const fraction = (clientX: number) => {
    const box = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - box.left) / box.width));
  };
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const begin = (part: "start" | "end" | "offset") => (event: React.PointerEvent) => {
    if (disabled || !event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { part, x: event.clientX, offset };
    useEditorStore.getState().beginHistoryGesture();
  };
  const move = (event: React.PointerEvent) => {
    const session = drag.current;
    if (!session) return;
    if (session.part === "offset") {
      const box = track.current!.getBoundingClientRect();
      onChange({
        trimPathOffset: round(wrap(session.offset + (event.clientX - session.x) / box.width)),
      });
      return;
    }
    // Ends move in screen space; convert back into the un-offset value.
    const value = fraction(event.clientX);
    const local = value >= 1 ? 1 : wrap(value - offset);
    onChange(
      session.part === "start"
        ? { trimPathStart: round(Math.min(local, 1)) }
        : { trimPathEnd: round(local === 0 && value > 0 ? 1 : local) },
    );
  };
  const finish = (event: React.PointerEvent) => {
    if (!drag.current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    useEditorStore.getState().endHistoryGesture();
  };
  const handlers = (part: "start" | "end" | "offset") => ({
    onPointerDown: begin(part),
    onPointerMove: move,
    onPointerUp: finish,
    onPointerCancel: finish,
  });
  const thumb =
    "absolute top-1/2 z-10 h-4 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none before:absolute before:inset-y-0 before:left-1/2 before:w-[3px] before:-translate-x-1/2 before:rounded-full before:bg-foreground before:shadow-[0_0_0_1px_var(--color-sidebar)] pointer-coarse:w-6";

  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
      <span className="truncate text-[11px] text-muted-foreground">Visible</span>
      <div className="flex min-w-0 items-center gap-0.5">
        <div
          ref={track}
          className={cn(
            "relative h-5 min-w-0 flex-1 rounded-sm bg-secondary",
            disabled && "pointer-events-none opacity-50",
          )}
          title="Drag the ends to trim, or the bar to slide it along the path"
        >
          {/* The trimmed-away length reads as a dashed outline of the path. */}
          <div className="absolute inset-x-1 top-1/2 h-px -translate-y-1/2 border-t border-dashed border-muted-foreground/40" />
          {ranges.map(([a, b], index) => (
            <div
              key={index}
              aria-hidden="true"
              className="absolute inset-y-1 cursor-grab touch-none rounded-[2px] bg-primary/80 active:cursor-grabbing"
              style={{ left: `${a * 100}%`, width: `${(b - a) * 100}%` }}
              {...(full ? {} : handlers("offset"))}
            />
          ))}
          <div
            aria-hidden="true"
            className={thumb}
            style={{ left: `${from * 100}%` }}
            title="Start"
            {...handlers("start")}
          />
          <div
            aria-hidden="true"
            className={thumb}
            style={{ left: `${to * 100}%` }}
            title="End"
            {...handlers("end")}
          />
        </div>
        <KeyframeSlot />
      </div>
    </div>
  );
}

export function LayerAppearanceSections({
  layer,
  selectedLayers,
  count = 1,
  onChange,
}: {
  layer: Layer;
  selectedLayers: Layer[];
  count?: number;
  onChange: (patch: Partial<Layer>) => void;
}) {
  const keyframeFor = useKeyframeToggles(layer, count);
  const blocks = useEditorStore((state) => state.animation.blocks);
  const fillKindValue = (item: Layer): "solid" | GradientType => item.fillGradient?.type ?? "solid";
  const fillKind = sharedValue(selectedLayers, fillKindValue, fillKindValue(layer));
  const fillColor = sharedValue(
    selectedLayers,
    (item) => item.fillColor || "#000000",
    layer.fillColor || "#000000",
  );
  const fillAlpha = sharedValue(
    selectedLayers,
    (item) => item.fillAlpha ?? 1,
    layer.fillAlpha ?? 1,
  );
  const fillRule = sharedValue(
    selectedLayers,
    (item) => item.fillType ?? "nonZero",
    layer.fillType ?? "nonZero",
  );
  const strokeColor = sharedValue(
    selectedLayers,
    (item) => item.strokeColor || "#000000",
    layer.strokeColor || "#000000",
  );
  const strokeAlpha = sharedValue(
    selectedLayers,
    (item) => item.strokeAlpha ?? 1,
    layer.strokeAlpha ?? 1,
  );
  const strokeWidth = sharedValue(
    selectedLayers,
    (item) => item.strokeWidth ?? 0,
    layer.strokeWidth ?? 0,
  );
  const opacity = sharedValue(selectedLayers, (item) => item.alpha ?? 1, layer.alpha ?? 1);
  const trimStart = sharedValue(
    selectedLayers,
    (item) => item.trimPathStart ?? 0,
    layer.trimPathStart ?? 0,
  );
  const trimEnd = sharedValue(
    selectedLayers,
    (item) => item.trimPathEnd ?? 1,
    layer.trimPathEnd ?? 1,
  );
  const trimOffset = sharedValue(
    selectedLayers,
    (item) => item.trimPathOffset ?? 0,
    layer.trimPathOffset ?? 0,
  );
  const trimAnimated = blocks.some(
    (block) =>
      String(block.layerId) === String(layer.id) && block.propertyName.startsWith("trimPath"),
  );
  const showFillRule =
    fillRule.mixed || fillRule.value === "evenOdd" || (layer.from?.subPaths?.length ?? 0) > 1;

  const setFillKind = (kind: "solid" | GradientType) => {
    if (kind === "solid") {
      onChange({ fillGradient: undefined });
      return;
    }
    onChange({
      fillGradient: layer.fillGradient
        ? { ...layer.fillGradient, type: kind }
        : gradientFromSolid(kind, layer.fillColor || "#000000"),
    });
  };

  return (
    <>
      <Section
        title="Appearance"
        action={<KeyframeMenu label="Appearance" keyframes={[keyframeFor("alpha")]} />}
      >
        <NumberRow
          label="Opacity"
          value={Math.round(opacity.value * 100)}
          mixed={opacity.mixed}
          min={0}
          max={100}
          suffix="%"
          onChange={(value) => onChange({ alpha: value / 100 })}
          keyframe={keyframeFor("alpha")}
        />
      </Section>

      <Section
        title="Fill"
        action={
          <>
            <InlineSelect
              label="Fill type"
              value={fillKind.mixed ? "" : (fillKind.value as "solid" | GradientType)}
              options={[
                { value: "solid", label: "Solid" },
                { value: "linear", label: "Linear" },
                { value: "radial", label: "Radial" },
              ]}
              onChange={setFillKind}
            />
            <KeyframeMenu
              label="Fill"
              keyframes={[keyframeFor("fillColor"), keyframeFor("fillAlpha")]}
            />
          </>
        }
      >
        {fillKind.mixed ? (
          <p className="text-[11px] text-muted-foreground">Mixed fill types</p>
        ) : layer.fillGradient ? (
          <GradientEditor
            gradient={layer.fillGradient}
            onChange={(fillGradient) => onChange({ fillGradient })}
          >
            {layer.fillGradient.type === "linear" && (
              <NumberRow
                label="Angle"
                value={layer.fillGradient.angle ?? 90}
                suffix="°"
                onChange={(angle) => onChange({ fillGradient: { ...layer.fillGradient!, angle } })}
              />
            )}
          </GradientEditor>
        ) : (
          <ColorRow
            label="Color"
            color={fillColor.value}
            mixed={fillColor.mixed}
            onColor={(fillColor) => onChange({ fillColor })}
            keyframe={keyframeFor("fillColor")}
          />
        )}
        <NumberRow
          label="Opacity"
          value={Math.round(fillAlpha.value * 100)}
          mixed={fillAlpha.mixed}
          min={0}
          max={100}
          suffix="%"
          onChange={(value) => onChange({ fillAlpha: value / 100 })}
          keyframe={keyframeFor("fillAlpha")}
        />
        {showFillRule && (
          <Row label="Rule">
            <Segmented
              value={fillRule.value}
              mixed={fillRule.mixed}
              onChange={(fillType) => onChange({ fillType: fillType as FillType })}
              options={[
                { value: "nonZero", label: "Non-zero" },
                { value: "evenOdd", label: "Even-odd" },
              ]}
            />
          </Row>
        )}
      </Section>

      <Section
        title="Stroke"
        action={
          <>
            <StrokeSettings layer={layer} onChange={onChange} />
            <KeyframeMenu
              label="Stroke"
              keyframes={[
                keyframeFor("strokeColor"),
                keyframeFor("strokeAlpha"),
                keyframeFor("strokeWidth"),
              ]}
            />
          </>
        }
      >
        <ColorRow
          label="Color"
          color={strokeColor.value}
          mixed={strokeColor.mixed}
          onColor={(strokeColor) => onChange({ strokeColor })}
          keyframe={keyframeFor("strokeColor")}
        />
        <NumberRow
          label="Opacity"
          value={Math.round(strokeAlpha.value * 100)}
          mixed={strokeAlpha.mixed}
          min={0}
          max={100}
          suffix="%"
          onChange={(value) => onChange({ strokeAlpha: value / 100 })}
          keyframe={keyframeFor("strokeAlpha")}
        />
        <NumberRow
          label="Width"
          value={strokeWidth.value}
          mixed={strokeWidth.mixed}
          min={0}
          step={0.1}
          onChange={(strokeWidth) => onChange({ strokeWidth })}
          keyframe={keyframeFor("strokeWidth")}
        />
      </Section>

      <Section
        title="Trim path"
        action={
          <KeyframeMenu
            label="Trim path"
            keyframes={[
              keyframeFor("trimPathStart"),
              keyframeFor("trimPathEnd"),
              keyframeFor("trimPathOffset"),
            ]}
          />
        }
        defaultOpen={
          trimAnimated ||
          (layer.trimPathStart ?? 0) !== 0 ||
          (layer.trimPathEnd ?? 1) !== 1 ||
          (layer.trimPathOffset ?? 0) !== 0
        }
      >
        <TrimRangeBar
          start={trimStart.value}
          end={trimEnd.value}
          offset={trimOffset.value}
          disabled={trimStart.mixed || trimEnd.mixed || trimOffset.mixed}
          onChange={onChange}
        />
        <NumberRow
          label="Start"
          value={Math.round(trimStart.value * 100)}
          mixed={trimStart.mixed}
          min={0}
          max={100}
          suffix="%"
          onChange={(value) => onChange({ trimPathStart: Math.max(0, Math.min(1, value / 100)) })}
          keyframe={keyframeFor("trimPathStart")}
        />
        <NumberRow
          label="End"
          value={Math.round(trimEnd.value * 100)}
          mixed={trimEnd.mixed}
          min={0}
          max={100}
          suffix="%"
          onChange={(value) => onChange({ trimPathEnd: Math.max(0, Math.min(1, value / 100)) })}
          keyframe={keyframeFor("trimPathEnd")}
        />
        <NumberRow
          label="Offset"
          value={Math.round(trimOffset.value * 100)}
          mixed={trimOffset.mixed}
          suffix="%"
          onChange={(value) => onChange({ trimPathOffset: value / 100 })}
          keyframe={keyframeFor("trimPathOffset")}
        />
      </Section>
    </>
  );
}

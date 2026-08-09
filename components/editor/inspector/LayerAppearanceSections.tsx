"use client";

import React from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { gradientFromSolid } from "@/lib/shapeshifter/gradients";
import { sharedValue } from "@/lib/shapeshifter/scene/inspectorSelection";
import type { FillType, GradientType, Layer } from "@/lib/shapeshifter/types";
import { ColorRow, GradientEditor } from "./InspectorColorControls";
import { NumberRow, Row, Section, Segmented, TextInput } from "./InspectorControls";

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
        className="flex size-7 shrink-0 items-center justify-center rounded-[4px] bg-muted/65 text-muted-foreground transition-[background-color,color] hover:bg-muted hover:text-foreground"
        aria-label="Stroke settings"
        title="Stroke settings"
      >
        <SlidersHorizontal className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className="w-80 gap-0 overflow-hidden rounded-xl p-0"
      >
        <div className="flex h-12 items-center justify-between border-b border-border px-4">
          <span className="text-[13px] font-semibold">Stroke settings</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Close stroke settings"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="space-y-3 p-4">
          <div
            className="grid grid-cols-3 rounded-lg bg-muted p-0.5"
            role="tablist"
            aria-label="Stroke settings mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected="true"
              className="h-8 rounded-md bg-background text-[12px] font-medium text-foreground shadow-sm"
            >
              Basic
            </button>
            {(["Dynamic", "Brush"] as const).map((label) => (
              <button
                key={label}
                type="button"
                role="tab"
                disabled
                aria-selected="false"
                title={`${label} strokes are not supported by Android Vector Drawable`}
                className="h-8 rounded-md text-[12px] text-muted-foreground disabled:cursor-not-allowed disabled:text-muted-foreground/50"
              >
                {label}
              </button>
            ))}
          </div>
          <p className="rounded-md bg-muted/55 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
            Android Vector Drawable supports Basic, centered strokes. Dynamic and Brush modes are
            shown for orientation but cannot be exported.
          </p>
          <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Style</span>
            <div className="flex h-8 items-center gap-2 rounded-md border border-border bg-background px-2 text-[12px]">
              <span className="h-px w-6 bg-foreground" />
              Solid
            </div>
          </div>
          <div className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Alignment</span>
            <div
              className="flex h-8 items-center rounded-md border border-border bg-background px-2 text-[12px]"
              title="Android Vector Drawable strokes are always centered on the path"
            >
              Center
            </div>
          </div>
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
          <div className="flex items-center gap-2">
            <span className="w-[72px] shrink-0 text-[11px] text-muted-foreground">Dash</span>
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

export function LayerAppearanceSections({
  layer,
  selectedLayers,
  onChange,
}: {
  layer: Layer;
  selectedLayers: Layer[];
  onChange: (patch: Partial<Layer>) => void;
}) {
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
      <Section title="Fill">
        <Row label="Type">
          <Segmented<"solid" | GradientType>
            value={fillKind.value}
            mixed={fillKind.mixed}
            onChange={setFillKind}
            options={[
              { value: "solid", label: "Solid" },
              { value: "linear", label: "Linear" },
              { value: "radial", label: "Radial" },
            ]}
          />
        </Row>
        {fillKind.mixed ? (
          <p className="rounded-md bg-muted/55 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
            Multiple fill types. Choose one above to apply it to the selection.
          </p>
        ) : layer.fillGradient ? (
          <>
            <GradientEditor
              gradient={layer.fillGradient}
              onChange={(fillGradient) => onChange({ fillGradient })}
            />
            {layer.fillGradient.type === "linear" && (
              <NumberRow
                label="Angle"
                value={layer.fillGradient.angle ?? 90}
                suffix="°"
                onChange={(angle) => onChange({ fillGradient: { ...layer.fillGradient!, angle } })}
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
            />
          </>
        ) : (
          <ColorRow
            label="Color"
            color={fillColor.value}
            alpha={fillAlpha.value}
            mixed={fillColor.mixed}
            alphaMixed={fillAlpha.mixed}
            onColor={(fillColor) => onChange({ fillColor })}
            onAlpha={(fillAlpha) => onChange({ fillAlpha })}
          />
        )}
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
      </Section>

      <Section title="Stroke">
        <ColorRow
          color={strokeColor.value}
          alpha={strokeAlpha.value}
          mixed={strokeColor.mixed}
          alphaMixed={strokeAlpha.mixed}
          onColor={(strokeColor) => onChange({ strokeColor })}
          onAlpha={(strokeAlpha) => onChange({ strokeAlpha })}
        />
        <div className="flex items-center gap-1.5">
          <div className="min-w-0 flex-1">
            <NumberRow
              label="Width"
              value={strokeWidth.value}
              mixed={strokeWidth.mixed}
              min={0}
              step={0.1}
              onChange={(strokeWidth) => onChange({ strokeWidth })}
            />
          </div>
          <StrokeSettings layer={layer} onChange={onChange} />
        </div>
        {layer.from?.subPaths && layer.from.subPaths.length > 1 && (
          <p className="mt-1 text-[9px] leading-tight text-muted-foreground/60">
            Applies to all {layer.from.subPaths.length} subpaths in this layer. Select a subpath in
            Path commands, then use Edit → Extract to separate it.
          </p>
        )}
      </Section>

      <Section
        title="Trim path"
        defaultOpen={
          (layer.trimPathStart ?? 0) !== 0 ||
          (layer.trimPathEnd ?? 1) !== 1 ||
          (layer.trimPathOffset ?? 0) !== 0
        }
      >
        <NumberRow
          label="Start"
          value={Math.round(trimStart.value * 100)}
          mixed={trimStart.mixed}
          min={0}
          max={100}
          suffix="%"
          onChange={(value) => onChange({ trimPathStart: Math.max(0, Math.min(1, value / 100)) })}
        />
        <NumberRow
          label="End"
          value={Math.round(trimEnd.value * 100)}
          mixed={trimEnd.mixed}
          min={0}
          max={100}
          suffix="%"
          onChange={(value) => onChange({ trimPathEnd: Math.max(0, Math.min(1, value / 100)) })}
        />
        <NumberRow
          label="Offset"
          value={Math.round(trimOffset.value * 100)}
          mixed={trimOffset.mixed}
          suffix="%"
          onChange={(value) => onChange({ trimPathOffset: value / 100 })}
        />
      </Section>
    </>
  );
}

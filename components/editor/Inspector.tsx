"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Maximize2, Minimize2, Trash2, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/lib/store/editorStore";
import {
  changeCommandType,
  parsePath,
  pathToString,
  updateCommandPoint,
} from "@/lib/shapeshifter/pathUtils";
import type {
  FillType,
  Gradient,
  GradientStop,
  GradientType,
  Layer,
  StrokeLineCap,
  StrokeLineJoin,
} from "@/lib/shapeshifter/types";
import {
  gradientFromSolid,
  gradientToCssBar,
  normalizeStops,
} from "@/lib/shapeshifter/gradients";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import { MaterialSymbol } from "./MaterialSymbol";
import { PathCommandsList } from "./PathCommandsList";
import { CompactColorInput } from "@/components/ui/color-picker";

/* ------------------------------------------------------------------ */
/* Field primitives — a small, consistent Figma-grade control system  */
/* ------------------------------------------------------------------ */

const fieldBase =
  "h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 hover:border-foreground/20 focus:border-primary focus:ring-2 focus:ring-primary/20";

function Section({
  title,
  action,
  children,
  defaultOpen = true,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = React.useState(defaultOpen);
  return (
    <section className="border-b border-border/60 last:border-b-0">
      <div className="flex h-9 items-center justify-between pl-1.5 pr-3">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 items-center gap-1 rounded py-1 pr-1 text-foreground hover:text-foreground"
          aria-expanded={open}
        >
          <ChevronRight
            className={cn(
              "size-3.5 shrink-0 text-muted-foreground transition-transform",
              open && "rotate-90",
            )}
          />
          <span className="truncate text-[11px] font-semibold tracking-tight">{title}</span>
        </button>
        {open && action}
      </div>
      {open && <div className="space-y-1.5 px-3 pb-3">{children}</div>}
    </section>
  );
}

function Row({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[58px_minmax(0,1fr)] items-center gap-2">
      {label ? (
        <span className="truncate text-[11px] text-muted-foreground">{label}</span>
      ) : (
        <span />
      )}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className={cn(fieldBase, mono && "font-mono")}
    />
  );
}

/** Number field with Figma-style label-drag scrubbing + optional unit suffix. */
function NumberRow({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const scrub = React.useRef<{ startX: number; startVal: number } | null>(null);
  // While the field is focused we keep the raw keystrokes so typing "2." or a
  // trailing zero isn't reformatted mid-edit. Display always uses a "." decimal
  // separator (an <input type=number> would otherwise render the OS locale's
  // comma, e.g. "2,4" on pt-BR), and we parse both "." and "," on input.
  const [draft, setDraft] = React.useState<string | null>(null);
  const display = draft ?? (Number.isFinite(value) ? String(value) : "0");

  const clamp = (n: number) => {
    let next = n;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    if (step) next = Math.round(next / step) * step;
    return Number(next.toFixed(4));
  };

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    scrub.current = { startX: e.clientX, startVal: value };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!scrub.current) return;
    const dx = e.clientX - scrub.current.startX;
    onChange(clamp(scrub.current.startVal + dx * (step || 1) * 0.5));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    scrub.current = null;
  };

  return (
    <div className="grid grid-cols-[58px_minmax(0,1fr)] items-center gap-2">
      <span
        role="slider"
        aria-label={label}
        aria-valuenow={value}
        tabIndex={-1}
        className="w-fit cursor-ew-resize select-none truncate border-b border-dotted border-muted-foreground/40 text-[11px] text-muted-foreground hover:border-foreground/50 hover:text-foreground"
        title="Drag to adjust"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {label}
      </span>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          value={display}
          onFocus={() => setDraft(Number.isFinite(value) ? String(value) : "0")}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const n = Number(raw.replace(",", "."));
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
          onBlur={() => setDraft(null)}
          className={cn(fieldBase, "pr-7 font-mono tabular-nums")}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/60">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

/** Compact color pill: swatch + hex + opacity in one control (Figma-style).
    Uses the rich 3d-editor grade color picker popover. */
function ColorRow({
  label,
  color,
  alpha,
  onColor,
  onAlpha,
}: {
  label?: string;
  color: string;
  alpha?: number;
  onColor: (v: string) => void;
  onAlpha?: (v: number) => void;
}) {
  const hex = (color?.startsWith("#") ? color : color ? `#${color}` : "#000000");
  const hasLabel = Boolean(label);
  return (
    <div className={cn("grid items-center gap-2", hasLabel ? "grid-cols-[58px_minmax(0,1fr)]" : "grid-cols-1")}>
      {hasLabel && <span className="truncate text-[11px] text-muted-foreground">{label}</span>}
      <div className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background pl-1 pr-2 transition-colors hover:border-foreground/20 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <CompactColorInput
          value={hex}
          onChange={onColor}
          ariaLabel={label || "Color"}
          side="bottom"
          align="start"
        />
        {alpha != null && onAlpha && (
          <>
            <span className="h-4 w-px bg-border" />
            <input
              type="number"
              min={0}
              max={100}
              value={Math.round((alpha ?? 1) * 100)}
              onChange={(e) => {
                const pct = Number(e.target.value);
                if (Number.isFinite(pct)) onAlpha(Math.max(0, Math.min(100, pct)) / 100);
              }}
              className="w-9 bg-transparent text-right font-mono text-xs tabular-nums text-muted-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              aria-label={(label || "Color") + " opacity"}
            />
            <span className="text-[10px] text-muted-foreground/60">%</span>
          </>
        )}
      </div>
    </div>
  );
}

/** Compact Figma-style gradient editor: preview bar + per-stop color/offset/opacity. */
function GradientEditor({
  gradient,
  onChange,
}: {
  gradient: Gradient;
  onChange: (g: Gradient) => void;
}) {
  const stops = gradient.stops;
  const [active, setActive] = React.useState(0);
  const activeIdx = Math.min(active, stops.length - 1);
  const activeStop = stops[activeIdx];

  const commit = (next: Partial<Gradient>) => onChange({ ...gradient, ...next });

  const updateStop = (idx: number, patch: Partial<GradientStop>) => {
    const next = stops.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    commit({ stops: next });
  };

  const addStop = () => {
    // Insert a stop in the widest gap, colored by interpolating neighbours' offsets.
    const sorted = normalizeStops(stops);
    let gapStart = 0;
    let gap = -1;
    for (let i = 0; i < sorted.length - 1; i++) {
      const d = sorted[i + 1].offset - sorted[i].offset;
      if (d > gap) {
        gap = d;
        gapStart = i;
      }
    }
    const offset = (sorted[gapStart].offset + sorted[gapStart + 1].offset) / 2;
    const next = [...stops, { offset, color: sorted[gapStart].color, opacity: 1 }];
    commit({ stops: next });
    setActive(next.length - 1);
  };

  const removeStop = (idx: number) => {
    if (stops.length <= 2) return;
    commit({ stops: stops.filter((_, i) => i !== idx) });
    setActive(0);
  };

  const hex = activeStop?.color?.startsWith("#") ? activeStop.color : "#000000";

  return (
    <div className="space-y-2">
      {/* Preview bar with stop handles */}
      <div
        className="relative h-6 rounded-md ring-1 ring-inset ring-border"
        style={{
          backgroundImage: `${gradientToCssBar(gradient)}, repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%)`,
          backgroundSize: "100% 100%, 8px 8px",
        }}
      >
        {stops.map((s, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActive(i)}
            aria-label={`Stop ${i + 1}`}
            className={cn(
              "absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-sm transition-transform",
              i === activeIdx
                ? "border-primary scale-110"
                : "border-white ring-1 ring-black/20",
            )}
            style={{ left: `${s.offset * 100}%`, background: s.color }}
          />
        ))}
      </div>

      {/* Active stop editor */}
      {activeStop && (
        <div className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background pl-1 pr-2 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <CompactColorInput
            value={hex}
            onChange={(c) => updateStop(activeIdx, { color: c })}
            ariaLabel="Stop color"
            side="bottom"
            align="start"
          />
          <span className="h-4 w-px bg-border" />
          <input
            type="number"
            min={0}
            max={100}
            value={Math.round((activeStop.opacity ?? 1) * 100)}
            onChange={(e) => {
              const pct = Number(e.target.value);
              if (Number.isFinite(pct))
                updateStop(activeIdx, { opacity: Math.max(0, Math.min(100, pct)) / 100 });
            }}
            className="w-9 bg-transparent text-right font-mono text-xs tabular-nums text-muted-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            aria-label="Stop opacity"
          />
          <span className="text-[10px] text-muted-foreground/60">%</span>
        </div>
      )}

      {activeStop && (
        <div className="flex items-center gap-2">
          <NumberRow
            label="Position"
            value={Math.round((activeStop.offset ?? 0) * 100)}
            min={0}
            max={100}
            suffix="%"
            onChange={(v) => updateStop(activeIdx, { offset: v / 100 })}
          />
        </div>
      )}

      {/* Add / remove stop */}
      <div className="grid grid-cols-2 gap-1">
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={addStop}
          className="h-7 gap-1 text-[11px]"
        >
          <MaterialSymbol name="add" size={14} className="text-muted-foreground" /> Stop
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => removeStop(activeIdx)}
          disabled={stops.length <= 2}
          className="h-7 gap-1 text-[11px] disabled:opacity-40"
        >
          <MaterialSymbol name="remove" size={14} className="text-muted-foreground" /> Remove
        </Button>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex h-8 items-center rounded-md bg-muted p-0.5">
      {options.map((o) => (
        <Button
          key={o.value}
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => onChange(o.value)}
          className={cn(
            "h-7 flex-1 rounded-[5px] px-1 text-[11px] capitalize",
            value === o.value
              ? "bg-card font-medium text-foreground shadow-sm hover:bg-card"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Inspector                                                          */
/* ------------------------------------------------------------------ */

export function Inspector() {
  const {
    selection,
    getCurrentSelectedPoint,
    updateSelectedPoint,
    deleteSelectedPoint,
    selectedLayerId,
    selectedLayerIds,
    editingSide,
    layers,
    updateSelectedLayer,
    startActionMode,
    addTimelineBlock,
    animation,
    selectedPoints,
    selectPoint,
    booleanCombine,
    toggleLayerLock,
  } = useEditorStore();

  const point = getCurrentSelectedPoint ? getCurrentSelectedPoint() : null;
  const currentLayer = layers.find((l) => l.id === selectedLayerId);
  const multiCount = selectedLayerIds?.length ?? 0;
  const updateLayer = (patch: Partial<Layer>) => updateSelectedLayer(patch);
  const setPath = (parsed: ReturnType<typeof parsePath>) =>
    updateLayer(editingSide === "from" ? { from: parsed, pathData: parsed } : { to: parsed });

  const [isCommandsFocused, setIsCommandsFocused] = React.useState(false);
  const [showPathData, setShowPathData] = React.useState(false);

  React.useEffect(() => {
    if (!isCommandsFocused) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIsCommandsFocused(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isCommandsFocused]);

  /* ---- empty state ---- */
  if (!currentLayer) {
    return (
      <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center border-b border-border px-3">
          <span className="text-[13px] font-semibold">Properties</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <MaterialSymbol name="touch_app" size={24} />
          </div>
          <p className="max-w-[12rem] text-xs leading-relaxed text-muted-foreground">
            Select a layer or point to edit its properties
          </p>
        </div>
      </div>
    );
  }

  const animatableProperties =
    currentLayer.type === "group"
      ? ["rotation", "scaleX", "scaleY", "pivotX", "pivotY", "translateX", "translateY"]
      : [
          "pathData",
          "fillColor",
          "fillAlpha",
          "strokeColor",
          "strokeAlpha",
          "strokeWidth",
          "trimPathStart",
          "trimPathEnd",
          "trimPathOffset",
        ];

  const commandsList = (extraClass?: string) => (
    <PathCommandsList
      pathData={(currentLayer[editingSide] ?? currentLayer.from)}
      selectedPoints={selectedPoints}
      className={extraClass}
      onSelectCommand={(subPathIndex, commandIndex, pointIndex) => {
        if (!selectPoint) return;
        selectPoint({
          layerId: selectedLayerId,
          side: editingSide,
          subPathIndex,
          commandIndex,
          pointIndex,
        });
      }}
      onUpdateCommandPoint={(subPathIndex, commandIndex, pointIndex, newPoint) => {
        setPath(
          updateCommandPoint((currentLayer[editingSide] ?? currentLayer.from), subPathIndex, commandIndex, pointIndex, newPoint),
        );
      }}
      onChangeCommandType={(subPathIndex, commandIndex, newType) => {
        setPath(changeCommandType((currentLayer[editingSide] ?? currentLayer.from), subPathIndex, commandIndex, newType));
      }}
    />
  );

  /* ---- dedicated full-height command focus mode ---- */
  if (isCommandsFocused) {
    return (
      <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center justify-between border-b border-border px-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[13px] font-semibold">Path commands</span>
            <span className="rounded bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
              d
            </span>
            <span className="truncate text-[11px] text-muted-foreground">{currentLayer.name}</span>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setIsCommandsFocused(false)}
            aria-label="Exit focus (Esc)"
          >
            <Minimize2 className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-2">{commandsList("h-full")}</div>
      </div>
    );
  }

  const isGroup = currentLayer.type === "group";

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="flex h-14 items-center gap-2.5 border-b border-border px-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          <MaterialSymbol
            name={
              currentLayer.type === "clipPath"
                ? "crop"
                : isGroup
                  ? "folder"
                  : "polyline"
            }
            size={18}
          />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold leading-tight">
            {currentLayer.name}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
            <span className="capitalize">{currentLayer.type}</span>
            {!isGroup && (
              <span className="rounded bg-muted px-1 py-0.5 text-[10px] capitalize">
                {editingSide}
              </span>
            )}
            {animation.blocks.some((b) => String(b.layerId) === String(currentLayer.id)) && (
              <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
                anim
              </span>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
                aria-label="Animate a property"
                title="Animate a property"
              />
            }
          >
            <MaterialSymbol name="animation" size={17} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {animatableProperties.map((propertyName) => (
              <DropdownMenuItem
                key={propertyName}
                onClick={() => addTimelineBlock(currentLayer.id, propertyName)}
              >
                {propertyLabel(propertyName)}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {!isGroup && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={startActionMode}
                  aria-label="Edit path morph"
                />
              }
            >
              <MaterialSymbol name="edit" size={17} />
            </TooltipTrigger>
            <TooltipContent>Edit path morph (start → end)</TooltipContent>
          </Tooltip>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Layer */}
        <Section title="Layer">
          <Row label="Name">
            <TextInput value={currentLayer.name} onChange={(v) => updateLayer({ name: v })} />
          </Row>
          <Row label="Type">
            <Segmented
              value={currentLayer.type}
              onChange={(v) => updateLayer({ type: v as Layer["type"] })}
              options={[
                { value: "path", label: "Path" },
                { value: "clipPath", label: "Clip" },
                { value: "group", label: "Group" },
              ]}
            />
          </Row>
        </Section>

        {!isGroup && (
          <>
            {/* Fill */}
            <Section title="Fill">
              {(() => {
                const fillKind: "solid" | GradientType =
                  currentLayer.fillGradient?.type ?? "solid";
                const setKind = (kind: "solid" | GradientType) => {
                  if (kind === "solid") {
                    updateLayer({ fillGradient: undefined });
                    return;
                  }
                  const existing = currentLayer.fillGradient;
                  updateLayer({
                    fillGradient: existing
                      ? { ...existing, type: kind }
                      : gradientFromSolid(kind, currentLayer.fillColor || "#000000"),
                  });
                };
                return (
                  <>
                    <Row label="Type">
                      <Segmented<"solid" | GradientType>
                        value={fillKind}
                        onChange={setKind}
                        options={[
                          { value: "solid", label: "Solid" },
                          { value: "linear", label: "Linear" },
                          { value: "radial", label: "Radial" },
                        ]}
                      />
                    </Row>
                    {currentLayer.fillGradient ? (
                      <>
                        <GradientEditor
                          gradient={currentLayer.fillGradient}
                          onChange={(g) => updateLayer({ fillGradient: g })}
                        />
                        {currentLayer.fillGradient.type === "linear" && (
                          <NumberRow
                            label="Angle"
                            value={currentLayer.fillGradient.angle ?? 90}
                            suffix="°"
                            onChange={(v) =>
                              updateLayer({
                                fillGradient: { ...currentLayer.fillGradient!, angle: v },
                              })
                            }
                          />
                        )}
                        <NumberRow
                          label="Opacity"
                          value={Math.round((currentLayer.fillAlpha ?? 1) * 100)}
                          min={0}
                          max={100}
                          suffix="%"
                          onChange={(v) => updateLayer({ fillAlpha: v / 100 })}
                        />
                      </>
                    ) : (
                      <ColorRow
                        label="Color"
                        color={currentLayer.fillColor || ""}
                        alpha={currentLayer.fillAlpha ?? 1}
                        onColor={(v) => updateLayer({ fillColor: v })}
                        onAlpha={(v) => updateLayer({ fillAlpha: v })}
                      />
                    )}
                  </>
                );
              })()}
              <Row label="Rule">
                <Segmented
                  value={currentLayer.fillType ?? "nonZero"}
                  onChange={(v) => updateLayer({ fillType: v as FillType })}
                  options={[
                    { value: "nonZero", label: "Non-zero" },
                    { value: "evenOdd", label: "Even-odd" },
                  ]}
                />
              </Row>
            </Section>

            {/* Stroke */}
            <Section title="Stroke">
              <ColorRow
                color={currentLayer.strokeColor || ""}
                alpha={currentLayer.strokeAlpha ?? 1}
                onColor={(v) => updateLayer({ strokeColor: v })}
                onAlpha={(v) => updateLayer({ strokeAlpha: v })}
              />
              <NumberRow
                label="Width"
                value={currentLayer.strokeWidth ?? 1}
                min={0}
                step={0.1}
                onChange={(v) => updateLayer({ strokeWidth: v })}
              />

              {/* Figma-style compact icon controls for cap + join (no verbose text) */}
              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <div className="mb-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">Cap</div>
                  <div className="flex items-center gap-px rounded-md bg-muted p-0.5">
                    {([
                      { v: "butt", label: "Butt", icon: <svg width="14" height="10" viewBox="0 0 14 10" className="mx-auto"><line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="butt" /></svg> },
                      { v: "round", label: "Round", icon: <svg width="14" height="10" viewBox="0 0 14 10" className="mx-auto"><line x1="1" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="11" cy="5" r="1.5" fill="none" stroke="currentColor" strokeWidth="1" /></svg> },
                      { v: "square", label: "Square", icon: <svg width="14" height="10" viewBox="0 0 14 10" className="mx-auto"><line x1="1" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="square" /><rect x="10" y="3.5" width="3" height="3" fill="none" stroke="currentColor" strokeWidth="1" /></svg> },
                    ] as const).map(({ v, label, icon }) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => updateLayer({ strokeLinecap: v })}
                        className={cn(
                          "flex h-6 flex-1 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted/70",
                          (currentLayer.strokeLinecap ?? "butt") === v && "bg-card text-foreground shadow-sm"
                        )}
                        title={label}
                        aria-label={label}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="mb-0.5 text-[9px] font-medium uppercase tracking-wider text-muted-foreground/70">Join</div>
                  <div className="flex items-center gap-px rounded-md bg-muted p-0.5">
                    {([
                      { v: "miter", label: "Miter", icon: <svg width="14" height="10" viewBox="0 0 14 10" className="mx-auto"><polyline points="1,8 7,2 13,8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter" /></svg> },
                      { v: "round", label: "Round", icon: <svg width="14" height="10" viewBox="0 0 14 10" className="mx-auto"><polyline points="1,8 7,2 13,8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg> },
                      { v: "bevel", label: "Bevel", icon: <svg width="14" height="10" viewBox="0 0 14 10" className="mx-auto"><polyline points="1,8 7,3 13,8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="bevel" /></svg> },
                    ] as const).map(({ v, label, icon }) => (
                      <button
                        key={v}
                        type="button"
                        onClick={() => updateLayer({ strokeLinejoin: v })}
                        className={cn(
                          "flex h-6 flex-1 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted/70",
                          (currentLayer.strokeLinejoin ?? "miter") === v && "bg-card text-foreground shadow-sm"
                        )}
                        title={label}
                        aria-label={label}
                      >
                        {icon}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="w-[58px] shrink-0 text-[11px] text-muted-foreground">Dash</span>
                <TextInput
                  value={currentLayer.strokeDasharray ?? ""}
                  placeholder="e.g. 4 2"
                  onChange={(v) => updateLayer({ strokeDasharray: v || undefined })}
                />
              </div>
              {/* Clarify scope: stroke is per-layer (affects every subpath). Users can split for independent styling. */}
              {currentLayer.from?.subPaths && currentLayer.from.subPaths.length > 1 && (
                <p className="mt-1 text-[9px] leading-tight text-muted-foreground/60">
                  Applies to all {currentLayer.from.subPaths.length} subpaths in this layer.
                  Select a subpath (in path commands or direct tool) then use Edit → Extract to separate.
                </p>
              )}
            </Section>

            {/* Trim path */}
            <Section title="Trim path">
              <NumberRow
                label="Start"
                value={Math.round((currentLayer.trimPathStart ?? 0) * 100)}
                min={0}
                max={100}
                step={1}
                suffix="%"
                onChange={(v) => updateLayer({ trimPathStart: Math.max(0, Math.min(1, v / 100)) })}
              />
              <NumberRow
                label="End"
                value={Math.round((currentLayer.trimPathEnd ?? 1) * 100)}
                min={0}
                max={100}
                step={1}
                suffix="%"
                onChange={(v) => updateLayer({ trimPathEnd: Math.max(0, Math.min(1, v / 100)) })}
              />
              <NumberRow
                label="Offset"
                value={Math.round((currentLayer.trimPathOffset ?? 0) * 100)}
                step={1}
                suffix="%"
                onChange={(v) => updateLayer({ trimPathOffset: v / 100 })}
              />
            </Section>

            {/* Path */}
            <Section
              title="Path"
              action={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setIsCommandsFocused(true)}
                  aria-label="Focus path commands"
                >
                  <Maximize2 className="size-3.5" />
                </Button>
              }
            >
              <div className="overflow-hidden rounded-md border border-border">
                {commandsList("max-h-72")}
              </div>
              <button
                type="button"
                onClick={() => setShowPathData((s) => !s)}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={cn("size-3.5 transition-transform", showPathData && "rotate-90")}
                />
                SVG path data
              </button>
              {showPathData && (
                <textarea
                  value={pathToString((currentLayer[editingSide] ?? currentLayer.from))}
                  onChange={(e) => {
                    try {
                      setPath(parsePath(e.target.value));
                    } catch {
                      toast.error("Invalid path data");
                    }
                  }}
                  spellCheck={false}
                  className="min-h-20 w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-[10px] leading-relaxed text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              )}
            </Section>

            {/* Boolean combine with the layer below (mirrors the toolbar Edit menu). */}
            {(() => {
              const idx = layers.findIndex((l) => l.id === currentLayer.id);
              const hasNext = idx >= 0 && idx < layers.length - 1;
              if (!hasNext) return null;
              const ops = [
                { op: "union", label: "Union", icon: "join_full" },
                { op: "subtract", label: "Subtract", icon: "join_left" },
                { op: "intersect", label: "Intersect", icon: "join_inner" },
                { op: "exclude", label: "Exclude", icon: "join_right" },
              ] as const;
              return (
                <Section title="Combine" defaultOpen={false}>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Boolean with the layer below ({layers[idx + 1]?.name}).
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {ops.map(({ op, label, icon }) => (
                      <button
                        key={op}
                        type="button"
                        onClick={() => {
                          booleanCombine(op);
                          toast.success(label);
                        }}
                        className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-background text-[11px] text-foreground transition-colors hover:border-foreground/20 hover:bg-muted"
                      >
                        <MaterialSymbol name={icon} size={15} className="text-muted-foreground" />
                        {label}
                      </button>
                    ))}
                  </div>
                </Section>
              );
            })()}
          </>
        )}

        {/* Position / transform for every selection (Figma Design top block) */}
        <Section title={multiCount > 1 ? `Transform · ${multiCount} layers` : "Transform"}>
          {multiCount > 1 && (
            <p className="mb-1 text-[10px] leading-relaxed text-muted-foreground">
              Edits apply to all selected layers.
            </p>
          )}
          <NumberRow
            label="X"
            value={currentLayer.translateX ?? 0}
            onChange={(v) => updateLayer({ translateX: v })}
          />
          <NumberRow
            label="Y"
            value={currentLayer.translateY ?? 0}
            onChange={(v) => updateLayer({ translateY: v })}
          />
          <NumberRow
            label="Rotation"
            value={currentLayer.rotation ?? 0}
            suffix="°"
            onChange={(v) => updateLayer({ rotation: v })}
          />
          <NumberRow
            label="Scale X"
            value={currentLayer.scaleX ?? 1}
            step={0.1}
            onChange={(v) => updateLayer({ scaleX: v })}
          />
          <NumberRow
            label="Scale Y"
            value={currentLayer.scaleY ?? 1}
            step={0.1}
            onChange={(v) => updateLayer({ scaleY: v })}
          />
          {(isGroup || multiCount === 1) && (
            <>
              <NumberRow
                label="Pivot X"
                value={currentLayer.pivotX ?? 0}
                onChange={(v) => updateLayer({ pivotX: v })}
              />
              <NumberRow
                label="Pivot Y"
                value={currentLayer.pivotY ?? 0}
                onChange={(v) => updateLayer({ pivotY: v })}
              />
            </>
          )}
          <button
            type="button"
            className="mt-1 flex h-7 w-full items-center justify-center rounded-md border border-border text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            onClick={() => toggleLayerLock(currentLayer.id)}
          >
            {currentLayer.locked ? "Unlock layer" : "Lock layer"}
          </button>
        </Section>

        {/* Selected point(s) - supports lasso multi-select */}
        {(selection || (selectedPoints && selectedPoints.length > 0)) && (
          <Section title={selectedPoints && selectedPoints.length > 1 ? `Selected points (${selectedPoints.length})` : "Selected point"}>
            {selectedPoints && selectedPoints.length > 1 ? (
              <p className="text-[10px] text-muted-foreground mb-1">Batch edit via drag or delete (lasso).</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <NumberRow
                  label="X"
                  value={point?.x ?? 0}
                  step={0.1}
                  onChange={(v) => updateSelectedPoint({ x: v, y: point?.y ?? 0 })}
                />
                <NumberRow
                  label="Y"
                  value={point?.y ?? 0}
                  step={0.1}
                  onChange={(v) => updateSelectedPoint({ x: point?.x ?? 0, y: v })}
                />
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-8 w-full justify-start gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => deleteSelectedPoint()}
            >
              <Trash2 className="size-3.5" /> Delete {selectedPoints && selectedPoints.length > 1 ? "points" : "point"}
            </Button>
          </Section>
        )}
      </div>
    </div>
  );
}

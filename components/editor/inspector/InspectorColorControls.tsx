"use client";

import React from "react";
import { CompactColorInput } from "@/components/ui/compact-color-input";
import { ArrowLeftRight, Trash2 } from "lucide-react";
import { hexToHsv } from "@/components/ui/color-picker-utils";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/lib/store/editorStore";
import type { Gradient, GradientStop } from "@/lib/shapeshifter/types";
import {
  gradientToCssBar,
  reverseGradientStops,
  sampleGradientStop,
} from "@/lib/shapeshifter/gradients";
import { GRADIENT_PRESETS, hueShiftedStops, matchesPreset } from "./gradientPresets";
import { KeyframeToggle, NumberRow, type KeyframeToggleProps } from "./InspectorControls";

/** Distinct solid colors used by fills and strokes in the active document. */
function useDocumentColors() {
  const layers = useEditorStore((state) => state.layers);
  return React.useMemo(() => {
    const colors = new Set<string>();
    for (const layer of layers) {
      for (const value of [layer.fillColor, layer.strokeColor]) {
        if (value && /^#?[0-9a-f]{6}$/i.test(value))
          colors.add((value.startsWith("#") ? value : `#${value}`).toUpperCase());
      }
    }
    return [...colors].slice(0, 16);
  }, [layers]);
}

/** Compact color pill: swatch + hex + opacity in one control (Figma-style).
    Uses the rich 3d-editor grade color picker popover. */
export function ColorRow({
  label,
  color,
  alpha,
  onColor,
  onAlpha,
  mixed = false,
  alphaMixed = false,
  keyframe,
}: {
  label?: string;
  color: string;
  alpha?: number;
  onColor: (v: string) => void;
  onAlpha?: (v: number) => void;
  mixed?: boolean;
  alphaMixed?: boolean;
  keyframe?: KeyframeToggleProps;
}) {
  const hex = color?.startsWith("#") ? color : color ? `#${color}` : "#000000";
  const hasLabel = Boolean(label);
  const documentColors = useDocumentColors();
  return (
    <div
      className={cn(
        "group grid items-center gap-2",
        hasLabel ? "grid-cols-[64px_minmax(0,1fr)]" : "grid-cols-1",
      )}
    >
      {hasLabel && <span className="truncate text-[11px] text-muted-foreground">{label}</span>}
      <div className="flex min-w-0 items-center gap-0.5">
        <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-transparent bg-secondary pl-1 pr-2 transition-[background-color,border-color] hover:border-border focus-within:border-primary focus-within:bg-background">
          <CompactColorInput
            value={hex}
            onChange={onColor}
            ariaLabel={label || "Color"}
            side="left"
            align="start"
            mixed={mixed}
            swatches={documentColors}
          />
          {alpha != null && onAlpha && (
            <>
              <span className="h-4 w-px bg-border" />
              <input
                type="number"
                min={0}
                max={100}
                value={alphaMixed ? "" : Math.round((alpha ?? 1) * 100)}
                placeholder={alphaMixed ? "Mixed" : undefined}
                onChange={(e) => {
                  const pct = Number(e.target.value);
                  if (Number.isFinite(pct)) onAlpha(Math.max(0, Math.min(100, pct)) / 100);
                }}
                className="w-9 bg-transparent text-right text-[11px] tabular-nums text-muted-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
                aria-label={(label || "Color") + " opacity"}
              />
              <span className="text-[10px] text-muted-foreground/60">%</span>
            </>
          )}
        </div>
        {keyframe && <KeyframeToggle keyframe={keyframe} />}
      </div>
    </div>
  );
}

const HUE_TAP_STEP = 60;
const HUE_DIAL_DEAD_ZONE = 6;
const HUE_DOT_RADIUS = 7.5;
const HUE_WHEEL = `conic-gradient(${[0, 60, 120, 180, 240, 300, 360]
  .map((hue) => `hsl(${hue} 90% 60%)`)
  .join(", ")})`;

/**
 * A tiny color-harmony wheel: every gradient color sits as a dot at its hue,
 * so shifting the hue visibly turns the whole constellation together.
 */
function HueDial({ stops, scrubbing }: { stops: GradientStop[]; scrubbing: boolean }) {
  const dots = React.useMemo(() => {
    const seen = new Set<string>();
    return stops.flatMap((stop) => {
      const color = stop.color.toLowerCase();
      if (!/^#[0-9a-f]{6}$/.test(color) || seen.has(color)) return [];
      const hsv = hexToHsv(color);
      if (hsv.s < 8) return [];
      seen.add(color);
      return [{ color, hue: hsv.h }];
    });
  }, [stops]);

  // Dots sit relative to the first one and only the group turns, so a hue
  // shift reads as one smooth spin. Keep the angle continuous across 360°.
  const anchor = dots[0]?.hue ?? 0;
  const [angle, setAngle] = React.useState(anchor);
  const [shownAnchor, setShownAnchor] = React.useState(anchor);
  if (anchor !== shownAnchor) {
    setShownAnchor(anchor);
    setAngle(angle + ((((anchor - shownAnchor) % 360) + 540) % 360) - 180);
  }

  return (
    <span
      aria-hidden="true"
      data-scrubbing={scrubbing || undefined}
      className="relative size-4 rounded-full transition-[scale] duration-150 ease-out group-hover/hue:scale-110 data-scrubbing:scale-125"
    >
      <span
        className="absolute inset-0 rounded-full opacity-45 [mask:radial-gradient(circle,transparent_6px,black_6.5px)]"
        style={{ background: HUE_WHEEL }}
      />
      <span
        data-scrubbing={scrubbing || undefined}
        className="absolute inset-0 transition-[rotate] duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] data-scrubbing:duration-0"
        style={{ rotate: `${angle}deg` }}
      >
        {dots.map(({ color, hue }) => {
          const theta = ((hue - anchor) * Math.PI) / 180;
          return (
            <span
              key={color}
              className="absolute top-1/2 left-1/2 size-1 rounded-full shadow-[0_0_0_1px_rgb(0_0_0/0.45)]"
              style={{
                backgroundColor: color,
                translate: `calc(-50% + ${Math.sin(theta) * (HUE_DOT_RADIUS - 1)}px) calc(-50% - ${Math.cos(theta) * (HUE_DOT_RADIUS - 1)}px)`,
              }}
            />
          );
        })}
      </span>
    </span>
  );
}

const gradientToolClass =
  "grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40";

/** Compact Figma-style gradient editor: preview bar + per-stop color/offset/opacity + presets. */
export function GradientEditor({
  gradient,
  onChange,
  children,
}: {
  gradient: Gradient;
  onChange: (g: Gradient) => void;
  /** Placement controls (angle, ...) shown between the stop fields and the presets. */
  children?: React.ReactNode;
}) {
  const stops = gradient.stops;
  const [active, setActive] = React.useState(0);
  const [hueScrubbing, setHueScrubbing] = React.useState(false);
  const activeIdx = Math.min(active, stops.length - 1);
  const activeStop = stops[activeIdx];

  // Reads the latest gradient during drags so successive moves don't revert each other.
  const latest = React.useRef(gradient);
  latest.current = gradient;
  const commit = (next: Partial<Gradient>) => onChange({ ...latest.current, ...next });

  const updateStop = (idx: number, patch: Partial<GradientStop>) =>
    commit({ stops: latest.current.stops.map((s, i) => (i === idx ? { ...s, ...patch } : s)) });

  const removeStop = (idx: number) => {
    if (stops.length <= 2) return;
    commit({ stops: stops.filter((_, i) => i !== idx) });
    setActive(Math.max(0, idx - 1));
  };

  const hex = activeStop?.color?.startsWith("#") ? activeStop.color : "#000000";
  const barRef = React.useRef<HTMLDivElement>(null);
  const offsetAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };
  const addStopAt = (offset: number) => {
    const next = [...stops, sampleGradientStop(stops, offset)];
    commit({ stops: next });
    setActive(next.length - 1);
  };

  /** Pointer drags run as one undo step; `onMove` receives the pointer event. */
  const dragGesture = (
    event: React.PointerEvent<HTMLElement>,
    onMove: (event: PointerEvent) => void,
    onEnd?: (event: PointerEvent) => void,
  ) => {
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    useEditorStore.getState().beginHistoryGesture();
    const end = (endEvent: PointerEvent) => {
      target.removeEventListener("pointermove", onMove);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      onEnd?.(endEvent);
      useEditorStore.getState().endHistoryGesture();
    };
    target.addEventListener("pointermove", onMove);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };

  const dragStop = (index: number) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus();
    setActive(index);
    dragGesture(event, (moveEvent) =>
      updateStop(index, { offset: Math.round(offsetAt(moveEvent.clientX) * 1000) / 1000 }),
    );
  };

  const nudgeStop = (index: number) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeStop(index);
      return;
    }
    const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    const step = event.shiftKey ? 0.1 : 0.01;
    const offset = Math.max(0, Math.min(1, (stops[index]?.offset ?? 0) + direction * step));
    updateStop(index, { offset: Math.round(offset * 1000) / 1000 });
  };

  /** Tap spins every hue a step; dragging around the dial turns the colors 1:1. */
  const handleHuePointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const base = latest.current.stops;
    const rect = event.currentTarget.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const startX = event.clientX;
    const startY = event.clientY;
    // Clockwise from 12 o'clock, like the dial's dots.
    const pointerAngle = (x: number, y: number) => (Math.atan2(x - cx, cy - y) * 180) / Math.PI;
    let lastAngle: number | null = null;
    let turned = 0;
    let moved = false;
    dragGesture(
      event,
      (moveEvent) => {
        if (!moved && Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < 3)
          return;
        if (!moved) setHueScrubbing(true);
        moved = true;
        // Right on top of the center the angle is noise; wait to leave it.
        if (Math.hypot(moveEvent.clientX - cx, moveEvent.clientY - cy) < HUE_DIAL_DEAD_ZONE) return;
        const angle = pointerAngle(moveEvent.clientX, moveEvent.clientY);
        if (lastAngle !== null) turned += ((((angle - lastAngle) % 360) + 540) % 360) - 180;
        lastAngle = angle;
        commit({ stops: hueShiftedStops(base, turned) });
      },
      (endEvent) => {
        setHueScrubbing(false);
        if (!moved && endEvent.type !== "pointercancel")
          commit({ stops: hueShiftedStops(base, HUE_TAP_STEP) });
      },
    );
  };

  return (
    <div className="space-y-2">
      <div
        ref={barRef}
        className="relative mx-1.5 h-6 cursor-copy rounded-md shadow-[inset_0_0_0_1px_var(--border)]"
        title="Click to add a stop · drag stops to move them"
        onPointerDown={(event) => {
          if (event.button !== 0 || event.target !== event.currentTarget) return;
          addStopAt(Math.round(offsetAt(event.clientX) * 1000) / 1000);
        }}
        style={{
          backgroundImage: `${gradientToCssBar(gradient)}, repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%)`,
          backgroundSize: "100% 100%, 8px 8px",
        }}
      >
        {stops.map((s, i) => (
          <button
            key={i}
            type="button"
            onPointerDown={dragStop(i)}
            onKeyDown={nudgeStop(i)}
            onClick={() => setActive(i)}
            aria-label={`Stop ${i + 1} at ${Math.round(s.offset * 100)}%`}
            aria-pressed={i === activeIdx}
            title="Drag to move · arrows nudge · Delete removes"
            className={cn(
              "absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none rounded-full border-2 border-white transition-[scale,box-shadow] focus-visible:outline-none",
              i === activeIdx
                ? "scale-110 shadow-[0_0_0_2px_var(--primary),0_1px_3px_rgb(0_0_0/0.35)]"
                : "shadow-[0_0_0_1px_rgb(0_0_0/0.25),0_1px_2px_rgb(0_0_0/0.25)] hover:scale-110",
            )}
            style={{ left: `${s.offset * 100}%`, background: s.color }}
          />
        ))}
      </div>

      {activeStop && (
        <div className="flex items-center gap-1">
          <div className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-transparent bg-secondary pl-1 pr-2 transition-[background-color,border-color] hover:border-border focus-within:border-primary focus-within:bg-background">
            <CompactColorInput
              value={hex}
              onChange={(c) => updateStop(activeIdx, { color: c })}
              ariaLabel="Stop color"
              side="left"
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
              className="w-8 bg-transparent text-right text-[11px] tabular-nums text-muted-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
              aria-label="Stop opacity"
            />
            <span className="text-[10px] text-muted-foreground/60">%</span>
          </div>
          <button
            type="button"
            onClick={() => removeStop(activeIdx)}
            disabled={stops.length <= 2}
            aria-label="Remove stop"
            title="Remove stop"
            className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-30"
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      )}

      {activeStop && (
        <NumberRow
          label="Position"
          value={Math.round((activeStop.offset ?? 0) * 100)}
          min={0}
          max={100}
          suffix="%"
          onChange={(v) => updateStop(activeIdx, { offset: v / 100 })}
        />
      )}

      {children}

      <div className="space-y-1.5 pt-1">
        <div className="flex h-6 items-center justify-between">
          <span className="text-[11px] text-muted-foreground">Presets</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              title="Reverse stops"
              aria-label="Reverse gradient"
              className={gradientToolClass}
              onClick={() => commit({ stops: reverseGradientStops(stops) })}
            >
              <ArrowLeftRight className="size-3.5" />
            </button>
            <button
              type="button"
              title="Shift hue — click to spin, drag around to turn"
              aria-label="Shift gradient hue"
              className={cn(
                gradientToolClass,
                "group/hue cursor-grab touch-none active:cursor-grabbing",
              )}
              onPointerDown={handleHuePointerDown}
              onClick={(event) => {
                // Pointer taps are handled on pointerdown; this is the keyboard path.
                if (event.detail === 0) commit({ stops: hueShiftedStops(stops, HUE_TAP_STEP) });
              }}
            >
              <HueDial stops={stops} scrubbing={hueScrubbing} />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-8 gap-1">
          {GRADIENT_PRESETS.map((preset) => {
            const selected = matchesPreset(stops, preset);
            return (
              <button
                key={preset.name}
                type="button"
                title={preset.name}
                aria-label={`Use ${preset.name} gradient`}
                aria-pressed={selected}
                onClick={() => {
                  commit({ stops: preset.stops.map((stop) => ({ ...stop })) });
                  setActive(0);
                }}
                className="relative aspect-square min-w-0 rounded-md shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)] ring-offset-2 ring-offset-background transition-[scale,box-shadow] duration-150 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 aria-pressed:ring-2 aria-pressed:ring-foreground/80"
                style={{ backgroundImage: gradientToCssBar({ ...gradient, stops: preset.stops }) }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

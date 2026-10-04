"use client";

import React from "react";
import { CompactColorInput } from "@/components/ui/compact-color-input";
import { Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/lib/store/editorStore";
import type { Gradient, GradientStop } from "@/lib/shapeshifter/types";
import { gradientToCssBar, normalizeStops } from "@/lib/shapeshifter/gradients";
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

/** Compact Figma-style gradient editor: preview bar + per-stop color/offset/opacity. */
export function GradientEditor({
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

  const removeStop = (idx: number) => {
    if (stops.length <= 2) return;
    commit({ stops: stops.filter((_, i) => i !== idx) });
    setActive(0);
  };

  const hex = activeStop?.color?.startsWith("#") ? activeStop.color : "#000000";
  const barRef = React.useRef<HTMLDivElement>(null);
  const offsetAt = (clientX: number) => {
    const rect = barRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };
  const addStopAt = (offset: number) => {
    const sorted = normalizeStops(stops);
    const after = sorted.find((stop) => stop.offset >= offset) ?? sorted[sorted.length - 1]!;
    const next = [...stops, { offset, color: after.color, opacity: after.opacity ?? 1 }];
    commit({ stops: next });
    setActive(next.length - 1);
  };
  const dragStop = (index: number) => (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    setActive(index);
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const store = useEditorStore.getState();
    store.beginHistoryGesture();
    const move = (moveEvent: PointerEvent) =>
      updateStopLive(index, Math.round(offsetAt(moveEvent.clientX) * 1000) / 1000);
    const end = () => {
      target.removeEventListener("pointermove", move);
      target.removeEventListener("pointerup", end);
      target.removeEventListener("pointercancel", end);
      useEditorStore.getState().endHistoryGesture();
    };
    target.addEventListener("pointermove", move);
    target.addEventListener("pointerup", end);
    target.addEventListener("pointercancel", end);
  };
  // Reads the latest gradient during a drag so successive moves don't revert each other.
  const latest = React.useRef(gradient);
  latest.current = gradient;
  const updateStopLive = (index: number, offset: number) =>
    onChange({
      ...latest.current,
      stops: latest.current.stops.map((stop, i) => (i === index ? { ...stop, offset } : stop)),
    });

  return (
    <div className="space-y-2">
      <div
        ref={barRef}
        className="relative h-6 cursor-copy rounded-md shadow-[inset_0_0_0_1px_var(--border)]"
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
            onClick={() => setActive(i)}
            aria-label={`Stop ${i + 1}`}
            aria-pressed={i === activeIdx}
            className={cn(
              "absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2 transition-[transform,box-shadow]",
              i === activeIdx
                ? "scale-110 border-white shadow-[0_0_0_2px_var(--primary),0_1px_3px_rgb(0_0_0/0.35)]"
                : "border-white shadow-[0_0_0_1px_rgb(0_0_0/0.25),0_1px_2px_rgb(0_0_0/0.25)]",
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
    </div>
  );
}

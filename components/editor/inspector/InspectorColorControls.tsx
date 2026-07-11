"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { CompactColorInput } from "@/components/ui/compact-color-input";
import { Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Gradient, GradientStop } from "@/lib/shapeshifter/types";
import { gradientToCssBar, normalizeStops } from "@/lib/shapeshifter/gradients";
import { NumberRow } from "./InspectorControls";

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
}: {
  label?: string;
  color: string;
  alpha?: number;
  onColor: (v: string) => void;
  onAlpha?: (v: number) => void;
  mixed?: boolean;
  alphaMixed?: boolean;
}) {
  const hex = (color?.startsWith("#") ? color : color ? `#${color}` : "#000000");
  const hasLabel = Boolean(label);
  return (
    <div
      className={cn(
        "group grid items-center gap-2",
        hasLabel ? "grid-cols-[58px_minmax(0,1fr)]" : "grid-cols-1",
      )}
    >
      {hasLabel && <span className="truncate text-[11px] text-muted-foreground">{label}</span>}
      <div className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-background pl-1 pr-2 transition-colors hover:border-foreground/20 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <CompactColorInput
          value={hex}
          onChange={onColor}
          ariaLabel={label || "Color"}
          side="bottom"
          align="start"
          mixed={mixed}
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
          <Plus size={14} className="text-muted-foreground" /> Stop
        </Button>
        <Button
          type="button"
          variant="outline"
          size="xs"
          onClick={() => removeStop(activeIdx)}
          disabled={stops.length <= 2}
          className="h-7 gap-1 text-[11px] disabled:opacity-40"
        >
          <Minus size={14} className="text-muted-foreground" /> Remove
        </Button>
      </div>
    </div>
  );
}


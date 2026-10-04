"use client";

import * as React from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pipette } from "lucide-react";
import { cn } from "@/lib/utils";
import { hexToRgb, type ColorFormat } from "./color-picker-utils";
import { formatSolidColorValueEdit, getSolidColorFormatValues } from "./color-solid-editor-model";

const ENABLE_ALPHA = false;

export interface SolidColorEditorProps {
  h: number;
  s: number;
  v: number;
  hex: string;
  alpha: number;
  inputText: string;
  format: ColorFormat;
  setFormat: (format: ColorFormat) => void;
  canvasRef: React.RefObject<HTMLDivElement | null>;
  hueRef: React.RefObject<HTMLDivElement | null>;
  alphaRef: React.RefObject<HTMLDivElement | null>;
  handleCanvasStart: (e: React.MouseEvent | React.TouchEvent) => void;
  handleHueStart: (e: React.MouseEvent | React.TouchEvent) => void;
  handleAlphaStart: (e: React.MouseEvent | React.TouchEvent) => void;
  handleAlphaChange: (value: string) => void;
  handleTextChange: (value: string) => void;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  handleBlur: () => void;
  framed?: boolean;
  compact?: boolean;
  swatches?: string[];
  onPick?: (hex: string) => void;
}

type EyeDropperWindow = Window & {
  EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
};

export function SolidColorEditor({
  h,
  s,
  v,
  hex,
  alpha,
  inputText,
  format,
  setFormat,
  canvasRef,
  hueRef,
  alphaRef,
  handleCanvasStart,
  handleHueStart,
  handleAlphaStart,
  handleAlphaChange,
  handleTextChange,
  handleKeyDown,
  handleBlur,
  framed = true,
  compact = false,
  swatches,
  onPick,
}: SolidColorEditorProps) {
  const [canSample, setCanSample] = React.useState(false);
  React.useEffect(() => setCanSample(Boolean((window as EyeDropperWindow).EyeDropper)), []);
  const sample = async () => {
    const EyeDropper = (window as EyeDropperWindow).EyeDropper;
    if (!EyeDropper || !onPick) return;
    try {
      const result = await new EyeDropper().open();
      onPick(result.sRGBHex.toUpperCase());
    } catch {
      // The user cancelled sampling.
    }
  };
  const rgb = hexToRgb(hex);
  const formatValues = getSolidColorFormatValues({ format, hex, h, s, v });

  const updateFormatValue = (index: number, rawValue: string) => {
    const nextHex = formatSolidColorValueEdit({
      format,
      hex,
      h,
      s,
      v,
      index,
      rawValue,
    });
    if (nextHex) handleTextChange(nextHex);
  };

  const formatSelect = (
    <Select value={format} onValueChange={(next) => setFormat(next as ColorFormat)}>
      <SelectTrigger
        size="sm"
        className="h-7 w-[64px] shrink-0 rounded-md border-transparent bg-secondary px-2 text-[11px] text-foreground hover:bg-accent"
      >
        <SelectValue>{format}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[72px]">
        <SelectItem value="HEX">HEX</SelectItem>
        <SelectItem value="RGB">RGB</SelectItem>
        <SelectItem value="HSL">HSL</SelectItem>
        <SelectItem value="HSB">HSB</SelectItem>
      </SelectContent>
    </Select>
  );

  return (
    <div
      className={cn(
        "space-y-2.5",
        framed &&
          "rounded-xl border border-border bg-popover p-3 pb-2 text-popover-foreground shadow-xl",
      )}
    >
      <div
        ref={canvasRef}
        onMouseDown={handleCanvasStart}
        onTouchStart={handleCanvasStart}
        className={cn(
          "relative w-full cursor-crosshair overflow-hidden rounded-lg select-none",
          compact ? "h-36" : "h-56",
        )}
      >
        <div
          className="absolute inset-0 rounded-lg shadow-[inset_0_0_0_1px_var(--border)]"
          style={{
            backgroundImage: `linear-gradient(to top, #000 0%, rgba(0, 0, 0, 0) 100%), linear-gradient(to right, #fff 0%, hsl(${h}, 100%, 50%) 100%)`,
          }}
        />
        <div
          className="absolute z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.25),0_1px_3px_rgb(0_0_0/0.35)]"
          style={{
            left: `${s}%`,
            top: `${100 - v}%`,
            backgroundColor: hex,
          }}
        />
      </div>

      <div className="flex items-center gap-2">
        {canSample && onPick && (
          <button
            type="button"
            onClick={sample}
            aria-label="Pick a color from the screen"
            title="Pick a color from the screen"
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Pipette className="size-3.5" />
          </button>
        )}
        <div
          ref={hueRef}
          onMouseDown={handleHueStart}
          onTouchStart={handleHueStart}
          className="relative h-3 w-full cursor-pointer rounded-full shadow-[inset_0_0_0_1px_var(--border)]"
          style={{
            background:
              "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
          }}
        >
          <div
            className="absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.25),0_1px_3px_rgb(0_0_0/0.35)]"
            style={{
              left: `clamp(7px, ${(h / 360) * 100}%, calc(100% - 7px))`,
              backgroundColor: `hsl(${h}, 100%, 50%)`,
            }}
          />
        </div>
      </div>

      {ENABLE_ALPHA && (
        <div
          ref={alphaRef}
          onMouseDown={handleAlphaStart}
          onTouchStart={handleAlphaStart}
          className="relative h-4.5 w-full cursor-pointer rounded-full border border-border shadow-inner"
          style={{
            backgroundColor: "#fff",
            backgroundImage: `linear-gradient(to right, rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0), rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)), linear-gradient(45deg, #8b8b8b 25%, transparent 25%), linear-gradient(-45deg, #8b8b8b 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #8b8b8b 75%), linear-gradient(-45deg, transparent 75%, #8b8b8b 75%)`,
            backgroundPosition: "0 0, 0 0, 0 5px, 5px -5px, -5px 0",
            backgroundSize: "100% 100%, 10px 10px, 10px 10px, 10px 10px, 10px 10px",
          }}
        >
          <div
            className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-transparent shadow-[0_1px_4px_rgba(0,0,0,0.38)]"
            style={{ left: `clamp(8px, ${alpha * 100}%, calc(100% - 8px))` }}
          />
        </div>
      )}

      {format === "HEX" ? null : (
        <div className="flex items-center gap-2 text-[12px]">
          {formatSelect}
          <div
            className={cn(
              "grid min-w-0 flex-1 gap-1",
              ENABLE_ALPHA ? "grid-cols-4" : "grid-cols-3",
            )}
          >
            {formatValues.map((value, index) => (
              <input
                key={`${format}-${index}`}
                type="text"
                value={Math.round(value)}
                onChange={(event) => updateFormatValue(index, event.target.value)}
                className={cn(
                  "h-7 min-w-0 rounded-md border border-transparent bg-secondary text-center text-[11px] tabular-nums text-foreground outline-none focus:border-primary",
                )}
              />
            ))}
            {ENABLE_ALPHA && (
              <div className="flex h-8 min-w-0 items-center rounded-r-lg border border-border bg-muted/45 px-1 font-mono text-foreground">
                <input
                  type="text"
                  value={Math.round(alpha * 100)}
                  onChange={(event) => handleAlphaChange(event.target.value)}
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-center font-mono text-foreground outline-none"
                />
                <span className="text-muted-foreground">%</span>
              </div>
            )}
          </div>
        </div>
      )}

      {format === "HEX" && (
        <div className="flex items-center gap-2">
          {formatSelect}
          <div className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md border border-transparent bg-secondary px-2 focus-within:border-primary">
            <span className="text-[11px] text-muted-foreground">#</span>
            <input
              type="text"
              value={inputText.replace(/^#/, "")}
              onChange={(e) => handleTextChange(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleBlur}
              placeholder="FFFFFF"
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[11px] tabular-nums text-foreground uppercase outline-none focus:ring-0"
            />
          </div>
        </div>
      )}

      {swatches && swatches.length > 0 && onPick && (
        <div className="border-t border-border pt-2.5">
          <div className="mb-1.5 text-[11px] text-muted-foreground">In this document</div>
          <div className="flex flex-wrap gap-1.5">
            {swatches.map((swatch) => (
              <button
                key={swatch}
                type="button"
                aria-label={`Use ${swatch}`}
                title={swatch}
                onClick={() => onPick(swatch)}
                className={cn(
                  "size-5 rounded-[4px] shadow-[inset_0_0_0_1px_var(--border)] transition-transform hover:scale-110",
                  swatch.toLowerCase() === hex.toLowerCase() &&
                    "ring-2 ring-primary ring-offset-1 ring-offset-popover",
                )}
                style={{ backgroundColor: swatch }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

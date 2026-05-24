"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type ColorFormat = "HEX" | "RGB" | "HSL" | "HSB";

interface ColorPickerProps {
  value?: string;
  onChange: (hex: string) => void;
  className?: string;
  placeholder?: string;
}

function normalizeHex(value?: string, fallback = "#000000") {
  const text = (value || "").trim();
  if (!text || text === "none") return fallback;
  const withHash = text.startsWith("#") ? text : `#${text}`;
  if (/^#[0-9a-fA-F]{3}$/.test(withHash)) {
    return `#${withHash.slice(1).split("").map((char) => char + char).join("")}`;
  }
  return /^#[0-9a-fA-F]{6}$/.test(withHash) ? withHash : fallback;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex).replace(/^#/, "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  const channel = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

function hexToHsv(hex: string): { h: number; s: number; v: number } {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;

  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta + (gn < bn ? 6 : 0)) / 6;
    else if (max === gn) h = ((bn - rn) / delta + 2) / 6;
    else h = ((rn - gn) / delta + 4) / 6;
  }

  return {
    h: Math.round(h * 360),
    s: max === 0 ? 0 : Math.round((delta / max) * 100),
    v: Math.round(max * 100),
  };
}

function hsvToHex(h: number, s: number, v: number): string {
  const hn = h / 360;
  const sn = s / 100;
  const vn = v / 100;
  const i = Math.floor(hn * 6);
  const f = hn * 6 - i;
  const p = vn * (1 - sn);
  const q = vn * (1 - f * sn);
  const t = vn * (1 - (1 - f) * sn);
  let r = 0;
  let g = 0;
  let b = 0;

  switch (i % 6) {
    case 0:
      r = vn; g = t; b = p;
      break;
    case 1:
      r = q; g = vn; b = p;
      break;
    case 2:
      r = p; g = vn; b = t;
      break;
    case 3:
      r = p; g = q; b = vn;
      break;
    case 4:
      r = t; g = p; b = vn;
      break;
    case 5:
      r = vn; g = p; b = q;
      break;
  }

  return rgbToHex(r * 255, g * 255, b * 255);
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const { r, g, b } = hexToRgb(hex);
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const delta = max - min;
    s = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === rn) h = (gn - bn) / delta + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
    h /= 6;
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(lightness * 100) };
}

function hslToHex(h: number, s: number, l: number): string {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;

  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }

  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function ColorPicker({ value, onChange, className, placeholder = "none" }: ColorPickerProps) {
  const hex = normalizeHex(value);
  const hasValue = Boolean(value && value !== "none");
  const [{ h, s, v }, setHsv] = React.useState(() => hexToHsv(hex));
  const [format, setFormat] = React.useState<ColorFormat>("HEX");
  const [inputText, setInputText] = React.useState(hex);
  const canvasRef = React.useRef<HTMLDivElement>(null);
  const hueRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setHsv(hexToHsv(hex));
    setInputText(hex);
  }, [hex]);

  const rgb = hexToRgb(hex);
  const hsl = hexToHsl(hex);
  const formatValues = format === "RGB" ? [rgb.r, rgb.g, rgb.b] : format === "HSL" ? [hsl.h, hsl.s, hsl.l] : [h, s, v];

  const commitHex = React.useCallback((nextHex: string) => {
    const normalized = normalizeHex(nextHex);
    setInputText(normalized);
    setHsv(hexToHsv(normalized));
    onChange(normalized);
  }, [onChange]);

  const updateCanvas = React.useCallback((clientX: number, clientY: number) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const nextS = Math.round(clampNumber((clientX - rect.left) / rect.width, 0, 1) * 100);
    const nextV = Math.round(clampNumber(1 - (clientY - rect.top) / rect.height, 0, 1) * 100);
    commitHex(hsvToHex(h, nextS, nextV));
  }, [commitHex, h]);

  const updateHue = React.useCallback((clientX: number) => {
    if (!hueRef.current) return;
    const rect = hueRef.current.getBoundingClientRect();
    const nextH = Math.round(clampNumber((clientX - rect.left) / rect.width, 0, 1) * 360);
    commitHex(hsvToHex(nextH, s, v));
  }, [commitHex, s, v]);

  const bindDrag = (
    event: React.MouseEvent | React.TouchEvent,
    update: (clientX: number, clientY: number) => void,
  ) => {
    event.preventDefault();
    const first = "touches" in event ? event.touches[0] : event;
    update(first.clientX, first.clientY);

    const move = (moveEvent: MouseEvent | TouchEvent) => {
      const pointer = "touches" in moveEvent ? moveEvent.touches[0] : moveEvent;
      update(pointer.clientX, pointer.clientY);
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };

    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
  };

  const updateFormatValue = (index: number, rawValue: string) => {
    const parsed = Number.parseFloat(rawValue);
    if (!Number.isFinite(parsed)) return;
    if (format === "RGB") {
      const next = [rgb.r, rgb.g, rgb.b];
      next[index] = clampNumber(parsed, 0, 255);
      commitHex(rgbToHex(next[0], next[1], next[2]));
    } else if (format === "HSL") {
      const next = [hsl.h, hsl.s, hsl.l];
      next[index] = index === 0 ? clampNumber(parsed, 0, 360) : clampNumber(parsed, 0, 100);
      commitHex(hslToHex(next[0], next[1], next[2]));
    } else {
      const next = [h, s, v];
      next[index] = index === 0 ? clampNumber(parsed, 0, 360) : clampNumber(parsed, 0, 100);
      commitHex(hsvToHex(next[0], next[1], next[2]));
    }
  };

  const handleTextChange = (text: string) => {
    setInputText(text);
    const formatted = text.trim().startsWith("#") ? text.trim() : `#${text.trim()}`;
    if (/^#[0-9a-fA-F]{6}$/.test(formatted)) commitHex(formatted);
  };

  const revertInvalidText = () => {
    const formatted = inputText.trim().startsWith("#") ? inputText.trim() : `#${inputText.trim()}`;
    if (/^#[0-9a-fA-F]{6}$/.test(formatted)) commitHex(formatted);
    else setInputText(hex);
  };

  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "flex h-8 min-w-0 items-center gap-2 rounded-lg border border-border/80 bg-background/60 px-2 text-left text-foreground shadow-sm transition-colors hover:bg-muted/70 focus:outline-none focus:ring-2 focus:ring-ring/45 active:scale-[0.99]",
          "dark:border-white/[0.08] dark:bg-black/20 dark:hover:border-white/20 dark:hover:bg-white/[0.04]",
          className,
        )}
      >
        <span
          className="size-4 shrink-0 rounded-md border border-foreground/15 shadow-sm"
          style={{ backgroundColor: hex }}
        />
        <span className={cn("min-w-0 flex-1 truncate font-mono text-[11px] font-medium uppercase", hasValue ? "text-foreground/80" : "text-muted-foreground")}>
          {hasValue ? hex : placeholder}
        </span>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[260px] select-none overflow-hidden rounded-xl border border-border/80 bg-popover/95 p-3 pb-2 text-popover-foreground shadow-2xl backdrop-blur-xl dark:border-white/[0.12]"
      >
        <div className="space-y-3">
          <div
            ref={canvasRef}
            onMouseDown={(event) => bindDrag(event, updateCanvas)}
            onTouchStart={(event) => bindDrag(event, updateCanvas)}
            className="relative h-40 w-full cursor-crosshair select-none overflow-hidden rounded-lg border border-border/80 bg-muted shadow-inner dark:border-white/[0.08]"
          >
            <div
              className="absolute inset-px rounded-[7px]"
              style={{
                backgroundImage: `linear-gradient(to top, #000 0%, rgba(0, 0, 0, 0) 100%), linear-gradient(to right, #fff 0%, hsl(${h}, 100%, 50%) 100%)`,
              }}
            />
            <div
              className="absolute z-10 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-transparent shadow-[0_1px_7px_rgba(0,0,0,0.65)]"
              style={{ left: `${s}%`, top: `${100 - v}%` }}
            />
          </div>

          <div
            ref={hueRef}
            onMouseDown={(event) => bindDrag(event, (clientX) => updateHue(clientX))}
            onTouchStart={(event) => bindDrag(event, (clientX) => updateHue(clientX))}
            className="relative h-4.5 w-full cursor-pointer rounded-full border border-foreground/20 shadow-inner"
            style={{
              background: "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)",
            }}
          >
            <div
              className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-transparent shadow-[0_1px_4px_rgba(0,0,0,0.55)]"
              style={{ left: `clamp(8px, ${(h / 360) * 100}%, calc(100% - 8px))` }}
            />
          </div>

          {format === "HEX" ? (
            <div className="flex items-center gap-2">
              <div className="relative h-8 w-[72px] shrink-0 rounded-lg border border-border/80 bg-muted/60 dark:border-white/[0.09] dark:bg-white/[0.06]">
                <select
                  value={format}
                  onChange={(event) => setFormat(event.target.value as ColorFormat)}
                  className="h-full w-full appearance-none rounded-lg bg-transparent pl-3 pr-8 text-[11px] outline-none"
                >
                  <option value="HEX">HEX</option>
                  <option value="RGB">RGB</option>
                  <option value="HSL">HSL</option>
                  <option value="HSB">HSB</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
              <div className="flex h-8 min-w-0 flex-1 items-center gap-1 rounded-lg border border-border/80 bg-muted/50 px-2.5 dark:border-white/[0.07] dark:bg-black/25">
                <span className="font-mono text-[10px] font-bold text-muted-foreground">#</span>
                <input
                  type="text"
                  value={inputText.replace(/^#/, "")}
                  onChange={(event) => handleTextChange(event.target.value)}
                  onBlur={revertInvalidText}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      revertInvalidText();
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="000000"
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 font-mono text-xs uppercase text-foreground outline-none focus:ring-0"
                />
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[12px]">
              <div className="relative h-8 w-[72px] shrink-0 rounded-lg border border-border/80 bg-muted/60 dark:border-white/[0.09] dark:bg-white/[0.06]">
                <select
                  value={format}
                  onChange={(event) => setFormat(event.target.value as ColorFormat)}
                  className="h-full w-full appearance-none rounded-lg bg-transparent pl-3 pr-8 outline-none"
                >
                  <option value="HEX">HEX</option>
                  <option value="RGB">RGB</option>
                  <option value="HSL">HSL</option>
                  <option value="HSB">HSB</option>
                </select>
                <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              </div>
              <div className="grid min-w-0 flex-1 grid-cols-3 gap-px rounded-lg bg-border/80 dark:bg-black/25">
                {formatValues.map((item, index) => (
                  <input
                    key={`${format}-${index}`}
                    type="text"
                    value={Math.round(item)}
                    onChange={(event) => updateFormatValue(index, event.target.value)}
                    className={cn(
                      "h-8 min-w-0 border border-border/70 bg-muted/45 text-center font-mono text-foreground outline-none dark:border-white/[0.07] dark:bg-white/[0.04]",
                      index === 0 && "rounded-l-lg",
                      index === 2 && "rounded-r-lg",
                    )}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

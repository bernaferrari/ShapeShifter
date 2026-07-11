"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

const fieldBase =
  "h-8 w-full rounded-md border border-border bg-background px-2 text-xs text-foreground outline-none transition-colors placeholder:text-muted-foreground/50 hover:border-foreground/20 focus:border-primary focus:ring-2 focus:ring-primary/20";

export function Section({
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
export function Row({ label, children }: { label?: string; children: React.ReactNode }) {
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

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  ariaLabel,
  onBlur,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  ariaLabel?: string;
  onBlur?: () => void;
}) {
  return (
    <input
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      aria-label={ariaLabel}
      className={cn(fieldBase, mono && "font-mono")}
    />
  );
}

/** Number field with Figma-style label-drag scrubbing + optional unit suffix. */
export function NumberRow({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix,
  mixed = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  mixed?: boolean;
}) {
  const scrub = React.useRef<{ startX: number; startVal: number } | null>(null);
  // While the field is focused we keep the raw keystrokes so typing "2." or a
  // trailing zero isn't reformatted mid-edit. Display always uses a "." decimal
  // separator (an <input type=number> would otherwise render the OS locale's
  // comma, e.g. "2,4" on pt-BR), and we parse both "." and "," on input.
  const [draft, setDraft] = React.useState<string | null>(null);
  const display = draft ?? (mixed ? "" : Number.isFinite(value) ? String(value) : "0");

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
    <div
      className="group grid grid-cols-[58px_minmax(0,1fr)] items-center gap-2"
    >
      <span
        role="slider"
        aria-label={label}
        aria-valuenow={value}
        aria-valuetext={mixed ? "Mixed values" : undefined}
        tabIndex={0}
        className="w-fit cursor-ew-resize select-none truncate border-b border-dotted border-muted-foreground/40 text-[11px] text-muted-foreground hover:border-foreground/50 hover:text-foreground"
        title="Drag to adjust"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
          onChange(clamp(value + direction * (step || 1) * (event.shiftKey ? 10 : 1)));
        }}
      >
        {label}
      </span>
      <div className="relative">
        <input
          type="text"
          inputMode="decimal"
          aria-label={label}
          value={display}
          placeholder={mixed ? "Mixed" : undefined}
          onFocus={() => setDraft(mixed ? "" : Number.isFinite(value) ? String(value) : "0")}
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


export function Segmented<T extends string>({
  value,
  options,
  onChange,
  mixed = false,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  mixed?: boolean;
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
            "h-7 flex-1 rounded-sm px-1 text-[11px] capitalize",
            !mixed && value === o.value
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

"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/lib/store/editorStore";

const fieldBase =
  "h-7 w-full rounded-[4px] border border-transparent bg-muted/65 px-2 text-xs text-foreground outline-none transition-[background-color,border-color,box-shadow] placeholder:text-muted-foreground/50 hover:bg-muted focus:border-primary/70 focus:bg-background focus:ring-1 focus:ring-primary/25";

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
      <div className="flex h-9 items-center justify-between pl-1.5 pr-2.5">
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
  keyframe,
  compact = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  mixed?: boolean;
  keyframe?: {
    active: boolean;
    onClick: () => void;
    label: string;
  };
  compact?: boolean;
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
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    scrub.current = { startX: e.clientX, startVal: value };
    useEditorStore.getState().beginHistoryGesture();
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
    useEditorStore.getState().endHistoryGesture();
  };

  if (compact) {
    return (
      <div className="group relative min-w-0">
        <span
          role="slider"
          aria-label={label}
          aria-valuenow={value}
          aria-valuetext={mixed ? "Mixed values" : undefined}
          tabIndex={0}
          className="absolute inset-y-0 left-0 z-10 flex w-7 cursor-ew-resize select-none items-center justify-center text-[9px] font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground"
          title="Drag to adjust"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={(event) => {
            if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"].includes(event.key)) return;
            event.preventDefault();
            const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
            onChange(clamp(value + direction * (step || 1) * (event.shiftKey ? 10 : 1)));
          }}
        >
          {label}
        </span>
        <input
          type="text"
          inputMode="decimal"
          aria-label={label}
          value={display}
          placeholder={mixed ? "Mixed" : undefined}
          onFocus={() => {
            useEditorStore.getState().beginHistoryGesture();
            setDraft(mixed ? "" : Number.isFinite(value) ? String(value) : "0");
          }}
          onChange={(event) => {
            const raw = event.target.value;
            setDraft(raw);
            const number = Number(raw.replace(",", "."));
            if (Number.isFinite(number)) onChange(clamp(number));
          }}
          onBlur={() => {
            setDraft(null);
            useEditorStore.getState().endHistoryGesture();
          }}
          className={cn(
            fieldBase,
            "pl-7 font-mono tabular-nums",
            keyframe ? (suffix ? "pr-12" : "pr-7") : suffix ? "pr-7" : "pr-2",
          )}
        />
        {suffix && (
          <span
            className={cn(
              "pointer-events-none absolute top-1/2 -translate-y-1/2 text-[9px] text-muted-foreground/55",
              keyframe ? "right-7" : "right-2",
            )}
          >
            {suffix}
          </span>
        )}
        {keyframe && (
          <button
            type="button"
            onClick={keyframe.onClick}
            className="absolute right-0.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded hover:bg-background/70"
            aria-label={keyframe.label}
            title={keyframe.label}
          >
            <span
              className={cn(
                "size-2 rotate-45 rounded-[1px] border",
                keyframe.active
                  ? "border-primary bg-primary"
                  : "border-muted-foreground/40 bg-background",
              )}
            />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="group grid grid-cols-[58px_minmax(0,1fr)] items-center gap-2">
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
          if (
            event.key !== "ArrowLeft" &&
            event.key !== "ArrowRight" &&
            event.key !== "ArrowDown" &&
            event.key !== "ArrowUp"
          )
            return;
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
          onFocus={() => {
            useEditorStore.getState().beginHistoryGesture();
            setDraft(mixed ? "" : Number.isFinite(value) ? String(value) : "0");
          }}
          onChange={(e) => {
            const raw = e.target.value;
            setDraft(raw);
            const n = Number(raw.replace(",", "."));
            if (Number.isFinite(n)) onChange(clamp(n));
          }}
          onBlur={() => {
            setDraft(null);
            useEditorStore.getState().endHistoryGesture();
          }}
          className={cn(
            fieldBase,
            "font-mono tabular-nums",
            keyframe ? (suffix ? "pr-14" : "pr-8") : "pr-7",
          )}
        />
        {suffix && (
          <span
            className={cn(
              "pointer-events-none absolute top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/60",
              keyframe ? "right-8" : "right-2",
            )}
          >
            {suffix}
          </span>
        )}
        {keyframe && (
          <button
            type="button"
            onClick={keyframe.onClick}
            className="absolute right-1 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded hover:bg-muted focus-visible:outline focus-visible:outline-1 focus-visible:outline-foreground/60"
            aria-label={keyframe.label}
            title={keyframe.label}
          >
            <span
              className={cn(
                "size-2 rotate-45 rounded-[1px] border",
                keyframe.active
                  ? "border-primary bg-primary"
                  : "border-muted-foreground/45 bg-background",
              )}
            />
          </button>
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
    <div className="flex h-7 items-center rounded-[4px] bg-muted/65 p-0.5">
      {options.map((o) => (
        <Button
          key={o.value}
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => onChange(o.value)}
          className={cn(
            "h-6 flex-1 rounded-[3px] px-1 text-[11px] capitalize",
            !mixed && value === o.value
              ? "bg-card font-medium text-foreground shadow-xs hover:bg-card"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

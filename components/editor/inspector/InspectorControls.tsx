"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronRight, Ellipsis } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { horizontalIntent } from "@/lib/touchIntent";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/lib/store/editorStore";

/**
 * Touch sizing has one rule: fields type at 16px (so iOS never zooms on
 * focus) inside a 36px box that suits it; everything else keeps its own size.
 */
export const fieldBase =
  "h-7 pointer-coarse:h-9 w-full rounded-md border border-transparent bg-secondary px-2 text-[11px] text-foreground outline-none transition-[background-color,border-color,box-shadow] placeholder:text-muted-foreground/50 hover:border-border focus:border-primary focus:bg-background";

/**
 * A choice that reads as text with a chevron (Figma's inline dropdowns). It
 * opens the app's menu rather than a native select, so it stays text-sized on
 * phones without triggering focus zoom.
 */
export function InlineSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T | "";
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const current = options.find((option) => option.value === value)?.label ?? "Mixed";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`${label}: ${current}`}
            className={cn(
              "flex h-6 items-center gap-0.5 rounded-md px-1 text-[11px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-popup-open:bg-muted data-popup-open:text-foreground",
              className,
            )}
          />
        }
      >
        {current}
        <ChevronDown className="size-3 opacity-70" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-32">
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange(next as T)}>
          {options.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
    <section className="border-b border-border last:border-b-0">
      <div className="group/section flex h-9 items-center justify-between pl-3 pr-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="-ml-1 flex min-w-0 items-center gap-1 rounded py-1 pl-1 pr-1 text-foreground"
          aria-expanded={open}
        >
          <span className="truncate text-[11px] font-semibold tracking-tight">{title}</span>
          <ChevronRight
            className={cn(
              "size-3 shrink-0 text-muted-foreground opacity-0 transition-[transform,opacity] group-hover/section:opacity-100",
              open && "rotate-90",
              !open && "opacity-60",
            )}
          />
        </button>
        {action && <div className="flex shrink-0 items-center gap-0.5">{action}</div>}
      </div>
      {open && <div className="space-y-2 px-3 pb-3">{children}</div>}
    </section>
  );
}

export interface KeyframeToggleProps {
  active: boolean;
  animated?: boolean;
  removeAnimation?: () => void;
  removeAnimationLabel?: string;
  removeKeyframe?: () => void;
  removeKeyframeLabel?: string;
  onClick: () => void;
  label: string;
}

/**
 * Every row ends in the same column, so fields never shift. The phone layout
 * (narrow viewport) shows only the diamond, with options on long-press; the
 * desktop layout also shows a ⋯ beside it.
 */
const KEYFRAME_SLOT = "flex w-12 shrink-0 items-center in-[.mobile-workspace]:w-6";

/** Holds a row's place when it has no keyframe control, keeping columns aligned. */
export function KeyframeSlot() {
  return <span className={KEYFRAME_SLOT} aria-hidden />;
}

/**
 * Tap the diamond to toggle a key at the playhead. On an animated property,
 * removal lives in a menu: ⋯ on desktop, long-press or right-click anywhere.
 */
export function KeyframeToggle({
  keyframe,
  className,
}: {
  keyframe: KeyframeToggleProps;
  className?: string;
}) {
  const diamond = (
    <button
      type="button"
      onClick={keyframe.onClick}
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-md transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
      aria-label={keyframe.label}
      aria-pressed={keyframe.active}
      title={keyframe.label}
    >
      <span
        className={cn(
          "size-[7px] rotate-45 rounded-[1px] border transition-colors",
          keyframe.active
            ? "border-primary bg-primary"
            : "border-muted-foreground/50 group-hover:border-muted-foreground",
        )}
      />
    </button>
  );
  if (!keyframe.removeAnimation) return <span className={KEYFRAME_SLOT}>{diamond}</span>;
  const items = (
    <>
      {keyframe.removeKeyframe && (
        <DropdownMenuItem onClick={keyframe.removeKeyframe}>
          {keyframe.removeKeyframeLabel}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem variant="destructive" onClick={keyframe.removeAnimation}>
        {keyframe.removeAnimationLabel}
      </DropdownMenuItem>
    </>
  );
  return (
    <span className={KEYFRAME_SLOT}>
      <ContextMenu>
        <ContextMenuTrigger render={<span className="flex" />}>{diamond}</ContextMenuTrigger>
        <ContextMenuContent className="min-w-44">{items}</ContextMenuContent>
      </ContextMenu>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label={`${keyframe.removeAnimationLabel?.replace("Remove ", "")} options`}
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-popup-open:bg-muted in-[.mobile-workspace]:hidden"
            />
          }
        >
          <Ellipsis className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          {items}
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

export function Row({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
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
  glyph,
  reserveKeyframeSlot = false,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
  mixed?: boolean;
  keyframe?: KeyframeToggleProps;
  compact?: boolean;
  /** Visible label for compact fields when it differs from the accessible label. */
  glyph?: React.ReactNode;
  /** Keep the ◇ column so non-animatable fields align with animatable neighbours. */
  reserveKeyframeSlot?: boolean;
}) {
  const scrub = React.useRef<{
    startX: number;
    startY: number;
    startVal: number;
    /** Touch scrubs wait for a sideways drag so the panel can still scroll. */
    active: boolean;
  } | null>(null);
  // While the field is focused we keep the raw keystrokes so typing "2." or a
  // trailing zero isn't reformatted mid-edit. Display always uses a "." decimal
  // separator (an <input type=number> would otherwise render the OS locale's
  // comma, e.g. "2,4" on pt-BR), and we accept both "." and "," on commit.
  const [draft, setDraft] = React.useState<string | null>(null);
  const draftRef = React.useRef<string | null>(null);
  const display = draft ?? (mixed ? "" : Number.isFinite(value) ? String(value) : "0");

  const clamp = (n: number, quantize = true) => {
    let next = n;
    if (quantize && step) next = Number((Math.round(next / step) * step).toFixed(10));
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    return next;
  };

  const inputProps = {
    onFocus: (event: React.FocusEvent<HTMLInputElement>) => {
      const next = mixed ? "" : Number.isFinite(value) ? String(value) : "0";
      draftRef.current = next;
      setDraft(next);
      event.currentTarget.select();
    },
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      draftRef.current = event.target.value;
      setDraft(event.target.value);
    },
    onBlur: () => {
      const raw = draftRef.current?.trim();
      draftRef.current = null;
      setDraft(null);
      if (!raw) return;
      // A draft can be incomplete ("-", "2.") while typing. Only a finite
      // decimal is committed, and the scrub step never rounds typed precision.
      const normalized = raw.replace(",", ".");
      if (!/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) return;
      const number = Number(normalized);
      if (!Number.isFinite(number)) return;
      const next = clamp(number, false);
      if (mixed || next !== value) onChange(next);
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.key === "Escape") {
        draftRef.current = null;
        setDraft(null);
      }
      event.currentTarget.blur();
    },
  };

  const activate = (e: React.PointerEvent) => {
    const session = scrub.current;
    if (!session || session.active) return;
    session.active = true;
    // Scrubbing takes over from the text draft so the visible number follows
    // each adjustment instead of remaining frozen at the last focused value.
    draftRef.current = null;
    setDraft(null);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {}
    useEditorStore.getState().beginHistoryGesture();
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (!e.isPrimary || e.button !== 0) return;
    scrub.current = { startX: e.clientX, startY: e.clientY, startVal: value, active: false };
    if (e.pointerType === "touch") return;
    e.preventDefault();
    activate(e);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const session = scrub.current;
    if (!session) return;
    if (!session.active) {
      const intent = horizontalIntent(
        { x: session.startX, y: session.startY },
        { x: e.clientX, y: e.clientY },
      );
      if (intent === "scroll") scrub.current = null;
      if (intent !== "drag") return;
      // Measure from here so the slop does not register as a jump.
      session.startX = e.clientX;
      activate(e);
    }
    const dx = e.clientX - session.startX;
    onChange(clamp(session.startVal + dx * (step || 1) * 0.5));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const session = scrub.current;
    scrub.current = null;
    if (!session?.active) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    useEditorStore.getState().endHistoryGesture();
  };
  React.useEffect(
    () => () => {
      if (scrub.current?.active) useEditorStore.getState().endHistoryGesture();
    },
    [],
  );

  const scrubHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
    onLostPointerCapture: onPointerUp,
    onKeyDown: (event: React.KeyboardEvent) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowDown", "ArrowUp"].includes(event.key)) return;
      event.preventDefault();
      const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
      onChange(clamp(value + direction * (step || 1) * (event.shiftKey ? 10 : 1)));
    },
  };

  if (compact) {
    return (
      <div className="group flex min-w-0 items-center gap-0.5">
        <div className="relative min-w-0 flex-1">
          <span
            role="slider"
            aria-label={label}
            aria-valuenow={value}
            aria-valuetext={mixed ? "Mixed values" : undefined}
            tabIndex={0}
            className="absolute inset-y-0 left-0 z-10 flex w-6 cursor-ew-resize touch-pan-y select-none items-center justify-center text-[10px] text-muted-foreground hover:text-foreground"
            title={`${label} · drag to adjust`}
            {...scrubHandlers}
          >
            {glyph ?? label}
          </span>
          <input
            type="text"
            inputMode="decimal"
            aria-label={label}
            value={display}
            placeholder={mixed ? "Mixed" : undefined}
            {...inputProps}
            className={cn(fieldBase, "pl-6 tabular-nums", suffix ? "pr-6" : "pr-2")}
          />
          {suffix && (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/70">
              {suffix}
            </span>
          )}
        </div>
        {keyframe ? (
          <KeyframeToggle keyframe={keyframe} />
        ) : (
          reserveKeyframeSlot && <KeyframeSlot />
        )}
      </div>
    );
  }

  return (
    <div className="group grid grid-cols-[64px_minmax(0,1fr)] items-center gap-2">
      <span
        role="slider"
        aria-label={label}
        aria-valuenow={value}
        aria-valuetext={mixed ? "Mixed values" : undefined}
        tabIndex={0}
        className="w-fit cursor-ew-resize touch-pan-y select-none truncate text-[11px] text-muted-foreground hover:text-foreground"
        title="Drag to adjust"
        {...scrubHandlers}
      >
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-0.5">
        <div className="relative min-w-0 flex-1">
          <input
            type="text"
            inputMode="decimal"
            aria-label={label}
            value={display}
            placeholder={mixed ? "Mixed" : undefined}
            {...inputProps}
            className={cn(fieldBase, "tabular-nums", suffix ? "pr-6" : "pr-2")}
          />
          {suffix && (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground/70">
              {suffix}
            </span>
          )}
        </div>
        {keyframe && <KeyframeToggle keyframe={keyframe} />}
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
    <div className="flex h-7 items-center rounded-md bg-secondary p-0.5">
      {options.map((o) => (
        <Button
          key={o.value}
          type="button"
          size="xs"
          variant="ghost"
          onClick={() => onChange(o.value)}
          className={cn(
            "h-6 flex-1 rounded-[5px] px-1 text-[11px] capitalize",
            !mixed && value === o.value
              ? "bg-background font-medium text-foreground shadow-xs hover:bg-background dark:bg-accent dark:hover:bg-accent"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}

"use client";

import React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** A committed field keeps partial numbers/colors out of the animation model. */
export function MotionField({
  label,
  ariaLabel,
  value,
  suffix,
  color = false,
  multiline = false,
  validate,
  onCommit,
  onPreview,
  fieldRef,
  onCancel,
  disabled = false,
}: {
  label: string;
  ariaLabel: string;
  value: string | number;
  suffix?: string;
  color?: boolean;
  multiline?: boolean;
  validate: (raw: string) => string | null;
  onCommit: (raw: string) => void;
  onPreview?: () => void;
  fieldRef?: (element: HTMLInputElement | HTMLTextAreaElement | null) => void;
  onCancel?: () => void;
  disabled?: boolean;
}) {
  const id = React.useId();
  const [draft, setDraft] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const draftRef = React.useRef<string | null>(null);
  const cancelBlur = React.useRef(false);
  const Field = multiline ? "textarea" : "input";

  const commit = () => {
    const raw = draftRef.current;
    if (raw === null) return true;
    if (raw === String(value)) {
      draftRef.current = null;
      setDraft(null);
      return true;
    }
    const message = validate(raw);
    setError(message);
    if (message) return false;
    onCommit(raw);
    draftRef.current = null;
    setDraft(null);
    return true;
  };

  return (
    <div className="min-w-0 space-y-1">
      <div className="flex items-center justify-between gap-1">
        <label htmlFor={id} className="text-[10px] text-muted-foreground">
          {label}
        </label>
        {onPreview && (
          <button
            type="button"
            onClick={onPreview}
            aria-label={`Preview ${ariaLabel}`}
            title={`Preview ${label.toLowerCase()} keyframe`}
            className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ChevronRight className="size-3" />
          </button>
        )}
      </div>
      <div className="relative">
        {color && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 rounded-sm border border-border"
            style={{ backgroundColor: String(value) }}
          />
        )}
        <Field
          ref={fieldRef}
          disabled={disabled}
          id={id}
          type={multiline ? undefined : "text"}
          inputMode={color || multiline ? "text" : "decimal"}
          aria-label={ariaLabel}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
          value={draft ?? String(value)}
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            draftRef.current = String(value);
            setDraft(String(value));
          }}
          onChange={(event) => {
            draftRef.current = event.target.value;
            setDraft(event.target.value);
            if (error) setError(validate(event.target.value));
          }}
          onBlur={() => {
            if (cancelBlur.current) cancelBlur.current = false;
            else commit();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              if (commit()) event.currentTarget.blur();
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              cancelBlur.current = true;
              draftRef.current = null;
              setDraft(null);
              setError(null);
              event.currentTarget.blur();
              onCancel?.();
            }
          }}
          className={cn(
            "h-8 w-full rounded-[4px] border border-transparent bg-muted/65 px-2 font-mono text-xs tabular-nums text-foreground outline-none hover:bg-muted focus:border-primary/70 focus:bg-background focus:ring-1 focus:ring-primary/25 disabled:opacity-50",
            color && "pl-7",
            multiline && "h-16 resize-y py-1.5 text-[10px] leading-relaxed",
            suffix && "pr-7",
            error && "border-destructive",
          )}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-muted-foreground">
            {suffix}
          </span>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[10px] leading-relaxed text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export const numericValue = (raw: string) => Number(raw.trim().replace(",", "."));
export const validNumber = (raw: string) =>
  raw.trim() && Number.isFinite(numericValue(raw)) ? null : "Enter a number.";

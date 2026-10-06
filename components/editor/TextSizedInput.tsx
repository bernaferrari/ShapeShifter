"use client";

import React from "react";
import { cn } from "@/lib/utils";

/** iOS zooms into any field under 16px on focus, so fields always type at 16px. */
const TYPING_FONT = 16;

/**
 * An inline editor that looks exactly like the text it replaces (Figma's
 * rename fields): same size, same baseline, a thin outline. It types at 16px
 * and is drawn scaled to `fontSize`, so phones never zoom on focus.
 *
 * `fit="content"` hugs the text and grows while typing (canvas titles);
 * `fit="fill"` takes the remaining row width (layer lists).
 */
export function TextSizedInput({
  fontSize,
  lineHeight,
  fit = "content",
  className,
  value,
  style,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value"> & {
  value: string;
  fontSize: number;
  lineHeight: number;
  fit?: "content" | "fill";
}) {
  const scale = fontSize / TYPING_FONT;
  const inset = 2;
  return (
    <span
      className={cn("relative flex min-w-0 shrink-0", fit === "fill" && "flex-1", className)}
      style={{ height: lineHeight, fontSize, lineHeight: `${lineHeight}px` }}
    >
      {fit === "content" && (
        // Sizes the field like the text it replaces.
        <span aria-hidden className="invisible whitespace-pre" style={{ paddingInline: inset }}>
          {value || " "}
        </span>
      )}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[3px] bg-background outline outline-1 outline-primary"
      />
      <input
        {...props}
        value={value}
        spellCheck={false}
        className="absolute top-0 origin-top-left border-0 bg-transparent p-0 text-foreground outline-none selection:bg-primary/45 selection:text-foreground"
        style={{
          ...style,
          left: inset,
          // Inline values beat the phone-wide 16px input rule and any min-height.
          fontSize: TYPING_FONT,
          fontWeight: "inherit",
          minHeight: 0,
          height: lineHeight / scale,
          lineHeight: `${lineHeight / scale}px`,
          width: `calc((100% - ${inset}px) / ${scale})`,
          transform: `scale(${scale})`,
        }}
      />
    </span>
  );
}

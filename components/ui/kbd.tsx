import * as React from "react";
import { cn } from "@/lib/utils";

const MODIFIERS = new Set(["⌘", "⇧", "⌥", "⌃"]);

export function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] border border-border bg-background px-1 font-sans text-[11px] font-medium leading-none text-muted-foreground shadow-[0_1px_0_var(--border)]",
        className,
      )}
      {...props}
    />
  );
}

/** Splits a combo such as "⇧⌘Z" or "A / D" into individual key caps. */
function capsFor(combo: string): string[] {
  const trimmed = combo.trim();
  if (trimmed.includes("+") && trimmed.length > 1)
    return trimmed
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean);
  const caps: string[] = [];
  let rest = trimmed;
  while (rest.length > 1 && MODIFIERS.has(rest[0]!)) {
    caps.push(rest[0]!);
    rest = rest.slice(1);
  }
  if (rest) caps.push(rest);
  return caps;
}

export function KeyCombo({ keys, className }: { keys: string; className?: string }) {
  const alternatives = keys.split(" / ");
  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      {alternatives.map((alternative, index) => (
        <React.Fragment key={`${alternative}-${index}`}>
          {index > 0 && <span className="text-[11px] text-muted-foreground/60">or</span>}
          <span className="inline-flex items-center gap-0.5">
            {capsFor(alternative).map((cap, capIndex) => (
              <Kbd key={`${cap}-${capIndex}`}>{cap}</Kbd>
            ))}
          </span>
        </React.Fragment>
      ))}
    </span>
  );
}

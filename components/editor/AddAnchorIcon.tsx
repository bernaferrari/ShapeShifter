import React from "react";
import { cn } from "@/lib/utils";

/**
 * Illustrator's Add Anchor Point glyph: a pen nib with a plus. Scissors would
 * read as "cut path" to anyone coming from Illustrator.
 */
export function AddAnchorIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("lucide", className)}
    >
      <path d="M13 3 4 12l-1.5 7.5L10 18l9-9" />
      <path d="M11.5 12.5 2.5 19.5" />
      <circle cx="12.5" cy="11.5" r="1.5" />
      <path d="M19 15v6M16 18h6" />
    </svg>
  );
}

"use client";

import React from "react";
import { Spline, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { EasingPanel } from "../inspector/EasingPanel";
import type { TimelineBlock } from "@/lib/shapeshifter/types";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import { useEditorStore } from "@/lib/store/editorStore";

export function TimelineSegmentEasing({
  block,
  startPct,
  endPct,
}: {
  block: TimelineBlock;
  startPct: number;
  endPct: number;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <div
      className="pointer-events-none absolute top-1/2 z-[3] @container/easing"
      style={{
        left: `${startPct}%`,
        width: `${Math.max(0, endPct - startPct)}%`,
      }}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={`Edit ${propertyLabel(block.propertyName)} easing`}
              className="pointer-events-auto absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 hidden @min-[60px]/easing:grid pointer-coarse:@max-[87px]/easing:hidden size-5 pointer-coarse:size-11 place-items-center rounded-md text-primary opacity-0 outline-none hover:bg-muted focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-foreground group-hover/segment:opacity-100 pointer-coarse:opacity-100"
              onPointerDown={(event) => {
                if (event.pointerType !== "touch") event.stopPropagation();
              }}
              onClick={(event) => {
                event.stopPropagation();
                useEditorStore.getState().selectBlocks([block.id]);
              }}
            />
          }
        >
          <Spline className="size-3.5" />
        </PopoverTrigger>
        <PopoverContent
          side="top"
          initialFocus={false}
          className="w-72 max-w-[calc(100vw-16px)] p-3"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="flex items-center">
            <PopoverTitle className="flex-1">Easing</PopoverTitle>
            <button
              type="button"
              aria-label="Close easing editor"
              className="grid size-6 pointer-coarse:size-11 place-items-center rounded-md hover:bg-muted"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </button>
          </div>
          <EasingPanel block={block} inline onBack={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}

"use client";

import { ChevronRight, Frame } from "lucide-react";
import type { DragEvent } from "react";
import { cn } from "@/lib/utils";

export function LayerOwnerRow({
  name,
  dimensions,
  expanded,
  selected,
  dropActive,
  selectable,
  onToggle,
  onSelect,
  onDragOver,
  onDrop,
}: {
  name: string;
  dimensions?: string;
  expanded: boolean;
  selected: boolean;
  dropActive: boolean;
  selectable: boolean;
  onToggle: () => void;
  onSelect: (additive: boolean) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="treeitem"
      aria-level={1}
      aria-expanded={expanded}
      aria-selected={selected}
      className={cn(
        "group flex h-8 items-center px-1.5 transition-[background-color,box-shadow] duration-150",
        selected && "bg-primary/14 text-foreground",
        dropActive && "bg-primary/10 ring-1 ring-inset ring-primary",
      )}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted"
        onClick={onToggle}
        aria-label={expanded ? `Collapse ${name}` : `Expand ${name}`}
      >
        <ChevronRight
          className={cn("size-3 transition-transform duration-100", expanded && "rotate-90")}
        />
      </button>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 px-1 text-left text-[11px] font-medium disabled:cursor-default"
        onClick={(event) => selectable && onSelect(event.shiftKey)}
        aria-pressed={selectable ? selected : undefined}
        title={dimensions || undefined}
        disabled={!selectable}
      >
        <Frame className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{name}</span>
      </button>
    </div>
  );
}

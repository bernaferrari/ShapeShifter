"use client";

import React from "react";
import type { PathData, Selection } from "@/lib/shapeshifter/types";
import { getCommandDescription } from "@/lib/shapeshifter/pathUtils";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * Beautiful, calm, human-readable path command list.
 * 
 * Directly addresses the user's reference image vision (wys / 3o7):
 * - Scannable rows with type badge, short coords (mono), and friendly verb label.
 * - Live selection sync (highlights commands containing selected points).
 * - Click a row to select its anchor point on the canvas.
 * 
 * Uses only existing pro patterns:
 * - InspectorSection typography scale + muted headers
 * - LayerTimeline selectable row language (primary/10 bg, hover-muted, rounded-sm, mono data)
 * - Compact Badge for command type (like "anim" badges in Inspector)
 * 
 * Designed to live inside the existing Inspector "Path" section.
 * Zero new dependencies, tiny DOM, re-renders with the rest of the inspector.
 */

interface PathCommandsListProps {
  pathData?: PathData;
  selectedPoints?: Selection[];
  onSelectCommand?: (subPathIndex: number, commandIndex: number) => void;
  className?: string;
}

export function PathCommandsList({
  pathData,
  selectedPoints = [],
  onSelectCommand,
  className,
}: PathCommandsListProps) {
  if (!pathData?.subPaths?.length) {
    return (
      <div className={cn("px-4 py-2 text-[10px] text-muted-foreground", className)}>
        No path commands
      </div>
    );
  }

  const isCommandSelected = (subPathIndex: number, commandIndex: number) =>
    selectedPoints.some(
      (s) => s.subPathIndex === subPathIndex && s.commandIndex === commandIndex
    );

  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto text-[10px]", className)}>
      {pathData.subPaths.map((subPath, subPathIndex) => (
        <div key={`sp-${subPathIndex}`} className="mb-1 last:mb-0">
          {pathData.subPaths.length > 1 && (
            <div className="px-4 pb-0.5 pt-1 text-[9px] uppercase tracking-widest text-muted-foreground/60">
              Subpath {subPathIndex + 1}
            </div>
          )}

          <div className="space-y-px">
            {subPath.commands.map((cmd, commandIndex) => {
              const { label, shortCoords } = getCommandDescription(cmd);
              const selected = isCommandSelected(subPathIndex, commandIndex);
              const isClose = cmd.type === "Z";

              return (
                <button
                  key={cmd.id || `${subPathIndex}-${commandIndex}`}
                  type="button"
                  onClick={() => onSelectCommand?.(subPathIndex, commandIndex)}
                  className={cn(
                    "group flex w-full items-center gap-2 rounded-sm px-2.5 py-1 text-left transition-all",
                    "hover:bg-muted/70 active:bg-muted/50",
                    selected
                      ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30"
                      : "text-foreground hover:text-foreground"
                  )}
                  aria-pressed={selected}
                >
                  {/* Command type badge — calm, reference-inspired */}
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-4 shrink-0 rounded-sm border-0 px-1 font-mono text-[9px] tracking-[0.5px]",
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground group-hover:bg-muted/80"
                    )}
                  >
                    {cmd.type}
                  </Badge>

                  {/* Coords + human label — the heart of the beautiful surface */}
                  <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
                    {!isClose && shortCoords && (
                      <span
                        className={cn(
                          "shrink-0 font-mono text-[10px] tabular-nums tracking-tight",
                          selected ? "text-primary" : "text-foreground/90"
                        )}
                      >
                        {shortCoords}
                      </span>
                    )}
                    <span
                      className={cn(
                        "truncate text-[10px]",
                        selected ? "font-medium text-primary" : "text-muted-foreground"
                      )}
                    >
                      {label}
                    </span>
                  </div>

                  {/* Subtle index for power users (like reference alignment) */}
                  <span className="shrink-0 font-mono text-[8px] text-muted-foreground/50 tabular-nums">
                    {commandIndex}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

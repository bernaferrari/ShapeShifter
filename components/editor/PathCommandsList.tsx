"use client";

import React from "react";
import type { CommandType, PathData, Selection } from "@/lib/shapeshifter/types";
import { changeCommandType, getCommandDescription, updateCommandPoint } from "@/lib/shapeshifter/pathUtils";
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
  /** Called when a point inside a command should be mutated (for live two-way editing) */
  onUpdateCommandPoint?: (
    subPathIndex: number,
    commandIndex: number,
    pointIndex: number,
    newPoint: { x: number; y: number },
  ) => void;
  /** Called when the user wants to change the type of a command */
  onChangeCommandType?: (subPathIndex: number, commandIndex: number, newType: CommandType) => void;
  className?: string;
}

export function PathCommandsList({
  pathData,
  selectedPoints = [],
  onSelectCommand,
  onUpdateCommandPoint,
  onChangeCommandType,
  className,
}: PathCommandsListProps) {
  const [editing, setEditing] = React.useState<null | {
    subPathIndex: number;
    commandIndex: number;
    pointIndex: number;
    coord: "x" | "y";
    value: number;
  }>(null);

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

  const commitEdit = () => {
    if (!editing || !onUpdateCommandPoint) {
      setEditing(null);
      return;
    }
    const { subPathIndex, commandIndex, pointIndex, coord, value } = editing;
    const cmd = pathData.subPaths[subPathIndex]?.commands[commandIndex];
    if (!cmd) {
      setEditing(null);
      return;
    }
    const currentPt = cmd.points[pointIndex] || { x: 0, y: 0 };
    const nextPt =
      coord === "x"
        ? { x: value, y: currentPt.y }
        : { x: currentPt.x, y: value };

    onUpdateCommandPoint(subPathIndex, commandIndex, pointIndex, nextPt);
    setEditing(null);
  };

  const cycleType = (subPathIndex: number, commandIndex: number) => {
    if (!onChangeCommandType) return;
    const cmd = pathData.subPaths[subPathIndex]?.commands[commandIndex];
    if (!cmd) return;

    const order: CommandType[] = ["M", "L", "C", "Q", "H", "V", "Z"];
    const currentIdx = order.indexOf(cmd.type as CommandType);
    const nextType = order[(currentIdx + 1) % order.length];

    onChangeCommandType(subPathIndex, commandIndex, nextType);
  };

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
                  {/* Command type badge — now clickable to cycle type (editable surface) */}
                  <Badge
                    variant="outline"
                    className={cn(
                      "h-4 shrink-0 rounded-sm border-0 px-1 font-mono text-[9px] tracking-[0.5px] cursor-pointer active:scale-95 transition-transform",
                      selected
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground group-hover:bg-muted/80"
                    )}
                    onClick={(e) => {
                      e.stopPropagation();
                      cycleType(subPathIndex, commandIndex);
                    }}
                    title="Click to cycle command type"
                  >
                    {cmd.type}
                  </Badge>

                  {/* Coords + human label — heart of the beautiful surface. Now editable. */}
                  <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
                    {!isClose && cmd.points.length > 0 && (
                      <span
                        className={cn(
                          "shrink-0 font-mono text-[10px] tabular-nums tracking-tight cursor-text hover:underline decoration-dotted",
                          selected ? "text-primary" : "text-foreground/90"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          // Edit the last (endpoint) point — most common and useful action
                          const ptIdx = cmd.points.length - 1;
                          const pt = cmd.points[ptIdx];
                          // Start editing X by default
                          setEditing({
                            subPathIndex,
                            commandIndex,
                            pointIndex: ptIdx,
                            coord: "x",
                            value: pt.x,
                          });
                        }}
                        title="Click to edit endpoint X/Y"
                      >
                        {shortCoords || "—"}
                      </span>
                    )}

                    {/* Inline editor when this specific value is being edited */}
                    {editing &&
                      editing.subPathIndex === subPathIndex &&
                      editing.commandIndex === commandIndex && (
                        <input
                          autoFocus
                          type="number"
                          step="0.5"
                          value={editing.value}
                          onChange={(e) => {
                            const v = parseFloat(e.target.value);
                            if (!Number.isNaN(v)) {
                              setEditing({ ...editing, value: v });
                            }
                          }}
                          onBlur={commitEdit}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitEdit();
                            if (e.key === "Escape") setEditing(null);
                            if (e.key === "ArrowUp") {
                              e.preventDefault();
                              setEditing({ ...editing, value: editing.value + (e.shiftKey ? 5 : 0.5) });
                            }
                            if (e.key === "ArrowDown") {
                              e.preventDefault();
                              setEditing({ ...editing, value: editing.value - (e.shiftKey ? 5 : 0.5) });
                            }
                          }}
                          className="w-20 rounded-sm bg-background px-1 py-0.5 font-mono text-[10px] ring-1 ring-primary"
                        />
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

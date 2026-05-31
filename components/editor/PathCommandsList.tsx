"use client";

import React from "react";
import type { CommandType, PathData, Selection } from "@/lib/shapeshifter/types";
import { getCommandDescription } from "@/lib/shapeshifter/pathUtils";
import { cn } from "@/lib/utils";

interface PathCommandsListProps {
  pathData?: PathData;
  selectedPoints?: Selection[];
  onSelectCommand?: (subPathIndex: number, commandIndex: number, pointIndex: number) => void;
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

function pointRole(cmdType: CommandType, pointIndex: number, pointCount: number) {
  if (pointCount <= 1) return cmdType === "M" ? "start" : "end";
  if (pointIndex === pointCount - 1) return "end";
  if (cmdType === "C") return pointIndex === 0 ? "ctrl 1" : "ctrl 2";
  if (cmdType === "Q" || cmdType === "S") return "ctrl";
  return "pt";
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)).toString() : "0";
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
    selectedPoints.some((s) => s.subPathIndex === subPathIndex && s.commandIndex === commandIndex);

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
    const nextPt = coord === "x" ? { x: value, y: currentPt.y } : { x: currentPt.x, y: value };

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
      <div className="sticky top-0 z-10 grid grid-cols-[2rem_minmax(4rem,1fr)_3.25rem_3.25rem_1.5rem] gap-1 border-b bg-card/95 px-2.5 py-1 font-mono text-[8px] uppercase tracking-wider text-muted-foreground/70 backdrop-blur">
        <span>Cmd</span>
        <span>Point</span>
        <span className="text-right">X</span>
        <span className="text-right">Y</span>
        <span className="text-right">#</span>
      </div>
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
              const anchorPointIndex = Math.max(0, cmd.points.length - 1);
              const points = isClose ? [{ x: 0, y: 0 }] : cmd.points;

              return (
                <div
                  key={cmd.id || `${subPathIndex}-${commandIndex}`}
                  className={cn(
                    "group rounded-sm px-2.5 py-1 text-left transition-[background-color,color,box-shadow]",
                    "hover:bg-muted/70",
                    selected
                      ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30"
                      : "text-foreground hover:text-foreground",
                  )}
                >
                  {points.map((point, pointIndex) => {
                    const editable = !isClose && cmd.points.length > 0;
                    const logicalPointIndex = editable ? pointIndex : anchorPointIndex;
                    const pointSelected = selectedPoints.some(
                      (selection) =>
                        selection.subPathIndex === subPathIndex &&
                        selection.commandIndex === commandIndex &&
                        selection.pointIndex === logicalPointIndex,
                    );
                    const role = isClose
                      ? "close"
                      : pointRole(cmd.type as CommandType, pointIndex, points.length);

                    return (
                      <div
                        key={`${cmd.id || commandIndex}-${pointIndex}`}
                        className={cn(
                          "grid grid-cols-[2rem_minmax(4rem,1fr)_3.25rem_3.25rem_1.5rem] items-center gap-1",
                          pointIndex > 0 && "mt-1 border-t border-border/40 pt-1",
                        )}
                      >
                        {pointIndex === 0 ? (
                          <button
                            type="button"
                            className={cn(
                              "inline-flex h-5 w-fit items-center justify-center rounded-sm border-0 px-1 font-mono text-[9px] tracking-[0.5px] transition-transform active:scale-95",
                              selected
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground group-hover:bg-muted/80",
                            )}
                            onClick={(event) => {
                              event.stopPropagation();
                              cycleType(subPathIndex, commandIndex);
                            }}
                            title="Click to cycle command type"
                          >
                            {cmd.type}
                          </button>
                        ) : (
                          <span />
                        )}

                        <button
                          type="button"
                          className={cn(
                            "min-w-0 truncate rounded-sm px-1 py-0.5 text-left text-[10px]",
                            pointSelected
                              ? "bg-primary/15 font-medium text-primary"
                              : "text-muted-foreground hover:bg-muted",
                          )}
                          onClick={(event) => {
                            event.stopPropagation();
                            if (editable) {
                              onSelectCommand?.(subPathIndex, commandIndex, logicalPointIndex);
                            }
                          }}
                        >
                          <span className="mr-1 font-mono uppercase tracking-wide">{role}</span>
                          {pointIndex === 0 && (
                            <span className="text-muted-foreground/70">{label}</span>
                          )}
                        </button>

                        {(["x", "y"] as const).map((coord) => {
                          const isEditing =
                            editing?.subPathIndex === subPathIndex &&
                            editing.commandIndex === commandIndex &&
                            editing.pointIndex === logicalPointIndex &&
                            editing.coord === coord;

                          if (!editable) {
                            return (
                              <span
                                key={coord}
                                className="font-mono text-[10px] text-right text-muted-foreground/50"
                              >
                                -
                              </span>
                            );
                          }

                          return isEditing ? (
                            <input
                              key={coord}
                              autoFocus
                              type="number"
                              step="0.5"
                              value={editing.value}
                              onClick={(event) => event.stopPropagation()}
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
                                  setEditing({
                                    ...editing,
                                    value: editing.value + (e.shiftKey ? 5 : 0.5),
                                  });
                                }
                                if (e.key === "ArrowDown") {
                                  e.preventDefault();
                                  setEditing({
                                    ...editing,
                                    value: editing.value - (e.shiftKey ? 5 : 0.5),
                                  });
                                }
                              }}
                              className="h-6 w-full rounded-sm bg-background px-1 text-right font-mono text-[10px] ring-1 ring-primary"
                            />
                          ) : (
                            <button
                              key={coord}
                              type="button"
                              className="h-6 rounded-sm px-1 text-right font-mono text-[10px] tabular-nums text-foreground/90 hover:bg-background hover:ring-1 hover:ring-border"
                              onClick={(event) => {
                                event.stopPropagation();
                                setEditing({
                                  subPathIndex,
                                  commandIndex,
                                  pointIndex: logicalPointIndex,
                                  coord,
                                  value: point[coord],
                                });
                              }}
                            >
                              {formatNumber(point[coord])}
                            </button>
                          );
                        })}

                        <span className="text-right font-mono text-[8px] tabular-nums text-muted-foreground/50">
                          {pointIndex === 0 ? commandIndex : ""}
                        </span>
                      </div>
                    );
                  })}

                  {isClose && shortCoords && (
                    <span className="mt-1 block truncate pl-8 text-[9px] text-muted-foreground">
                      {shortCoords}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

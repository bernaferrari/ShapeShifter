"use client";

import React from "react";
import { Plus } from "lucide-react";
import type { CommandType, PathData, Selection } from "@/lib/shapeshifter/types";
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
  onAddPoint?: (subPathIndex: number, commandIndex: number) => void;
  className?: string;
}

const COMMAND_NAMES: Record<string, string> = {
  M: "Start",
  L: "Line",
  H: "Line",
  V: "Line",
  C: "Curve",
  S: "Curve",
  Q: "Curve",
  T: "Curve",
  A: "Arc",
  Z: "Close",
};

function pointRole(cmdType: CommandType, pointIndex: number, pointCount: number) {
  if (pointIndex === pointCount - 1) return null;
  if (cmdType === "C") return pointIndex === 0 ? "Handle 1" : "Handle 2";
  return "Handle";
}

function formatNumber(value: number) {
  return Number.isFinite(value) ? Number(value.toFixed(2)).toString() : "0";
}

/** A coordinate that always looks the same: plain text until hovered or focused. */
function CoordinateField({
  value,
  label,
  onCommit,
}: {
  value: number;
  label: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const cancelBlur = React.useRef(false);
  const commit = () => {
    if (cancelBlur.current) {
      cancelBlur.current = false;
      return;
    }
    if (draft == null) return;
    const next = Number(draft.replace(",", "."));
    setDraft(null);
    if (draft.trim() && Number.isFinite(next) && Math.abs(next) <= 1e7 && next !== value)
      onCommit(next);
  };
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={draft ?? formatNumber(value)}
      onClick={(event) => event.stopPropagation()}
      onFocus={(event) => {
        setDraft(formatNumber(value));
        event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancelBlur.current = true;
          setDraft(null);
          requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
        }
        if (event.key === "ArrowUp" || event.key === "ArrowDown") {
          event.preventDefault();
          const step = (event.shiftKey ? 10 : 1) * (event.key === "ArrowUp" ? 1 : -1);
          const next = Number(((Number(draft ?? value) || 0) + step).toFixed(4));
          setDraft(String(next));
          onCommit(next);
        }
      }}
      className="h-6 pointer-coarse:h-11 pointer-coarse:text-base w-full rounded-md border border-transparent bg-transparent px-1.5 text-right text-[11px] tabular-nums text-foreground outline-none hover:border-border focus:border-primary focus:bg-background"
    />
  );
}

export function PathCommandsList({
  pathData,
  selectedPoints = [],
  onSelectCommand,
  onUpdateCommandPoint,
  onChangeCommandType,
  onAddPoint,
  className,
}: PathCommandsListProps) {
  if (!pathData?.subPaths?.length) {
    return (
      <div className={cn("px-3 py-2 text-[11px] text-muted-foreground", className)}>
        This path is empty
      </div>
    );
  }

  const toggleCurve = (subPathIndex: number, commandIndex: number) => {
    const cmd = pathData.subPaths[subPathIndex]?.commands[commandIndex];
    if (!cmd || !onChangeCommandType) return;
    if (cmd.type === "L") onChangeCommandType(subPathIndex, commandIndex, "C");
    else if (cmd.type === "C") onChangeCommandType(subPathIndex, commandIndex, "L");
  };

  return (
    <div className={cn("min-h-0 flex-1 overflow-y-auto py-1 text-[11px]", className)}>
      {pathData.subPaths.map((subPath, subPathIndex) => {
        const pointCount = subPath.commands.filter((cmd) => cmd.points.length > 0).length;
        let longest = 1,
          longestLength = -1;
        subPath.commands.forEach((cmd, index) => {
          if (cmd.type === "M") return;
          const start = subPath.commands[index - 1]?.points.at(-1);
          const points = cmd.type === "Z" ? [subPath.commands[0]?.points[0]] : cmd.points;
          if (!start || !points.length || points.some((p) => !p)) return;
          let previous = start,
            length = 0;
          for (const point of points) {
            length += Math.hypot(point.x - previous.x, point.y - previous.y);
            previous = point;
          }
          if (length > longestLength) {
            longest = index;
            longestLength = length;
          }
        });
        const selected = selectedPoints.find((p) => p.subPathIndex === subPathIndex);
        return (
          <div key={`sp-${subPathIndex}`}>
            <div className="flex items-center justify-between gap-2 px-2 pb-1 pt-1 text-[10px] text-muted-foreground">
              <span>
                {pathData.subPaths.length > 1 ? `Shape ${subPathIndex + 1} · ` : ""}
                {pointCount} points
              </span>
              {onAddPoint && longestLength >= 0 && (
                <button
                  type="button"
                  aria-label={`Add point to shape ${subPathIndex + 1}`}
                  title="Add a point on the selected edge without changing its outline"
                  className="grid size-6 pointer-coarse:size-11 shrink-0 touch-manipulation place-items-center rounded-md hover:bg-muted hover:text-foreground"
                  onClick={() => onAddPoint(subPathIndex, selected?.commandIndex ?? longest)}
                >
                  <Plus className="size-3.5" />
                </button>
              )}
            </div>
            {subPath.commands.map((cmd, commandIndex) => {
              const isClose = cmd.type === "Z";
              const name = COMMAND_NAMES[cmd.type] ?? cmd.type;
              const canToggle = cmd.type === "L" || cmd.type === "C";
              if (isClose)
                return (
                  <div
                    key={cmd.id || `${subPathIndex}-${commandIndex}`}
                    className="px-2 py-1 text-[11px] text-muted-foreground"
                  >
                    Close
                  </div>
                );
              return cmd.points.map((point, pointIndex) => {
                const role = pointRole(cmd.type as CommandType, pointIndex, cmd.points.length);
                const selected = selectedPoints.some(
                  (selection) =>
                    selection.subPathIndex === subPathIndex &&
                    selection.commandIndex === commandIndex &&
                    selection.pointIndex === pointIndex,
                );
                const isAnchor = role == null;
                return (
                  <div
                    key={`${cmd.id || `${subPathIndex}-${commandIndex}`}-${cmd.type}-${pointIndex}`}
                    className={cn(
                      "grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-1 rounded-md px-1",
                      selected ? "bg-primary/10" : "hover:bg-muted/60",
                    )}
                    onClick={() => onSelectCommand?.(subPathIndex, commandIndex, pointIndex)}
                  >
                    <span
                      className={cn(
                        "flex min-w-0 items-center gap-1.5 truncate px-1",
                        isAnchor ? "text-foreground" : "pl-4 text-muted-foreground",
                        selected && "text-primary",
                      )}
                    >
                      {isAnchor ? (
                        canToggle && onChangeCommandType ? (
                          <button
                            type="button"
                            className="truncate rounded px-0.5 -ml-0.5 hover:bg-muted"
                            title={
                              cmd.type === "L"
                                ? "Make curve in every pose"
                                : "Make straight in every pose"
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleCurve(subPathIndex, commandIndex);
                            }}
                          >
                            {name}
                          </button>
                        ) : (
                          name
                        )
                      ) : (
                        role
                      )}
                    </span>
                    {(["x", "y"] as const).map((coord) => (
                      <CoordinateField
                        key={coord}
                        label={`${isAnchor ? name : role} ${coord.toUpperCase()}`}
                        value={point[coord]}
                        onCommit={(value) =>
                          onUpdateCommandPoint?.(
                            subPathIndex,
                            commandIndex,
                            pointIndex,
                            coord === "x" ? { x: value, y: point.y } : { x: point.x, y: value },
                          )
                        }
                      />
                    ))}
                  </div>
                );
              });
            })}
          </div>
        );
      })}
    </div>
  );
}

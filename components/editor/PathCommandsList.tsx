"use client";

import React from "react";
import { ArrowDownRight, ArrowUpLeft, Plus } from "lucide-react";
import type { CommandType, PathData, Selection } from "@/lib/pathshift/types";
import {
  pathAnchors,
  pointPresentation,
  edgePresentation,
  type PointAddress,
} from "@/lib/pathshift/path/pointPresentation";
import { usePathPointHighlight } from "./pathPointHighlight";
import { cn } from "@/lib/utils";

interface PathCommandsListProps {
  pathData?: PathData;
  ownerId: string;
  layerId: string | number;
  side: "from" | "to";
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
  ownerId,
  layerId,
  side,
}: PathCommandsListProps) {
  const highlight = usePathPointHighlight((state) => state.highlight);
  const show = usePathPointHighlight((state) => state.show);
  const clear = usePathPointHighlight((state) => state.clear);
  const listRef = React.useRef<HTMLDivElement>(null);
  const active =
    highlight &&
    highlight.ownerId === ownerId &&
    String(highlight.layerId) === String(layerId) &&
    highlight.side === side
      ? highlight
      : null;
  React.useEffect(() => () => clear("list"), [clear, ownerId, layerId, side]);
  React.useEffect(() => {
    if (!pathData || active?.source === "list") return;
    const address =
      active?.kind === "point"
        ? active.point
        : active?.kind === "edge"
          ? {
              subPathIndex: active.subPathIndex,
              commandIndex: active.commandIndex,
              pointIndex:
                pathData.subPaths[active.subPathIndex]?.commands[active.commandIndex]?.points
                  .length - 1,
            }
          : selectedPoints[0];
    if (!address) return;
    const anchor = pointPresentation(pathData, address)?.anchor;
    const list = listRef.current;
    const row =
      anchor && list?.querySelector(`[data-path-point="${anchor.subPathIndex}:${anchor.number}"]`);
    if (
      !list ||
      !row ||
      (list.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement)
    )
      return;
    // Scroll this list only: scrollIntoView also moves the canvas and mobile sheet.
    const bounds = list.getBoundingClientRect();
    const target = row.getBoundingClientRect();
    if (target.top < bounds.top + 20) list.scrollTop += target.top - bounds.top - 20;
    else if (target.bottom > bounds.bottom) list.scrollTop += target.bottom - bounds.bottom;
  }, [active, pathData, selectedPoints]);
  const preview = (point: PointAddress) =>
    show({ ownerId, layerId, side, source: "list", kind: "point", point });
  const select = (point: PointAddress) =>
    onSelectCommand?.(point.subPathIndex, point.commandIndex, point.pointIndex);
  if (!pathData?.subPaths?.length) {
    return (
      <div className={cn("px-3 py-2 text-[11px] text-muted-foreground", className)}>
        This path is empty
      </div>
    );
  }

  return (
    <div
      ref={listRef}
      aria-label="Path points"
      className={cn("min-h-0 flex-1 overflow-y-auto py-1 text-xs", className)}
      onPointerLeave={() => clear("list")}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) clear("list");
      }}
    >
      {pathData.subPaths.map((subPath, subPathIndex) => {
        const anchors = pathAnchors(pathData, subPathIndex);
        let longest = 1,
          longestLength = -1;
        subPath.commands.forEach((command, index) => {
          if (command.type === "M") return;
          const start = subPath.commands[index - 1]?.points.at(-1);
          const points = command.type === "Z" ? [subPath.commands[0]?.points[0]] : command.points;
          if (!start || !points.length || points.some((point) => !point)) return;
          let previous = start,
            length = 0;
          for (const point of points) {
            length += Math.hypot(point.x - previous.x, point.y - previous.y);
            previous = point;
          }
          if (length > longestLength) {
            longestLength = length;
            longest = index;
          }
        });
        const selected = selectedPoints.find((point) => point.subPathIndex === subPathIndex);
        // Morphing needs equal point counts, so compatible paths often stack extra
        // points on an existing one. Name the point each duplicate sits on.
        const overlaps = new Map<number, number>();
        anchors.forEach((anchor, index) => {
          const point = subPath.commands[anchor.commandIndex]?.points[anchor.pointIndex];
          if (!point) return;
          const twin = anchors.slice(0, index).find((other) => {
            const candidate = subPath.commands[other.commandIndex]?.points[other.pointIndex];
            return (
              candidate &&
              Math.abs(candidate.x - point.x) < 1e-6 &&
              Math.abs(candidate.y - point.y) < 1e-6
            );
          });
          if (twin) overlaps.set(anchor.number, twin.number);
        });
        const fields = (address: PointAddress, label: string) => {
          const point = subPath.commands[address.commandIndex]?.points[address.pointIndex];
          if (!point) return null;
          return (["x", "y"] as const).map((axis) => (
            <CoordinateField
              key={axis}
              label={`${pathData.subPaths.length > 1 ? `Shape ${subPathIndex + 1} ` : ""}${label} ${axis.toUpperCase()}`}
              value={point[axis]}
              onCommit={(value) =>
                onUpdateCommandPoint?.(
                  address.subPathIndex,
                  address.commandIndex,
                  address.pointIndex,
                  { ...point, [axis]: value },
                )
              }
            />
          ));
        };
        const hoveredAnchors =
          active?.kind === "edge" && active.subPathIndex === subPathIndex
            ? edgePresentation(pathData, subPathIndex, active.commandIndex)
            : null;
        const hoveredPoint =
          active?.kind === "point" && active.point.subPathIndex === subPathIndex
            ? pointPresentation(pathData, active.point)?.anchor
            : null;
        return (
          <div key={`shape-${subPathIndex}`}>
            <div className="sticky top-0 z-10 grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] items-center gap-1 bg-sidebar px-1 py-1 text-[11px] text-muted-foreground">
              <span className="truncate px-1">
                {pathData.subPaths.length > 1 ? `Shape ${subPathIndex + 1} · ` : ""}
                <span>{anchors.length} points</span>
                {subPath.commands.at(-1)?.type === "Z" ? " · Closed" : ""}
              </span>
              <span className="text-right pr-1.5" aria-hidden="true">
                X
              </span>
              <span className="text-right pr-1.5" aria-hidden="true">
                Y
              </span>
            </div>
            {anchors.map((anchor) => {
              const command = subPath.commands[anchor.commandIndex];
              const isSelected = selectedPoints.some(
                (point) =>
                  point.subPathIndex === subPathIndex &&
                  ((point.commandIndex === anchor.commandIndex &&
                    point.pointIndex === anchor.pointIndex) ||
                    anchor.controls.some(
                      (control) =>
                        control.commandIndex === point.commandIndex &&
                        control.pointIndex === point.pointIndex,
                    )),
              );
              const isHovered =
                hoveredPoint?.number === anchor.number ||
                hoveredAnchors?.start.number === anchor.number ||
                hoveredAnchors?.end.number === anchor.number;
              const edge = edgePresentation(pathData, subPathIndex, anchor.commandIndex);
              const curved = ["C", "Q", "S", "T"].includes(command.type);
              const canConvert = command.type === "L" || curved;
              const hover = (event: React.PointerEvent) => {
                if (
                  event.pointerType !== "touch" &&
                  !event.buttons &&
                  !(event.target as Element).closest("[data-path-edge-control]")
                )
                  preview(anchor);
              };
              return (
                <div
                  key={`${command.id}-${command.type}`}
                  data-path-point={`${subPathIndex}:${anchor.number}`}
                  data-hovered={isHovered || undefined}
                  className="scroll-m-2"
                >
                  <div
                    className={cn(
                      "grid grid-cols-[minmax(0,1fr)_1.75rem_3.5rem_3.5rem] pointer-coarse:grid-cols-[minmax(0,1fr)_2.75rem_3.5rem_3.5rem] items-center gap-1 rounded-md px-1",
                      isSelected ? "bg-primary/10" : isHovered ? "bg-muted" : "hover:bg-muted/50",
                    )}
                    onPointerMove={hover}
                    onPointerEnter={hover}
                    onFocus={() => preview(anchor)}
                  >
                    <button
                      type="button"
                      aria-label={`Select point ${anchor.number}${pathData.subPaths.length > 1 ? ` in shape ${subPathIndex + 1}` : ""}${overlaps.has(anchor.number) ? `, on top of point ${overlaps.get(anchor.number)}` : ""}`}
                      aria-pressed={isSelected}
                      onClick={() => select(anchor)}
                      className={cn(
                        "flex h-8 pointer-coarse:h-11 min-w-0 items-center gap-2 rounded px-1 text-left touch-manipulation focus-visible:outline-2 focus-visible:outline-ring",
                        isSelected && "text-primary",
                      )}
                    >
                      {overlaps.has(anchor.number) ? (
                        <span
                          className="relative size-2.5 shrink-0"
                          title={`Sits exactly on Point ${overlaps.get(anchor.number)}. Shapes that morph need the same number of points, so extra points can share a spot until another keyframe moves them apart.`}
                        >
                          <span className="absolute top-0 left-0 size-2 rounded-[1px] border border-current opacity-50" />
                          <span className="absolute right-0 bottom-0 size-2 rounded-[1px] border border-current bg-sidebar" />
                        </span>
                      ) : (
                        <span
                          className="size-2 shrink-0 border border-current rounded-[1px]"
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className={cn(
                          "truncate tabular-nums",
                          overlaps.has(anchor.number) && !isSelected && "text-muted-foreground",
                        )}
                      >
                        Point {anchor.number}
                      </span>
                    </button>
                    {canConvert && onChangeCommandType && edge ? (
                      <button
                        type="button"
                        data-path-edge-control="true"
                        onFocus={(event) => {
                          event.stopPropagation();
                          show({
                            ownerId,
                            layerId,
                            side,
                            source: "list",
                            kind: "edge",
                            subPathIndex,
                            commandIndex: anchor.commandIndex,
                          });
                        }}
                        aria-label={`Make edge ${edge.start.number}–${edge.end.number} ${curved ? "straight" : "curved"}`}
                        title={`Edge ${edge.start.number}–${edge.end.number}: ${curved ? "curved" : "straight"}. Click to make it ${curved ? "straight" : "curved"} in every keyframe.`}
                        aria-pressed={curved}
                        className="grid size-7 pointer-coarse:size-11 place-items-center rounded text-muted-foreground touch-manipulation hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={() =>
                          onChangeCommandType(subPathIndex, anchor.commandIndex, curved ? "L" : "C")
                        }
                        onPointerEnter={(event) => {
                          if (event.pointerType !== "touch" && !event.buttons)
                            show({
                              ownerId,
                              layerId,
                              side,
                              source: "list",
                              kind: "edge",
                              subPathIndex,
                              commandIndex: anchor.commandIndex,
                            });
                        }}
                      >
                        <EdgeGlyph curved={curved} />
                      </button>
                    ) : (
                      <span />
                    )}
                    {fields(anchor, `Point ${anchor.number}`)}
                  </div>
                  {(isSelected ||
                    (active?.source === "canvas" && hoveredPoint?.number === anchor.number)) &&
                    anchor.controls.length > 0 && (
                      <div className="ml-3 border-l border-border/70 pl-1 py-1">
                        {anchor.controls.map((control) => {
                          const controlSelected = selectedPoints.some(
                            (point) =>
                              point.subPathIndex === subPathIndex &&
                              point.commandIndex === control.commandIndex &&
                              point.pointIndex === control.pointIndex,
                          );
                          const controlHovered =
                            active?.kind === "point" &&
                            active.point.subPathIndex === subPathIndex &&
                            active.point.commandIndex === control.commandIndex &&
                            active.point.pointIndex === control.pointIndex;
                          return (
                            <div
                              key={`${control.commandIndex}:${control.pointIndex}`}
                              data-hovered={controlHovered || undefined}
                              className={cn(
                                "grid grid-cols-[minmax(0,1fr)_3.5rem_3.5rem] gap-1 items-center rounded-md px-1",
                                controlSelected
                                  ? "bg-primary/10"
                                  : controlHovered
                                    ? "bg-muted"
                                    : "hover:bg-muted/50",
                              )}
                              onPointerEnter={(event) => {
                                if (event.pointerType !== "touch" && !event.buttons)
                                  preview(control);
                              }}
                              onPointerMove={(event) => {
                                if (event.pointerType !== "touch" && !event.buttons)
                                  preview(control);
                              }}
                              onFocus={() => preview(control)}
                            >
                              <button
                                type="button"
                                aria-label={`Select point ${anchor.number} ${control.label.toLowerCase()}`}
                                aria-pressed={controlSelected}
                                title={`Curve control ${control.label === "Incoming" ? "coming into" : control.label === "Outgoing" ? "leaving" : "shared with the neighboring point of"} Point ${anchor.number}`}
                                className={cn(
                                  "flex h-8 pointer-coarse:h-11 items-center gap-1 text-left text-[11px] touch-manipulation focus-visible:outline-2 focus-visible:outline-ring",
                                  controlSelected ? "text-primary" : "text-muted-foreground",
                                )}
                                onClick={() => select(control)}
                              >
                                {control.label === "Incoming" ? (
                                  <ArrowUpLeft className="size-3 shrink-0" />
                                ) : (
                                  <ArrowDownRight className="size-3 shrink-0" />
                                )}
                                <span className="truncate">{control.label}</span>
                              </button>
                              {fields(
                                control,
                                `Point ${anchor.number} ${control.label.toLowerCase()}`,
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                </div>
              );
            })}
            {onAddPoint && longestLength >= 0 && (
              <button
                type="button"
                aria-label={`Add point to shape ${subPathIndex + 1}`}
                title="Adds a point on the selected edge (or the longest one) without changing the outline"
                className="mt-0.5 flex h-7 pointer-coarse:h-11 w-full touch-manipulation items-center gap-1.5 rounded-md px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => onAddPoint(subPathIndex, selected?.commandIndex ?? longest)}
              >
                <Plus className="size-3.5" />
                Add point
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The edge leading into a point: a straight or a curved segment between two dots. */
function EdgeGlyph({ curved }: { curved: boolean }) {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden="true" fill="currentColor">
      <circle cx="2.5" cy="9.5" r="1.5" />
      <circle cx="13.5" cy="2.5" r="1.5" />
      <path
        d={curved ? "M2.5 9.5C2.5 3 8 2.5 13.5 2.5" : "M2.5 9.5L13.5 2.5"}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
      />
    </svg>
  );
}

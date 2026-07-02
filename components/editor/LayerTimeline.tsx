"use client";

import React from "react";
import {
  ChevronRight,
  Eye,
  EyeOff,
  FileCode2,
  FolderOpen,
  MoreVertical,
  Plus,
  Timer,
  Square,
  Crop,
} from "lucide-react";
import { MaterialSymbol } from "./MaterialSymbol";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useEditorStore } from "@/lib/store/editorStore";
import type { Layer, VectorMetadata } from "@/lib/shapeshifter/types";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import { INTERPOLATOR_CURVES } from "@/lib/shapeshifter/interpolators";
import { EasingCurve } from "./EasingCurve";

/** Friendly labels for the real, curve-backed interpolators (Android-named). */
const INTERPOLATOR_OPTIONS: { value: keyof typeof INTERPOLATOR_CURVES; label: string }[] = [
  { value: "FAST_OUT_SLOW_IN", label: "Standard" },
  { value: "LINEAR_OUT_SLOW_IN", label: "Decelerate" },
  { value: "FAST_OUT_LINEAR_IN", label: "Accelerate" },
  { value: "ACCELERATE_DECELERATE", label: "Ease in-out" },
  { value: "LINEAR", label: "Linear" },
];

interface LayerTimelineProps {
  onOpenSVGImport: () => void;
  onExport: (type: string) => void;
  onLoadSample: (index: number) => void;
}

export function LayerTimeline(_props: LayerTimelineProps) {
  const {
    layers,
    selectedLayerId,
    selectLayer,
    toggleLayerVisibility,
    toggleLayerExpanded,
    convertLayerType,
    addTimelineBlock,
    addLayer,
    selectedBlockIds,
    updateTimelineBlock,
    progress,
    animation,
    vector,
    selectBlocks,
    timelineCollapsed,
    toggleTimelineCollapsed,
    setAnimationDuration,
  } = useEditorStore();
  const currentTimeMs = Math.round(progress * animation.duration);
  const formatTimeMark = (timeMs: number) =>
    animation.duration < 1000 ? `${Math.round(timeMs)}ms` : `${(timeMs / 1000).toFixed(1)}s`;

  const [draggingBlock, setDraggingBlock] = React.useState<null | {
    id: string;
    startX: number;
    originalStart: number;
    originalEnd: number;
  }>(null);
  const [resizingBlock, setResizingBlock] = React.useState<null | {
    id: string;
    edge: "start" | "end";
    startX: number;
    originalStart: number;
    originalEnd: number;
  }>(null);

  type TimelineLayer =
    | Layer
    | (VectorMetadata & {
        type: "vector";
        visible: boolean;
        locked: boolean;
        expanded?: boolean;
        parentId?: null;
      });
  type TimelineRow =
    | { kind: "layer"; layer: TimelineLayer; depth: number }
    | { kind: "property"; layer: TimelineLayer; propertyName: string; depth: number };

  const vectorRow: TimelineLayer = {
    ...vector,
    type: "vector",
    visible: true,
    locked: false,
    expanded: true,
    parentId: null,
  };
  const depthById = new Map<string, number>();
  const childCountById = new Map<string, number>();
  for (const layer of layers) {
    if (layer.parentId != null) {
      const key = String(layer.parentId);
      childCountById.set(key, (childCountById.get(key) ?? 0) + 1);
    }
    let depth = 0;
    let parentId = layer.parentId;
    while (parentId != null) {
      depth++;
      parentId = layers.find((candidate) => String(candidate.id) === String(parentId))?.parentId;
    }
    depthById.set(String(layer.id), depth);
  }
  for (const layer of layers) {
    if (layer.parentId == null) {
      childCountById.set(String(vector.id), (childCountById.get(String(vector.id)) ?? 0) + 1);
    }
  }
  const visibleLayers = layers.filter((layer) => {
    let parentId = layer.parentId;
    while (parentId != null) {
      const parent = layers.find((candidate) => String(candidate.id) === String(parentId));
      if (!parent) return true;
      if (parent.expanded === false) return false;
      parentId = parent.parentId;
    }
    return true;
  });
  const propertiesForLayer = (layerId: string | number) =>
    Array.from(
      new Set(
        animation.blocks
          .filter((block) => String(block.layerId) === String(layerId))
          .map((block) => block.propertyName),
      ),
    );
  const animatableProperties = (layerType: string) =>
    layerType === "vector"
      ? ["alpha"]
      : layerType === "group"
        ? ["rotation", "scaleX", "scaleY", "pivotX", "pivotY", "translateX", "translateY"]
        : [
            "pathData",
            "fillColor",
            "fillAlpha",
            "strokeColor",
            "strokeAlpha",
            "strokeWidth",
            "trimPathStart",
            "trimPathEnd",
            "trimPathOffset",
          ];
  const timelineRows: TimelineRow[] = [{ kind: "layer", layer: vectorRow, depth: 0 }];
  for (const layer of visibleLayers) {
    const depth = (depthById.get(String(layer.id)) ?? 0) + 1;
    timelineRows.push({ kind: "layer", layer, depth });
    if (layer.expanded !== false) {
      for (const propertyName of propertiesForLayer(layer.id)) {
        timelineRows.push({ kind: "property", layer, propertyName, depth: depth + 1 });
      }
    }
  }
  for (const propertyName of propertiesForLayer(vector.id)) {
    timelineRows.splice(1, 0, { kind: "property", layer: vectorRow, propertyName, depth: 1 });
  }

  return (
    <section className="z-20 flex h-full min-h-0 shrink-0 bg-card text-card-foreground shadow-md">
      <div className="flex min-h-0 w-[300px] shrink-0 flex-col border-r border-border/60 bg-sidebar">
        <div className="flex h-10 items-center justify-between border-b border-border/60 bg-card px-3">
          <span className="text-[13px] font-semibold tracking-tight">Layers</span>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Add layer"
                />
              }
            >
              <Plus className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => addLayer("path")}>New path</DropdownMenuItem>
              <DropdownMenuItem onClick={() => addLayer("clipPath")}>
                New clip path
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => addLayer("group")}>New group layer</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {timelineRows.map((row) => {
            if (row.kind === "property") {
              const blockIds = animation.blocks
                .filter(
                  (block) =>
                    String(block.layerId) === String(row.layer.id) &&
                    block.propertyName === row.propertyName,
                )
                .map((block) => block.id);
              const isSelected =
                blockIds.length > 0 && blockIds.every((id) => selectedBlockIds.includes(id));
              return (
                <button
                  key={`${row.layer.id}-${row.propertyName}`}
                  className={`flex h-7 w-full items-center gap-2 rounded px-2 text-left text-[11px] ${
                    isSelected
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-muted/70"
                  }`}
                  style={{ paddingLeft: `${8 + row.depth * 18}px` }}
                  onClick={() => selectBlocks(blockIds)}
                >
                  <Timer className="h-3 w-3 shrink-0" />
                  <span className="min-w-0 truncate">{propertyLabel(row.propertyName)}</span>
                </button>
              );
            }
            const layer = row.layer;
            const isSelected = selectedLayerId === layer.id;
            const isExpandable = (childCountById.get(String(layer.id)) ?? 0) > 0;
            return (
              <React.Fragment key={layer.id}>
                <div
                  role={layer.type === "vector" ? undefined : "button"}
                  tabIndex={layer.type === "vector" ? undefined : 0}
                  className={`flex h-8 w-full items-center gap-2 px-2 text-left transition-all border-l-2 ${
                    isSelected
                      ? "bg-primary/10 border-primary text-foreground font-semibold"
                      : "bg-transparent border-transparent text-foreground hover:bg-muted/70"
                  }`}
                  onClick={() => layer.type !== "vector" && selectLayer(layer.id)}
                  onDoubleClick={() => isExpandable && toggleLayerExpanded(layer.id)}
                  onKeyDown={(event) => {
                    if (layer.type === "vector") return;
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectLayer(layer.id);
                    }
                    if (event.key === "ArrowRight" && isExpandable && layer.expanded === false) {
                      event.preventDefault();
                      toggleLayerExpanded(layer.id);
                    }
                    if (event.key === "ArrowLeft" && isExpandable && layer.expanded !== false) {
                      event.preventDefault();
                      toggleLayerExpanded(layer.id);
                    }
                  }}
                >
                  <span style={{ width: `${row.depth * 12}px` }} />
                  <span
                    role="button"
                    tabIndex={0}
                    className="grid h-5 w-5 place-items-center rounded hover:bg-foreground/10"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (isExpandable) toggleLayerExpanded(layer.id);
                    }}
                    onKeyDown={(event) => {
                      if ((event.key === "Enter" || event.key === " ") && isExpandable) {
                        event.preventDefault();
                        event.stopPropagation();
                        toggleLayerExpanded(layer.id);
                      }
                    }}
                    aria-label={
                      layer.expanded === false ? `Expand ${layer.name}` : `Collapse ${layer.name}`
                    }
                  >
                    {isExpandable ? (
                      <ChevronRight
                        className={`h-3 w-3 transition-transform ${layer.expanded === false ? "" : "rotate-90"}`}
                      />
                    ) : (
                      <span className="h-3 w-3" />
                    )}
                  </span>

                  {layer.type === "vector" ? (
                    <FileCode2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : layer.type === "group" ? (
                    <FolderOpen
                      className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
                    />
                  ) : layer.type === "clipPath" ? (
                    <Crop
                      className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
                    />
                  ) : (
                    <Square
                      className={`h-3.5 w-3.5 shrink-0 ${isSelected ? "text-primary" : "text-muted-foreground"}`}
                    />
                  )}

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium">{layer.name}</span>
                  </span>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-xs"
                          variant="ghost"
                          className="size-5 text-muted-foreground hover:text-foreground"
                          onClick={(event) => event.stopPropagation()}
                        />
                      }
                    >
                      <MoreVertical className="h-3 w-3" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44 text-xs">
                      {layer.type === "path" && (
                        <DropdownMenuItem onClick={() => convertLayerType(layer.id, "clipPath")}>
                          Convert to clip path
                        </DropdownMenuItem>
                      )}
                      {layer.type === "clipPath" && (
                        <DropdownMenuItem onClick={() => convertLayerType(layer.id, "path")}>
                          Convert to path
                        </DropdownMenuItem>
                      )}
                      {animatableProperties(layer.type).map((propertyName) => (
                        <DropdownMenuItem
                          key={propertyName}
                          onClick={() => addTimelineBlock(layer.id, propertyName)}
                        >
                          Animate {propertyName}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>

                  {layer.type === "vector" ? (
                    <span className="h-5 w-5" />
                  ) : (
                    <span
                      role="button"
                      tabIndex={0}
                      className="grid h-5 w-5 place-items-center rounded hover:bg-foreground/10"
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleLayerVisibility(layer.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleLayerVisibility(layer.id);
                        }
                      }}
                      aria-label={layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
                    >
                      {layer.visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                    </span>
                  )}
                </div>
              </React.Fragment>
            );
          })}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-card">
        <div className="flex h-10 items-center gap-2 border-b border-border/60 bg-card px-3">
          <Button
            size="icon-xs"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            aria-label={timelineCollapsed ? "Expand timeline tracks" : "Collapse timeline tracks"}
            onClick={toggleTimelineCollapsed}
          >
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform ${timelineCollapsed ? "" : "rotate-90"}`}
            />
          </Button>
          <span className="text-[13px] font-semibold tracking-tight">Timeline</span>
          <span className="text-[11px] text-muted-foreground">
            {animation.blocks.length} {animation.blocks.length === 1 ? "track" : "tracks"}
          </span>
          <div className="flex-1" />
          {/* Live playhead time + editable total duration */}
          <span className="font-mono text-[11px] tabular-nums text-primary">
            {currentTimeMs}
            <span className="text-muted-foreground/60">ms</span>
          </span>
          <span className="text-[11px] text-muted-foreground/50">/</span>
          <div className="flex items-center rounded-md border border-border bg-background focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
            <input
              type="number"
              min={100}
              step={50}
              value={animation.duration}
              onChange={(e) => {
                const n = Number(e.target.value);
                if (Number.isFinite(n)) setAnimationDuration(n);
              }}
              aria-label="Animation duration in milliseconds"
              title="Total animation duration"
              className="h-6 w-14 bg-transparent px-1.5 text-right font-mono text-[11px] tabular-nums text-foreground outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none"
            />
            <span className="pr-1.5 text-[10px] text-muted-foreground/60">ms</span>
          </div>
        </div>
        <div
          className="relative grid h-7 grid-cols-11 border-b border-border/60 bg-muted/20 text-[11px] text-muted-foreground select-none cursor-ew-resize hover:bg-muted/35 active:bg-muted/50 transition-colors"
          onPointerDown={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const updateProgress = (clientX: number) => {
              const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
              const newProgress = x / rect.width;
              useEditorStore.getState().setProgress(newProgress);
            };

            updateProgress(e.clientX);
            const element = e.currentTarget;
            element.setPointerCapture(e.pointerId);

            const handlePointerMove = (moveEvent: PointerEvent) => {
              updateProgress(moveEvent.clientX);
            };

            const handlePointerUp = (upEvent: PointerEvent) => {
              try {
                element.releasePointerCapture(upEvent.pointerId);
              } catch {}
              window.removeEventListener("pointermove", handlePointerMove);
              window.removeEventListener("pointerup", handlePointerUp);
            };

            window.addEventListener("pointermove", handlePointerMove);
            window.addEventListener("pointerup", handlePointerUp);
          }}
        >
          {Array.from({ length: 11 }, (_, index) => (
            <span key={index} className="border-l border-border/45 pl-1 leading-7">
              {formatTimeMark((animation.duration * index) / 10)}
            </span>
          ))}
        </div>

        {selectedBlockIds.length > 0 &&
          (() => {
            const selBlock = animation.blocks.find((b) => selectedBlockIds.includes(b.id));
            const interp = selBlock?.interpolator || "FAST_OUT_SLOW_IN";
            const isNamed = interp in INTERPOLATOR_CURVES;
            // Resolve the curve points: a named Android interpolator, or a custom
            // "x1 y1 x2 y2" string (which evaluateInterpolator already understands).
            const curve = isNamed
              ? INTERPOLATOR_CURVES[interp as keyof typeof INTERPOLATOR_CURVES]
              : ((interp.match(/[-+]?(?:\d*\.)?\d+/g)?.map(Number).slice(0, 4) as
                  | [number, number, number, number]
                  | undefined) ?? INTERPOLATOR_CURVES.FAST_OUT_SLOW_IN);
            // Apply an interpolator value to every selected block.
            const setInterp = (value: string) =>
              selectedBlockIds.forEach((id) => updateTimelineBlock(id, { interpolator: value }));
            // Local progress within the selected block, for the travelling dot.
            const localT = selBlock
              ? Math.max(
                  0,
                  Math.min(
                    1,
                    (currentTimeMs - selBlock.startTime) /
                      Math.max(1, selBlock.endTime - selBlock.startTime),
                  ),
                )
              : undefined;
            return (
              <div className="flex h-16 items-center gap-3 border-b bg-muted/40 px-3 text-[11px]">
                <EasingCurve
                  points={curve}
                  progress={localT}
                  size={52}
                  onChange={(pts) => setInterp(pts.join(" "))}
                />
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Easing</span>
                    <Select
                      value={isNamed ? interp : "__custom__"}
                      onValueChange={(value) => {
                        if (!value) return;
                        // Selecting "Custom" seeds an editable curve from the
                        // current shape; named options apply their preset.
                        setInterp(value === "__custom__" ? curve.join(" ") : value);
                      }}
                    >
                      <SelectTrigger size="sm" className="h-7 w-36 bg-background text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {INTERPOLATOR_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                        <SelectItem value="__custom__">Custom…</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <span className="font-mono text-[10px] tabular-nums text-muted-foreground/80">
                    {isNamed
                      ? selBlock
                        ? `${selBlock.startTime}–${selBlock.endTime}ms`
                        : ""
                      : `cubic-bezier(${curve.map((n) => Number(n).toFixed(2)).join(", ")})`}
                    {selectedBlockIds.length > 1 && ` · ${selectedBlockIds.length} blocks`}
                  </span>
                </div>
              </div>
            );
          })()}

        <div
          className="relative min-h-0 flex-1 bg-muted/15 pt-2.5"
          style={{
            backgroundImage:
              "linear-gradient(90deg, color-mix(in oklab, var(--border) 45%, transparent) 1px, transparent 1px)",
            backgroundSize: "10% 100%",
          }}
        >
          <div
            className="absolute bottom-0 top-0 z-10 w-0.5 bg-primary before:absolute before:-left-1 before:-top-px before:h-2.5 before:w-2.5 before:rounded-full before:bg-primary"
            style={{ left: `${Math.round(progress * 100)}%` }}
          />
          {!timelineCollapsed && animation.blocks.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center p-5">
              <div className="w-full max-w-[260px] rounded-2xl border border-border/50 bg-card/75 px-4 py-4 text-center shadow-sm backdrop-blur-md">
                <div className="mx-auto mb-2.5 flex size-8 items-center justify-center rounded-full bg-muted">
                  <MaterialSymbol name="animation" size={17} className="text-muted-foreground" />
                </div>
                <div className="text-[13px] font-semibold tracking-[-0.1px] text-foreground/90">
                  No animations yet
                </div>
                <div className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground/90">
                  Click <MaterialSymbol name="animation" size={13} className="inline align-text-bottom text-foreground/70" /> next to a property in the Inspector, or choose <span className="font-medium text-foreground/70">Animate</span> from a layer’s menu.
                </div>
              </div>
            </div>
          )}
          {!timelineCollapsed &&
            timelineRows.map((row) => (
              <div
                key={row.kind === "property" ? `${row.layer.id}-${row.propertyName}` : row.layer.id}
                className={`${row.kind === "property" ? "h-7" : "h-8"} relative border-b border-border/45`}
              >
                {row.kind === "property" &&
                  animation.blocks
                    .filter(
                      (block) =>
                        String(block.layerId) === String(row.layer.id) &&
                        block.propertyName === row.propertyName,
                    )
                    .map((block) => {
                      const isSelected = selectedBlockIds.includes(block.id);
                      const leftPct = (block.startTime / animation.duration) * 100;
                      const widthPct = Math.max(
                        1,
                        ((block.endTime - block.startTime) / animation.duration) * 100,
                      );
                      const interp = block.interpolator || "FAST_OUT_SLOW_IN";
                      const handleDragStart = (e: React.PointerEvent) => {
                        e.stopPropagation();
                        (e.target as HTMLElement).setPointerCapture(e.pointerId);
                        setDraggingBlock({
                          id: block.id,
                          startX: e.clientX,
                          originalStart: block.startTime,
                          originalEnd: block.endTime,
                        });
                        const store = useEditorStore.getState();
                        store.selectBlocks([block.id]);
                      };

                      const handleDragMove = (e: React.PointerEvent) => {
                        if (!draggingBlock || draggingBlock.id !== block.id) return;
                        const rect = e.currentTarget.parentElement?.getBoundingClientRect();
                        const width = Math.max(1, rect?.width ?? 300);
                        const deltaX = e.clientX - draggingBlock.startX;
                        const deltaTime = (deltaX / width) * animation.duration;
                        let newStart = Math.max(
                          0,
                          Math.min(
                            animation.duration - 50,
                            draggingBlock.originalStart + deltaTime,
                          ),
                        );
                        let newEnd = Math.max(
                          newStart + 50,
                          Math.min(animation.duration, draggingBlock.originalEnd + deltaTime),
                        );
                        newStart = Math.round(newStart / 50) * 50;
                        newEnd = Math.round(newEnd / 50) * 50;
                        const store = useEditorStore.getState();
                        store.updateTimelineBlock(block.id, {
                          startTime: newStart,
                          endTime: newEnd,
                        });
                      };

                      const handleDragEnd = (e: React.PointerEvent) => {
                        setDraggingBlock(null);
                        (e.target as HTMLElement).releasePointerCapture(e.pointerId);
                      };

                      // Resize edge handlers (Figma/Framer pro timeline block duration editing)
                      const handleResizeStart =
                        (edge: "start" | "end") => (e: React.PointerEvent) => {
                          e.stopPropagation();
                          (e.target as HTMLElement).setPointerCapture(e.pointerId);
                          setResizingBlock({
                            id: block.id,
                            edge,
                            startX: e.clientX,
                            originalStart: block.startTime,
                            originalEnd: block.endTime,
                          });
                          const store = useEditorStore.getState();
                          store.selectBlocks([block.id]);
                        };

                      const handleResizeMove = (e: React.PointerEvent) => {
                        if (!resizingBlock || resizingBlock.id !== block.id) return;
                        const rect =
                          e.currentTarget.parentElement?.parentElement?.getBoundingClientRect() ??
                          e.currentTarget.parentElement?.getBoundingClientRect();
                        const width = Math.max(1, rect?.width ?? 300);
                        const deltaX = e.clientX - resizingBlock.startX;
                        const deltaTime = (deltaX / width) * animation.duration;
                        const minDur = 50;
                        let newStart = resizingBlock.originalStart;
                        let newEnd = resizingBlock.originalEnd;
                        if (resizingBlock.edge === "start") {
                          newStart = Math.max(
                            0,
                            Math.min(
                              resizingBlock.originalEnd - minDur,
                              resizingBlock.originalStart + deltaTime,
                            ),
                          );
                          newStart = Math.round(newStart / 50) * 50;
                        } else {
                          newEnd = Math.max(
                            resizingBlock.originalStart + minDur,
                            Math.min(animation.duration, resizingBlock.originalEnd + deltaTime),
                          );
                          newEnd = Math.round(newEnd / 50) * 50;
                        }
                        const store = useEditorStore.getState();
                        store.updateTimelineBlock(block.id, {
                          startTime: newStart,
                          endTime: newEnd,
                        });
                      };

                      const handleResizeEnd = (e: React.PointerEvent) => {
                        setResizingBlock(null);
                        try {
                          (e.target as HTMLElement).releasePointerCapture(e.pointerId);
                        } catch {}
                      };

                      return (
                        <div
                          key={block.id}
                          className={`absolute top-1 h-5 rounded-md cursor-grab active:cursor-grabbing transition-colors relative overflow-visible shadow-sm ${isSelected ? "bg-primary ring-1 ring-ring" : "bg-primary/65 hover:bg-primary/80"} ${interp === "LINEAR" ? "border border-dashed border-primary/70" : ""}`}
                          style={{
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                          }}
                          title={`${block.propertyName}: ${block.startTime}-${block.endTime}ms [${interp}] (drag center to move • drag edges to resize duration, snaps to 50ms) — click to multi-select`}
                          onPointerDown={handleDragStart}
                          onPointerMove={handleDragMove}
                          onPointerUp={handleDragEnd}
                          onPointerCancel={handleDragEnd}
                          onClick={(e) => {
                            e.stopPropagation();
                            useEditorStore.getState().toggleBlockSelection(block.id);
                          }}
                        >
                          {/* Left edge resize handle (pro timeline UX) */}
                          <div
                            className="absolute left-0 top-0 h-full w-2 cursor-ew-resize z-20 rounded-l-sm active:bg-primary/80 hover:bg-primary/40"
                            onPointerDown={handleResizeStart("start")}
                            onPointerMove={handleResizeMove}
                            onPointerUp={handleResizeEnd}
                            onPointerCancel={handleResizeEnd}
                            aria-hidden="true"
                          />
                          {/* Right edge resize handle */}
                          <div
                            className="absolute right-0 top-0 h-full w-2 cursor-ew-resize z-20 rounded-r-sm active:bg-primary/80 hover:bg-primary/40"
                            onPointerDown={handleResizeStart("end")}
                            onPointerMove={handleResizeMove}
                            onPointerUp={handleResizeEnd}
                            onPointerCancel={handleResizeEnd}
                            aria-hidden="true"
                          />
                        </div>
                      );
                    })}
              </div>
            ))}
        </div>
      </div>
    </section>
  );
}

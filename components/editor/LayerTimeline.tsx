"use client";

import React from "react";
import { ChevronRight, Eye, EyeOff, FolderOpen, Import, MoreVertical, Plus, Timer, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useEditorStore } from "@/lib/store/editorStore";
import { pathToString } from "@/lib/shapeshifter/pathUtils";

interface LayerTimelineProps {
  onOpenSVGImport: () => void;
  onExport: (type: string) => void;
  onLoadSample: (index: number) => void;
}

export function LayerTimeline({ onOpenSVGImport, onExport, onLoadSample }: LayerTimelineProps) {
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
  } = useEditorStore();
  const durationSeconds = animation.duration / 1000;

  const [draggingBlock, setDraggingBlock] = React.useState<null | { id: string; startX: number; originalStart: number; originalEnd: number }>(null);

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
    Array.from(new Set(animation.blocks.filter((block) => String(block.layerId) === String(layerId)).map((block) => block.propertyName)));
  const animatableProperties = (layerType: string) =>
    layerType === "group"
      ? ["rotation", "scaleX", "scaleY", "pivotX", "pivotY", "translateX", "translateY"]
      : ["pathData", "fillColor", "fillAlpha", "strokeColor", "strokeAlpha", "strokeWidth", "trimPathStart", "trimPathEnd", "trimPathOffset"];

  return (
    <section className="z-20 flex h-[280px] shrink-0 border-t bg-card shadow-md">
      <div className="flex min-h-0 w-[300px] shrink-0 flex-col border-r">
        <div className="flex h-10 items-center gap-0.5 border-b px-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger render={<button className="h-8 rounded px-2 text-xs font-medium hover:bg-muted" />}>File</DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuItem onClick={() => onLoadSample(0)}>New from Play/Pause</DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenSVGImport}>Open project or asset</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onLoadSample(1)}>Open Menu/Close demo</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport("json")}>Save project JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger render={<button className="h-8 rounded px-2 text-xs font-medium hover:bg-muted" />}>Import</DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-44">
              <DropdownMenuItem onClick={onOpenSVGImport}>
                <Import className="mr-2 h-4 w-4" /> SVG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenSVGImport}>
                <Import className="mr-2 h-4 w-4" /> Vector Drawable XML
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger render={<button className="h-8 rounded px-2 text-xs font-medium hover:bg-muted" />}>Export</DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuItem onClick={() => onExport("svg")}>Animated SVG</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport("css")}>CSS keyframes</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport("lottie")}>Lottie JSON</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport("vector")}>Vector Drawable</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport("avd")}>Animated Vector Drawable</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport("spritesheet")}>SVG spritesheet</DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExport("json")}>Project JSON</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button size="icon-sm" variant="ghost" aria-label="Add layer" />
              }
            >
              <Plus className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={() => addLayer("path")}>New path</DropdownMenuItem>
              <DropdownMenuItem onClick={() => addLayer("clipPath")}>New clip path</DropdownMenuItem>
              <DropdownMenuItem onClick={() => addLayer("group")}>New group layer</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {visibleLayers.map((layer) => {
            const isSelected = selectedLayerId === layer.id;
            const isExpandable = (childCountById.get(String(layer.id)) ?? 0) > 0;
            const existingProperties = propertiesForLayer(layer.id);
            return (
              <div key={layer.id}>
                <button
                  className={`flex h-12 w-full items-center gap-2 rounded px-2 text-left ${
                    isSelected
                      ? "bg-primary text-primary-foreground"
                      : "bg-transparent text-foreground hover:bg-muted"
                  }`}
                  onClick={() => selectLayer(layer.id)}
                  onDoubleClick={() => isExpandable && toggleLayerExpanded(layer.id)}
                >
                  <span style={{ width: `${(depthById.get(String(layer.id)) ?? 0) * 16}px` }} />
                  <span
                    role="button"
                    tabIndex={0}
                    className="grid h-6 w-6 place-items-center rounded hover:bg-foreground/10"
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
                    aria-label={layer.expanded === false ? `Expand ${layer.name}` : `Collapse ${layer.name}`}
                  >
                    {isExpandable ? (
                      <ChevronRight className={`h-4 w-4 transition-transform ${layer.expanded === false ? "" : "rotate-90"}`} />
                    ) : (
                      <span className="h-4 w-4" />
                    )}
                  </span>
                  <FolderOpen className={`h-4 w-4 shrink-0 ${isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{layer.name}</span>
                    <span className={`block truncate font-mono text-[10px] ${isSelected ? "text-primary-foreground/75" : "text-muted-foreground"}`}>
                      {layer.type === "group" ? "group layer" : pathToString(layer.from).slice(0, 52)}
                    </span>
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <span
                          role="button"
                          tabIndex={0}
                          className="grid h-6 w-6 place-items-center rounded hover:bg-foreground/10"
                          onClick={(event) => event.stopPropagation()}
                        />
                      }
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      {layer.type === "path" && <DropdownMenuItem onClick={() => convertLayerType(layer.id, "clipPath")}>Convert to clip path</DropdownMenuItem>}
                      {layer.type === "clipPath" && <DropdownMenuItem onClick={() => convertLayerType(layer.id, "path")}>Convert to path</DropdownMenuItem>}
                      {animatableProperties(layer.type).map((propertyName) => (
                        <DropdownMenuItem key={propertyName} onClick={() => addTimelineBlock(layer.id, propertyName)}>
                          Animate {propertyName}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <span
                    role="button"
                    tabIndex={0}
                    className="grid h-6 w-6 place-items-center rounded hover:bg-foreground/10"
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
                    {layer.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  </span>
                </button>
                {layer.expanded !== false && existingProperties.length > 0 && (
                  <div className="ml-10 border-l pl-3">
                    {existingProperties.map((propertyName) => (
                      <button
                        key={propertyName}
                        className="flex h-7 w-full items-center justify-between rounded px-2 text-left text-xs text-muted-foreground hover:bg-muted"
                        onClick={() => addTimelineBlock(layer.id, propertyName)}
                      >
                        <span>{propertyName}</span>
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex h-10 items-center gap-2 border-b px-3">
          <div className="flex items-center gap-1.5 text-xs font-semibold">
            <Timer className="h-3.5 w-3.5" />
            <span>anim</span><span className="ml-1 text-[10px] text-accent">(drag blocks)</span>
            <span className="text-muted-foreground">{animation.duration}ms</span>
          </div>
          <Button size="icon-xs" variant="ghost" aria-label="Zoom timeline to fit">
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div
          className="relative grid h-7 grid-cols-11 border-b text-[11px] text-muted-foreground select-none cursor-ew-resize hover:bg-muted/40 active:bg-muted/60 transition-colors"
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
              } catch (err) {}
              window.removeEventListener("pointermove", handlePointerMove);
              window.removeEventListener("pointerup", handlePointerUp);
            };

            window.addEventListener("pointermove", handlePointerMove);
            window.addEventListener("pointerup", handlePointerUp);
          }}
        >
          {Array.from({ length: 11 }, (_, index) => (
            <span key={index} className="border-l pl-1 leading-7">
              {((durationSeconds * index) / 10).toFixed(1)}s
            </span>
          ))}
        </div>

        {selectedBlockIds.length > 0 && (
          <div className="flex items-center gap-2 px-3 py-1 text-[10px] bg-muted/50 border-b">
            <span>Selected block interpolator:</span>
            <select
              className="text-xs bg-background border rounded px-1"
              value={animation.blocks.find(b => selectedBlockIds.includes(b.id))?.interpolator || "FAST_OUT_SLOW_IN"}
              onChange={(e) => {
                const selId = selectedBlockIds[0];
                if (selId) updateTimelineBlock(selId, { interpolator: e.target.value });
              }}
            >
              <option value="FAST_OUT_SLOW_IN">Fast out slow in</option>
              <option value="LINEAR">Linear</option>
              <option value="EASE_IN">Ease in</option>
              <option value="EASE_OUT">Ease out</option>
              <option value="EASE_IN_OUT">Ease in out</option>
            </select>
          </div>
        )}

        <div className="relative min-h-0 flex-1 bg-[linear-gradient(90deg,var(--border)_1px,transparent_1px)] bg-[length:10%_100%] pt-2.5">
          <div
            className="absolute bottom-0 top-0 z-10 w-0.5 bg-destructive before:absolute before:-left-1 before:-top-px before:h-2.5 before:w-2.5 before:rounded-full before:bg-destructive"
            style={{ left: `${Math.round(progress * 100)}%` }}
          />
          {layers.map((layer, index) => (
            <div key={layer.id} className="relative h-9 border-b">
              {animation.blocks
                .filter((block) => String(block.layerId) === String(layer.id))
                .map((block) => {
                  const isSelected = selectedBlockIds.includes(block.id);
                  const leftPct = (block.startTime / animation.duration) * 100;
                  const widthPct = Math.max(1, ((block.endTime - block.startTime) / animation.duration) * 100);
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
                    store.toggleBlockSelection(block.id);
                  };

                  const handleDragMove = (e: React.PointerEvent) => {
                    if (!draggingBlock || draggingBlock.id !== block.id) return;
                    const deltaX = e.clientX - draggingBlock.startX;
                    const deltaTime = (deltaX / 300) * animation.duration; // approximate px to ms scale
                    let newStart = Math.max(0, Math.min(animation.duration - 50, draggingBlock.originalStart + deltaTime));
                    let newEnd = Math.max(newStart + 50, Math.min(animation.duration, draggingBlock.originalEnd + deltaTime));
                    // Basic snap to grid (50ms)
                    if (true) {
                      newStart = Math.round(newStart / 50) * 50;
                      newEnd = Math.round(newEnd / 50) * 50;
                    }
                    const store = useEditorStore.getState();
                    store.updateTimelineBlock(block.id, { startTime: newStart, endTime: newEnd });
                  };

                  const handleDragEnd = (e: React.PointerEvent) => {
                    setDraggingBlock(null);
                    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
                  };

                  return (
                    <div
                      key={block.id}
                      className={`absolute top-2.5 h-2.5 rounded-full shadow-inner cursor-grab active:cursor-grabbing transition-all ${isSelected ? "bg-primary ring-1 ring-primary-foreground" : "bg-accent/70"}`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                      }}
                      title={`${block.propertyName}: ${block.startTime}-${block.endTime}ms (drag to move)`}
                      onPointerDown={handleDragStart}
                      onPointerMove={handleDragMove}
                      onPointerUp={handleDragEnd}
                      onPointerCancel={handleDragEnd}
                    />
                  );
                })}
              {animation.blocks.filter((block) => String(block.layerId) === String(layer.id)).length === 0 && (
                <div
                  className="absolute top-2.5 h-2.5 rounded-full bg-muted shadow-inner"
                  style={{ left: `${8 + index * 10}%`, width: `${54 - index * 4}%` }}
                />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

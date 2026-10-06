"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ChevronRight,
  Ellipsis,
  Crop,
  Folder,
  Lock,
  Maximize2,
  Minimize2,
  RectangleHorizontal,
  Shapes,
  Spline,
  Trash2,
  Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PAGE_ROOT_ID, useEditorStore } from "@/lib/store/editorStore";
import { changeCommandType, parsePath, updateCommandPoint } from "@/lib/shapeshifter/pathUtils";
import type { Layer } from "@/lib/shapeshifter/types";
import { layerAtTime } from "@/lib/shapeshifter/playheadResolve";
import { getPathDataBounds } from "@/lib/shapeshifter/path/pathDataIO";

const round2 = (value: number) => Math.round(value * 100) / 100;
import { EasingPanel } from "./inspector/EasingPanel";
import { useInspectorView } from "./inspector/inspectorView";
import { PathCommandsList } from "./PathCommandsList";
import {
  getInspectorSelectionBounds,
  resolveOwnedLayers,
} from "@/lib/shapeshifter/scene/inspectorSelection";
import { InlineSelect, NumberRow, Section } from "./inspector/InspectorControls";
import { LayerAppearanceSections } from "./inspector/LayerAppearanceSections";
import { FrameDesignPanel, LayerTransformSection } from "./inspector/InspectorPanels";
import { MorphPrepareSection } from "./inspector/MorphPrepareSection";
import { BooleanOperationsPanel } from "./BooleanOperations";
import { PathDataEditor } from "./inspector/PathDataEditor";
import { PanelHeader, useMobilePanelHeader } from "./PanelHeader";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/* ------------------------------------------------------------------ */
/* Inspector                                                          */
/* ------------------------------------------------------------------ */

export function Inspector() {
  const mobileHeader = useMobilePanelHeader();
  // Keep the inspector off the 60 fps playback path. A broad `useEditorStore()`
  // subscription re-rendered this entire control tree for unrelated progress,
  // viewport, hover, and pointer updates.
  const selection = useEditorStore((state) => state.selection);
  const getCurrentSelectedPoint = useEditorStore((state) => state.getCurrentSelectedPoint);
  const updateSelectedPoint = useEditorStore((state) => state.updateSelectedPoint);
  const deleteSelectedPoint = useEditorStore((state) => state.deleteSelectedPoint);
  const selectedLayerId = useEditorStore((state) => state.selectedLayerId);
  const selectedLayerIds = useEditorStore((state) => state.selectedLayerIds);
  const selectedLayerRefs = useEditorStore((state) => state.selectedLayerRefs);
  const editingSide = useEditorStore((state) => state.editingSide);
  const layers = useEditorStore((state) => state.layers);
  const updateSelectedLayer = useEditorStore((state) => state.updateSelectedLayer);
  const translateSelectedLayer = useEditorStore((state) => state.translateSelectedLayer);
  const beginTimelineMorphEditing = useEditorStore((state) => state.beginTimelineMorphEditing);
  const animation = useEditorStore((state) => state.animation);
  const easingBlockId = useInspectorView((state) => state.easingBlockId);
  // Leave the easing view only when a different layer is selected.
  React.useEffect(() => {
    const view = useInspectorView.getState();
    const owner = view.easingBlockId
      ? useEditorStore.getState().animation.blocks.find((block) => block.id === view.easingBlockId)
          ?.layerId
      : undefined;
    if (owner !== undefined && String(owner) !== String(selectedLayerId)) view.close();
  }, [selectedLayerId]);
  // Values follow the playhead while paused/scrubbing (not every playback frame).
  const pausedProgress = useEditorStore((state) => (state.isPlaying ? null : state.progress));
  const lastProgress = React.useRef(0);
  if (pausedProgress != null) lastProgress.current = pausedProgress;
  const playheadMs = lastProgress.current * animation.duration;
  const selectedPoints = useEditorStore((state) => state.selectedPoints);
  const selectPoint = useEditorStore((state) => state.selectPoint);

  const toggleLayerLock = useEditorStore((state) => state.toggleLayerLock);
  const selectionKind = useEditorStore((state) => state.selectionKind);
  const frames = useEditorStore((state) => state.frames);
  const rootLayers = useEditorStore((state) => state.rootLayers);
  const selectedFrameId = useEditorStore((state) => state.selectedFrameId);
  const selectedFrameIds = useEditorStore((state) => state.selectedFrameIds);
  const renameFrame = useEditorStore((state) => state.renameFrame);
  const moveFrame = useEditorStore((state) => state.moveFrame);
  const moveFrames = useEditorStore((state) => state.moveFrames);
  const duplicateFrame = useEditorStore((state) => state.duplicateFrame);
  const deleteFrame = useEditorStore((state) => state.deleteFrame);
  const updateVector = useEditorStore((state) => state.updateVector);

  const point = getCurrentSelectedPoint ? getCurrentSelectedPoint() : null;
  const currentLayer = layers.find((l) => l.id === selectedLayerId);
  const currentFrame = frames.find((frame) => frame.id === selectedFrameId);
  const selectedFrames = React.useMemo(
    () => frames.filter((frame) => selectedFrameIds.includes(frame.id)),
    [frames, selectedFrameIds],
  );
  const sceneOwners = React.useMemo(
    () => [
      ...frames.map((frame) => ({
        ownerId: frame.id,
        origin: { x: frame.x, y: frame.y },
        layers: frame.id === selectedFrameId ? layers : frame.layers,
      })),
      {
        ownerId: PAGE_ROOT_ID,
        origin: { x: 0, y: 0 },
        layers: selectedFrameId === PAGE_ROOT_ID ? layers : rootLayers,
      },
    ],
    [frames, layers, rootLayers, selectedFrameId],
  );
  const selectedLayers = React.useMemo(
    () => resolveOwnedLayers(sceneOwners, selectedLayerRefs),
    [sceneOwners, selectedLayerRefs],
  );
  const selectionBounds = React.useMemo(
    () => getInspectorSelectionBounds(sceneOwners, selectedLayerRefs),
    [sceneOwners, selectedLayerRefs],
  );
  const multiCount = selectedLayerRefs.length || selectedLayerIds?.length || 0;
  const animatedPropertyCount = new Set(
    animation.blocks
      .filter((block) => String(block.layerId) === String(currentLayer?.id))
      .map((block) => block.propertyName),
  ).size;
  const single = multiCount <= 1 && Boolean(currentLayer);
  /** Animated properties are keyed at the playhead; the rest edit the base value. */
  const updateLayer = (input: Partial<Layer>) => {
    if (!single || !currentLayer) {
      updateSelectedLayer(input);
      return;
    }
    let patch = input;
    // Like Figma, rotate and scale around the shape's own center. Android's default
    // center is the top-left corner, so set it the first time it would matter.
    const transforms = "rotation" in patch || "scaleX" in patch || "scaleY" in patch;
    const centerUnset =
      (currentLayer.pivotX ?? 0) === 0 &&
      (currentLayer.pivotY ?? 0) === 0 &&
      !trackExists("pivotX") &&
      !trackExists("pivotY");
    if (transforms && centerUnset) {
      const center = layerCenter(currentLayer);
      if (center) patch = { ...patch, pivotX: center.x, pivotY: center.y };
    }
    const rest = useEditorStore
      .getState()
      .setPropertiesAtPlayhead(currentLayer.id, patch as Record<string, never>);
    if (Object.keys(rest).length) updateSelectedLayer(rest as Partial<Layer>);
  };
  /** Center of the layer's own geometry, in the space its pivot is expressed in. */
  function layerCenter(layer: Layer) {
    if (layer.type === "group") {
      if (!selectionBounds) return null;
      return {
        x: round2(selectionBounds.x + selectionBounds.w / 2 - (layer.translateX ?? 0)),
        y: round2(selectionBounds.y + selectionBounds.h / 2 - (layer.translateY ?? 0)),
      };
    }
    const box = getPathDataBounds(layer.from);
    return box ? { x: round2(box.x + box.w / 2), y: round2(box.y + box.h / 2) } : null;
  }
  const liveLayer = React.useMemo(
    () =>
      currentLayer && single
        ? layerAtTime(currentLayer, animation.blocks, playheadMs, animation.duration)
        : currentLayer,
    [animation.blocks, animation.duration, currentLayer, playheadMs, single],
  );
  const translateLayer = (dx: number, dy: number) => {
    const animatedX = single && trackExists("translateX");
    const animatedY = single && trackExists("translateY");
    if (!liveLayer || (!animatedX && !animatedY)) {
      translateSelectedLayer(dx, dy);
      return;
    }
    updateLayer({
      ...(dx !== 0 && { translateX: (liveLayer.translateX ?? 0) + dx }),
      ...(dy !== 0 && { translateY: (liveLayer.translateY ?? 0) + dy }),
    });
  };
  function trackExists(propertyName: string) {
    return animation.blocks.some(
      (block) =>
        String(block.layerId) === String(currentLayer?.id) && block.propertyName === propertyName,
    );
  }
  const setPath = (parsed: ReturnType<typeof parsePath>) => {
    useEditorStore.getState().ensurePathKeyframeAtPlayhead();
    const side = useEditorStore.getState().editingSide;
    updateLayer(side === "from" ? { from: parsed, pathData: parsed } : { to: parsed });
  };

  const [isCommandsFocused, setIsCommandsFocused] = React.useState(false);
  const [showPathData, setShowPathData] = React.useState(false);

  React.useEffect(() => {
    if (!isCommandsFocused) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIsCommandsFocused(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isCommandsFocused]);

  /* ---- nothing selected: document-level properties ---- */
  if (selectionKind === "none" || (selectionKind === "layer" && !currentLayer)) {
    return <DocumentPanel />;
  }

  if (selectionKind === "frame" && currentFrame) {
    return (
      <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
        <InspectorHeader
          icon={<RectangleHorizontal className="size-3.5" />}
          title={selectedFrames.length > 1 ? `${selectedFrames.length} frames` : currentFrame.name}
          subtitle={
            selectedFrames.length > 1
              ? "Frames"
              : `Frame · ${currentFrame.vector.width} × ${currentFrame.vector.height}`
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <FrameDesignPanel
            frame={currentFrame}
            selectedFrames={selectedFrames.length ? selectedFrames : [currentFrame]}
            onRename={(name) => renameFrame(currentFrame.id, name)}
            onMove={(dx, dy) =>
              selectedFrames.length > 1
                ? moveFrames(
                    selectedFrames.map((frame) => frame.id),
                    dx,
                    dy,
                  )
                : moveFrame(currentFrame.id, dx, dy)
            }
            onResize={(width, height) => updateVector({ width, height })}
            onDuplicate={duplicateFrame}
            onDelete={() => deleteFrame(currentFrame.id)}
            canDelete={frames.length > 1}
          />
        </div>
      </div>
    );
  }

  if (!currentLayer) return null;

  const commandsList = (extraClass?: string) => (
    <PathCommandsList
      pathData={currentLayer[editingSide] ?? currentLayer.from}
      selectedPoints={selectedPoints}
      className={extraClass}
      onSelectCommand={(subPathIndex, commandIndex, pointIndex) => {
        if (!selectPoint) return;
        selectPoint({
          layerId: selectedLayerId,
          side: editingSide,
          subPathIndex,
          commandIndex,
          pointIndex,
        });
      }}
      onUpdateCommandPoint={(subPathIndex, commandIndex, pointIndex, newPoint) => {
        setPath(
          updateCommandPoint(
            currentLayer[editingSide] ?? currentLayer.from,
            subPathIndex,
            commandIndex,
            pointIndex,
            newPoint,
          ),
        );
      }}
      onChangeCommandType={(subPathIndex, commandIndex, newType) => {
        setPath(
          changeCommandType(
            currentLayer[editingSide] ?? currentLayer.from,
            subPathIndex,
            commandIndex,
            newType,
          ),
        );
      }}
    />
  );

  /* ---- dedicated full-height command focus mode ---- */
  if (isCommandsFocused) {
    return (
      <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
        <PanelHeader
          className="flex h-12 shrink-0 items-center justify-between border-b border-border pl-3 pr-2"
          actions={
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground"
              onClick={() => setIsCommandsFocused(false)}
              aria-label="Exit focus (Esc)"
            >
              <Minimize2 className="size-4" />
            </Button>
          }
        >
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold">Path commands</div>
            <div className="truncate text-[11px] text-muted-foreground">{currentLayer.name}</div>
          </div>
        </PanelHeader>
        <div className="min-h-0 flex-1 overflow-hidden p-2">{commandsList("h-full")}</div>
      </div>
    );
  }

  const easingBlock =
    easingBlockId && multiCount <= 1
      ? animation.blocks.find(
          (block) =>
            block.id === easingBlockId && String(block.layerId) === String(currentLayer.id),
        )
      : undefined;
  if (easingBlock)
    return (
      <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
        <EasingPanel block={easingBlock} onBack={() => useInspectorView.getState().close()} />
      </div>
    );

  const isGroup = currentLayer.type === "group";
  const isPathLike = currentLayer.type === "path" || currentLayer.type === "clipPath";
  // Selection bounds come from base geometry; shift them by any animated translation.
  const liveBounds =
    selectionBounds && single && liveLayer
      ? {
          ...selectionBounds,
          x: selectionBounds.x + (liveLayer.translateX ?? 0) - (currentLayer.translateX ?? 0),
          y: selectionBounds.y + (liveLayer.translateY ?? 0) - (currentLayer.translateY ?? 0),
        }
      : selectionBounds;
  const inspectorLayers = selectedLayers.length ? selectedLayers : [currentLayer];
  const allPaths = inspectorLayers.every((layer) => layer.type === "path");
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <InspectorHeader
        icon={
          currentLayer.type === "clipPath" ? (
            <Crop className="size-3.5" />
          ) : isGroup ? (
            <Folder className="size-3.5" />
          ) : (
            <Spline className="size-3.5" />
          )
        }
        title={multiCount > 1 ? `${multiCount} layers` : currentLayer.name}
        mobileSubtitle={
          multiCount > 1
            ? "Mixed selection"
            : animatedPropertyCount
              ? `Keyframe · ${Number(playheadMs.toFixed(2))} ms`
              : "Base artwork"
        }
        onRename={multiCount > 1 ? undefined : (name) => updateLayer({ name })}
        subtitle={
          multiCount > 1 ? (
            "Mixed selection"
          ) : (
            <span className="flex items-center gap-1">
              {isPathLike ? (
                <InlineSelect
                  label="Layer type"
                  value={currentLayer.type as "path" | "clipPath"}
                  options={[
                    { value: "path", label: "Path" },
                    { value: "clipPath", label: "Mask" },
                  ]}
                  onChange={(type) => updateLayer({ type })}
                  className="-ml-1"
                />
              ) : (
                <span>Group</span>
              )}
              {animatedPropertyCount === 0 && <span>· Base artwork</span>}
              {animatedPropertyCount > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-primary">
                    Keyframe · {Number(playheadMs.toFixed(2))} ms
                  </span>
                </>
              )}
            </span>
          )
        }
        actions={
          mobileHeader ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={<Button size="icon-sm" variant="ghost" aria-label="Layer actions" />}
              >
                <Ellipsis className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {isPathLike && (
                  <DropdownMenuItem
                    disabled={currentLayer.locked || multiCount > 1}
                    onClick={() => beginTimelineMorphEditing()}
                  >
                    Edit start and end paths
                  </DropdownMenuItem>
                )}
                {isPathLike && multiCount <= 1 && (
                  <DropdownMenuItem
                    onClick={() =>
                      updateLayer({ type: currentLayer.type === "path" ? "clipPath" : "path" })
                    }
                  >
                    {currentLayer.type === "path" ? "Use as mask" : "Use as path"}
                  </DropdownMenuItem>
                )}
                {multiCount <= 1 && (
                  <DropdownMenuItem onClick={() => toggleLayerLock(currentLayer.id)}>
                    {currentLayer.locked ? "Unlock layer" : "Lock layer"}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              {isPathLike && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="size-7 text-muted-foreground hover:text-foreground"
                        onClick={() => beginTimelineMorphEditing()}
                        disabled={currentLayer.locked || multiCount > 1}
                        aria-label="Edit start and end paths"
                      />
                    }
                  >
                    <Shapes className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>Morph: edit start and end shapes</TooltipContent>
                </Tooltip>
              )}
              {multiCount <= 1 && (
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className={cn(
                    "size-7 text-muted-foreground hover:text-foreground",
                    currentLayer.locked && "text-foreground",
                  )}
                  onClick={() => toggleLayerLock(currentLayer.id)}
                  aria-label={currentLayer.locked ? "Unlock layer" : "Lock layer"}
                  aria-pressed={Boolean(currentLayer.locked)}
                  title={currentLayer.locked ? "Unlock layer" : "Lock layer"}
                >
                  {currentLayer.locked ? (
                    <Lock className="size-3.5" />
                  ) : (
                    <Unlock className="size-3.5" />
                  )}
                </Button>
              )}
            </>
          )
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto">
        {animatedPropertyCount > 0 && multiCount <= 1 && (
          <p className="border-b border-border px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
            Animated fields edit this pose. Other fields edit the base artwork.
          </p>
        )}
        <MorphPrepareSection />
        {multiCount > 1 && allPaths && <BooleanOperationsPanel />}
        <LayerTransformSection
          layer={liveLayer!}
          selectedLayers={single ? [liveLayer!] : inspectorLayers}
          bounds={liveBounds}
          count={multiCount}
          onPatch={updateLayer}
          onTranslate={translateLayer}
          size={
            isPathLike
              ? {
                  layer: currentLayer,
                  selectedLayers: inspectorLayers,
                  bounds: selectionBounds,
                  progressMs: playheadMs,
                }
              : undefined
          }
        />

        {allPaths && (
          <LayerAppearanceSections
            layer={liveLayer!}
            selectedLayers={single ? [liveLayer!] : inspectorLayers}
            count={multiCount}
            onChange={updateLayer}
          />
        )}

        {/* The raw command list is the most technical part of the panel; collapsed until asked for. */}
        {isPathLike && multiCount <= 1 && (
          <Section
            title="Path"
            defaultOpen={currentLayer.type === "clipPath"}
            action={
              <>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setIsCommandsFocused(true)}
                  aria-label="Focus path commands"
                  title="Expand path commands"
                >
                  <Maximize2 className="size-3.5" />
                </Button>
              </>
            }
          >
            <div className="overflow-hidden rounded-md border border-border">
              {commandsList("max-h-72")}
            </div>
            <button
              type="button"
              onClick={() => setShowPathData((s) => !s)}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <ChevronRight
                className={cn("size-3.5 transition-transform", showPathData && "rotate-90")}
              />
              SVG path data
            </button>
            {showPathData && (
              <PathDataEditor
                key={`${selectedFrameId}:${String(selectedLayerId)}:${editingSide}`}
                path={currentLayer[editingSide] ?? currentLayer.from}
                onCommit={setPath}
              />
            )}
          </Section>
        )}

        {/* Selected point(s) - supports lasso multi-select */}
        {(selection || (selectedPoints && selectedPoints.length > 0)) && (
          <Section
            title={
              selectedPoints && selectedPoints.length > 1
                ? `${selectedPoints.length} points`
                : "Point"
            }
            action={
              <button
                type="button"
                className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                onClick={() => deleteSelectedPoint()}
                aria-label={
                  selectedPoints && selectedPoints.length > 1 ? "Delete points" : "Delete point"
                }
                title="Delete"
              >
                <Trash2 className="size-3.5" />
              </button>
            }
          >
            {(!selectedPoints || selectedPoints.length <= 1) && (
              <div className="grid grid-cols-2 gap-1.5">
                <NumberRow
                  label="X"
                  compact
                  value={point?.x ?? 0}
                  step={0.1}
                  onChange={(v) => {
                    useEditorStore.getState().ensurePathKeyframeAtPlayhead();
                    updateSelectedPoint({ x: v, y: point?.y ?? 0 });
                  }}
                />
                <NumberRow
                  label="Y"
                  compact
                  value={point?.y ?? 0}
                  step={0.1}
                  onChange={(v) => {
                    useEditorStore.getState().ensurePathKeyframeAtPlayhead();
                    updateSelectedPoint({ x: point?.x ?? 0, y: v });
                  }}
                />
              </div>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

function InspectorHeader({
  icon,
  title,
  subtitle,
  mobileSubtitle,
  actions,
  onRename,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: React.ReactNode;
  mobileSubtitle?: React.ReactNode;
  actions?: React.ReactNode;
  onRename?: (name: string) => void;
}) {
  const mobileHeader = useMobilePanelHeader();
  const [draft, setDraft] = React.useState(title);
  React.useEffect(() => setDraft(title), [title]);
  const commit = () => {
    const next = draft.trim();
    if (next && next !== title) onRename?.(next);
    else setDraft(title);
  };
  return (
    <PanelHeader
      className="inspector-header flex min-h-12 shrink-0 items-center gap-2 border-b border-border py-1.5 pl-3 pr-2"
      actions={actions && <div className="flex shrink-0 items-center">{actions}</div>}
    >
      <div className="grid size-6 shrink-0 place-items-center rounded-md bg-secondary text-muted-foreground in-[.mobile-workspace]:hidden">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        {onRename ? (
          <input
            aria-label="Name"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
              if (event.key === "Escape") {
                setDraft(title);
                requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
              }
              event.stopPropagation();
            }}
            className="-ml-1 h-5 w-full truncate rounded px-1 text-[12px] font-semibold leading-tight outline-none hover:bg-muted focus:bg-background focus:ring-1 focus:ring-primary"
          />
        ) : (
          <div className="truncate text-[12px] font-semibold leading-tight">{title}</div>
        )}
        <div className="mt-0.5 truncate text-[11px] leading-none text-muted-foreground">
          {mobileHeader ? (mobileSubtitle ?? subtitle) : subtitle}
        </div>
      </div>
    </PanelHeader>
  );
}

/** With nothing selected the panel shows document-level controls instead of an empty void. */
function DocumentPanel() {
  const duration = useEditorStore((state) => state.animation.duration);
  const setAnimationDuration = useEditorStore((state) => state.setAnimationDuration);
  const isRepeating = useEditorStore((state) => state.isRepeating);
  const playbackMode = useEditorStore((state) => state.playbackMode);
  const toggleRepeating = useEditorStore((state) => state.toggleRepeating);
  const vector = useEditorStore((state) => state.vector);
  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <InspectorHeader
        icon={<RectangleHorizontal className="size-3.5" />}
        title={vector?.name || "Document"}
        subtitle="Nothing selected"
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Animation">
          <NumberRow
            label="Duration"
            value={duration}
            min={100}
            step={10}
            suffix="ms"
            onChange={(value) => setAnimationDuration(Math.max(100, Math.round(value)))}
          />
          <label className="flex h-7 items-center justify-between text-[11px] text-muted-foreground">
            Loop playback
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={isRepeating}
              onChange={toggleRepeating}
            />
          </label>
          <label className="flex h-7 items-center justify-between text-[11px] text-muted-foreground">
            Back-and-forth playback
            <input
              type="checkbox"
              className="size-3.5 accent-primary"
              checked={playbackMode === "back-and-forth"}
              onChange={(event) =>
                useEditorStore
                  .getState()
                  .setPlaybackMode(event.target.checked ? "back-and-forth" : "forward")
              }
            />
          </label>
        </Section>
        <div className="space-y-2 px-3 py-4 text-[11px] leading-relaxed text-muted-foreground">
          <p>Select a layer to edit it. Click ◇ next to any property to animate it.</p>
        </div>
      </div>
    </div>
  );
}

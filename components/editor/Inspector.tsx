"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Maximize2,
  Minimize2,
  Trash2,
  ChevronRight,
  SlidersHorizontal,
  MousePointerClick,
  Crop,
  Folder,
  Spline,
  Pencil,
  RectangleHorizontal,
  Activity,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { PAGE_ROOT_ID, useEditorStore } from "@/lib/store/editorStore";
import {
  changeCommandType,
  parsePath,
  pathToString,
  updateCommandPoint,
} from "@/lib/shapeshifter/pathUtils";
import type {
  FillType,
  GradientType,
  Layer,
} from "@/lib/shapeshifter/types";
import {
  gradientFromSolid,
} from "@/lib/shapeshifter/gradients";
import { PathCommandsList } from "./PathCommandsList";
import {
  getInspectorSelectionBounds,
  resolveOwnedLayers,
  sharedValue,
} from "@/lib/shapeshifter/scene/inspectorSelection";
import {
  NumberRow,
  Row,
  Section,
  Segmented,
  TextInput,
} from "./inspector/InspectorControls";
import {
  ColorRow,
  GradientEditor,
} from "./inspector/InspectorColorControls";
import {
  FrameDesignPanel,
  InspectorTabs,
  LayerTransformSection,
  MotionPanel,
  type InspectorTab,
} from "./inspector/InspectorPanels";

/* ------------------------------------------------------------------ */
/* Field primitives — a small, consistent Figma-grade control system  */
/* ------------------------------------------------------------------ */


/* ------------------------------------------------------------------ */
/* Inspector                                                          */
/* ------------------------------------------------------------------ */

export function Inspector() {
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
  const startActionMode = useEditorStore((state) => state.startActionMode);
  const animation = useEditorStore((state) => state.animation);
  const selectedPoints = useEditorStore((state) => state.selectedPoints);
  const selectPoint = useEditorStore((state) => state.selectPoint);
  const booleanCombine = useEditorStore((state) => state.booleanCombine);
  const toggleLayerLock = useEditorStore((state) => state.toggleLayerLock);
  const selectionKind = useEditorStore((state) => state.selectionKind);
  const frames = useEditorStore((state) => state.frames);
  const rootLayers = useEditorStore((state) => state.rootLayers);
  const selectedFrameId = useEditorStore((state) => state.selectedFrameId);
  const renameFrame = useEditorStore((state) => state.renameFrame);
  const moveFrame = useEditorStore((state) => state.moveFrame);
  const duplicateFrame = useEditorStore((state) => state.duplicateFrame);
  const deleteFrame = useEditorStore((state) => state.deleteFrame);
  const updateVector = useEditorStore((state) => state.updateVector);

  const point = getCurrentSelectedPoint ? getCurrentSelectedPoint() : null;
  const currentLayer = layers.find((l) => l.id === selectedLayerId);
  const currentFrame = frames.find((frame) => frame.id === selectedFrameId);
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
  const updateLayer = (patch: Partial<Layer>) => updateSelectedLayer(patch);
  const setPath = (parsed: ReturnType<typeof parsePath>) =>
    updateLayer(editingSide === "from" ? { from: parsed, pathData: parsed } : { to: parsed });

  const [isCommandsFocused, setIsCommandsFocused] = React.useState(false);
  const [showPathData, setShowPathData] = React.useState(false);
  const [activeTab, setActiveTab] = React.useState<InspectorTab>("design");

  React.useEffect(() => {
    if (!isCommandsFocused) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setIsCommandsFocused(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isCommandsFocused]);

  /* ---- empty state ---- */
  if (selectionKind === "none" || (selectionKind === "layer" && !currentLayer)) {
    return (
      <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
        <InspectorTabs value={activeTab} onChange={setActiveTab} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <MousePointerClick size={24} />
          </div>
          <p className="max-w-[12rem] text-xs leading-relaxed text-muted-foreground">
            Select a layer or point to edit its properties
          </p>
        </div>
      </div>
    );
  }

  if (selectionKind === "frame" && currentFrame) {
    return (
      <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
        <InspectorTabs value={activeTab} onChange={setActiveTab} />
        <div className="flex h-13 items-center gap-2.5 border-b border-border px-3">
          <div className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
            <RectangleHorizontal className="size-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-semibold">{currentFrame.name}</div>
            <div className="text-[10px] text-muted-foreground">Frame · {currentFrame.vector.width} × {currentFrame.vector.height}</div>
          </div>
        </div>
        {activeTab === "design" ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <FrameDesignPanel
              frame={currentFrame}
              onRename={(name) => renameFrame(currentFrame.id, name)}
              onMove={(dx, dy) => moveFrame(currentFrame.id, dx, dy)}
              onResize={(width, height) => updateVector({ width, height })}
              onDuplicate={duplicateFrame}
              onDelete={() => deleteFrame(currentFrame.id)}
              canDelete={frames.length > 1}
            />
          </div>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-muted-foreground">
            <Activity className="size-5" />
            <p className="text-[11px] leading-relaxed">Select a vector inside this frame to edit its motion.</p>
          </div>
        )}
      </div>
    );
  }

  if (!currentLayer) return null;

  const commandsList = (extraClass?: string) => (
    <PathCommandsList
      pathData={(currentLayer[editingSide] ?? currentLayer.from)}
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
          updateCommandPoint((currentLayer[editingSide] ?? currentLayer.from), subPathIndex, commandIndex, pointIndex, newPoint),
        );
      }}
      onChangeCommandType={(subPathIndex, commandIndex, newType) => {
        setPath(changeCommandType((currentLayer[editingSide] ?? currentLayer.from), subPathIndex, commandIndex, newType));
      }}
    />
  );

  /* ---- dedicated full-height command focus mode ---- */
  if (isCommandsFocused) {
    return (
      <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex h-14 items-center justify-between border-b border-border px-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[13px] font-semibold">Path commands</span>
            <span className="rounded bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground">
              d
            </span>
            <span className="truncate text-[11px] text-muted-foreground">{currentLayer.name}</span>
          </div>
          <Button
            size="icon-sm"
            variant="ghost"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setIsCommandsFocused(false)}
            aria-label="Exit focus (Esc)"
          >
            <Minimize2 className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-2">{commandsList("h-full")}</div>
      </div>
    );
  }

  const isGroup = currentLayer.type === "group";
  const inspectorLayers = selectedLayers.length ? selectedLayers : [currentLayer];
  const allPaths = inspectorLayers.every((layer) => layer.type !== "group");
  const fillKindValue = (layer: Layer): "solid" | GradientType =>
    layer.fillGradient?.type ?? "solid";
  const fillKind = sharedValue(inspectorLayers, fillKindValue, fillKindValue(currentLayer));
  const fillColor = sharedValue(
    inspectorLayers,
    (layer) => layer.fillColor || "#000000",
    currentLayer.fillColor || "#000000",
  );
  const fillAlpha = sharedValue(
    inspectorLayers,
    (layer) => layer.fillAlpha ?? 1,
    currentLayer.fillAlpha ?? 1,
  );
  const fillRule = sharedValue(
    inspectorLayers,
    (layer) => layer.fillType ?? "nonZero",
    currentLayer.fillType ?? "nonZero",
  );
  const strokeColor = sharedValue(
    inspectorLayers,
    (layer) => layer.strokeColor || "#000000",
    currentLayer.strokeColor || "#000000",
  );
  const strokeAlpha = sharedValue(
    inspectorLayers,
    (layer) => layer.strokeAlpha ?? 1,
    currentLayer.strokeAlpha ?? 1,
  );
  const strokeWidth = sharedValue(
    inspectorLayers,
    (layer) => layer.strokeWidth ?? 0,
    currentLayer.strokeWidth ?? 0,
  );
  const trimStart = sharedValue(
    inspectorLayers,
    (layer) => layer.trimPathStart ?? 0,
    currentLayer.trimPathStart ?? 0,
  );
  const trimEnd = sharedValue(
    inspectorLayers,
    (layer) => layer.trimPathEnd ?? 1,
    currentLayer.trimPathEnd ?? 1,
  );
  const trimOffset = sharedValue(
    inspectorLayers,
    (layer) => layer.trimPathOffset ?? 0,
    currentLayer.trimPathOffset ?? 0,
  );

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <InspectorTabs value={activeTab} onChange={setActiveTab} />
      {/* Header */}
      <div className="flex h-13 items-center gap-2.5 border-b border-border px-3">
        <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
          {currentLayer.type === "clipPath" ? (
            <Crop size={16} />
          ) : isGroup ? (
            <Folder size={16} />
          ) : (
            <Spline size={16} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold leading-tight">
            {currentLayer.name}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] leading-none text-muted-foreground">
            <span className="capitalize">{currentLayer.type}</span>
            {!isGroup && (
              <span className="rounded bg-muted px-1 py-0.5 text-[10px] capitalize">
                {editingSide}
              </span>
            )}
            {animation.blocks.some((b) => String(b.layerId) === String(currentLayer.id)) && (
              <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] text-primary">
                anim
              </span>
            )}
          </div>
        </div>
        {!isGroup && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={startActionMode}
                  aria-label="Edit path morph"
                />
              }
            >
              <Pencil size={17} />
            </TooltipTrigger>
            <TooltipContent>Edit path morph (start → end)</TooltipContent>
          </Tooltip>
        )}
      </div>

      {activeTab === "motion" ? (
        <MotionPanel layer={currentLayer} selectionCount={multiCount} onEditMorph={startActionMode} />
      ) : (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <LayerTransformSection
          layer={currentLayer}
          selectedLayers={selectedLayers.length ? selectedLayers : [currentLayer]}
          bounds={selectionBounds}
          count={multiCount}
          onPatch={updateLayer}
          onTranslate={translateSelectedLayer}
          onToggleLock={() => toggleLayerLock(currentLayer.id)}
        />
        {/* Layer */}
        {multiCount <= 1 && <Section title="Layer" defaultOpen={false}>
          <Row label="Name">
            <TextInput ariaLabel="Layer name" value={currentLayer.name} onChange={(v) => updateLayer({ name: v })} />
          </Row>
          <Row label="Type">
            <Segmented
              value={currentLayer.type}
              onChange={(v) => updateLayer({ type: v as Layer["type"] })}
              options={[
                { value: "path", label: "Path" },
                { value: "clipPath", label: "Clip" },
                { value: "group", label: "Group" },
              ]}
            />
          </Row>
        </Section>}

        {allPaths && (
          <>
            {/* Fill */}
            <Section title="Fill">
              {(() => {
                const setKind = (kind: "solid" | GradientType) => {
                  if (kind === "solid") {
                    updateLayer({ fillGradient: undefined });
                    return;
                  }
                  const existing = currentLayer.fillGradient;
                  updateLayer({
                    fillGradient: existing
                      ? { ...existing, type: kind }
                      : gradientFromSolid(kind, currentLayer.fillColor || "#000000"),
                  });
                };
                return (
                  <>
                    <Row label="Type">
                      <Segmented<"solid" | GradientType>
                        value={fillKind.value}
                        mixed={fillKind.mixed}
                        onChange={setKind}
                        options={[
                          { value: "solid", label: "Solid" },
                          { value: "linear", label: "Linear" },
                          { value: "radial", label: "Radial" },
                        ]}
                      />
                    </Row>
                    {fillKind.mixed ? (
                      <p className="rounded-md bg-muted/55 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                        Multiple fill types. Choose one above to apply it to the selection.
                      </p>
                    ) : currentLayer.fillGradient ? (
                      <>
                        <GradientEditor
                          gradient={currentLayer.fillGradient}
                          onChange={(g) => updateLayer({ fillGradient: g })}
                        />
                        {currentLayer.fillGradient.type === "linear" && (
                          <NumberRow
                            label="Angle"
                            value={currentLayer.fillGradient.angle ?? 90}
                            suffix="°"
                            onChange={(v) =>
                              updateLayer({
                                fillGradient: { ...currentLayer.fillGradient!, angle: v },
                              })
                            }
                          />
                        )}
                        <NumberRow
                          label="Opacity"
                          value={Math.round(fillAlpha.value * 100)}
                          mixed={fillAlpha.mixed}
                          min={0}
                          max={100}
                          suffix="%"
                          onChange={(v) => updateLayer({ fillAlpha: v / 100 })}
                        />
                      </>
                    ) : (
                      <ColorRow
                        label="Color"
                        color={fillColor.value}
                        alpha={fillAlpha.value}
                        mixed={fillColor.mixed}
                        alphaMixed={fillAlpha.mixed}
                        onColor={(v) => updateLayer({ fillColor: v })}
                        onAlpha={(v) => updateLayer({ fillAlpha: v })}
                      />
                    )}
                  </>
                );
              })()}
              <Row label="Rule">
                <Segmented
                  value={fillRule.value}
                  mixed={fillRule.mixed}
                  onChange={(v) => updateLayer({ fillType: v as FillType })}
                  options={[
                    { value: "nonZero", label: "Non-zero" },
                    { value: "evenOdd", label: "Even-odd" },
                  ]}
                />
              </Row>
            </Section>

            {/* Stroke */}
            <Section title="Stroke">
              <ColorRow
                color={strokeColor.value}
                alpha={strokeAlpha.value}
                mixed={strokeColor.mixed}
                alphaMixed={strokeAlpha.mixed}
                onColor={(v) => updateLayer({ strokeColor: v })}
                onAlpha={(v) => updateLayer({ strokeAlpha: v })}
              />
              <div className="flex items-center gap-1.5">
                <div className="min-w-0 flex-1">
                  <NumberRow
                    label="Width"
                    value={strokeWidth.value}
                    mixed={strokeWidth.mixed}
                    min={0}
                    step={0.1}
                    onChange={(v) => updateLayer({ strokeWidth: v })}
                  />
                </div>
                {/* Figma tucks cap/join/dash behind a settings popover instead of
                    always showing them — keeps the panel compact when they're rarely touched. */}
                <Popover>
                  <PopoverTrigger
                    className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-muted/70 hover:text-foreground"
                    aria-label="Stroke settings"
                    title="Stroke settings"
                  >
                    <SlidersHorizontal className="size-3.5" />
                  </PopoverTrigger>
                  <PopoverContent align="end" side="bottom" sideOffset={6} className="w-56">
                    <div>
                      <div className="mb-1 text-[10px] font-medium text-muted-foreground">Cap</div>
                      <div className="flex items-center gap-px rounded-md bg-muted p-0.5">
                        {([
                          { v: "butt", label: "Butt", icon: <svg width="14" height="10" viewBox="0 0 14 10" className="mx-auto"><line x1="1" y1="5" x2="13" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="butt" /></svg> },
                          { v: "round", label: "Round", icon: <svg width="14" height="10" viewBox="0 0 14 10" className="mx-auto"><line x1="1" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /><circle cx="11" cy="5" r="1.5" fill="none" stroke="currentColor" strokeWidth="1" /></svg> },
                          { v: "square", label: "Square", icon: <svg width="14" height="10" viewBox="0 0 14 10" className="mx-auto"><line x1="1" y1="5" x2="11" y2="5" stroke="currentColor" strokeWidth="2" strokeLinecap="square" /><rect x="10" y="3.5" width="3" height="3" fill="none" stroke="currentColor" strokeWidth="1" /></svg> },
                        ] as const).map(({ v, label, icon }) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => updateLayer({ strokeLinecap: v })}
                            className={cn(
                              "flex h-7 flex-1 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted/70",
                              (currentLayer.strokeLinecap ?? "butt") === v && "bg-card text-foreground shadow-sm"
                            )}
                            title={label}
                            aria-label={label}
                          >
                            {icon}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-2.5">
                      <div className="mb-1 text-[10px] font-medium text-muted-foreground">Join</div>
                      <div className="flex items-center gap-px rounded-md bg-muted p-0.5">
                        {([
                          { v: "miter", label: "Miter", icon: <svg width="14" height="10" viewBox="0 0 14 10" className="mx-auto"><polyline points="1,8 7,2 13,8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="miter" /></svg> },
                          { v: "round", label: "Round", icon: <svg width="14" height="10" viewBox="0 0 14 10" className="mx-auto"><polyline points="1,8 7,2 13,8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg> },
                          { v: "bevel", label: "Bevel", icon: <svg width="14" height="10" viewBox="0 0 14 10" className="mx-auto"><polyline points="1,8 7,3 13,8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="bevel" /></svg> },
                        ] as const).map(({ v, label, icon }) => (
                          <button
                            key={v}
                            type="button"
                            onClick={() => updateLayer({ strokeLinejoin: v })}
                            className={cn(
                              "flex h-7 flex-1 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-muted/70",
                              (currentLayer.strokeLinejoin ?? "miter") === v && "bg-card text-foreground shadow-sm"
                            )}
                            title={label}
                            aria-label={label}
                          >
                            {icon}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="mt-2.5 flex items-center gap-2">
                      <span className="w-10 shrink-0 text-[11px] text-muted-foreground">Dash</span>
                      <TextInput
                        ariaLabel="Stroke dash pattern"
                        value={currentLayer.strokeDasharray ?? ""}
                        placeholder="e.g. 4 2"
                        onChange={(v) => updateLayer({ strokeDasharray: v || undefined })}
                      />
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              {/* Clarify scope: stroke is per-layer (affects every subpath). Users can split for independent styling. */}
              {currentLayer.from?.subPaths && currentLayer.from.subPaths.length > 1 && (
                <p className="mt-1 text-[9px] leading-tight text-muted-foreground/60">
                  Applies to all {currentLayer.from.subPaths.length} subpaths in this layer.
                  Select a subpath (in path commands or direct tool) then use Edit → Extract to separate.
                </p>
              )}
            </Section>

            {/* Trim path — collapsed unless already in use (Figma keeps rarely-touched
                sections like this closed by default to keep the panel scannable). */}
            <Section
              title="Trim path"
              defaultOpen={
                (currentLayer.trimPathStart ?? 0) !== 0 ||
                (currentLayer.trimPathEnd ?? 1) !== 1 ||
                (currentLayer.trimPathOffset ?? 0) !== 0
              }
            >
              <NumberRow
                label="Start"
                value={Math.round(trimStart.value * 100)}
                mixed={trimStart.mixed}
                min={0}
                max={100}
                step={1}
                suffix="%"
                onChange={(v) => updateLayer({ trimPathStart: Math.max(0, Math.min(1, v / 100)) })}
              />
              <NumberRow
                label="End"
                value={Math.round(trimEnd.value * 100)}
                mixed={trimEnd.mixed}
                min={0}
                max={100}
                step={1}
                suffix="%"
                onChange={(v) => updateLayer({ trimPathEnd: Math.max(0, Math.min(1, v / 100)) })}
              />
              <NumberRow
                label="Offset"
                value={Math.round(trimOffset.value * 100)}
                mixed={trimOffset.mixed}
                step={1}
                suffix="%"
                onChange={(v) => updateLayer({ trimPathOffset: v / 100 })}
              />
            </Section>

            {/* Path — raw command list is the densest, most technical part of the
                panel (Figma never shows this by default); collapsed until asked for. */}
            {multiCount <= 1 && <Section
              title="Path"
              defaultOpen={false}
              action={
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setIsCommandsFocused(true)}
                  aria-label="Focus path commands"
                >
                  <Maximize2 className="size-3.5" />
                </Button>
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
                <textarea
                  value={pathToString((currentLayer[editingSide] ?? currentLayer.from))}
                  onChange={(e) => {
                    try {
                      setPath(parsePath(e.target.value));
                    } catch {
                      toast.error("Invalid path data");
                    }
                  }}
                  spellCheck={false}
                  className="min-h-20 w-full resize-y rounded-md border border-border bg-background p-2 font-mono text-[10px] leading-relaxed text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              )}
            </Section>}

            {/* Boolean combine with the layer below (mirrors the toolbar Edit menu). */}
            {multiCount <= 1 && (() => {
              const idx = layers.findIndex((l) => l.id === currentLayer.id);
              const hasNext = idx >= 0 && idx < layers.length - 1;
              if (!hasNext) return null;
              // Two overlapping circles per op, matching each boolean result region
              // (mirrors the original Material Symbols join_* icons this replaced).
              const ops = [
                {
                  op: "union",
                  label: "Union",
                  icon: (
                    <svg width="15" height="15" viewBox="0 0 16 16">
                      <circle cx="6" cy="8" r="5" fill="currentColor" opacity="0.55" />
                      <circle cx="10" cy="8" r="5" fill="currentColor" opacity="0.55" />
                    </svg>
                  ),
                },
                {
                  op: "subtract",
                  label: "Subtract",
                  icon: (
                    <svg width="15" height="15" viewBox="0 0 16 16">
                      <mask id="bool-subtract-mask">
                        <rect width="16" height="16" fill="black" />
                        <circle cx="6" cy="8" r="5" fill="white" />
                        <circle cx="10" cy="8" r="5" fill="black" />
                      </mask>
                      <circle cx="10" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" />
                      <rect width="16" height="16" fill="currentColor" mask="url(#bool-subtract-mask)" />
                    </svg>
                  ),
                },
                {
                  op: "intersect",
                  label: "Intersect",
                  icon: (
                    <svg width="15" height="15" viewBox="0 0 16 16">
                      <mask id="bool-intersect-mask">
                        <rect width="16" height="16" fill="black" />
                        <circle cx="6" cy="8" r="5" fill="white" />
                      </mask>
                      <circle cx="6" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" />
                      <circle cx="10" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.35" />
                      <circle cx="10" cy="8" r="5" fill="currentColor" mask="url(#bool-intersect-mask)" />
                    </svg>
                  ),
                },
                {
                  op: "exclude",
                  label: "Exclude",
                  icon: (
                    <svg width="15" height="15" viewBox="0 0 16 16">
                      <mask id="bool-exclude-mask">
                        <circle cx="6" cy="8" r="5" fill="white" />
                        <circle cx="10" cy="8" r="5" fill="white" />
                        <circle cx="8" cy="8" r="3.2" fill="black" />
                      </mask>
                      <rect width="16" height="16" fill="currentColor" mask="url(#bool-exclude-mask)" />
                    </svg>
                  ),
                },
              ] as const;
              return (
                <Section title="Combine" defaultOpen={false}>
                  <p className="text-[10px] leading-relaxed text-muted-foreground">
                    Boolean with the layer below ({layers[idx + 1]?.name}).
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {ops.map(({ op, label, icon }) => (
                      <button
                        key={op}
                        type="button"
                        onClick={() => {
                          booleanCombine(op);
                          toast.success(label);
                        }}
                        className="flex h-8 items-center justify-center gap-1.5 rounded-md border border-border bg-background text-[11px] text-foreground transition-colors hover:border-foreground/20 hover:bg-muted"
                      >
                        <span className="text-muted-foreground">{icon}</span>
                        {label}
                      </button>
                    ))}
                  </div>
                </Section>
              );
            })()}
          </>
        )}

        {/* Selected point(s) - supports lasso multi-select */}
        {(selection || (selectedPoints && selectedPoints.length > 0)) && (
          <Section title={selectedPoints && selectedPoints.length > 1 ? `Selected points (${selectedPoints.length})` : "Selected point"}>
            {selectedPoints && selectedPoints.length > 1 ? (
              <p className="text-[10px] text-muted-foreground mb-1">Batch edit via drag or delete (lasso).</p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <NumberRow
                  label="X"
                  value={point?.x ?? 0}
                  step={0.1}
                  onChange={(v) => updateSelectedPoint({ x: v, y: point?.y ?? 0 })}
                />
                <NumberRow
                  label="Y"
                  value={point?.y ?? 0}
                  step={0.1}
                  onChange={(v) => updateSelectedPoint({ x: point?.x ?? 0, y: v })}
                />
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-8 w-full justify-start gap-1.5 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => deleteSelectedPoint()}
            >
              <Trash2 className="size-3.5" /> Delete {selectedPoints && selectedPoints.length > 1 ? "points" : "point"}
            </Button>
          </Section>
        )}
      </div>
      )}
    </div>
  );
}

"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Copy, Link2, Lock, Pencil, Trash2, Unlink2, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/lib/store/editorStore";
import type { CanvasFrame } from "@/lib/store/editorStore";
import type { Layer } from "@/lib/shapeshifter/types";
import { propertyLabel } from "@/lib/shapeshifter/propertyLabels";
import {
  sharedValue,
  type InspectorSelectionBounds,
} from "@/lib/shapeshifter/scene/inspectorSelection";
import { NumberRow, Row, Section, TextInput } from "./InspectorControls";

export type InspectorTab = "design" | "motion";

export function InspectorTabs({
  value,
  onChange,
}: {
  value: InspectorTab;
  onChange: (tab: InspectorTab) => void;
}) {
  return (
    <div
      className="grid h-9 grid-cols-2 border-b border-border/80 px-3"
      role="tablist"
      aria-label="Inspector mode"
    >
      {(["design", "motion"] as const).map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={value === tab}
          onClick={() => onChange(tab)}
          className={cn(
            "relative text-[11px] font-medium capitalize text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/35",
            value === tab && "text-foreground",
          )}
        >
          {tab}
          {value === tab && <span className="absolute inset-x-4 bottom-0 h-px bg-primary" />}
        </button>
      ))}
    </div>
  );
}

export function LayerTransformSection({
  layer,
  selectedLayers,
  bounds,
  count,
  onPatch,
  onTranslate,
  onToggleLock,
}: {
  layer: Layer;
  selectedLayers: Layer[];
  bounds: InspectorSelectionBounds | null;
  count: number;
  onPatch: (patch: Partial<Layer>) => void;
  onTranslate: (dx: number, dy: number) => void;
  onToggleLock: () => void;
}) {
  const scaleX = sharedValue(selectedLayers, (item) => item.scaleX ?? 1, layer.scaleX ?? 1);
  const scaleY = sharedValue(selectedLayers, (item) => item.scaleY ?? 1, layer.scaleY ?? 1);
  const rotation = sharedValue(selectedLayers, (item) => item.rotation ?? 0, layer.rotation ?? 0);
  const positionX = bounds?.x ?? layer.translateX ?? 0;
  const positionY = bounds?.y ?? layer.translateY ?? 0;
  const blocks = useEditorStore((state) => state.animation.blocks);
  const addTimelineBlock = useEditorStore((state) => state.addTimelineBlock);
  const removeTimelineProperty = useEditorStore((state) => state.removeTimelineProperty);
  const [scaleLinked, setScaleLinked] = React.useState(
    () => !scaleX.mixed && !scaleY.mixed && Math.abs(scaleX.value - scaleY.value) < 1e-6,
  );
  React.useEffect(() => {
    if (scaleX.mixed || scaleY.mixed) setScaleLinked(false);
  }, [layer.id, scaleX.mixed, scaleY.mixed]);

  const patchScale = (axis: "x" | "y", percent: number) => {
    const value = percent / 100;
    if (!scaleLinked) {
      onPatch(axis === "x" ? { scaleX: value } : { scaleY: value });
      return;
    }
    const current = axis === "x" ? scaleX.value : scaleY.value;
    const other = axis === "x" ? scaleY.value : scaleX.value;
    const linkedValue = Math.abs(current) > 1e-6 ? other * (value / current) : value;
    onPatch(
      axis === "x"
        ? { scaleX: value, scaleY: linkedValue }
        : { scaleX: linkedValue, scaleY: value },
    );
  };
  const keyframeFor = (propertyName: string) => {
    if (count !== 1) return undefined;
    const matches = blocks.filter(
      (block) => String(block.layerId) === String(layer.id) && block.propertyName === propertyName,
    );
    const active = matches.length > 0;
    const label = propertyLabel(propertyName);
    return {
      active,
      label: active ? `Remove ${label} animation` : `Animate ${label}`,
      onClick: () =>
        active
          ? removeTimelineProperty(layer.id, propertyName)
          : addTimelineBlock(layer.id, propertyName),
    };
  };
  return (
    <Section
      title={count > 1 ? `Transform · ${count} layers` : "Transform"}
      action={
        <div className="flex items-center">
          <button
            type="button"
            onClick={() => setScaleLinked((linked) => !linked)}
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Link scale proportions"
            aria-pressed={scaleLinked}
            title={scaleLinked ? "Scale proportions linked" : "Scale proportions unlinked"}
          >
            {scaleLinked ? <Link2 className="size-3.5" /> : <Unlink2 className="size-3.5" />}
          </button>
          <button
            type="button"
            onClick={onToggleLock}
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={layer.locked ? "Unlock layer" : "Lock layer"}
            title={layer.locked ? "Unlock layer" : "Lock layer"}
          >
            {layer.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
          </button>
        </div>
      }
    >
      {count > 1 && (
        <p className="text-[10px] text-muted-foreground">Values apply to the full selection.</p>
      )}
      <div className="grid grid-cols-2 gap-1.5">
        <NumberRow
          label="X"
          compact
          value={positionX}
          onChange={(value) => onTranslate(value - positionX, 0)}
          keyframe={keyframeFor("translateX")}
        />
        <NumberRow
          label="Y"
          compact
          value={positionY}
          onChange={(value) => onTranslate(0, value - positionY)}
          keyframe={keyframeFor("translateY")}
        />
        <NumberRow
          label="SX"
          compact
          value={Math.round(scaleX.value * 10000) / 100}
          mixed={scaleX.mixed}
          step={1}
          suffix="%"
          onChange={(value) => patchScale("x", value)}
          keyframe={keyframeFor("scaleX")}
        />
        <NumberRow
          label="SY"
          compact
          value={Math.round(scaleY.value * 10000) / 100}
          mixed={scaleY.mixed}
          step={1}
          suffix="%"
          onChange={(value) => patchScale("y", value)}
          keyframe={keyframeFor("scaleY")}
        />
      </div>
      <NumberRow
        label="R"
        compact
        value={rotation.value}
        mixed={rotation.mixed}
        suffix="°"
        onChange={(value) => onPatch({ rotation: value })}
        keyframe={keyframeFor("rotation")}
      />
      {count > 1 && bounds?.coordinateSpace === "world" && (
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          X and Y use page coordinates across frames.
        </p>
      )}
      {count === 1 && (
        <details className="group/details pt-0.5">
          <summary className="cursor-pointer select-none text-[10px] text-muted-foreground hover:text-foreground">
            Transform origin
          </summary>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            <NumberRow
              label="X"
              value={layer.pivotX ?? 0}
              onChange={(value) => onPatch({ pivotX: value })}
            />
            <NumberRow
              label="Y"
              value={layer.pivotY ?? 0}
              onChange={(value) => onPatch({ pivotY: value })}
            />
          </div>
        </details>
      )}
    </Section>
  );
}

export function FrameDesignPanel({
  frame,
  selectedFrames,
  onRename,
  onMove,
  onResize,
  onDuplicate,
  onDelete,
  canDelete,
}: {
  frame: CanvasFrame;
  selectedFrames: CanvasFrame[];
  onRename: (name: string) => void;
  onMove: (dx: number, dy: number) => void;
  onResize: (width: number, height: number) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const count = selectedFrames.length;
  const selectionX = Math.min(...selectedFrames.map((item) => item.x));
  const selectionY = Math.min(...selectedFrames.map((item) => item.y));
  const widthValues = selectedFrames.map((item) => item.vector.width);
  const heightValues = selectedFrames.map((item) => item.vector.height);
  const widths = {
    value: widthValues[0] ?? frame.vector.width,
    mixed: widthValues.some((value) => value !== widthValues[0]),
  };
  const heights = {
    value: heightValues[0] ?? frame.vector.height,
    mixed: heightValues.some((value) => value !== heightValues[0]),
  };
  const [nameDraft, setNameDraft] = React.useState(frame.name);
  React.useEffect(() => setNameDraft(frame.name), [frame.id, frame.name]);

  return (
    <>
      <Section title={count > 1 ? `Frames · ${count}` : "Frame"}>
        {count === 1 ? (
          <Row label="Name">
            <TextInput
              value={nameDraft}
              onChange={setNameDraft}
              onBlur={() => onRename(nameDraft)}
              ariaLabel="Frame name"
            />
          </Row>
        ) : (
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Position changes move every selected frame together.
          </p>
        )}
      </Section>
      <Section title="Position & intrinsic size">
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          <NumberRow
            label="X"
            value={selectionX}
            onChange={(value) => onMove(value - selectionX, 0)}
          />
          <NumberRow
            label="Y"
            value={selectionY}
            onChange={(value) => onMove(0, value - selectionY)}
          />
          {count === 1 ? (
            <>
              <NumberRow
                label="Intrinsic W"
                value={frame.vector.width}
                min={1}
                onChange={(value) => onResize(value, frame.vector.height)}
              />
              <NumberRow
                label="Intrinsic H"
                value={frame.vector.height}
                min={1}
                onChange={(value) => onResize(frame.vector.width, value)}
              />
            </>
          ) : (
            <>
              <Row label="W">
                <span className="text-[11px] text-muted-foreground">
                  {widths.mixed ? "Mixed" : widths.value}
                </span>
              </Row>
              <Row label="H">
                <span className="text-[11px] text-muted-foreground">
                  {heights.mixed ? "Mixed" : heights.value}
                </span>
              </Row>
            </>
          )}
        </div>
      </Section>
      {count === 1 && (
        <Section title="Android">
          <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
            <NumberRow
              label="VP W"
              value={frame.vector.viewportWidth ?? frame.vector.width}
              min={1}
              onChange={(value) => useEditorStore.getState().updateVector({ viewportWidth: value })}
            />
            <NumberRow
              label="VP H"
              value={frame.vector.viewportHeight ?? frame.vector.height}
              min={1}
              onChange={(value) =>
                useEditorStore.getState().updateVector({ viewportHeight: value })
              }
            />
          </div>
          <Row label="Tint">
            <TextInput
              ariaLabel="Android tint"
              value={frame.vector.tint ?? ""}
              onChange={(value) =>
                useEditorStore.getState().updateVector({ tint: value || undefined })
              }
            />
          </Row>
          <Row label="Tint mode">
            <TextInput
              ariaLabel="Android tint mode"
              value={frame.vector.tintMode ?? ""}
              onChange={(value) =>
                useEditorStore.getState().updateVector({ tintMode: value || undefined })
              }
            />
          </Row>
          <Row label="Mirror">
            <button
              type="button"
              className="h-7 rounded-md border border-border px-2 text-[11px]"
              onClick={() =>
                useEditorStore.getState().updateVector({ autoMirrored: !frame.vector.autoMirrored })
              }
            >
              {frame.vector.autoMirrored ? "On" : "Off"}
            </button>
          </Row>
        </Section>
      )}
      {count === 1 && (
        <Section title="Actions" defaultOpen={false}>
          <div className="grid grid-cols-2 gap-1.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-[11px]"
              onClick={onDuplicate}
            >
              <Copy className="size-3.5" /> Duplicate
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-[11px] text-destructive hover:text-destructive"
              onClick={onDelete}
              disabled={!canDelete}
            >
              <Trash2 className="size-3.5" /> Delete
            </Button>
          </div>
        </Section>
      )}
    </>
  );
}

export function MotionPanel({
  layer,
  selectionCount,
  onEditMorph,
}: {
  layer: Layer;
  selectionCount: number;
  onEditMorph: () => void;
}) {
  const blocks = useEditorStore((state) => state.animation.blocks);
  const addTimelineBlock = useEditorStore((state) => state.addTimelineBlock);
  const removeTimelineProperty = useEditorStore((state) => state.removeTimelineProperty);
  const selectBlocks = useEditorStore((state) => state.selectBlocks);
  const layerBlocks = blocks.filter((block) => String(block.layerId) === String(layer.id));
  const propertyNames = Array.from(
    new Set([
      ...layerBlocks.map((block) => block.propertyName),
      "translateX",
      "translateY",
      "rotation",
      "scaleX",
      "scaleY",
      "fillColor",
      "strokeColor",
      "strokeWidth",
    ]),
  );

  if (selectionCount > 1) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={`Motion · ${selectionCount} layers`}>
          <p className="rounded-md bg-muted/55 px-2 py-2 text-[10px] leading-relaxed text-muted-foreground">
            Select one layer to edit its motion tracks. Design properties can still be changed for
            the full selection.
          </p>
        </Section>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Section title="Vector morph">
        <button
          type="button"
          onClick={onEditMorph}
          className="flex h-8 w-full items-center gap-2 rounded-[4px] bg-muted/65 px-2 text-left text-[11px] text-foreground transition-colors hover:bg-muted"
        >
          <Pencil className="size-3.5 text-muted-foreground" />
          <span className="flex-1">Start and end paths</span>
          <span className="text-[10px] text-muted-foreground">Edit</span>
        </button>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          Define both geometries for the vector morph.
        </p>
      </Section>
      <Section title="Animations">
        <div className="space-y-1">
          {propertyNames.map((propertyName) => {
            const matches = layerBlocks.filter((block) => block.propertyName === propertyName);
            const active = matches.length > 0;
            return (
              <div
                key={propertyName}
                className={cn(
                  "group flex h-7 w-full items-center rounded-[4px] hover:bg-muted",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <button
                  type="button"
                  onClick={() =>
                    active
                      ? selectBlocks(matches.map((block) => block.id))
                      : addTimelineBlock(layer.id, propertyName)
                  }
                  className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left text-[11px]"
                  aria-label={
                    active
                      ? `Edit ${propertyLabel(propertyName)} animation`
                      : `Animate ${propertyLabel(propertyName)}`
                  }
                >
                  <span
                    className={cn(
                      "size-2 rotate-45 rounded-[1px] border",
                      active ? "border-primary bg-primary" : "border-muted-foreground/40",
                    )}
                  />
                  <span className="flex-1">{propertyLabel(propertyName)}</span>
                  <span className="text-[10px] opacity-60 transition-opacity group-hover:opacity-100">
                    {active ? "Edit" : "Animate"}
                  </span>
                </button>
                {active && (
                  <button
                    type="button"
                    onClick={() => removeTimelineProperty(layer.id, propertyName)}
                    className="grid size-7 shrink-0 place-items-center rounded-[4px] text-muted-foreground opacity-60 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus-visible:opacity-100"
                    aria-label={`Remove ${propertyLabel(propertyName)} animation`}
                    title={`Remove ${propertyLabel(propertyName)} animation`}
                  >
                    <Trash2 className="size-3" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

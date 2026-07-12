"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Copy, Lock, Pencil, Trash2, Unlock } from "lucide-react";
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
      className="grid h-10 grid-cols-2 border-b border-border px-3"
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
            "relative text-[11px] font-medium capitalize text-muted-foreground transition-colors hover:text-foreground",
            value === tab && "text-foreground",
          )}
        >
          {tab}
          {value === tab && (
            <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" />
          )}
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
  return (
    <Section
      title={count > 1 ? `Transform · ${count} layers` : "Transform"}
      action={
        <button
          type="button"
          onClick={onToggleLock}
          className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={layer.locked ? "Unlock layer" : "Lock layer"}
          title={layer.locked ? "Unlock layer" : "Lock layer"}
        >
          {layer.locked ? <Lock className="size-3.5" /> : <Unlock className="size-3.5" />}
        </button>
      }
    >
      {count > 1 && (
        <p className="text-[10px] text-muted-foreground">Values apply to the full selection.</p>
      )}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        <NumberRow
          label="X"
          value={positionX}
          onChange={(value) => onTranslate(value - positionX, 0)}
        />
        <NumberRow
          label="Y"
          value={positionY}
          onChange={(value) => onTranslate(0, value - positionY)}
        />
        <NumberRow
          label="Scale X"
          value={scaleX.value}
          mixed={scaleX.mixed}
          step={0.1}
          onChange={(value) => onPatch({ scaleX: value })}
        />
        <NumberRow
          label="Scale Y"
          value={scaleY.value}
          mixed={scaleY.mixed}
          step={0.1}
          onChange={(value) => onPatch({ scaleY: value })}
        />
      </div>
      <NumberRow
        label="Rotation"
        value={rotation.value}
        mixed={rotation.mixed}
        suffix="°"
        onChange={(value) => onPatch({ rotation: value })}
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
      <Section title="Position & size">
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
                label="W"
                value={frame.vector.width}
                min={1}
                onChange={(value) => onResize(value, frame.vector.height)}
              />
              <NumberRow
                label="H"
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
      <Section title="Path motion">
        <button
          type="button"
          onClick={onEditMorph}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Pencil className="size-3.5" /> Edit start and end paths
        </button>
        <p className="text-[10px] leading-relaxed text-muted-foreground">
          ShapeShifter morphs compatible vector paths while preserving editable geometry.
        </p>
      </Section>
      <Section title={`Animated properties${layerBlocks.length ? ` · ${layerBlocks.length}` : ""}`}>
        <div className="space-y-1">
          {propertyNames.map((propertyName) => {
            const matches = layerBlocks.filter((block) => block.propertyName === propertyName);
            const active = matches.length > 0;
            return (
              <button
                key={propertyName}
                type="button"
                onClick={() =>
                  active
                    ? selectBlocks(matches.map((block) => block.id))
                    : addTimelineBlock(layer.id, propertyName)
                }
                className={cn(
                  "group flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[11px] hover:bg-muted",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <span
                  className={cn(
                    "size-2 rotate-45 rounded-[1px] border",
                    active ? "border-primary bg-primary" : "border-muted-foreground/40",
                  )}
                />
                <span className="flex-1">{propertyLabel(propertyName)}</span>
                <span className="text-[10px] opacity-0 group-hover:opacity-70">
                  {active ? "Select" : "Add"}
                </span>
              </button>
            );
          })}
        </div>
      </Section>
    </div>
  );
}

"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store/editorStore";
import { parsePath, pathToString } from "@/lib/shapeshifter/pathUtils";
import type { FillType, Layer, StrokeLineCap, StrokeLineJoin } from "@/lib/shapeshifter/types";
import { MaterialSymbol } from "./MaterialSymbol";

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-8 grid-cols-[112px_minmax(0,1fr)] items-center gap-3 px-4 py-1">
      <Label className="select-none truncate text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function InspectorSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="py-2">
      <div className="px-4 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function NumberField({
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  // Figma-grade live scrubbing (drag label-adjacent grip for pro number editing)
  // Smallest addition: local pointer drag modeled on LayerTimeline pattern, no store impact.
  const [scrub, setScrub] = React.useState<{ startX: number; startVal: number } | null>(null);

  const handleScrubStart = (e: React.PointerEvent<HTMLSpanElement>) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setScrub({ startX: e.clientX, startVal: value });
  };
  const handleScrubMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (!scrub) return;
    const dx = e.clientX - scrub.startX;
    const sens = (step || 1) * 0.2; // tuned for 60fps precise feel
    let next = scrub.startVal + dx * sens;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    if (step && step > 0) next = Math.round(next / step) * step;
    onChange(next);
  };
  const handleScrubEnd = (e: React.PointerEvent<HTMLSpanElement>) => {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {}
    setScrub(null);
  };

  return (
    <div className="flex items-center gap-1">
      <Input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        min={min}
        max={max}
        step={step}
        className="h-7 rounded-sm bg-background font-mono text-xs"
        onChange={(event) => {
          const next = Number(event.target.value);
          if (Number.isFinite(next)) onChange(next);
        }}
      />
      <span
        role="presentation"
        tabIndex={-1}
        className="cursor-ew-resize select-none px-0.5 text-[10px] leading-none text-muted-foreground/70 hover:text-foreground active:text-primary"
        title="Drag to scrub value (Figma-style)"
        onPointerDown={handleScrubStart}
        onPointerMove={handleScrubMove}
        onPointerUp={handleScrubEnd}
        onPointerCancel={handleScrubEnd}
      >
        ⟷
      </span>
    </div>
  );
}

export function Inspector() {
  const {
    selection,
    getCurrentSelectedPoint,
    updateSelectedPoint,
    deleteSelectedPoint,
    selectedLayerId,
    editingSide,
    layers,
    updateSelectedLayer,
    startActionMode,
    addTimelineBlock,
  } = useEditorStore();

  const point = getCurrentSelectedPoint ? getCurrentSelectedPoint() : null;
  const currentLayer = layers.find((l) => l.id === selectedLayerId);
  const updateLayer = (patch: Partial<Layer>) => updateSelectedLayer(patch);

  if (!currentLayer) {
    return (
      <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
        <div className="flex min-h-16 items-center border-b bg-card px-4 shadow-xs">
          <span className="text-sm font-medium">Properties</span>
        </div>
        <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-muted-foreground">
          <MaterialSymbol name="touch_app" size={28} />
          <p className="ml-3">Select something to edit its properties</p>
        </div>
      </div>
    );
  }

  const animatableProperties =
    currentLayer.type === "group"
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

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className="flex min-h-16 items-center gap-3 border-b bg-card px-4 shadow-xs">
        <MaterialSymbol
          name={
            currentLayer.type === "clipPath"
              ? "crop"
              : currentLayer.type === "group"
                ? "folder"
                : "polyline"
          }
          size={32}
          className="shrink-0 text-muted-foreground"
        />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-medium leading-6">{currentLayer.name}</div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{currentLayer.type} layer</span>
            {currentLayer.type !== "group" && (
              <Badge variant="outline" className="h-4 rounded-sm px-1 text-[10px]">
                {editingSide}
              </Badge>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button size="icon-sm" variant="ghost" aria-label="Animate this layer" />}
          >
            <MaterialSymbol name="animation" size={17} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            {animatableProperties.map((propertyName) => (
              <DropdownMenuItem
                key={propertyName}
                onClick={() => addTimelineBlock(currentLayer.id, propertyName)}
              >
                {propertyName}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {currentLayer.type !== "group" && (
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={startActionMode}
            aria-label="Edit path morphing animation"
          >
            <MaterialSymbol name="edit" size={17} />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-2 text-xs">
        <InspectorSection title="Layer">
          <PropertyRow label="name">
            <Input
              className="h-7 rounded-sm bg-background text-xs"
              value={currentLayer.name}
              onChange={(event) => updateLayer({ name: event.target.value })}
            />
          </PropertyRow>
          <PropertyRow label="type">
            <Select
              value={currentLayer.type}
              onValueChange={(value) => updateLayer({ type: value as Layer["type"] })}
            >
              <SelectTrigger size="sm" className="h-7 w-full rounded-sm bg-background text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="path">path</SelectItem>
                <SelectItem value="clipPath">clipPath</SelectItem>
                <SelectItem value="group">group</SelectItem>
              </SelectContent>
            </Select>
          </PropertyRow>
        </InspectorSection>
        <Separator />

        {currentLayer.type !== "group" && (
          <>
            <InspectorSection title="Path">
              <PropertyRow label="pathData">
                <Textarea
                  value={pathToString(currentLayer[editingSide])}
                  className="min-h-20 resize-none rounded-sm bg-background p-1.5 font-mono text-[10px]"
                  onChange={(event) => {
                    try {
                      const parsed = parsePath(event.target.value);
                      updateLayer(
                        editingSide === "from"
                          ? { from: parsed, pathData: parsed }
                          : { to: parsed },
                      );
                    } catch {
                      toast.error("Invalid path data");
                    }
                  }}
                />
              </PropertyRow>
            </InspectorSection>
            <Separator />

            <InspectorSection title="Fill">
              <PropertyRow label="fillColor">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={
                      currentLayer.fillColor?.startsWith("#") ? currentLayer.fillColor : "#000000"
                    }
                    onChange={(e) => updateLayer({ fillColor: e.target.value })}
                    className="h-7 w-7 cursor-pointer rounded-sm border border-border bg-transparent"
                  />
                  <Input
                    className="h-7 rounded-sm bg-background font-mono text-xs"
                    value={currentLayer.fillColor || ""}
                    placeholder="none"
                    onChange={(e) => updateLayer({ fillColor: e.target.value })}
                  />
                </div>
              </PropertyRow>

              <PropertyRow label="fillAlpha">
                <NumberField
                  min={0}
                  max={1}
                  step={0.1}
                  value={currentLayer.fillAlpha ?? 1}
                  onChange={(val) => updateLayer({ fillAlpha: val })}
                />
              </PropertyRow>
              <PropertyRow label="fillType">
                <Select
                  value={currentLayer.fillType ?? "nonZero"}
                  onValueChange={(val) => updateLayer({ fillType: val as FillType })}
                >
                  <SelectTrigger size="sm" className="h-7 w-full rounded-sm bg-background text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="nonZero">nonZero</SelectItem>
                    <SelectItem value="evenOdd">evenOdd</SelectItem>
                  </SelectContent>
                </Select>
              </PropertyRow>
            </InspectorSection>
            <Separator />

            <InspectorSection title="Stroke">
              <PropertyRow label="strokeColor">
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={
                      currentLayer.strokeColor?.startsWith("#")
                        ? currentLayer.strokeColor
                        : "#000000"
                    }
                    onChange={(e) => updateLayer({ strokeColor: e.target.value })}
                    className="h-7 w-7 cursor-pointer rounded-sm border border-border bg-transparent"
                  />
                  <Input
                    className="h-7 rounded-sm bg-background font-mono text-xs"
                    value={currentLayer.strokeColor || ""}
                    placeholder="none"
                    onChange={(e) => updateLayer({ strokeColor: e.target.value })}
                  />
                </div>
              </PropertyRow>

              <PropertyRow label="strokeAlpha">
                <NumberField
                  min={0}
                  max={1}
                  step={0.1}
                  value={currentLayer.strokeAlpha ?? 1}
                  onChange={(val) => updateLayer({ strokeAlpha: val })}
                />
              </PropertyRow>

              <PropertyRow label="strokeWidth">
                <NumberField
                  min={0}
                  step={0.1}
                  value={currentLayer.strokeWidth ?? 1}
                  onChange={(val) => updateLayer({ strokeWidth: val })}
                />
              </PropertyRow>

              <PropertyRow label="strokeLinecap">
                <Select
                  value={currentLayer.strokeLinecap ?? "butt"}
                  onValueChange={(val) => updateLayer({ strokeLinecap: val as StrokeLineCap })}
                >
                  <SelectTrigger size="sm" className="h-7 w-full rounded-sm bg-background text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="butt">Butt</SelectItem>
                    <SelectItem value="round">Round</SelectItem>
                    <SelectItem value="square">Square</SelectItem>
                  </SelectContent>
                </Select>
              </PropertyRow>

              <PropertyRow label="strokeLinejoin">
                <Select
                  value={currentLayer.strokeLinejoin ?? "miter"}
                  onValueChange={(val) => updateLayer({ strokeLinejoin: val as StrokeLineJoin })}
                >
                  <SelectTrigger size="sm" className="h-7 w-full rounded-sm bg-background text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="miter">Miter</SelectItem>
                    <SelectItem value="round">Round</SelectItem>
                    <SelectItem value="bevel">Bevel</SelectItem>
                  </SelectContent>
                </Select>
              </PropertyRow>

              <PropertyRow label="strokeMiterLimit">
                <NumberField
                  min={1}
                  value={currentLayer.strokeMiterLimit ?? 4}
                  onChange={(val) => updateLayer({ strokeMiterLimit: val })}
                />
              </PropertyRow>
            </InspectorSection>
            <Separator />

            <InspectorSection title="Trim Path">
              <PropertyRow label="trimPathStart">
                <NumberField
                  min={0}
                  max={1}
                  step={0.1}
                  value={currentLayer.trimPathStart ?? 0}
                  onChange={(val) => updateLayer({ trimPathStart: val })}
                />
              </PropertyRow>

              <PropertyRow label="trimPathEnd">
                <NumberField
                  min={0}
                  max={1}
                  step={0.1}
                  value={currentLayer.trimPathEnd ?? 1}
                  onChange={(val) => updateLayer({ trimPathEnd: val })}
                />
              </PropertyRow>

              <PropertyRow label="trimPathOffset">
                <NumberField
                  step={0.1}
                  value={currentLayer.trimPathOffset ?? 0}
                  onChange={(val) => updateLayer({ trimPathOffset: val })}
                />
              </PropertyRow>
            </InspectorSection>
          </>
        )}

        {currentLayer.type === "group" && (
          <InspectorSection title="Transform">
            <PropertyRow label="rotation">
              <NumberField
                value={currentLayer.rotation ?? 0}
                onChange={(val) => updateLayer({ rotation: val })}
              />
            </PropertyRow>
            <PropertyRow label="scaleX">
              <NumberField
                value={currentLayer.scaleX ?? 1}
                onChange={(val) => updateLayer({ scaleX: val })}
              />
            </PropertyRow>
            <PropertyRow label="scaleY">
              <NumberField
                value={currentLayer.scaleY ?? 1}
                onChange={(val) => updateLayer({ scaleY: val })}
              />
            </PropertyRow>
            <PropertyRow label="pivotX">
              <NumberField
                value={currentLayer.pivotX ?? 0}
                onChange={(val) => updateLayer({ pivotX: val })}
              />
            </PropertyRow>
            <PropertyRow label="pivotY">
              <NumberField
                value={currentLayer.pivotY ?? 0}
                onChange={(val) => updateLayer({ pivotY: val })}
              />
            </PropertyRow>
            <PropertyRow label="translateX">
              <NumberField
                value={currentLayer.translateX ?? 0}
                onChange={(val) => updateLayer({ translateX: val })}
              />
            </PropertyRow>
            <PropertyRow label="translateY">
              <NumberField
                value={currentLayer.translateY ?? 0}
                onChange={(val) => updateLayer({ translateY: val })}
              />
            </PropertyRow>
          </InspectorSection>
        )}

        {selection && point ? (
          <>
            <Separator />
            <InspectorSection title="Selected Point">
              <div className="grid grid-cols-2 gap-2 px-4">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-muted-foreground">X</span>
                  <Input
                    type="number"
                    value={point.x.toFixed(2)}
                    className="h-7 rounded-sm bg-background font-mono text-xs"
                    step="0.1"
                    onChange={(event) =>
                      updateSelectedPoint({ x: parseFloat(event.target.value) || 0, y: point.y })
                    }
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-[10px] text-muted-foreground">Y</span>
                  <Input
                    type="number"
                    value={point.y.toFixed(2)}
                    className="h-7 rounded-sm bg-background font-mono text-xs"
                    step="0.1"
                    onChange={(event) =>
                      updateSelectedPoint({ x: point.x, y: parseFloat(event.target.value) || 0 })
                    }
                  />
                </div>
              </div>
              <Button
                variant="outline"
                className="mx-4 mt-2 h-7 w-[calc(100%-2rem)] justify-start gap-1.5 border-destructive/20 text-xs text-destructive"
                size="sm"
                onClick={() => {
                  deleteSelectedPoint();
                  toast.success("Point deleted");
                }}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete Point
              </Button>
            </InspectorSection>
          </>
        ) : (
          <div className="mx-4 my-3 rounded-sm border border-dashed border-border/80 p-2 text-center text-[10px] text-muted-foreground">
            Click a point on the canvas to edit its coordinates.
          </div>
        )}
      </div>
    </div>
  );
}

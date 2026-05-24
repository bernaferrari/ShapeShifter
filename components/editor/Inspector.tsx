"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store/editorStore";
import { parsePath, pathToString } from "@/lib/shapeshifter/pathUtils";
import type { FillType, Layer, StrokeLineCap, StrokeLineJoin } from "@/lib/shapeshifter/types";
import { MaterialSymbol } from "./MaterialSymbol"; // Reuse helper if exists

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[112px_minmax(0,1fr)] items-center gap-3">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function NumberField({
  value,
  min,
  max,
  step = 0.01,
  onChange,
}: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step}
      className="h-8 font-mono"
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
    />
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
  } = useEditorStore();

  const point = getCurrentSelectedPoint ? getCurrentSelectedPoint() : null;
  const currentLayer = layers.find((l) => l.id === selectedLayerId);
  const selectedCommand =
    currentLayer?.[editingSide].subPaths[selection?.subPathIndex ?? 0]?.commands[
      selection?.commandIndex ?? 0
    ];

  const updateLayer = (patch: Partial<Layer>) => updateSelectedLayer(patch);

  if (!currentLayer) {
    return (
      <div className="flex-1 space-y-6 overflow-y-auto p-4 text-sm">
        <div className="py-8 text-center text-muted-foreground">
          <MaterialSymbol name="touch_app" size={28} />
          <p className="mt-2 text-sm font-medium">Select something to edit its properties</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 overflow-y-auto p-4 text-sm">
      <div className="flex items-center gap-3 rounded-md border bg-card p-3">
        <MaterialSymbol name={currentLayer.type === "clipPath" ? "crop" : "polyline"} size={28} className="text-muted-foreground" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{currentLayer.name}</div>
          <div className="text-xs text-muted-foreground">{currentLayer.type} layer</div>
        </div>
        {currentLayer.type !== "group" && (
          <Button size="icon-sm" variant="ghost" aria-label="Edit path morphing animation" onClick={startActionMode}>
            <MaterialSymbol name="edit" size={18} />
          </Button>
        )}
      </div>

      <section className="space-y-3">
        <div className="text-xs font-semibold tracking-widest text-muted-foreground">LAYER</div>
        <PropertyRow label="name">
          <Input className="h-8" value={currentLayer.name} onChange={(event) => updateLayer({ name: event.target.value })} />
        </PropertyRow>
        <PropertyRow label="type">
          <Select value={currentLayer.type} onValueChange={(value) => updateLayer({ type: value as Layer["type"] })}>
            <SelectTrigger className="h-8 w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="path">path</SelectItem>
              <SelectItem value="clipPath">clipPath</SelectItem>
              <SelectItem value="group">group</SelectItem>
            </SelectContent>
          </Select>
        </PropertyRow>
        {currentLayer.type !== "group" && (
          <PropertyRow label="pathData">
            <Textarea
              value={pathToString(currentLayer[editingSide])}
              className="min-h-20 resize-none font-mono text-xs"
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
        )}
      </section>

      <Separator />

      {currentLayer.type === "group" ? (
        <section className="space-y-3">
          <div className="text-xs font-semibold tracking-widest text-muted-foreground">TRANSFORM</div>
          <PropertyRow label="rotation">
            <NumberField value={currentLayer.rotation ?? 0} onChange={(value) => updateLayer({ rotation: value })} />
          </PropertyRow>
          <PropertyRow label="scaleX">
            <NumberField value={currentLayer.scaleX ?? 1} onChange={(value) => updateLayer({ scaleX: value })} />
          </PropertyRow>
          <PropertyRow label="scaleY">
            <NumberField value={currentLayer.scaleY ?? 1} onChange={(value) => updateLayer({ scaleY: value })} />
          </PropertyRow>
          <PropertyRow label="pivotX">
            <NumberField value={currentLayer.pivotX ?? 0} onChange={(value) => updateLayer({ pivotX: value })} />
          </PropertyRow>
          <PropertyRow label="pivotY">
            <NumberField value={currentLayer.pivotY ?? 0} onChange={(value) => updateLayer({ pivotY: value })} />
          </PropertyRow>
          <PropertyRow label="translateX">
            <NumberField value={currentLayer.translateX ?? 0} onChange={(value) => updateLayer({ translateX: value })} />
          </PropertyRow>
          <PropertyRow label="translateY">
            <NumberField value={currentLayer.translateY ?? 0} onChange={(value) => updateLayer({ translateY: value })} />
          </PropertyRow>
        </section>
      ) : (
        <section className="space-y-3">
          <div className="text-xs font-semibold tracking-widest text-muted-foreground">APPEARANCE</div>
          <PropertyRow label="fillColor">
            <div className="flex gap-2">
              <Input
                type="color"
                value={currentLayer.fillColor || "#000000"}
                className="h-8 w-12 p-1"
                onChange={(event) => updateLayer({ fillColor: event.target.value })}
              />
              <Input
                value={currentLayer.fillColor || ""}
                className="h-8 font-mono"
                onChange={(event) => updateLayer({ fillColor: event.target.value })}
              />
            </div>
          </PropertyRow>
          <PropertyRow label="fillAlpha">
            <NumberField min={0} max={1} value={currentLayer.fillAlpha ?? 1} onChange={(value) => updateLayer({ fillAlpha: value })} />
          </PropertyRow>
          <PropertyRow label="strokeColor">
            <Input className="h-8 font-mono" value={currentLayer.strokeColor || ""} placeholder="none" onChange={(event) => updateLayer({ strokeColor: event.target.value })} />
          </PropertyRow>
          <PropertyRow label="strokeAlpha">
            <NumberField min={0} max={1} value={currentLayer.strokeAlpha ?? 1} onChange={(value) => updateLayer({ strokeAlpha: value })} />
          </PropertyRow>
          <PropertyRow label="strokeWidth">
            <NumberField min={0} step={0.1} value={currentLayer.strokeWidth ?? 0} onChange={(value) => updateLayer({ strokeWidth: value })} />
          </PropertyRow>
          <PropertyRow label="strokeLinecap">
            <Select value={currentLayer.strokeLinecap ?? "butt"} onValueChange={(value) => updateLayer({ strokeLinecap: value as StrokeLineCap })}>
              <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="butt">butt</SelectItem>
                <SelectItem value="square">square</SelectItem>
                <SelectItem value="round">round</SelectItem>
              </SelectContent>
            </Select>
          </PropertyRow>
          <PropertyRow label="strokeLinejoin">
            <Select value={currentLayer.strokeLinejoin ?? "miter"} onValueChange={(value) => updateLayer({ strokeLinejoin: value as StrokeLineJoin })}>
              <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="miter">miter</SelectItem>
                <SelectItem value="round">round</SelectItem>
                <SelectItem value="bevel">bevel</SelectItem>
              </SelectContent>
            </Select>
          </PropertyRow>
          <PropertyRow label="strokeMiterLimit">
            <NumberField min={1} step={0.1} value={currentLayer.strokeMiterLimit ?? 4} onChange={(value) => updateLayer({ strokeMiterLimit: value })} />
          </PropertyRow>
          <PropertyRow label="fillType">
            <Select value={currentLayer.fillType ?? "nonZero"} onValueChange={(value) => updateLayer({ fillType: value as FillType })}>
              <SelectTrigger className="h-8 w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="nonZero">nonZero</SelectItem>
                <SelectItem value="evenOdd">evenOdd</SelectItem>
              </SelectContent>
            </Select>
          </PropertyRow>
        </section>
      )}

      <Separator />

      {currentLayer.type !== "group" && (
        <section className="space-y-3">
          <div className="text-xs font-semibold tracking-widest text-muted-foreground">TRIM PATH</div>
          <PropertyRow label="trimPathStart">
            <NumberField min={0} max={1} value={currentLayer.trimPathStart ?? 0} onChange={(value) => updateLayer({ trimPathStart: value })} />
          </PropertyRow>
          <PropertyRow label="trimPathEnd">
            <NumberField min={0} max={1} value={currentLayer.trimPathEnd ?? 1} onChange={(value) => updateLayer({ trimPathEnd: value })} />
          </PropertyRow>
          <PropertyRow label="trimPathOffset">
            <NumberField value={currentLayer.trimPathOffset ?? 0} onChange={(value) => updateLayer({ trimPathOffset: value })} />
          </PropertyRow>
        </section>
      )}

      {selection && point ? (
        <section className="space-y-3">
          <Separator />
          <div>
            <div className="mb-1.5 text-xs font-semibold tracking-widest text-muted-foreground">SELECTED POINT</div>
            <div className="rounded-md bg-muted p-3 font-mono text-xs">
              {editingSide.toUpperCase()} command {selectedCommand?.type ?? "-"} #{selection.commandIndex}.{selection.pointIndex}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="mb-1 block text-[10px] text-muted-foreground">X</Label>
              <Input
                type="number"
                value={point.x.toFixed(2)}
                className="h-8 font-mono"
                step="0.1"
                onChange={(event) => updateSelectedPoint({ x: parseFloat(event.target.value) || 0, y: point.y })}
              />
            </div>
            <div>
              <Label className="mb-1 block text-[10px] text-muted-foreground">Y</Label>
              <Input
                type="number"
                value={point.y.toFixed(2)}
                className="h-8 font-mono"
                step="0.1"
                onChange={(event) => updateSelectedPoint({ x: point.x, y: parseFloat(event.target.value) || 0 })}
              />
            </div>
          </div>
          <Button
            variant="outline"
            className="w-full justify-start gap-2 text-destructive"
            size="sm"
            onClick={() => {
              deleteSelectedPoint();
              toast.success("Point deleted");
            }}
          >
            <Trash2 className="h-4 w-4" /> Delete Selected Point
          </Button>
        </section>
      ) : (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          Click a point on the canvas to edit its coordinates.
        </div>
      )}
    </div>
  );
}

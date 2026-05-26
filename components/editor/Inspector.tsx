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
import { MaterialSymbol } from "./MaterialSymbol";
import { ColorPicker } from "@/components/ui/color-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

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
  const [showAdvancedStroke, setShowAdvancedStroke] = React.useState(false);
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
        <div className="space-y-4">
          {/* Fill Section */}
          <section className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span className="tracking-wide">Fill</span>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Button variant="ghost" size="icon-sm" className="h-6 w-6 hover:bg-muted" disabled>
                  <MaterialSymbol name="grid_view" size={14} />
                </Button>
                <Button variant="ghost" size="icon-sm" className="h-6 w-6 hover:bg-muted" onClick={() => updateLayer({ fillColor: "#000000", fillAlpha: 1 })}>
                  <MaterialSymbol name="add" size={14} />
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0">
                <ColorPicker
                  value={currentLayer.fillColor || "none"}
                  onChange={(hex) => updateLayer({ fillColor: hex })}
                  className="w-full justify-start h-8 px-2"
                  placeholder="none"
                />
              </div>

              {/* Opacity */}
              <div className="flex h-8 w-16 items-center rounded-lg border bg-background/50 px-2 focus-within:ring-1 focus-within:ring-ring">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round((currentLayer.fillAlpha ?? 1) * 100)}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (Number.isFinite(val)) {
                      updateLayer({ fillAlpha: Math.max(0, Math.min(100, val)) / 100 });
                    }
                  }}
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-right font-mono text-xs outline-none"
                />
                <span className="text-[10px] text-muted-foreground ml-0.5">%</span>
              </div>

              {/* Visibility Toggle */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 hover:bg-muted"
                onClick={() => {
                  const isVisible = (currentLayer.fillAlpha ?? 1) > 0;
                  updateLayer({ fillAlpha: isVisible ? 0 : 1 });
                }}
                aria-label="Toggle fill visibility"
              >
                <MaterialSymbol name={(currentLayer.fillAlpha ?? 1) > 0 ? "visibility" : "visibility_off"} size={14} />
              </Button>

              {/* Remove Fill */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted"
                onClick={() => updateLayer({ fillColor: "", fillAlpha: 0 })}
                aria-label="Remove fill"
              >
                <MaterialSymbol name="remove" size={14} />
              </Button>
            </div>
          </section>

          <Separator className="my-2" />

          {/* Stroke Section */}
          <section className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span className="tracking-wide">Stroke</span>
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Button variant="ghost" size="icon-sm" className="h-6 w-6 hover:bg-muted" disabled>
                  <MaterialSymbol name="grid_view" size={14} />
                </Button>
                <Button variant="ghost" size="icon-sm" className="h-6 w-6 hover:bg-muted" onClick={() => updateLayer({ strokeColor: "#000000", strokeAlpha: 1, strokeWidth: 1 })}>
                  <MaterialSymbol name="add" size={14} />
                </Button>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <div className="flex-1 min-w-0">
                <ColorPicker
                  value={currentLayer.strokeColor || "none"}
                  onChange={(hex) => updateLayer({ strokeColor: hex })}
                  className="w-full justify-start h-8 px-2"
                  placeholder="none"
                />
              </div>

              {/* Opacity */}
              <div className="flex h-8 w-16 items-center rounded-lg border bg-background/50 px-2 focus-within:ring-1 focus-within:ring-ring">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round((currentLayer.strokeAlpha ?? 1) * 100)}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (Number.isFinite(val)) {
                      updateLayer({ strokeAlpha: Math.max(0, Math.min(100, val)) / 100 });
                    }
                  }}
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-right font-mono text-xs outline-none"
                />
                <span className="text-[10px] text-muted-foreground ml-0.5">%</span>
              </div>

              {/* Visibility Toggle */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 hover:bg-muted"
                onClick={() => {
                  const isVisible = (currentLayer.strokeAlpha ?? 1) > 0;
                  updateLayer({ strokeAlpha: isVisible ? 0 : 1 });
                }}
                aria-label="Toggle stroke visibility"
              >
                <MaterialSymbol name={(currentLayer.strokeAlpha ?? 1) > 0 ? "visibility" : "visibility_off"} size={14} />
              </Button>

              {/* Remove Stroke */}
              <Button
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted"
                onClick={() => updateLayer({ strokeColor: "", strokeWidth: 0 })}
                aria-label="Remove stroke"
              >
                <MaterialSymbol name="remove" size={14} />
              </Button>
            </div>

            {/* Row 2: Alignment, Width, Popover settings */}
            <div className="grid grid-cols-[1.2fr_1fr_auto_auto] items-center gap-1.5">
              {/* Alignment Select */}
              <Select value="center">
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Center" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="inside">Inside (Center)</SelectItem>
                  <SelectItem value="outside">Outside (Center)</SelectItem>
                </SelectContent>
              </Select>

              {/* Width Input */}
              <div className="flex h-8 items-center rounded-lg border bg-background/50 px-2 focus-within:ring-1 focus-within:ring-ring">
                <MaterialSymbol name="line_weight" size={14} className="text-muted-foreground mr-1.5 shrink-0" />
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={currentLayer.strokeWidth ?? 0}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    if (Number.isFinite(val)) {
                      updateLayer({ strokeWidth: val });
                    }
                  }}
                  className="min-w-0 flex-1 border-0 bg-transparent p-0 text-left font-mono text-xs outline-none"
                />
              </div>

              {/* Advanced Settings Popover */}
              <Popover open={showAdvancedStroke} onOpenChange={setShowAdvancedStroke}>
                <PopoverTrigger
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-md border transition-colors hover:bg-muted focus:outline-none focus:ring-1 focus:ring-ring",
                    showAdvancedStroke ? "bg-accent text-accent-foreground border-accent" : "bg-background/50"
                  )}
                  aria-label="Advanced stroke settings"
                >
                  <MaterialSymbol name="tune" size={16} />
                </PopoverTrigger>
                
                <PopoverContent className="w-[280px] rounded-xl border bg-popover/95 p-4 shadow-2xl backdrop-blur-md dark:border-white/[0.12]" align="end" sideOffset={6}>
                  <div className="flex items-center justify-between border-b pb-2 mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Stroke settings</h4>
                    <Button variant="ghost" size="icon-sm" className="h-6 w-6 hover:bg-muted" onClick={() => setShowAdvancedStroke(false)}>
                      <MaterialSymbol name="close" size={16} />
                    </Button>
                  </div>
                  
                  {/* Tabs */}
                  <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted/65 p-1 text-[11px] font-semibold mb-4">
                    <button className="rounded px-2 py-1 bg-background shadow-sm text-center">Basic</button>
                    <button className="rounded px-2 py-1 text-muted-foreground/60 text-center cursor-not-allowed" disabled>Dynamic</button>
                    <button className="rounded px-2 py-1 text-muted-foreground/60 text-center cursor-not-allowed" disabled>Brush</button>
                  </div>

                  <div className="space-y-4 text-xs">
                    {/* Style */}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground font-medium">Style</span>
                      <Select
                        value={(currentLayer.strokeDasharray && currentLayer.strokeDasharray !== "none") ? "dashed" : "solid"}
                        onValueChange={(val) => {
                          updateLayer({ strokeDasharray: val === "dashed" ? "4,4" : "none" });
                        }}
                      >
                        <SelectTrigger className="h-8 w-36 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="solid">─ Solid</SelectItem>
                          <SelectItem value="dashed">--- Dashed</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Width profile */}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground font-medium">Width profile</span>
                      <div className="flex items-center gap-1.5">
                        <Select value="uniform">
                          <SelectTrigger className="h-8 w-26 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="uniform">─ Uniform</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button variant="outline" size="icon-sm" className="h-8 w-8 hover:bg-muted border-border/80" disabled>
                          <MaterialSymbol name="flip" size={15} />
                        </Button>
                      </div>
                    </div>

                    {/* Line Cap */}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground font-medium">Cap</span>
                      <div className="flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5">
                        {(["butt", "round", "square"] as const).map((cap) => {
                          const isActive = (currentLayer.strokeLinecap ?? "butt") === cap;
                          return (
                            <Button
                              key={cap}
                              variant={isActive ? "secondary" : "ghost"}
                              className="h-7 px-2.5 text-[10px] capitalize font-semibold shadow-none"
                              onClick={() => updateLayer({ strokeLinecap: cap })}
                            >
                              {cap}
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Join Row */}
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-muted-foreground font-medium">Join</span>
                      <div className="flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5">
                        {(["miter", "round", "bevel"] as const).map((join) => {
                          const isActive = (currentLayer.strokeLinejoin ?? "miter") === join;
                          return (
                            <Button
                              key={join}
                              variant={isActive ? "secondary" : "ghost"}
                              size="icon-sm"
                              className="h-7 w-8"
                              onClick={() => updateLayer({ strokeLinejoin: join })}
                              title={`${join} join`}
                            >
                              <MaterialSymbol name={join === "miter" ? "square_foot" : join === "round" ? "rounded_corner" : "edgesensor_low"} size={14} />
                            </Button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Miter limit */}
                    {(currentLayer.strokeLinejoin ?? "miter") === "miter" && (
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-muted-foreground font-medium">Miter limit</span>
                        <div className="flex h-8 w-24 items-center rounded-md border bg-background/50 px-2 focus-within:ring-1 focus-within:ring-ring">
                          <MaterialSymbol name="straighten" size={14} className="text-muted-foreground mr-1.5 shrink-0" />
                          <input
                            type="number"
                            min={1}
                            step={0.1}
                            value={currentLayer.strokeMiterLimit ?? 4}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              if (Number.isFinite(val)) {
                                updateLayer({ strokeMiterLimit: val });
                              }
                            }}
                            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-right font-mono text-xs outline-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </PopoverContent>
              </Popover>

              {/* Dash settings / Cap button */}
              <Button variant="outline" size="icon-sm" className="h-8 w-8 bg-background/50 hover:bg-muted" disabled>
                <MaterialSymbol name="border_style" size={16} />
              </Button>
            </div>
          </section>

          <Separator className="my-2" />

          {/* Advanced Rules */}
          <section className="space-y-2">
            <div className="text-xs font-semibold text-foreground tracking-wide">Advanced</div>
            <PropertyRow label="fillType">
              <Select value={currentLayer.fillType ?? "nonZero"} onValueChange={(value) => updateLayer({ fillType: value as FillType })}>
                <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="nonZero">nonZero</SelectItem>
                  <SelectItem value="evenOdd">evenOdd</SelectItem>
                </SelectContent>
              </Select>
            </PropertyRow>
          </section>
        </div>
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

"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store/editorStore";
import { MaterialSymbol } from "./MaterialSymbol"; // Reuse helper if exists

export function Inspector() {
  const {
    selection,
    getCurrentSelectedPoint,
    updateSelectedPoint,
    deleteSelectedPoint,
    selectedLayerId,
    editingSide,
    layers,
  } = useEditorStore();

  const point = getCurrentSelectedPoint ? getCurrentSelectedPoint() : null;
  const currentLayer = layers.find((l) => l.id === selectedLayerId);

  if (!selection || !point) {
    return (
      <div className="p-4 space-y-6 scroll-area flex-1 text-sm">
        <div className="text-center py-8 text-muted-foreground">
          <MaterialSymbol name="touch_app" size={28} />
          <p className="text-sm mt-2 font-medium">No point selected</p>
          <p className="text-xs mt-1">
            Click or drag points • Press <kbd>1</kbd>/<kbd>2</kbd> to switch sides
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6 scroll-area flex-1 text-sm">
      <div>
        <div className="property-label mb-1.5">SELECTED POINT</div>
        <div className="font-mono text-xs bg-muted p-3 rounded-lg">
          Point #{selection.commandIndex} ({selection.pointIndex})<br />
          Command: L
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <div className="property-label">POSITION</div>
          <div className="grid grid-cols-2 gap-2 mt-1">
            <div>
              <div className="text-[10px] mb-1 text-muted-foreground">X</div>
              <Input
                type="number"
                value={point.x.toFixed(2)}
                className="h-8 font-mono"
                step="0.1"
                onChange={(e) => {
                  const newX = parseFloat(e.target.value) || 0;
                  updateSelectedPoint({ x: newX, y: point.y });
                }}
              />
            </div>
            <div>
              <div className="text-[10px] mb-1 text-muted-foreground">Y</div>
              <Input
                type="number"
                value={point.y.toFixed(2)}
                className="h-8 font-mono"
                step="0.1"
                onChange={(e) => {
                  const newY = parseFloat(e.target.value) || 0;
                  updateSelectedPoint({ x: point.x, y: newY });
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="pt-4 border-t space-y-2">
        <Button
          variant="outline"
          className="w-full justify-start gap-2 text-destructive"
          size="sm"
          onClick={() => {
            deleteSelectedPoint();
            toast.success("Point deleted");
          }}
        >
          <Trash2 className="w-4 h-4" /> Delete Selected Point
        </Button>
      </div>
    </div>
  );
}

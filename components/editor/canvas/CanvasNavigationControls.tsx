"use client";

import { Grid3x3, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

interface CanvasNavigationControlsProps {
  zoomPercent: number;
  showWorldControls: boolean;
  gridDivisions: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onCycleGrid: () => void;
  onFitSelection: () => void;
  onReset: () => void;
}

const iconButtonClass = "h-7 text-muted-foreground hover:bg-muted hover:text-foreground";

export function CanvasNavigationControls({
  zoomPercent,
  showWorldControls,
  gridDivisions,
  onZoomOut,
  onZoomIn,
  onCycleGrid,
  onFitSelection,
  onReset,
}: CanvasNavigationControlsProps) {
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 z-30 flex items-center gap-0.5 rounded-md bg-background/95 p-0.5 [box-shadow:var(--elevation-floating)] backdrop-blur-md">
      <div className="pointer-events-auto flex items-center gap-0.5">
        <Button
          size="icon-xs"
          variant="ghost"
          className={`${iconButtonClass} w-7 text-xs`}
          onClick={onZoomOut}
          aria-label="Zoom out"
        >
          −
        </Button>
        <span className="min-w-[2.5rem] select-none px-0.5 text-center font-mono text-[10px] font-medium text-muted-foreground">
          {Math.round(zoomPercent)}%
        </span>
        <Button
          size="icon-xs"
          variant="ghost"
          className={`${iconButtonClass} w-7 text-xs`}
          onClick={onZoomIn}
          aria-label="Zoom in"
        >
          +
        </Button>
        {showWorldControls && (
          <>
            <div className="mx-0.5 h-4 w-px bg-border" />
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className={`${iconButtonClass} w-auto gap-0.5 px-1.5 font-mono text-[10px]`}
                    onClick={onCycleGrid}
                    aria-label="Grid divisions"
                  >
                    <Grid3x3 className="size-3" />
                    {gridDivisions}
                  </Button>
                }
              />
              <TooltipContent>
                Grid: major every {gridDivisions} px · click to cycle 4/5/8
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className={`${iconButtonClass} w-auto px-1.5 text-[10px] font-medium`}
                    onClick={onFitSelection}
                    aria-label="Zoom to selection"
                  >
                    Fit
                  </Button>
                }
              />
              <TooltipContent>Zoom to selection (⇧2)</TooltipContent>
            </Tooltip>
          </>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          className={`${iconButtonClass} w-7`}
          onClick={onReset}
          aria-label="Reset canvas views"
        >
          <RotateCcw className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}

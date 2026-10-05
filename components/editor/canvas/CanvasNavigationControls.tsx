"use client";

import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface CanvasNavigationControlsProps {
  zoomPercent: number;
  compact?: boolean;
  onFitFrame?: () => void;
  showWorldControls: boolean;
  gridDivisions: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onZoomToActualSize: () => void;
  onSetGrid: (divisions: number) => void;
  onFitSelection: () => void;
  onReset: () => void;
  showRulers?: boolean;
  onToggleRulers?: () => void;
}

/** A single quiet zoom readout; every view command lives in its menu. */
export function CanvasNavigationControls({
  zoomPercent,
  compact = false,
  onFitFrame,
  showWorldControls,
  gridDivisions,
  onZoomOut,
  onZoomIn,
  onZoomToActualSize,
  onSetGrid,
  onFitSelection,
  onReset,
  showRulers,
  onToggleRulers,
}: CanvasNavigationControlsProps) {
  return (
    <div
      aria-label="Canvas navigation"
      className="absolute right-3 bottom-3 z-30 flex items-center gap-1 max-md:top-3 max-md:bottom-auto"
      onContextMenu={(event) => event.stopPropagation()}
    >
      {compact && (
        <button
          type="button"
          aria-label="Fit active frame"
          onClick={onFitFrame ?? onReset}
          className="h-11 min-w-11 touch-manipulation rounded-lg bg-card px-3 text-[12px] font-medium [box-shadow:var(--elevation-floating)]"
        >
          Fit
        </button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Zoom options"
              className={cn(
                "flex h-8 items-center gap-1 rounded-lg bg-card px-2.5 text-[11px] tabular-nums text-muted-foreground [box-shadow:var(--elevation-floating)] transition-colors hover:text-foreground data-popup-open:text-foreground",
                compact && "h-11 touch-manipulation text-[12px]",
              )}
            />
          }
        >
          {Math.round(zoomPercent)}%
          <ChevronDown className="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          className={cn("w-52", compact && "[&_[data-slot=dropdown-menu-shortcut]]:hidden")}
        >
          <DropdownMenuItem onClick={onZoomIn}>
            Zoom in
            <DropdownMenuShortcut>+</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onZoomOut}>
            Zoom out
            <DropdownMenuShortcut>−</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onZoomToActualSize}>
            Zoom to 100%
            <DropdownMenuShortcut>0</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onReset}>
            Zoom to fit
            <DropdownMenuShortcut>⇧1</DropdownMenuShortcut>
          </DropdownMenuItem>
          {showWorldControls && (
            <DropdownMenuItem onClick={onFitSelection}>
              Zoom to selection
              <DropdownMenuShortcut>⇧2</DropdownMenuShortcut>
            </DropdownMenuItem>
          )}
          {showWorldControls && (
            <>
              <DropdownMenuSeparator />
              {onToggleRulers && (
                <DropdownMenuCheckboxItem
                  checked={Boolean(showRulers)}
                  onCheckedChange={onToggleRulers}
                >
                  Rulers
                </DropdownMenuCheckboxItem>
              )}
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Pixel grid</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-40">
                  <DropdownMenuRadioGroup
                    value={String(gridDivisions)}
                    onValueChange={(value) => onSetGrid(Number(value))}
                  >
                    {[4, 5, 8].map((divisions) => (
                      <DropdownMenuRadioItem key={divisions} value={String(divisions)}>
                        Major every {divisions}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

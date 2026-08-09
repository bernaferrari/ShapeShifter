"use client";

import React from "react";
import {
  Play,
  Pause,
  SkipBack,
  Undo2,
  Redo2,
  Download,
  Upload,
  Plus,
  Zap,
  RotateCw,
  Repeat,
  Gauge,
  ArrowLeftRight,
  HelpCircle,
  ChevronDown,
  ArrowLeft,
  Sparkles,
  Scissors,
  ChevronFirst,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store/editorStore";
import { DEMO_INFOS } from "@/lib/shapeshifter/demoProjects";
import { ExportDialog } from "./ExportDialog";
import { ThemeToggle } from "../ThemeToggle";

interface ToolbarProps {
  onExport: (type: string) => void;
  onLoadSample: (index: number) => void;
  onTogglePlay: () => void;
  onResetAnim: () => void;
  onOpenSVGImport: () => void;
  onShowHelp: () => void;
  resetAllViews: () => void;
  isPlaying: boolean;
  isActionMode: boolean;
  editingSide: "from" | "to";
  setEditingSide: (side: "from" | "to") => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

/** Quiet, neutral chrome — Figma-grade. The bar recedes; the canvas is the hero.
 *  Dense path/boolean actions are collapsed into a single contextual "Edit" menu
 *  instead of a wall of always-visible buttons. */
export function Toolbar({
  onExport,
  onLoadSample,
  onTogglePlay,
  onResetAnim,
  onOpenSVGImport,
  onShowHelp,
  isPlaying,
  isActionMode,
  editingSide,
  setEditingSide,
  undo,
  redo,
  canUndo,
  canRedo,
}: ToolbarProps) {
  const addLayer = useEditorStore((state) => state.addLayer);
  const reverseSelectedLayer = useEditorStore((state) => state.reverseSelectedLayer);
  const shiftSelectedLayer = useEditorStore((state) => state.shiftSelectedLayer);
  const autoFixSelectedLayer = useEditorStore((state) => state.autoFixSelectedLayer);
  const closeActionMode = useEditorStore((state) => state.closeActionMode);
  const splitSelectedCommand = useEditorStore((state) => state.splitSelectedCommand);
  const setSelectedCommandAsFirst = useEditorStore((state) => state.setSelectedCommandAsFirst);
  const deleteSelectedPoint = useEditorStore((state) => state.deleteSelectedPoint);
  const deleteSelectedSubPath = useEditorStore((state) => state.deleteSelectedSubPath);
  const extractSelectedSubPathToNewLayer = useEditorStore(
    (state) => state.extractSelectedSubPathToNewLayer,
  );
  const booleanCombine = useEditorStore((state) => state.booleanCombine);
  const resetProject = useEditorStore((state) => state.resetProject);
  const vector = useEditorStore((state) => state.vector);
  const isRepeating = useEditorStore((state) => state.isRepeating);
  const isSlowMotion = useEditorStore((state) => state.isSlowMotion);
  const toggleRepeating = useEditorStore((state) => state.toggleRepeating);
  const toggleSlowMotion = useEditorStore((state) => state.toggleSlowMotion);

  const handleAutoFix = () => {
    if (autoFixSelectedLayer()) {
      toast.success("Paths made compatible");
    }
  };

  return (
    <header className="relative flex h-12 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-card px-3 text-foreground [scrollbar-width:none]">
      {/* Centered document name — Figma-style, fills the chrome's quiet middle */}
      {!isActionMode && (
        <div className="pointer-events-none absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 max-w-[40%] md:block">
          <span className="block truncate text-center text-[12px] font-medium text-muted-foreground">
            {vector?.name || "Untitled"}
          </span>
        </div>
      )}
      {/* Brand / back */}
      <div className="flex items-center gap-2 pr-1">
        {isActionMode && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground hover:text-foreground"
                  aria-label="Back to canvas"
                  onClick={closeActionMode}
                />
              }
            >
              <ArrowLeft size={18} />
            </TooltipTrigger>
            <TooltipContent>Back to canvas (⌘W)</TooltipContent>
          </Tooltip>
        )}
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
          <Sparkles size={16} />
        </div>
        <div className="hidden leading-none sm:block">
          <div className="text-[13px] font-semibold tracking-tight">
            {isActionMode ? "Path morphing" : "Shape Shifter"}
          </div>
          <div className="mt-0.5 text-[10px] leading-none text-muted-foreground">
            {isActionMode ? "Compatibility editor" : "Vector motion studio"}
          </div>
        </div>
      </div>

      <div className="mx-1 h-5 w-px bg-border" />

      {/* File */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" className="gap-1 px-2 text-[13px] font-medium" />
          }
        >
          File <ChevronDown className="size-3.5 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          <DropdownMenuItem
            onClick={() => {
              resetProject();
              toast.success("New project");
            }}
          >
            <Plus className="mr-2 size-4" /> New project
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onOpenSVGImport}>
            <Upload className="mr-2 size-4" /> Import SVG / XML / Project…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => addLayer("path")}>
            <Plus className="mr-2 size-4" /> Add layer
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => onExport("json")}>
            <Download className="mr-2 size-4" /> Export project (.json)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Edit — all the dense path/boolean actions collapsed here */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" className="gap-1 px-2 text-[13px] font-medium" />
          }
        >
          Edit <ChevronDown className="size-3.5 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <DropdownMenuItem onClick={undo} disabled={!canUndo}>
            <Undo2 className="mr-2 size-4" /> Undo
            <span className="ml-auto text-xs text-muted-foreground">⌘Z</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={redo} disabled={!canRedo}>
            <Redo2 className="mr-2 size-4" /> Redo
            <span className="ml-auto text-xs text-muted-foreground">⇧⌘Z</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={handleAutoFix}>
            <Zap className="mr-2 size-4 text-amber-500" /> Auto fix compatibility
            <span className="ml-auto text-xs text-muted-foreground">⇧F</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => {
              reverseSelectedLayer();
              toast.success("Reversed");
            }}
          >
            <RotateCw className="mr-2 size-4" /> Reverse points
            <span className="ml-auto text-xs text-muted-foreground">⇧R</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => shiftSelectedLayer(1)}>
            <ArrowLeftRight className="mr-2 size-4" /> Shift points forward
            <span className="ml-auto text-xs text-muted-foreground">⇧S</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => shiftSelectedLayer(-1)}>
            <ArrowLeftRight className="mr-2 size-4 -scale-x-100" /> Shift points back
          </DropdownMenuItem>

          {isActionMode && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Selected command
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => splitSelectedCommand()}>
                  <Scissors size={16} className="mr-2" /> Split in half
                  <span className="ml-auto text-xs text-muted-foreground">X</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedCommandAsFirst()}>
                  <ChevronFirst size={16} className="mr-2" /> Set as first point
                  <span className="ml-auto text-xs text-muted-foreground">F</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => deleteSelectedPoint()}>
                  <Trash2 size={16} className="mr-2" /> Delete point(s)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => deleteSelectedSubPath()}>
                  <X size={16} className="mr-2" /> Delete subpath(s)
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}

          <DropdownMenuItem
            onClick={() => extractSelectedSubPathToNewLayer?.()}
            disabled={!extractSelectedSubPathToNewLayer}
          >
            <Scissors size={16} className="mr-2" /> Extract subpath to new layer
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Combine with next layer
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => booleanCombine("union")}>Union</DropdownMenuItem>
            <DropdownMenuItem onClick={() => booleanCombine("subtract")}>Subtract</DropdownMenuItem>
            <DropdownMenuItem onClick={() => booleanCombine("intersect")}>
              Intersect
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => booleanCombine("exclude")}>Exclude</DropdownMenuItem>
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Samples */}
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="ghost" size="sm" className="gap-1 px-2 text-[13px] font-medium" />
          }
        >
          Samples <ChevronDown className="size-3.5 opacity-50" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          {DEMO_INFOS.map((demo, index) => (
            <DropdownMenuItem key={demo.id} onClick={() => onLoadSample(index)}>
              {demo.title}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* From / To — segmented, action mode only (shadcn Button) */}
      {isActionMode && (
        <>
          <div className="mx-1 h-5 w-px bg-border" />
          <div className="flex items-center rounded-md bg-muted p-0.5">
            {(["from", "to"] as const).map((side) => (
              <Button
                key={side}
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => setEditingSide(side)}
                className={`h-6 gap-1 rounded-sm px-2.5 text-xs capitalize ${
                  editingSide === side
                    ? "bg-card text-foreground shadow-sm hover:bg-card"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {side === "from" ? <ChevronLeft size={14} /> : null}
                {side}
                {side === "to" ? <ChevronRight size={14} /> : null}
              </Button>
            ))}
          </div>
        </>
      )}

      <div className="flex-1" />

      {/* Transport — reset · play · loop · slow-mo */}
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-foreground"
                onClick={onResetAnim}
                aria-label="Reset animation"
              />
            }
          >
            <SkipBack className="size-4" />
          </TooltipTrigger>
          <TooltipContent>Reset to start</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="sm"
                className="h-7 gap-1.5 px-3"
                onClick={onTogglePlay}
                aria-label={isPlaying ? "Pause" : "Play"}
              />
            }
          >
            {isPlaying ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
            <span className="text-xs">{isPlaying ? "Pause" : "Play"}</span>
          </TooltipTrigger>
          <TooltipContent>{isPlaying ? "Pause" : "Play"} (Space)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "text-muted-foreground hover:text-foreground",
                  isRepeating && "bg-primary/10 text-primary hover:text-primary",
                )}
                onClick={toggleRepeating}
                aria-label="Loop playback"
                aria-pressed={isRepeating}
              />
            }
          >
            <Repeat className="size-4" />
          </TooltipTrigger>
          <TooltipContent>{isRepeating ? "Looping on" : "Loop off"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn(
                  "text-muted-foreground hover:text-foreground",
                  isSlowMotion && "bg-primary/10 text-primary hover:text-primary",
                )}
                onClick={toggleSlowMotion}
                aria-label="Slow motion"
                aria-pressed={isSlowMotion}
              />
            }
          >
            <Gauge className="size-4" />
          </TooltipTrigger>
          <TooltipContent>{isSlowMotion ? "Slow motion (0.25×)" : "Slow motion"}</TooltipContent>
        </Tooltip>
      </div>

      <div className="mx-1 h-5 w-px bg-border" />

      {/* Export */}
      <ExportDialog>
        <Button variant="ghost" size="sm" className="gap-1.5 px-2.5 text-[13px] font-medium">
          <Download className="size-3.5" /> Export
        </Button>
      </ExportDialog>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={onShowHelp}
              aria-label="Keyboard shortcuts"
            />
          }
        >
          <HelpCircle className="size-4" />
        </TooltipTrigger>
        <TooltipContent>Keyboard shortcuts</TooltipContent>
      </Tooltip>

      <ThemeToggle />
    </header>
  );
}

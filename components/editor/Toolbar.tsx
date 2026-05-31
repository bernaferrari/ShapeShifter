"use client";

import React from "react";
import {
  Play,
  Pause,
  SkipBack,
  Undo2,
  Download,
  Upload,
  Plus,
  Zap,
  RotateCw,
  ArrowLeftRight,
  HelpCircle,
  Trash2,
  X,
  GitBranch,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store/editorStore";
import { DEMO_INFOS } from "@/lib/shapeshifter/demoProjects";
import { MaterialSymbol } from "./MaterialSymbol";
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

export function Toolbar({
  onExport,
  onLoadSample,
  onTogglePlay,
  onResetAnim,
  onOpenSVGImport,
  onShowHelp,
  resetAllViews,
  isPlaying,
  isActionMode,
  editingSide,
  setEditingSide,
  undo,
  redo,
  canUndo,
  canRedo,
}: ToolbarProps) {
  const {
    addLayer,
    reverseSelectedLayer,
    shiftSelectedLayer,
    autoFixSelectedLayer,
    closeActionMode,
    splitSelectedCommand,
    setSelectedCommandAsFirst,
    deleteSelectedPoint,
    deleteSelectedSubPath,
    booleanCombine,
    resetProject,
  } = useEditorStore();

  const handleAutoFix = () => {
    if (autoFixSelectedLayer()) {
      toast.success("Auto Fix applied", { description: "Paths are now more compatible" });
    }
  };

  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 overflow-x-auto bg-primary text-primary-foreground dark:bg-card dark:text-foreground border-b border-primary-foreground/10 dark:border-border px-4 shadow-sm [scrollbar-width:none]">
      <div className="flex items-center gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2 border-r border-white/20 dark:border-border pr-4">
          {isActionMode && (
            <Button
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/10 dark:text-foreground dark:hover:bg-muted h-8 w-8"
              aria-label="Close path morphing mode"
              onClick={closeActionMode}
            >
              <MaterialSymbol name="arrow_back" size={20} />
            </Button>
          )}
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 dark:bg-primary/10 text-white dark:text-primary">
            <MaterialSymbol name="auto_awesome" size={18} filled weight={600} />
          </div>
          <div>
            <div className="text-sm font-bold tracking-tight text-white dark:text-foreground">
              {isActionMode ? "Path morphing" : "Shape Shifter"}
            </div>
            <div className="text-[10px] text-white/70 dark:text-muted-foreground -mt-0.5 leading-none">
              {isActionMode ? "Path compatibility" : "Vector motion studio"}
            </div>
          </div>
        </div>

        <Badge
          variant="secondary"
          className="font-mono text-[9px] tracking-widest px-1.5 py-0 bg-white/10 text-white hover:bg-white/10 dark:bg-muted dark:text-foreground"
        >
          v2.0
        </Badge>

        {/* Shortcuts / Help */}
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 text-xs text-white/80 hover:text-white hover:bg-white/10 dark:text-muted-foreground dark:hover:text-foreground h-8 px-2.5"
          onClick={onShowHelp}
        >
          <HelpCircle className="w-3.5 h-3.5" /> Shortcuts
        </Button>
      </div>

      <div className="flex items-center gap-1.5 border-l border-white/20 dark:border-border pl-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10 dark:text-muted-foreground dark:hover:text-foreground"
                onClick={onResetAnim}
                aria-label="Reset animation"
              />
            }
          >
            <SkipBack className="w-4 h-4" />
          </TooltipTrigger>
          <TooltipContent>Reset animation</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="default"
                size="icon"
                className="h-8 w-8 bg-primary-foreground hover:bg-primary-foreground/90 text-primary dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90 shadow-sm"
                onClick={onTogglePlay}
                aria-label={isPlaying ? "Pause animation" : "Play animation"}
              />
            }
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </TooltipTrigger>
          <TooltipContent>{isPlaying ? "Pause" : "Play"} animation</TooltipContent>
        </Tooltip>
      </div>

      {/* File */}
      <div className="flex items-center gap-1 border-l border-white/20 dark:border-border pl-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="inline-flex shrink-0 items-center justify-center rounded-lg h-8 gap-1.5 px-3 text-xs font-semibold hover:bg-white/10 text-white dark:text-foreground dark:hover:bg-muted transition-all outline-none"
              />
            }
          >
            <Upload className="w-3.5 h-3.5" /> File
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52 text-xs">
            <DropdownMenuItem
              onClick={() => {
                resetProject();
                toast.success("New project");
              }}
            >
              <Plus className="w-4 h-4 mr-2" /> New Project
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenSVGImport}>
              <Upload className="w-4 h-4 mr-2" /> Import SVG / XML / Project
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => addLayer("path")}>
              <Plus className="w-4 h-4 mr-2" /> Add Layer
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onExport("json")}>
              <Download className="w-4 h-4 mr-2" /> Export Project (.json)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Edit (Undo/Redo) */}
      <div className="flex items-center gap-1 border-l border-white/20 dark:border-border pl-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10 dark:text-muted-foreground dark:hover:text-foreground"
                onClick={undo}
                disabled={!canUndo}
                aria-label="Undo"
              />
            }
          >
            <Undo2 className="w-4 h-4" />
          </TooltipTrigger>
          <TooltipContent>Undo (⌘Z)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/10 dark:text-muted-foreground dark:hover:text-foreground"
                onClick={redo}
                disabled={!canRedo}
                aria-label="Redo"
              />
            }
          >
            <Undo2 className="w-4 h-4 rotate-180 flip-y" />
          </TooltipTrigger>
          <TooltipContent>Redo (⇧⌘Z)</TooltipContent>
        </Tooltip>
      </div>

      {/* Transform / Action Mode Side Toggle */}
      <div className="flex items-center gap-1 border-l border-white/20 dark:border-border pl-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={editingSide === "from" ? "default" : "ghost"}
                size="sm"
                onClick={() => setEditingSide("from")}
                className={`h-8 px-3 gap-1.5 text-xs font-semibold ${
                  editingSide === "from"
                    ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90 dark:bg-primary dark:text-primary-foreground shadow-sm"
                    : "text-white/80 hover:text-white hover:bg-white/10 dark:text-muted-foreground dark:hover:text-foreground"
                }`}
              />
            }
          >
            <MaterialSymbol name="arrow_left" size={16} /> From
          </TooltipTrigger>
          <TooltipContent>Edit starting shape (1)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant={editingSide === "to" ? "default" : "ghost"}
                size="sm"
                onClick={() => setEditingSide("to")}
                className={`h-8 px-3 gap-1.5 text-xs font-semibold ${
                  editingSide === "to"
                    ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90 dark:bg-primary dark:text-primary-foreground shadow-sm"
                    : "text-white/80 hover:text-white hover:bg-white/10 dark:text-muted-foreground dark:hover:text-foreground"
                }`}
              />
            }
          >
            To <MaterialSymbol name="arrow_right" size={16} />
          </TooltipTrigger>
          <TooltipContent>Edit ending shape (2)</TooltipContent>
        </Tooltip>
      </div>

      {/* Magic Tools */}
      <div className="flex items-center gap-1.5 border-l border-white/20 dark:border-border pl-2">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs border-white/20 bg-white/5 text-white hover:bg-white/10 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted"
                onClick={handleAutoFix}
              />
            }
          >
            <Zap className="w-3.5 h-3.5 text-amber-300 dark:text-amber-500" /> Auto Fix
          </TooltipTrigger>
          <TooltipContent>Make paths compatible (A)</TooltipContent>
        </Tooltip>

        {isActionMode && (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-white/20 bg-white/5 hover:bg-white/10 text-white dark:border-border dark:bg-background dark:hover:bg-muted dark:text-foreground"
                    onClick={() => {
                      shiftSelectedLayer(-1);
                      toast.success("Shifted back");
                    }}
                    aria-label="Shift back points"
                  />
                }
              >
                <SkipBack className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent>Shift back points</TooltipContent>
            </Tooltip>
          </>
        )}

        {isActionMode && (
          <>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-white/20 bg-white/5 hover:bg-white/10 text-white dark:border-border dark:bg-background dark:hover:bg-muted dark:text-foreground"
                    onClick={() => {
                      splitSelectedCommand();
                      toast.success("Split in half");
                    }}
                    aria-label="Split command in half"
                  />
                }
              >
                <MaterialSymbol name="call_split" size={16} />
              </TooltipTrigger>
              <TooltipContent>Split command in half</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-white/20 bg-white/5 hover:bg-white/10 text-white dark:border-border dark:bg-background dark:hover:bg-muted dark:text-foreground"
                    onClick={() => {
                      setSelectedCommandAsFirst();
                      toast.success("Set as first point");
                    }}
                    aria-label="Set selected command as first"
                  />
                }
              >
                <MaterialSymbol name="first_page" size={16} />
              </TooltipTrigger>
              <TooltipContent>Set as first (original toolbar)</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-white/20 bg-white/5 hover:bg-white/10 text-white dark:border-border dark:bg-background dark:hover:bg-muted dark:text-foreground"
                    onClick={() => {
                      deleteSelectedPoint();
                    }}
                    aria-label="Delete selected point"
                  />
                }
              >
                <Trash2 className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent>Delete Point</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-white/20 bg-white/5 hover:bg-white/10 text-white dark:border-border dark:bg-background dark:hover:bg-muted dark:text-foreground"
                    onClick={() => {
                      deleteSelectedSubPath();
                    }}
                    aria-label="Delete selected subpath"
                  />
                }
              >
                <X className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent>Delete SubPath</TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 border-white/20 bg-white/5 hover:bg-white/10 text-white dark:border-border dark:bg-background dark:hover:bg-muted dark:text-foreground"
                    onClick={() => {
                      // Full PairSubPaths port pending (historical; future v6j parity)
                    }}
                    aria-label="Pair subpaths"
                  />
                }
              >
                <GitBranch className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent>Pair SubPaths (future)</TooltipContent>
            </Tooltip>
          </>
        )}

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs border-white/20 bg-white/5 text-white hover:bg-white/10 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted"
                onClick={() => {
                  reverseSelectedLayer();
                  toast.success("Reversed");
                }}
              />
            }
          >
            <RotateCw className="w-3.5 h-3.5 text-indigo-200 dark:text-indigo-400" /> Reverse
          </TooltipTrigger>
          <TooltipContent>Reverse (R)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs border-white/20 bg-white/5 text-white hover:bg-white/10 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted"
                onClick={() => {
                  shiftSelectedLayer(1);
                  toast.success("Shifted");
                }}
              />
            }
          >
            <ArrowLeftRight className="w-3.5 h-3.5 text-emerald-300 dark:text-emerald-500" /> Shift
          </TooltipTrigger>
          <TooltipContent>Shift points (S)</TooltipContent>
        </Tooltip>

        {/* Boolean ops (kbv real clipper post-21g stub; !isActionMode layer select parity with Reverse/Shift) */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 text-[10px] border-white/20 bg-white/5 text-white hover:bg-white/10 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted"
                aria-label="Union selected with next layer"
                onClick={() => {
                  booleanCombine("union");
                  toast.success("Union");
                }}
              />
            }
          >
            Union
          </TooltipTrigger>
          <TooltipContent>Union selected + next layer</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 text-[10px] border-white/20 bg-white/5 text-white hover:bg-white/10 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted"
                aria-label="Subtract (A-B) selected minus next layer"
                onClick={() => {
                  booleanCombine("subtract");
                  toast.success("Subtract");
                }}
              />
            }
          >
            Sub
          </TooltipTrigger>
          <TooltipContent>Subtract (A-B) selected + next</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 text-[10px] border-white/20 bg-white/5 text-white hover:bg-white/10 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted"
                aria-label="Intersect selected with next layer"
                onClick={() => {
                  booleanCombine("intersect");
                  toast.success("Intersect");
                }}
              />
            }
          >
            Inter
          </TooltipTrigger>
          <TooltipContent>Intersect selected + next</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className="h-8 px-2 text-[10px] border-white/20 bg-white/5 text-white hover:bg-white/10 dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted"
                aria-label="Exclude/XOR selected with next layer"
                onClick={() => {
                  booleanCombine("exclude");
                  toast.success("Exclude");
                }}
              />
            }
          >
            Xor
          </TooltipTrigger>
          <TooltipContent>Exclude/XOR selected + next</TooltipContent>
        </Tooltip>
      </div>

      {/* Samples */}
      <div className="flex items-center gap-1 border-l border-white/20 dark:border-border pl-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                className="inline-flex shrink-0 items-center justify-center rounded-lg h-8 gap-1.5 px-3 text-xs font-semibold hover:bg-white/10 text-white dark:text-foreground dark:hover:bg-muted transition-all outline-none"
              />
            }
          >
            Samples
          </DropdownMenuTrigger>
          <DropdownMenuContent className="text-xs">
            {DEMO_INFOS.map((demo, index) => (
              <DropdownMenuItem key={demo.id} onClick={() => onLoadSample(index)}>
                {demo.title}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Export */}
      <div className="flex items-center gap-1 border-l border-white/20 dark:border-border pl-2">
        <ExportDialog>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5 text-xs text-white/80 hover:text-white hover:bg-white/10 dark:text-muted-foreground dark:hover:text-foreground"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </Button>
        </ExportDialog>
      </div>

      {/* Reset Views */}
      <Button
        variant="ghost"
        size="sm"
        className="h-8 text-xs text-white/80 hover:text-white hover:bg-white/10 dark:text-muted-foreground dark:hover:text-foreground border-l border-white/20 dark:border-border pl-2 rounded-none"
        onClick={resetAllViews}
      >
        Reset Views
      </Button>

      <div className="flex-1" />
      <ThemeToggle />
    </header>
  );
}

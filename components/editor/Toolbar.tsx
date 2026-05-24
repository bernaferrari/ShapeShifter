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
    toolMode,
    setToolMode,
    splitSelectedCommand,
    setSelectedCommandAsFirst,
    deleteSelectedPoint,
    deleteSelectedSubPath,
  } = useEditorStore();

  const handleAutoFix = () => {
    if (autoFixSelectedLayer()) {
      toast.success("Auto Fix applied", { description: "Paths are now more compatible" });
    }
  };

  return (
    <header className="flex min-h-12 shrink-0 items-center gap-2 overflow-x-auto border-b bg-primary px-3 text-primary-foreground shadow-sm [scrollbar-width:none]">
      <div className="flex items-center gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2 border-r border-primary-foreground/20 pr-4">
          {isActionMode && (
            <Button
              variant="ghost"
              size="icon"
              className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
              aria-label="Close path morphing mode"
              onClick={closeActionMode}
            >
              <MaterialSymbol name="arrow_back" size={20} />
            </Button>
          )}
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary-foreground/15">
            <MaterialSymbol name="auto_awesome" size={18} filled weight={600} />
          </div>
          <div>
            <div className="text-lg font-semibold tracking-tight">{isActionMode ? "Path morphing" : "Shape Shifter"}</div>
            <div className="-mt-1 text-[10px] text-primary-foreground/70">
              {isActionMode ? "Edit start and end path compatibility" : "React 2026"}
            </div>
          </div>
        </div>

        <Badge variant="secondary" className="font-mono text-[10px] tracking-widest">
          v2.0
        </Badge>

        {/* Help */}
        <Button variant="ghost" size="sm" className="gap-1.5 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" onClick={onShowHelp}>
          <HelpCircle className="w-4 h-4" /> Shortcuts
        </Button>
      </div>

      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
              variant="ghost"
              size="icon"
              className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
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
              className="bg-primary-foreground text-primary hover:bg-primary-foreground/90"
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
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="sm" className="gap-2 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" />}
          >
            <Upload className="w-4 h-4" /> File
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onClick={() => toast.info("New project (demo)")}>
              <Plus className="w-4 h-4 mr-2" /> New Project
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenSVGImport}>
              <Upload className="w-4 h-4 mr-2" /> Import from SVG
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

      {/* Edit */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
              variant="ghost"
              size="icon"
              className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
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
              className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
              onClick={redo}
              disabled={!canRedo}
              aria-label="Redo"
              />
            }
          >
            <Redo2 className="w-4 h-4" />
          </TooltipTrigger>
          <TooltipContent>Redo (⇧⌘Z)</TooltipContent>
        </Tooltip>
      </div>

      {/* Transform / Action Mode */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
              variant={editingSide === "from" ? "default" : "ghost"}
              size="sm"
              onClick={() => setEditingSide("from")}
              className={editingSide === "from" ? "gap-1.5 bg-primary-foreground text-primary hover:bg-primary-foreground/90" : "gap-1.5 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"}
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
              className={editingSide === "to" ? "gap-1.5 bg-primary-foreground text-primary hover:bg-primary-foreground/90" : "gap-1.5 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"}
              />
            }
          >
            To <MaterialSymbol name="arrow_right" size={16} />
          </TooltipTrigger>
          <TooltipContent>Edit ending shape (2)</TooltipContent>
        </Tooltip>
      </div>

      {/* Magic Tools */}
      <div className="flex items-center gap-1">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
              variant="outline"
              size="sm"
              className="gap-2 border-primary-foreground/30 bg-primary-foreground/5 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
              onClick={handleAutoFix}
              />
            }
          >
            <Zap className="w-4 h-4" /> Auto Fix
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
                    className="border-primary-foreground/30 bg-primary-foreground/5 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
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
            {/* Tool Mode Switcher - advancing pure SVG Action Mode parity (sy0 / 5t1) */}
            <div className="flex items-center gap-0.5 rounded border border-primary-foreground/30 bg-primary-foreground/5 p-0.5 text-xs">
              <button
                onClick={() => setToolMode("select")}
                className={`rounded px-2 py-0.5 ${toolMode === "select" ? "bg-primary-foreground/20 text-primary-foreground" : "hover:bg-primary-foreground/10"}`}
                title="Select / Move points"
              >Select</button>
              <button
                onClick={() => setToolMode("pen")}
                className={`rounded px-2 py-0.5 ${toolMode === "pen" ? "bg-primary-foreground/20 text-primary-foreground" : "hover:bg-primary-foreground/10"}`}
                title="Pen / Add points (matches original Add Points mode)"
              >Pen</button>
              <button
                onClick={() => setToolMode("direct")}
                className={`rounded px-2 py-0.5 ${toolMode === "direct" ? "bg-primary-foreground/20 text-primary-foreground" : "hover:bg-primary-foreground/10"}`}
                title="Direct edit (handles)"
              >Direct</button>
            </div>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="border-primary-foreground/30 bg-primary-foreground/5 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
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
              <TooltipContent>Split in half (original toolbar action)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="border-primary-foreground/30 bg-primary-foreground/5 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
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

            {/* Additional original actions for full toolbar parity (closes iet/uak gaps) */}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="outline"
                    size="icon"
                    className="border-primary-foreground/30 bg-primary-foreground/5 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                    onClick={() => {
                      deleteSelectedPoint();
                    }}
                    aria-label="Delete selected point (original onDeletePointsClick)"
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
                    className="border-primary-foreground/30 bg-primary-foreground/5 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                    onClick={() => {
                      deleteSelectedSubPath();
                    }}
                    aria-label="Delete selected subpath (original onDeleteSubPathsClick)"
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
                    className="border-primary-foreground/30 bg-primary-foreground/5 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
                    onClick={() => {
                      // Full PairSubPaths port pending (see PairSubPathHelper in original)
                    }}
                    aria-label="Pair subpaths (original onPairSubPathsClick)"
                  />
                }
              >
                <GitBranch className="h-4 w-4" />
              </TooltipTrigger>
              <TooltipContent>Pair SubPaths (TODO full port)</TooltipContent>
            </Tooltip>
          </>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
              variant="outline"
              size="sm"
              className="gap-2 border-primary-foreground/30 bg-primary-foreground/5 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
              onClick={() => {
                reverseSelectedLayer();
                toast.success("Reversed");
              }}
              />
            }
          >
            <RotateCw className="w-4 h-4" /> Reverse
          </TooltipTrigger>
          <TooltipContent>Reverse (R)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
              variant="outline"
              size="sm"
              className="gap-2 border-primary-foreground/30 bg-primary-foreground/5 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground"
              onClick={() => {
                shiftSelectedLayer(1);
                toast.success("Shifted");
              }}
              />
            }
          >
            <ArrowLeftRight className="w-4 h-4" /> Shift
          </TooltipTrigger>
          <TooltipContent>Shift points (S)</TooltipContent>
        </Tooltip>
      </div>

      {/* Samples */}
      <div className="flex items-center gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="sm" className="gap-2 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" />}
          >
            Samples
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => onLoadSample(0)}>Play → Pause</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onLoadSample(1)}>Menu → Close</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onLoadSample(2)}>Heart → Star</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onLoadSample(3)}>Arrow → Check</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onLoadSample(4)}>Circle → Square</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Export */}
      <div className="flex items-center gap-1">
        <ExportDialog>
          <Button variant="ghost" size="sm" className="gap-2 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground">
            <Download className="w-4 h-4" /> Export
          </Button>
        </ExportDialog>
      </div>

      {/* Reset Views */}
      <Button variant="ghost" size="sm" className="text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground" onClick={resetAllViews}>
        Reset Views
      </Button>

      <div className="flex-1" />
      <ThemeToggle />
    

</header>
  );
}

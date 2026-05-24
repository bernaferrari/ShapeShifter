"use client";

import React from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Undo2,
  Redo2,
  Download,
  Upload,
  Plus,
  Zap,
  RotateCw,
  ArrowLeftRight,
  HelpCircle,
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
import { ThemeToggle } from "../ThemeToggle"; // We'll create this helper if needed

interface ToolbarProps {
  onExport: (type: string) => void;
  onLoadSample: (index: number) => void;
  onTogglePlay: () => void;
  onResetAnim: () => void;
  onOpenSVGImport: () => void;
  onShowHelp: () => void;
  resetAllViews: () => void;
  isPlaying: boolean;
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
  editingSide,
  setEditingSide,
  undo,
  redo,
  canUndo,
  canRedo,
}: ToolbarProps) {
  const {
    addLayer,
    deleteLayer,
    selectedLayerId,
    layers,
    reverseSelectedLayer,
    shiftSelectedLayer,
    autoFixSelectedLayer,
  } = useEditorStore();

  const handleAutoFix = () => {
    if (autoFixSelectedLayer()) {
      toast.success("Auto Fix applied", { description: "Paths are now more compatible" });
    }
  };

  return (
    <header className="editor-toolbar">
      <div className="flex items-center gap-3">
        {/* Brand */}
        <div className="flex items-center gap-2 pr-4 border-r border-border">
          <div className="w-8 h-8 rounded-xl bg-primary flex items-center justify-center">
            <MaterialSymbol name="auto_awesome" size={18} filled weight={600} />
          </div>
          <div>
            <div className="font-semibold tracking-[-0.02em] text-lg">ShapeShifter</div>
            <div className="text-[10px] text-muted-foreground -mt-1">2026</div>
          </div>
        </div>

        <Badge variant="secondary" className="font-mono text-[10px] tracking-widest">
          v2.0
        </Badge>

        {/* Help */}
        <Button variant="ghost" size="sm" className="editor-btn gap-1.5" onClick={onShowHelp}>
          <HelpCircle className="w-4 h-4" /> Shortcuts
        </Button>
      </div>

      {/* File */}
      <div className="group">
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button variant="ghost" size="sm" className="editor-btn gap-2">
              <Upload className="w-4 h-4" /> File
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onClick={() => toast.info("New project (demo)")}>
              <Plus className="w-4 h-4 mr-2" /> New Project
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenSVGImport}>
              <Upload className="w-4 h-4 mr-2" /> Import from SVG
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onExport("json")}>
              <Download className="w-4 h-4 mr-2" /> Export Project (.json)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Edit */}
      <div className="group">
        <Tooltip>
          <TooltipTrigger>
            <Button
              variant="ghost"
              size="icon"
              className="editor-btn"
              onClick={undo}
              disabled={!canUndo}
            >
              <Undo2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Undo (⌘Z)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Button
              variant="ghost"
              size="icon"
              className="editor-btn"
              onClick={redo}
              disabled={!canRedo}
            >
              <Redo2 className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Redo (⇧⌘Z)</TooltipContent>
        </Tooltip>
      </div>

      {/* Transform */}
      <div className="group">
        <Tooltip>
          <TooltipTrigger>
            <Button
              variant={editingSide === "from" ? "default" : "ghost"}
              size="sm"
              onClick={() => setEditingSide("from")}
              className="editor-btn gap-1.5"
            >
              <MaterialSymbol name="arrow_left" size={16} /> From
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit starting shape (1)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Button
              variant={editingSide === "to" ? "default" : "ghost"}
              size="sm"
              onClick={() => setEditingSide("to")}
              className="editor-btn gap-1.5"
            >
              To <MaterialSymbol name="arrow_right" size={16} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit ending shape (2)</TooltipContent>
        </Tooltip>
      </div>

      {/* Magic Tools */}
      <div className="group">
        <Tooltip>
          <TooltipTrigger>
            <Button
              variant="outline"
              size="sm"
              className="editor-btn gap-2"
              onClick={handleAutoFix}
            >
              <Zap className="w-4 h-4" /> Auto Fix
            </Button>
          </TooltipTrigger>
          <TooltipContent>Make paths compatible (A)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Button
              variant="outline"
              size="sm"
              className="editor-btn gap-2"
              onClick={() => {
                reverseSelectedLayer();
                toast.success("Reversed");
              }}
            >
              <RotateCw className="w-4 h-4" /> Reverse
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reverse (R)</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger>
            <Button
              variant="outline"
              size="sm"
              className="editor-btn gap-2"
              onClick={() => {
                shiftSelectedLayer(1);
                toast.success("Shifted");
              }}
            >
              <ArrowLeftRight className="w-4 h-4" /> Shift
            </Button>
          </TooltipTrigger>
          <TooltipContent>Shift points (S)</TooltipContent>
        </Tooltip>
      </div>

      {/* Samples */}
      <div className="group">
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button variant="ghost" size="sm" className="editor-btn gap-2">
              Samples
            </Button>
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
      <div className="group">
        <DropdownMenu>
          <DropdownMenuTrigger>
            <Button variant="ghost" size="sm" className="editor-btn gap-2">
              <Download className="w-4 h-4" /> Export
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => onExport("svg")}>Animated SVG</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("css")}>CSS Keyframes</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onExport("lottie")}>Lottie JSON</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onExport("json")}>Project (.json)</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Reset Views */}
      <Button variant="ghost" size="sm" className="editor-btn" onClick={resetAllViews}>
        Reset Views
      </Button>
    </header>
  );
}

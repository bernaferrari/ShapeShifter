"use client";

import React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  Circle,
  Frame,
  Lasso,
  MousePointer2,
  PaintBucket,
  PenTool,
  Scissors,
  Square,
  Waypoints,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEditorStore } from "@/lib/store/editorStore";
import type { ToolMode } from "@/lib/pathshift/toolModes";
import { selectedPathLayer } from "@/lib/store/playheadPathEditing";

interface ToolDef {
  mode: ToolMode;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
}

const SHAPES: ToolDef[] = [
  { mode: "rectangle", label: "Rectangle", icon: <Square className="size-4" />, shortcut: "R" },
  { mode: "ellipse", label: "Ellipse", icon: <Circle className="size-4" />, shortcut: "O" },
];

/** Shown only while editing points, like Figma's vector edit toolbar. */
const VECTOR_TOOLS: ToolDef[] = [
  { mode: "direct", label: "Edit points", icon: <Waypoints className="size-4" />, shortcut: "A" },
  { mode: "pen", label: "Pen", icon: <PenTool className="size-4" />, shortcut: "P" },
  { mode: "pencil", label: "Lasso", icon: <Lasso className="size-4" />, shortcut: "L" },
  { mode: "paint", label: "Paint", icon: <PaintBucket className="size-4" />, shortcut: "B" },
  { mode: "knife", label: "Add point", icon: <Scissors className="size-4" />, shortcut: "K" },
];
const VECTOR_MODES = new Set<ToolMode>(["direct", "pencil", "paint", "knife"]);

const toolButton =
  "grid size-8 place-items-center rounded-lg transition-colors pointer-coarse:size-10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring";
const idle = "text-foreground/75 hover:bg-muted hover:text-foreground";
const active = "bg-primary text-primary-foreground";

function Tip({ label, shortcut }: { label: string; shortcut?: string }) {
  return (
    <TooltipContent side="top" sideOffset={8} className="flex items-center gap-2 text-[11px]">
      {label}
      {shortcut && <span className="text-[10px] opacity-60">{shortcut}</span>}
    </TooltipContent>
  );
}

export function BottomToolPalette() {
  const toolMode = useEditorStore((state) => state.toolMode);
  const setToolMode = useEditorStore((state) => state.setToolMode);
  const [lastShape, setLastShape] = React.useState<ToolDef>(SHAPES[0]!);
  const editingPoints = VECTOR_MODES.has(toolMode);
  const canEditPoints = useEditorStore((state) => {
    const layer = selectedPathLayer(state);
    return Boolean(layer && !layer.locked);
  });

  const choose = (mode: ToolMode) => {
    if (mode === "rectangle" || mode === "ellipse") useEditorStore.getState().closeActionMode();
    setToolMode(mode);
  };

  const toolButtonFor = (tool: ToolDef) => {
    const isActive = toolMode === tool.mode;
    return (
      <Tooltip key={tool.mode}>
        <TooltipTrigger
          render={
            <button
              type="button"
              className={cn(toolButton, isActive ? active : idle)}
              onClick={() => choose(tool.mode)}
              aria-label={tool.label}
              aria-pressed={isActive}
            >
              {tool.icon}
            </button>
          }
        />
        <Tip label={tool.label} shortcut={tool.shortcut} />
      </Tooltip>
    );
  };

  if (editingPoints)
    return (
      <div
        role="toolbar"
        aria-label="Vector editing tools"
        className="flex items-center gap-0.5 rounded-xl bg-card p-1 [box-shadow:var(--elevation-floating)]"
      >
        {VECTOR_TOOLS.map(toolButtonFor)}
        <div className="mx-1 h-4 w-px bg-border" aria-hidden />
        <button
          type="button"
          onClick={() => {
            useEditorStore.getState().closeActionMode();
            setToolMode("select");
          }}
          className="h-8 rounded-lg px-3 text-[12px] font-medium text-foreground hover:bg-muted pointer-coarse:h-10"
          title="Done editing points · Esc"
        >
          Done
        </button>
      </div>
    );

  const shapeActive = SHAPES.some((shape) => shape.mode === toolMode);
  const currentShape = SHAPES.find((shape) => shape.mode === toolMode) ?? lastShape;

  return (
    <div
      role="toolbar"
      aria-label="Drawing tools"
      className="flex items-center gap-0.5 rounded-xl bg-card p-1 [box-shadow:var(--elevation-floating)]"
    >
      {toolButtonFor({
        mode: "select",
        label: "Move",
        icon: <MousePointer2 className="size-4" />,
        shortcut: "V",
      })}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className={cn(toolButton, idle)}
              onClick={() => useEditorStore.getState().addFrame()}
              aria-label="Add frame"
            >
              <Frame className="size-4" />
            </button>
          }
        />
        <Tip label="Frame" />
      </Tooltip>
      <div className="flex items-center">
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={cn(toolButton, "rounded-r-none", shapeActive ? active : idle)}
                onClick={() => choose(currentShape.mode)}
                aria-label={currentShape.label}
                aria-pressed={shapeActive}
              >
                {currentShape.icon}
              </button>
            }
          />
          <Tip label={currentShape.label} shortcut={currentShape.shortcut} />
        </Tooltip>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label="Choose shape"
                className={cn(
                  "grid h-8 w-4 place-items-center rounded-r-lg transition-colors pointer-coarse:h-10 pointer-coarse:w-5",
                  shapeActive ? active : idle,
                )}
              />
            }
          >
            <ChevronDown className="size-3" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" sideOffset={8} className="w-44">
            {SHAPES.map((shape) => (
              <DropdownMenuItem
                key={shape.mode}
                onClick={() => {
                  setLastShape(shape);
                  choose(shape.mode);
                }}
              >
                {shape.icon}
                {shape.label}
                <DropdownMenuShortcut>{shape.shortcut}</DropdownMenuShortcut>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {toolButtonFor({
        mode: "pen",
        label: "Pen",
        icon: <PenTool className="size-4" />,
        shortcut: "P",
      })}
      {canEditPoints && (
        <>
          <div className="mx-1 h-4 w-px bg-border" aria-hidden />
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className={cn(toolButton, idle)}
                  onClick={() => {
                    useEditorStore.getState().clearSelection?.();
                    setToolMode("direct");
                  }}
                  aria-label="Edit points"
                >
                  <Waypoints className="size-4" />
                </button>
              }
            />
            <Tip label="Edit points" shortcut="Enter" />
          </Tooltip>
        </>
      )}
    </div>
  );
}

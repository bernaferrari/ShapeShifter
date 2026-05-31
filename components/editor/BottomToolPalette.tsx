"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MousePointer2, Lasso, PaintBucket, PenTool } from "lucide-react";
import { useEditorStore } from "@/lib/store/editorStore";
import type { ToolMode } from "@/lib/shapeshifter/toolModes";

/**
 * Bottom tool palette — first visible artifact of the 2026 vision.
 * Matches the spirit of the user's reference (Move/Lasso/Bend/Cut/Paint/Pen/Direct + More) per v6j DESIGN 67dd105e. Paint completes the professional palette (rsn).
 * Initially a clean, modern bar that drives toolMode.
 *
 * This is the start of PR-01 foundation work under ShapeShifter-v6j (P0).
 * Over time this will grow real gestures (Bend will become a first-class curvature tool,
 * Cut will be a real knife, etc.).
 */

interface ToolDef {
  mode: ToolMode;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
}

const TOOLS: ToolDef[] = [
  {
    mode: "select",
    label: "Move / Select",
    icon: <MousePointer2 className="h-4 w-4" />,
    shortcut: "V",
  },
  {
    mode: "direct",
    label: "Direct / Bend",
    icon: <span className="material-symbols text-[18px] leading-none">conversion_path</span>,
    shortcut: "D",
  },
  {
    mode: "pen",
    label: "Pen",
    icon: <PenTool className="h-4 w-4" />,
    shortcut: "P",
  },
  {
    mode: "pencil",
    label: "Lasso",
    icon: <Lasso className="h-4 w-4" />,
    shortcut: "L",
  },
  {
    mode: "paint",
    label: "Paint",
    icon: <PaintBucket className="h-4 w-4" />,
    shortcut: "B",
  },
];

export function BottomToolPalette() {
  const { toolMode, setToolMode, isActionMode } = useEditorStore();

  // Hide the new palette in the old Action Mode triptych for now
  // (the old left sidebar still lives there). This keeps the transition safe.
  if (isActionMode) return null;

  return (
    <div className="flex items-center justify-center">
      <div className="flex items-center gap-1 rounded-lg border bg-background/95 p-1 shadow-xl shadow-black/15 backdrop-blur dark:shadow-black/35">
        {TOOLS.map((tool) => {
          const isActive = toolMode === tool.mode;
          return (
            <Tooltip key={tool.mode}>
              <TooltipTrigger
                render={
                  <Button
                    size="icon"
                    variant={isActive ? "secondary" : "ghost"}
                    className={`h-11 w-11 rounded-md transition-[background-color,color,box-shadow,transform] active:scale-95 ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setToolMode(tool.mode)}
                    aria-label={tool.label}
                    aria-pressed={isActive}
                  >
                    {tool.icon}
                  </Button>
                }
              />
              <TooltipContent side="top" className="text-[11px]">
                {tool.label} {tool.shortcut ? `(${tool.shortcut})` : ""}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}

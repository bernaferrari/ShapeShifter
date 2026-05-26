"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MousePointer2, Lasso, PaintBucket, Scissors, PenTool, MoreHorizontal } from "lucide-react";
import { useEditorStore } from "@/lib/store/editorStore";
import type { ToolMode } from "@/lib/shapeshifter/toolModes";

/**
 * Bottom tool palette — first visible artifact of the 2026 vision.
 * Matches the spirit of the user's reference (Move/Lasso/Paint/Bend/Cut + More).
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
    label: "Direct / Bend (Flex) – Ctrl+drag curves",
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
    label: "Pencil / Lasso (stub)",
    icon: <Lasso className="h-4 w-4" />,
    shortcut: "L",
  },
  {
    mode: "rectangle",
    label: "Shapes (stub)",
    icon: <span className="material-symbols text-[18px] leading-none">rectangle</span>,
  },
  {
    mode: "default",
    label: "More…",
    icon: <MoreHorizontal className="h-4 w-4" />,
  },
];

export function BottomToolPalette() {
  const { toolMode, setToolMode, isActionMode } = useEditorStore();

  // Hide the new palette in the old Action Mode triptych for now
  // (the old left sidebar still lives there). This keeps the transition safe.
  if (isActionMode) return null;

  return (
    <div className="flex h-12 items-center justify-center border-t bg-card px-2 shadow-sm">
      <div className="flex items-center gap-1 rounded-xl border bg-background p-1 shadow-sm">
        {TOOLS.map((tool) => {
          const isActive = toolMode === tool.mode;
          return (
            <Tooltip key={tool.mode}>
              <TooltipTrigger
                render={
                  <Button
                    size="sm"
                    variant={isActive ? "secondary" : "ghost"}
                    className={`h-8 gap-1.5 px-2.5 text-xs font-medium transition-all ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setToolMode(tool.mode)}
                    aria-label={tool.label}
                    aria-pressed={isActive}
                  />
                }
              >
                {tool.icon}
                <span className="hidden sm:inline">{tool.label.split(" / ")[0]}</span>
              </Button>
            }
            <TooltipContent side="top" className="text-[11px]">
              {tool.label} {tool.shortcut ? `(${tool.shortcut})` : ""}
            </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="ml-3 text-[10px] text-muted-foreground hidden md:block">
        Tool palette (vision foundation)
      </div>
    </div>
  );
}

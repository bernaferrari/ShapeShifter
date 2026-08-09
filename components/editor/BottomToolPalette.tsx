"use client";

import React from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MousePointer2, Lasso, PaintBucket, PenTool, Scissors, Waypoints } from "lucide-react";
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
    label: "Move",
    icon: <MousePointer2 className="h-4 w-4" />,
    shortcut: "V",
  },
  {
    // Figma A = vector/direct — must match page.tsx (not Auto Fix)
    mode: "direct",
    label: "Vector",
    icon: <Waypoints className="size-[18px]" />,
    shortcut: "A",
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
  {
    mode: "knife",
    label: "Knife",
    icon: <Scissors className="h-4 w-4" />,
    shortcut: "K",
  },
];

export function BottomToolPalette() {
  const toolMode = useEditorStore((state) => state.toolMode);
  const setToolMode = useEditorStore((state) => state.setToolMode);

  return (
    <div className="flex items-center gap-0.5 rounded-lg bg-card/95 p-1 [box-shadow:var(--elevation-floating)] backdrop-blur-md">
      {TOOLS.map((tool) => {
        const isActive = toolMode === tool.mode;
        return (
          <React.Fragment key={tool.mode}>
            {/* Divider between navigate/edit tools and create tools (Figma-style grouping) */}
            {tool.mode === "pen" && <div className="mx-0.5 h-5 w-px bg-border" />}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon"
                    variant="ghost"
                    className={`size-8 rounded-md transition-[background-color,color,transform] active:scale-[0.96] ${
                      isActive
                        ? "bg-primary text-primary-foreground hover:bg-primary"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                    onClick={() => setToolMode(tool.mode)}
                    aria-label={tool.label}
                    aria-pressed={isActive}
                  >
                    {tool.icon}
                  </Button>
                }
              />
              <TooltipContent side="top" className="flex flex-col gap-1 text-[11px] max-w-[220px]">
                <div className="flex items-center gap-2">
                  <span>{tool.label}</span>
                  {tool.shortcut && (
                    <kbd className="rounded bg-muted px-1 py-px font-mono text-[10px] text-muted-foreground">
                      {tool.shortcut}
                    </kbd>
                  )}
                </div>
                {tool.mode === "direct" && (
                  <div className="text-[10px] text-muted-foreground leading-tight">
                    Edit path points (Figma vector). Drag blue squares. Play timeline to preview
                    morph.
                  </div>
                )}
                {tool.mode === "select" && (
                  <div className="text-[10px] text-muted-foreground leading-tight">
                    Move whole shapes or frames. Double-click a shape to edit its vector.
                  </div>
                )}
                {tool.mode === "pen" && (
                  <div className="text-[10px] text-muted-foreground leading-tight">
                    Click to place points · drag for curves · Esc to finish
                  </div>
                )}
                {tool.mode === "paint" && (
                  <div className="text-[10px] text-muted-foreground leading-tight">
                    Click a region to fill with the current color
                  </div>
                )}
              </TooltipContent>
            </Tooltip>
          </React.Fragment>
        );
      })}
    </div>
  );
}

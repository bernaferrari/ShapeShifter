"use client";

import React from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Gauge, MousePointer2, Pause, PenTool, Play, Repeat, RotateCcw, SkipBack, SkipForward } from "lucide-react";
import { PathCanvas } from "./PathCanvas";
import { useEditorStore } from "@/lib/store/editorStore";

interface CanvasAreaProps {
  resetFrom: number;
  resetPreview: number;
  resetTo: number;
  resetAllViews: () => void;
}

export function CanvasArea({
  resetFrom,
  resetPreview,
  resetTo,
  resetAllViews,
}: CanvasAreaProps) {
  const {
    isPlaying,
    zoom,
    setProgress,
    setZoom,
    togglePlayback,
    toggleSlowMotion,
    toggleRepeating,
    getCompatibilityStatus,
    editingSide,
    setEditingSide,
    isActionMode,
    isSlowMotion,
    isRepeating,
    toolMode,
    setToolMode,
  } = useEditorStore();

  const compatibility = getCompatibilityStatus();

  return (
    <div className="flex min-w-0 flex-1 overflow-hidden bg-muted dark:bg-zinc-950">
      {isActionMode && (
        <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r bg-card px-1.5 py-3 shadow-xs">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon"
                  variant={toolMode === "select" ? "secondary" : "ghost"}
                  className="size-9"
                  onClick={() => setToolMode("select")}
                  aria-label="Select tool"
                />
              }
            >
              <MousePointer2 className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent side="right">Select</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon"
                  variant={toolMode === "direct" ? "secondary" : "ghost"}
                  className="size-9"
                  onClick={() => setToolMode("direct")}
                  aria-label="Vector edit tool"
                />
              }
            >
              <MaterialToolIcon name="conversion_path" />
            </TooltipTrigger>
            <TooltipContent side="right">Vector</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon"
                  variant={toolMode === "pen" ? "secondary" : "ghost"}
                  className="size-9"
                  onClick={() => setToolMode("pen")}
                  aria-label="Pen tool"
                />
              }
            >
              <PenTool className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent side="right">Pen</TooltipContent>
          </Tooltip>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-8 py-6">
        <motion.div
          className={
            isActionMode
              ? "grid w-full max-w-6xl grid-cols-3 items-center gap-5"
              : "w-full max-w-xl"
          }
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {isActionMode && (
            <div className="relative w-full">
              <div className="mb-2">
                <div className="text-[13px] font-semibold">Start</div>
                <div className="text-xs text-muted-foreground">FROM path</div>
              </div>
              <button
                className={`aspect-square w-full overflow-hidden rounded-sm border bg-card shadow-sm ${
                  editingSide === "from" ? "ring-2 ring-ring" : ""
                }`}
                onClick={() => setEditingSide("from")}
              >
                <PathCanvas side="from" resetKey={resetFrom} zoom={zoom} width={420} height={420} />
              </button>
            </div>
          )}

          <div className="relative w-full">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-[13px] font-semibold">Animated preview</div>
                <div className="text-xs text-muted-foreground">
                  {isActionMode ? "Interpolated path" : "Select a layer to edit properties"}
                </div>
              </div>
              <div className="flex items-center gap-1.5 bg-muted/50 rounded-lg p-0.5 border border-border">
                <Button size="icon-xs" variant="ghost" className="h-6 w-6 text-xs text-muted-foreground hover:text-foreground" onClick={() => setZoom(Math.max(0.5, zoom - 0.25))} aria-label="Zoom out">
                  -
                </Button>
                <span className="text-[10px] font-mono font-medium px-1 text-muted-foreground select-none">{Math.round(zoom * 100)}%</span>
                <Button size="icon-xs" variant="ghost" className="h-6 w-6 text-xs text-muted-foreground hover:text-foreground" onClick={() => setZoom(Math.min(4, zoom + 0.25))} aria-label="Zoom in">
                  +
                </Button>
                <div className="h-4 w-px bg-border mx-1" />
                <Button size="icon-xs" variant="ghost" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={resetAllViews} aria-label="Reset canvas views">
                  <RotateCcw className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="aspect-square w-full overflow-hidden rounded-sm border bg-card shadow-md">
              <PathCanvas side="preview" resetKey={resetPreview} zoom={zoom} width={456} height={456} />
            </div>
            {compatibility.warning && (
              <div className="mt-3 flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-foreground">
                <span>{compatibility.warning}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 px-2 text-[10px]"
                  onClick={() => {
                    const { autoFixSelectedLayer } = useEditorStore.getState();
                    autoFixSelectedLayer();
                  }}
                >
                  Fix
                </Button>
              </div>
            )}
          </div>

          {isActionMode && (
            <div className="relative w-full">
              <div className="mb-2">
                <div className="text-[13px] font-semibold">End</div>
                <div className="text-xs text-muted-foreground">TO path</div>
              </div>
              <button
                className={`aspect-square w-full overflow-hidden rounded-sm border bg-card shadow-sm ${
                  editingSide === "to" ? "ring-2 ring-ring" : ""
                }`}
                onClick={() => setEditingSide("to")}
              >
                <PathCanvas side="to" resetKey={resetTo} zoom={zoom} width={420} height={420} />
              </button>
            </div>
          )}
        </motion.div>
      </div>

      {/* Compact centered playback controls matching the original */}
      <div className="flex h-14 shrink-0 items-center justify-center gap-2 bg-muted dark:bg-zinc-900">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant={isSlowMotion ? "secondary" : "ghost"}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={toggleSlowMotion}
                aria-label="Slow motion"
              />
            }
          >
            <Gauge className="h-4 w-4" />
          </TooltipTrigger>
          <TooltipContent>Slow motion</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setProgress(0)}
                aria-label="Go to start"
              />
            }
          >
            <SkipBack className="h-4 w-4" />
          </TooltipTrigger>
          <TooltipContent>Go to start</TooltipContent>
        </Tooltip>

        <Button
          size="icon"
          onClick={togglePlayback}
          aria-label="Toggle playback"
          className="h-10 w-10 rounded-full bg-primary hover:bg-primary/90 text-primary-foreground shadow-md flex items-center justify-center transition-transform active:scale-95 shrink-0"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
        </Button>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={() => setProgress(1)}
                aria-label="Go to end"
              />
            }
          >
            <SkipForward className="h-4 w-4" />
          </TooltipTrigger>
          <TooltipContent>Go to end</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="icon"
                variant={isRepeating ? "secondary" : "ghost"}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                onClick={toggleRepeating}
                aria-label="Repeat"
              />
            }
          >
            <Repeat className="h-4 w-4" />
          </TooltipTrigger>
          <TooltipContent>Repeat playback</TooltipContent>
        </Tooltip>
      </div>
      </div>
    </div>
  );
}

function MaterialToolIcon({ name }: { name: string }) {
  return <span className="material-symbols text-[18px] leading-none">{name}</span>;
}

"use client";

import React from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Gauge, Pause, Play, Repeat, RotateCcw, SkipBack, SkipForward } from "lucide-react";
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
    progress,
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
  } = useEditorStore();

  const compatibility = getCompatibilityStatus();

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-muted">
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-6 py-7">
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
            <div className="aspect-square w-full overflow-hidden rounded-sm border bg-card shadow-lg">
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

      <div className="flex h-14 shrink-0 items-center justify-center gap-2 bg-muted px-5">
        <Button
          size="icon"
          variant={isSlowMotion ? "secondary" : "ghost"}
          aria-label="Slow motion"
          onClick={toggleSlowMotion}
        >
          <Gauge className="h-4 w-4" />
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
              size="icon"
              variant="outline"
              onClick={() => setProgress(0)}
              aria-label="Reset animation"
              className="h-9 w-9"
              />
            }
          >
            <SkipBack className="w-4 h-4" />
          </TooltipTrigger>
          <TooltipContent>Go to start</TooltipContent>
        </Tooltip>

        <Button
          size="icon"
          onClick={togglePlayback}
          aria-label="Toggle playback"
          className="h-10 w-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </Button>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
              size="icon"
              variant="outline"
              onClick={() => setProgress(1)}
              className="h-9 w-9"
              aria-label="Go to end"
              />
            }
          >
            <SkipForward className="w-4 h-4" />
          </TooltipTrigger>
          <TooltipContent>Go to end</TooltipContent>
        </Tooltip>

        <div className="w-[min(420px,40vw)] px-4">
          <Slider
            value={[progress * 100]}
            max={100}
            step={0.1}
            onValueChange={(val) => {
              const v = Array.isArray(val) ? val[0] : val;
              setProgress(v / 100);
              if (isPlaying) {
                const { togglePlayback } = useEditorStore.getState();
                togglePlayback();
              }
            }}
            className="w-full"
          />
        </div>

        <div className="w-12 text-right font-mono text-xs tabular-nums text-muted-foreground">
          {(progress * 100).toFixed(0)}%
        </div>

        <Button
          size="icon"
          variant={isRepeating ? "secondary" : "ghost"}
          aria-label="Repeat"
          onClick={toggleRepeating}
        >
          <Repeat className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

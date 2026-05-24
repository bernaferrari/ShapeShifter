"use client";

import React from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SkipBack, SkipForward, Play, Pause } from "lucide-react";
import { PathCanvas } from "./PathCanvas";
import { useEditorStore } from "@/lib/store/editorStore";

interface CanvasAreaProps {
  resetFrom: number;
  setResetFrom: (fn: (k: number) => number) => void;
  resetPreview: number;
  setResetPreview: (fn: (k: number) => number) => void;
  resetTo: number;
  setResetTo: (fn: (k: number) => number) => void;
  resetAllViews: () => void;
}

export function CanvasArea({
  resetFrom,
  setResetFrom,
  resetPreview,
  setResetPreview,
  resetTo,
  setResetTo,
  resetAllViews,
}: CanvasAreaProps) {
  const {
    isPlaying,
    progress,
    speed,
    zoom,
    setProgress,
    setSpeed,
    setZoom,
    togglePlayback,
    getCompatibilityStatus,
  } = useEditorStore();

  const compatibility = getCompatibilityStatus();

  return (
    <div className="relative">
      {/* Central Canvas Area */}
      <div className="relative rounded-2xl border border-border bg-card/30 p-6 shadow-inner">
        <motion.div
          className="flex gap-6 justify-center"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.23, 1, 0.32, 1] }}
        >
          {/* FROM */}
          <div className="flex flex-col items-center">
            <div className="mb-1.5 flex items-center justify-between w-full">
              <div className="flex items-center gap-1.5">
                <div className="text-[10px] font-medium tracking-[1.5px] text-muted-foreground">
                  FROM
                </div>
                <div className="h-px w-4 bg-border" />
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => setResetFrom((k) => k + 1)}
                title="Reset view"
              >
                <span className="text-[10px]">↺</span>
              </Button>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/50 p-1 shadow-inner">
              <PathCanvas side="from" resetKey={resetFrom} />
            </div>
          </div>

          {/* LIVE MORPH - The Heart */}
          <div className="flex flex-col items-center relative">
            <div className="mb-1.5 flex items-center justify-between w-full">
              <div className="flex items-center gap-1.5">
                <div className="text-[10px] font-semibold tracking-[1.5px] text-emerald-400">
                  LIVE MORPH
                </div>
                <div className="h-px w-4 bg-emerald-500/50" />
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => setResetPreview((k) => k + 1)}
                title="Reset view"
              >
                <span className="text-[10px]">↺</span>
              </Button>
            </div>

            {/* Compatibility Warning */}
            {compatibility.warning && (
              <div className="absolute -top-9 left-1/2 -translate-x-1/2 text-[10px] px-3 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/30 flex items-center gap-1.5 z-10">
                <span>⚠</span>
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

            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-1 shadow-inner ring-1 ring-inset ring-emerald-500/10">
              <PathCanvas side="preview" resetKey={resetPreview} />
            </div>
          </div>

          {/* TO */}
          <div className="flex flex-col items-center">
            <div className="mb-1.5 flex items-center justify-between w-full">
              <div className="flex items-center gap-1.5">
                <div className="text-[10px] font-medium tracking-[1.5px] text-muted-foreground">
                  TO
                </div>
                <div className="h-px w-4 bg-border" />
              </div>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6"
                onClick={() => setResetTo((k) => k + 1)}
                title="Reset view"
              >
                <span className="text-[10px]">↺</span>
              </Button>
            </div>
            <div className="rounded-xl border border-border/60 bg-background/50 p-1 shadow-inner">
              <PathCanvas side="to" resetKey={resetTo} />
            </div>
          </div>
        </motion.div>

        {/* Floating Status */}
        <div className="absolute top-4 right-4 bg-card/90 backdrop-blur border border-border rounded-full px-3 py-1 text-xs font-mono flex items-center gap-2">
          <div
            className={`w-1.5 h-1.5 rounded-full ${isPlaying ? "bg-success animate-pulse" : "bg-muted-foreground"}`}
          />
          {isPlaying ? "ANIMATING" : "EDITING"} • {Math.round(progress * 100)}%
        </div>

        {/* Zoom Controls */}
        <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-card/90 backdrop-blur border rounded-full px-1 py-1">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
          >
            −
          </Button>
          <div className="text-xs tabular-nums w-9 text-center font-mono">
            {Math.round(zoom * 100)}%
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setZoom(Math.min(4, zoom + 0.25))}
          >
            +
          </Button>
        </div>
      </div>

      {/* Playback Bar */}
      <div className="playback-bar mt-4">
        <Tooltip>
          <TooltipTrigger>
            <Button
              size="icon"
              variant="outline"
              onClick={() => setProgress(0)}
              aria-label="Reset animation"
              className="h-9 w-9"
            >
              <SkipBack className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
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
          <TooltipTrigger>
            <Button
              size="icon"
              variant="outline"
              onClick={() => setProgress(1)}
              className="h-9 w-9"
            >
              <SkipForward className="w-4 h-4" />
            </Button>
          </TooltipTrigger>
        </Tooltip>

        <div className="flex-1 px-4">
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

        <div className="font-mono text-xs text-muted-foreground w-12 text-right tabular-nums">
          {(progress * 100).toFixed(0)}%
        </div>

        <div className="flex items-center gap-2 pl-3 border-l border-border">
          <span className="text-xs text-muted-foreground">SPEED</span>
          <select
            value={speed}
            onChange={(e) => setSpeed(parseFloat(e.target.value))}
            className="bg-transparent text-sm font-medium focus:outline-none border border-border rounded px-2 py-0.5"
          >
            {[0.25, 0.5, 1, 1.5, 2, 3, 4].map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

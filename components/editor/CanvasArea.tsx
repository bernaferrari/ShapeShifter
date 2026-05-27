"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Copy,
  Gauge,
  MousePointer2,
  Pause,
  PenTool,
  Play,
  Plus,
  Repeat,
  RotateCcw,
  SkipBack,
  SkipForward,
  Trash2,
} from "lucide-react";
import { PathCanvas } from "./PathCanvas";
import { useEditorStore } from "@/lib/store/editorStore";
import { pathToString } from "@/lib/shapeshifter/pathUtils";
import { pointInPolygon } from "@/lib/shapeshifter/gestures/HitTests";

interface CanvasAreaProps {
  resetFrom: number;
  resetPreview: number;
  resetTo: number;
  resetAllViews: () => void;
}

export function CanvasArea({ resetFrom, resetPreview, resetTo, resetAllViews }: CanvasAreaProps) {
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
    layers,
    selectedLayerId,
    frames,
    selectedFrameId,
    addFrame,
    duplicateFrame,
    renameFrame,
    deleteFrame,
    selectFrame,
    animation,
  } = useEditorStore();

  const compatibility = getCompatibilityStatus();
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId);
  const selectedFrame = frames.find((frame) => frame.id === selectedFrameId);
  const sideCanvasChrome =
    "rounded-sm border bg-card shadow-lg shadow-black/10 dark:shadow-black/35";

  // r5o: Freeform world host in CanvasArea (!isActionMode). Smallest extension of existing
  // projection + frames x/y model. World camera + culling + gestures follow PathCanvas
  // patterns exactly (viewBox math, raf, pointer, focal zoom, lasso via HitTests).
  // moveFrames for multi-artboard. Double-click focus: selectFrame + camera lerp.
  // Zero changes to PathCanvas or actionMode paths. ToolMode (from palette/keyboard) drives world select/lasso.
  const [worldView, setWorldView] = useState({ x: -80, y: -80, w: 320, h: 320, scale: 1 });
  const [isWorldPanning, setIsWorldPanning] = useState(false);
  const [lastWorldPan, setLastWorldPan] = useState({ x: 0, y: 0 });
  const worldSvgRef = useRef<SVGSVGElement>(null);
  const worldLassoRef = useRef<Array<{ x: number; y: number }>>([]);
  const worldLassoRafRef = useRef<number | null>(null);
  const [, setWorldLassoFrame] = useState(0);
  const [worldSelectedIds, setWorldSelectedIds] = useState<string[]>([]);

  // Stub for world artboard drag start (r5o freeform depth owns full impl; present for typecheck hygiene during parallel waves).
  // i8f touches only frame tab indicators + animation optionality — no behavior change here.
  const startWorldArtboardDrag = (_x: number, _y: number, _ids: string[]) => {};

  const worldPointFromEvent = useCallback(
    (cx: number, cy: number) => {
      const r = worldSvgRef.current?.getBoundingClientRect();
      if (!r) return null;
      return {
        x: worldView.x + ((cx - r.left) / r.width) * worldView.w,
        y: worldView.y + ((cy - r.top) / r.height) * worldView.h,
      };
    },
    [worldView],
  );

  const getFrameBounds = useCallback(
    (f: any) => ({
      x: f.x || 0,
      y: f.y || 0,
      w: f.vector?.width || 48,
      h: f.vector?.height || 48,
    }),
    [],
  );

  // Performance culling for large/complex docs (AABB vs world viewport)
  const culledFrames = useMemo(() => {
    const vb = worldView;
    return frames.filter((f) => {
      const b = getFrameBounds(f);
      return !(b.x + b.w < vb.x || b.x > vb.x + vb.w || b.y + b.h < vb.y || b.y > vb.y + vb.h);
    });
  }, [frames, worldView, getFrameBounds]);

  const handleWorldWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const m = worldPointFromEvent(e.clientX, e.clientY);
      if (!m) return;
      const zf = e.deltaY > 0 ? 0.9 : 1.1;
      const ns = Math.max(0.05, Math.min(10, worldView.scale * zf));
      const nw = 320 / ns;
      const nh = 320 / ns;
      const nx = m.x - (m.x - worldView.x) * (nw / worldView.w);
      const ny = m.y - (m.y - worldView.y) * (nh / worldView.h);
      setWorldView({ x: nx, y: ny, w: nw, h: nh, scale: ns });
    },
    [worldPointFromEvent, worldView],
  );

  const hitArtboard = useCallback(
    (pt: { x: number; y: number } | null) => {
      if (!pt) return null;
      for (const f of [...frames].reverse()) {
        // topmost visual
        const b = getFrameBounds(f);
        if (pt.x >= b.x && pt.x <= b.x + b.w && pt.y >= b.y && pt.y <= b.y + b.h) return f.id;
      }
      return null;
    },
    [frames, getFrameBounds],
  );

  // World pointer handlers (exact PathCanvas parity for gestures + artboard ops)
  const handleWorldPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const p = worldPointFromEvent(e.clientX, e.clientY);
      if (e.button === 1 || e.altKey) {
        setIsWorldPanning(true);
        setLastWorldPan({ x: e.clientX, y: e.clientY });
        worldSvgRef.current?.setPointerCapture(e.pointerId);
        return;
      }
      if (!p) return;
      const hitId = hitArtboard(p);
      const isLassoTool = toolMode === "pencil";
      if (isLassoTool) {
        worldLassoRef.current = [p];
        if (worldLassoRafRef.current) cancelAnimationFrame(worldLassoRafRef.current);
        worldLassoRafRef.current = null;
        worldSvgRef.current?.setPointerCapture(e.pointerId);
        return;
      }
      // select tool (and direct as select proxy for world): artboard hit, multi, start batch drag (PathCanvas pattern)
      const additive = e.shiftKey;
      if (hitId) {
        const next = additive
          ? worldSelectedIds.includes(hitId)
            ? worldSelectedIds.filter((id) => id !== hitId)
            : [...worldSelectedIds, hitId]
          : [hitId];
        setWorldSelectedIds(next);
        if (!additive) selectFrame(hitId);
        startWorldArtboardDrag(e.clientX, e.clientY, next.length ? next : [hitId]);
      } else if (!additive) {
        setWorldSelectedIds([]);
      }
      worldSvgRef.current?.setPointerCapture(e.pointerId);
    },
    [
      worldPointFromEvent,
      hitArtboard,
      toolMode,
      selectFrame,
      worldSelectedIds,
      startWorldArtboardDrag,
    ],
  );

  const handleWorldPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isWorldPanning) {
        const r = worldSvgRef.current?.getBoundingClientRect();
        if (!r) return;
        const dx = ((e.clientX - lastWorldPan.x) / r.width) * worldView.w;
        const dy = ((e.clientY - lastWorldPan.y) / r.height) * worldView.h;
        setWorldView((prev) => ({ ...prev, x: prev.x - dx, y: prev.y - dy }));
        setLastWorldPan({ x: e.clientX, y: e.clientY });
        return;
      }
      const p = worldPointFromEvent(e.clientX, e.clientY);
      if (!p) return;
      const curTool = toolMode;
      if (curTool === "pencil") {
        const pts = worldLassoRef.current;
        if (
          pts.length === 0 ||
          Math.hypot(p.x - pts[pts.length - 1].x, p.y - pts[pts.length - 1].y) > 0.5
        ) {
          pts.push(p);
          if (pts.length > 4 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) < 2.5) {
            pts[pts.length - 1] = { ...pts[0] };
          }
        }
        if (pts.length > 200) pts.shift();
        if (!worldLassoRafRef.current) {
          worldLassoRafRef.current = requestAnimationFrame(() => {
            setWorldLassoFrame((f) => (f + 1) % 10000);
            worldLassoRafRef.current = null;
          });
        }
      }
    },
    [isWorldPanning, lastWorldPan, worldPointFromEvent, toolMode, worldView],
  );

  const handleWorldPointerUp = useCallback(
    (e: React.PointerEvent) => {
      setIsWorldPanning(false);
      const curTool = toolMode;
      if (worldSvgRef.current?.hasPointerCapture(e.pointerId)) {
        worldSvgRef.current.releasePointerCapture(e.pointerId);
      }

      // Lasso commit for artboard selection (world-level, reuses pointInPolygon - 9rp parity)
      if (curTool === "pencil" && worldLassoRef.current.length >= 3) {
        const poly = worldLassoRef.current;
        const hitIds = frames
          .filter((f) => {
            const b = getFrameBounds(f);
            const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
            return pointInPolygon(c, poly);
          })
          .map((f) => f.id);
        if (hitIds.length > 0) {
          const additive = e.shiftKey;
          setWorldSelectedIds((prev) =>
            additive ? Array.from(new Set([...prev, ...hitIds])) : hitIds,
          );
        } else if (!e.shiftKey) {
          setWorldSelectedIds([]);
        }
      }
      if (worldLassoRafRef.current) {
        cancelAnimationFrame(worldLassoRafRef.current);
        worldLassoRafRef.current = null;
      }
      setWorldLassoFrame(0);
      worldLassoRef.current = [];
    },
    [toolMode, frames, getFrameBounds],
  );

  // Double-click focus (select + camera lerp to artboard rect) - seamless world to detail transition
  const handleWorldDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      const p = worldPointFromEvent(e.clientX, e.clientY);
      const hit = hitArtboard(p);
      if (!hit) return;
      selectFrame(hit);
      const fb = frames.find((f) => f.id === hit);
      if (!fb) return;
      const b = getFrameBounds(fb);
      const pad = Math.max(b.w, b.h) * 0.65;
      const tgt = { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2, scale: 1 };
      const st = { ...worldView };
      const dur = 260;
      const t0 = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / dur);
        const e = 1 - Math.pow(1 - t, 3);
        setWorldView({
          x: st.x + (tgt.x - st.x) * e,
          y: st.y + (tgt.y - st.y) * e,
          w: st.w + (tgt.w - st.w) * e,
          h: st.h + (tgt.h - st.h) * e,
          scale: 1,
        });
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    [worldPointFromEvent, hitArtboard, selectFrame, frames, getFrameBounds, worldView],
  );

  return (
    <div className="flex min-w-0 flex-1 overflow-hidden bg-muted">
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
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-5 py-5 md:px-8">
          <motion.div
            className={
              isActionMode
                ? "grid h-full w-full max-w-[1440px] grid-cols-3 items-center gap-4"
                : "flex h-full w-full max-w-5xl items-center justify-center"
            }
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            {isActionMode && (
              <div className="relative flex h-full min-h-0 min-w-0 flex-col justify-center">
                <div className="mb-2">
                  <div className="text-[13px] font-semibold">Start</div>
                  <div className="text-xs text-muted-foreground">FROM path</div>
                </div>
                <button
                  className={`aspect-square max-h-[min(100%,640px)] w-full overflow-hidden ${sideCanvasChrome} ${
                    editingSide === "from" ? "ring-2 ring-ring" : ""
                  }`}
                  onClick={() => setEditingSide("from")}
                >
                  <PathCanvas
                    side="from"
                    resetKey={resetFrom}
                    zoom={zoom}
                    width={420}
                    height={420}
                  />
                </button>
              </div>
            )}

            <div
              className={
                isActionMode
                  ? "relative flex h-full min-h-0 min-w-0 flex-col justify-center"
                  : "relative flex h-full min-h-0 w-full max-w-[880px] flex-col justify-center"
              }
            >
              <div className="mb-2 flex items-center justify-between">
                {isActionMode ? (
                  <div>
                    <div className="text-[13px] font-semibold">Vector canvas</div>
                    <div className="text-xs text-muted-foreground">
                      {selectedLayer?.name ?? "Path morph"}
                    </div>
                  </div>
                ) : (
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="flex max-w-[420px] min-w-0 items-center gap-1 overflow-x-auto rounded-md border bg-card/80 p-1">
                      {frames.map((frame) => {
                        const frameHasAnim = (frame.animation?.blocks?.length ?? 0) > 0;
                        return (
                          <Button
                            key={frame.id}
                            size="sm"
                            variant={frame.id === selectedFrameId ? "secondary" : "ghost"}
                            className="h-7 shrink-0 px-2 text-xs"
                            onClick={() => selectFrame(frame.id)}
                            title={
                              frameHasAnim
                                ? `${frame.name} (has optional animation blocks)`
                                : frame.name
                            }
                          >
                            {frame.name}
                            {frameHasAnim && (
                              <span
                                className="ml-0.5 inline-block h-1.5 w-1.5 rounded-full bg-primary/70 align-middle"
                                aria-label="animated"
                              />
                            )}
                          </Button>
                        );
                      })}
                    </div>
                    {selectedFrame && (
                      <Input
                        className="h-7 w-36 rounded-md px-2 text-xs"
                        value={selectedFrame.name}
                        onChange={(event) => renameFrame(selectedFrame.id, event.target.value)}
                        aria-label="Rename selected frame"
                      />
                    )}
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={duplicateFrame}
                            aria-label="Duplicate frame"
                          />
                        }
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </TooltipTrigger>
                      <TooltipContent>Duplicate frame</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={addFrame}
                            aria-label="Add frame"
                          />
                        }
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </TooltipTrigger>
                      <TooltipContent>Add frame</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="icon-xs"
                            variant="ghost"
                            className="h-7 w-7 text-muted-foreground hover:text-destructive"
                            onClick={() => selectedFrame && deleteFrame(selectedFrame.id)}
                            disabled={frames.length <= 1}
                            aria-label="Delete frame"
                          />
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </TooltipTrigger>
                      <TooltipContent>Delete frame</TooltipContent>
                    </Tooltip>
                  </div>
                )}
                <div className="flex items-center gap-1.5 bg-muted/50 rounded-lg p-0.5 border border-border">
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="h-6 w-6 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setZoom(Math.max(0.5, zoom - 0.25))}
                    aria-label="Zoom out"
                  >
                    -
                  </Button>
                  <span className="text-[10px] font-mono font-medium px-1 text-muted-foreground select-none">
                    {Math.round(zoom * 100)}%
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="h-6 w-6 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setZoom(Math.min(4, zoom + 0.25))}
                    aria-label="Zoom in"
                  >
                    +
                  </Button>
                  <div className="h-4 w-px bg-border mx-1" />
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={resetAllViews}
                    aria-label="Reset canvas views"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <div
                className="aspect-square w-full max-w-[min(880px,100%)] overflow-hidden bg-muted"
                role="img"
                aria-label="Freeform world canvas with frames and tools (pan, zoom, select, lasso, multi-artboard). Use keyboard or bottom palette for tools. Double-click artboard to focus."
              >
                {!isActionMode ? (
                  <svg
                    ref={worldSvgRef}
                    width="100%"
                    height="100%"
                    className="touch-none"
                    onWheel={handleWorldWheel}
                    onPointerDown={handleWorldPointerDown}
                    onPointerMove={handleWorldPointerMove}
                    onPointerUp={handleWorldPointerUp}
                    onDoubleClick={handleWorldDoubleClick}
                    style={{ background: "hsl(var(--muted))" }}
                  >
                    {/* World grid (subtle, like PathCanvas) */}
                    <defs>
                      <pattern id="world-grid" width="16" height="16" patternUnits="userSpaceOnUse">
                        <path
                          d="M 16 0 L 0 0 0 16"
                          fill="none"
                          stroke="hsl(var(--border))"
                          strokeWidth="0.5"
                          opacity="0.5"
                        />
                      </pattern>
                    </defs>
                    <rect
                      x={worldView.x}
                      y={worldView.y}
                      width={worldView.w}
                      height={worldView.h}
                      fill="url(#world-grid)"
                    />
                    {/* Culled artboards (perf culling for large docs) + cheap static previews */}
                    {culledFrames.map((frame) => {
                      const b = getFrameBounds(frame);
                      const isSel =
                        worldSelectedIds.includes(frame.id) || frame.id === selectedFrameId;
                      // cheap preview: first path layer's from (or empty)
                      const previewLayer = frame.layers?.find(
                        (l: any) => l && (l.from || l.pathData),
                      );
                      const previewD = previewLayer
                        ? pathToString(
                            previewLayer.from || previewLayer.pathData || { subPaths: [] },
                          )
                        : "";
                      return (
                        <g key={frame.id} transform={`translate(${b.x} ${b.y})`}>
                          <rect
                            x={0}
                            y={0}
                            width={b.w}
                            height={b.h}
                            fill="#fff"
                            stroke={isSel ? "#0d99ff" : "hsl(var(--border))"}
                            strokeWidth={isSel ? 2.5 : 1}
                            rx="1"
                          />
                          {previewD && (
                            <path
                              d={previewD}
                              fill="none"
                              stroke="#111"
                              strokeWidth={Math.max(0.8, Math.min(2.2, b.w / 24))}
                              opacity="0.85"
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                          <text
                            x={4}
                            y={-4}
                            fontSize={Math.max(3, b.w * 0.08)}
                            fill="hsl(var(--muted-foreground))"
                            pointerEvents="none"
                          >
                            {frame.name}
                          </text>
                        </g>
                      );
                    })}
                    {/* Live world lasso polyline (60fps via raf, dashed, exact PathCanvas/9rp visual) */}
                    {worldLassoRef.current.length > 1 && (
                      <polyline
                        points={worldLassoRef.current.map((pt) => `${pt.x},${pt.y}`).join(" ")}
                        fill="none"
                        stroke="#0d99ff"
                        strokeWidth="1.2"
                        strokeDasharray="3 2"
                        opacity="0.9"
                        vectorEffect="non-scaling-stroke"
                      />
                    )}
                  </svg>
                ) : (
                  <PathCanvas
                    side="preview"
                    resetKey={resetPreview}
                    zoom={zoom}
                    width={456}
                    height={456}
                  />
                )}
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
              <div className="relative flex h-full min-h-0 min-w-0 flex-col justify-center">
                <div className="mb-2">
                  <div className="text-[13px] font-semibold">End</div>
                  <div className="text-xs text-muted-foreground">TO path</div>
                </div>
                <button
                  className={`aspect-square max-h-[min(100%,640px)] w-full overflow-hidden ${sideCanvasChrome} ${
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

        {/* Compact centered playback controls — power feature only. Rendered solely when animation opted-in (blocks present) for zero forced mental model + non-intrusive freeform canvas. Discovery + control remain excellent via toolbar, Space, LayerTimeline, Inspector. */}
        {animation.blocks.length > 0 && (
          <div className="flex h-14 shrink-0 items-center justify-center gap-2 border-t bg-card">
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
        )}
      </div>
    </div>
  );
}

function MaterialToolIcon({ name }: { name: string }) {
  return <span className="material-symbols text-[18px] leading-none">{name}</span>;
}

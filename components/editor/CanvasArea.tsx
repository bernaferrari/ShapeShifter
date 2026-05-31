"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import type { Viewport } from "@/lib/shapeshifter/camera";
import { clientToWorld, zoomAtWorldPoint } from "@/lib/shapeshifter/camera";
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
    worldViewport,
    setWorldViewport,
    fitWorldToFrames,
    bringFrameIntoView,
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
  const worldView = worldViewport;
  const setWorldView = useCallback(
    (next: Viewport | ((previous: Viewport) => Viewport)) => {
      const resolved =
        typeof next === "function" ? next(useEditorStore.getState().worldViewport) : next;
      setWorldViewport(resolved);
    },
    [setWorldViewport],
  );
  const [isWorldPanning, setIsWorldPanning] = useState(false);
  const [lastWorldPan, setLastWorldPan] = useState({ x: 0, y: 0 });
  const worldSvgRef = useRef<SVGSVGElement>(null);
  const worldLassoRef = useRef<Array<{ x: number; y: number }>>([]);
  const worldLassoRafRef = useRef<number | null>(null);
  // Zero-friction polish (19u): ref to cancel prior in-flight world camera lerp on rapid dblclicks
  // or repeated focus gestures. Prevents concurrent RAFs from fighting and causing camera jank
  // during world<->detail transitions on complex multi-frame docs. Exact pattern match to
  // lassoRafRef / paintPreviewRafRef in PathCanvas + worldLassoRafRef here.
  const worldCameraRafRef = useRef<number | null>(null);
  const [, setWorldLassoFrame] = useState(0);
  const [worldSelectedIds, setWorldSelectedIds] = useState<string[]>([]);

  // Real artboard dragging state (replaces the previous no-op stub)
  const [isDraggingArtboards, setIsDraggingArtboards] = useState(false);
  const [draggingArtboardIds, setDraggingArtboardIds] = useState<string[]>([]);
  const [artboardDragStart, setArtboardDragStart] = useState<{ x: number; y: number } | null>(null);
  // Real implementation for world artboard dragging (fixes the previous no-op stub).
  // Called from pointer down when artboards are hit in select mode.
  const startWorldArtboardDrag = (clientX: number, clientY: number, ids: string[]) => {
    if (!ids.length) return;
    const p = worldPointFromEvent(clientX, clientY);
    if (!p) return;

    setIsDraggingArtboards(true);
    setDraggingArtboardIds(ids);
    setArtboardDragStart(p);
  };

  const worldPointFromEvent = useCallback(
    (cx: number, cy: number) => {
      const r = worldSvgRef.current?.getBoundingClientRect();
      if (!r) return null;
      return clientToWorld(cx, cy, r, worldView);
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

  const frameIdsSignature = useMemo(() => frames.map((frame) => frame.id).join("|"), [frames]);
  const previousWorldSyncRef = useRef<{
    frameIdsSignature: string;
    selectedFrameId: string | null;
  } | null>(null);

  // Keep the store-owned camera synced to structural frame changes without re-fitting on drag.
  useEffect(() => {
    const previous = previousWorldSyncRef.current;
    previousWorldSyncRef.current = {
      frameIdsSignature,
      selectedFrameId: selectedFrameId ?? null,
    };

    if (!frames.length || !previous) return;

    if (previous.frameIdsSignature !== frameIdsSignature) {
      fitWorldToFrames();
      return;
    }

    if (selectedFrameId && selectedFrameId !== previous.selectedFrameId) {
      bringFrameIntoView(selectedFrameId, { animate: true });
    }
  }, [frameIdsSignature, frames.length, selectedFrameId, fitWorldToFrames, bringFrameIntoView]);

  useEffect(() => {
    return () => {
      if (worldCameraRafRef.current) cancelAnimationFrame(worldCameraRafRef.current);
      if (worldLassoRafRef.current) cancelAnimationFrame(worldLassoRafRef.current);
    };
  }, []);

  // Performance culling for large/complex docs (AABB vs world viewport)
  const culledFrames = useMemo(() => {
    const vb = worldView;
    return frames.filter((f) => {
      const b = getFrameBounds(f);
      return !(b.x + b.w < vb.x || b.x > vb.x + vb.w || b.y + b.h < vb.y || b.y > vb.y + vb.h);
    });
  }, [frames, worldView, getFrameBounds]);

  // Zero-friction polish (19u): memoized cheap static previews for culled world artboards.
  // Eliminates repeated .find + pathToString on every world pan/zoom/selection change
  // for large multi-frame docs. Recomputes only when frames change (correct). Exact
  // pattern + location as culledFrames useMemo immediately above.
  const framePreviews = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of frames) {
      const previewLayer = f.layers?.find((l: any) => l && (l.from || l.pathData));
      const previewD = previewLayer
        ? pathToString(previewLayer.from || previewLayer.pathData || { subPaths: [] })
        : "";
      m.set(f.id, previewD);
    }
    return m;
  }, [frames]);

  const handleWorldWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const m = worldPointFromEvent(e.clientX, e.clientY);
      if (!m) return;
      const zf = e.deltaY > 0 ? 0.9 : 1.1;
      setWorldView(zoomAtWorldPoint(worldView, m, worldView.scale * zf, 0.05, 20));
    },
    [setWorldView, worldPointFromEvent, worldView],
  );

  const zoomWorldAtCenter = useCallback(
    (factor: number) => {
      const center = {
        x: worldView.x + worldView.w / 2,
        y: worldView.y + worldView.h / 2,
      };
      setWorldView(zoomAtWorldPoint(worldView, center, worldView.scale * factor, 0.05, 20));
    },
    [setWorldView, worldView],
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

      // Artboard dragging in world (select mode) — pro Figma-grade
      if (isDraggingArtboards && draggingArtboardIds.length > 0 && artboardDragStart) {
        let dx = p.x - artboardDragStart.x;
        let dy = p.y - artboardDragStart.y;

        // Shift = axis lock (classic pro constraint)
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) {
            dy = 0;
          } else {
            dx = 0;
          }
        }

        if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) {
          useEditorStore.getState().moveFrames(draggingArtboardIds, dx, dy);
          setArtboardDragStart(p);
        }
        return;
      }

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
    [
      isWorldPanning,
      lastWorldPan,
      worldPointFromEvent,
      toolMode,
      worldView,
      isDraggingArtboards,
      draggingArtboardIds,
      artboardDragStart,
    ],
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

      // Commit artboard drag (pro)
      if (isDraggingArtboards) {
        // Push a single history step for the whole drag
        useEditorStore.getState().pushHistory?.();
        setIsDraggingArtboards(false);
        setDraggingArtboardIds([]);
        setArtboardDragStart(null);
      }
    },
    [toolMode, frames, getFrameBounds, isDraggingArtboards],
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
      // Cancel any prior lerp (19u polish): guarantees single active camera animation, zero jank on repeated dblclick focus.
      if (worldCameraRafRef.current) {
        cancelAnimationFrame(worldCameraRafRef.current);
        worldCameraRafRef.current = null;
      }
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
        if (t < 1) {
          worldCameraRafRef.current = requestAnimationFrame(step);
        } else {
          worldCameraRafRef.current = null;
        }
      };
      worldCameraRafRef.current = requestAnimationFrame(step);
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
                    onClick={() =>
                      isActionMode ? setZoom(Math.max(0.5, zoom - 0.25)) : zoomWorldAtCenter(0.8)
                    }
                    aria-label="Zoom out"
                  >
                    -
                  </Button>
                  <span className="text-[10px] font-mono font-medium px-1 text-muted-foreground select-none">
                    {Math.round((isActionMode ? zoom : worldView.scale) * 100)}%
                  </span>
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="h-6 w-6 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      isActionMode ? setZoom(Math.min(4, zoom + 0.25)) : zoomWorldAtCenter(1.25)
                    }
                    aria-label="Zoom in"
                  >
                    +
                  </Button>
                  <div className="h-4 w-px bg-border mx-1" />
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      fitWorldToFrames();
                      resetAllViews();
                    }}
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
                    viewBox={`${worldView.x} ${worldView.y} ${worldView.w} ${worldView.h}`}
                    preserveAspectRatio="xMidYMid meet"
                    className="touch-none"
                    onWheel={handleWorldWheel}
                    onPointerDown={handleWorldPointerDown}
                    onPointerMove={handleWorldPointerMove}
                    onPointerUp={handleWorldPointerUp}
                    onDoubleClick={handleWorldDoubleClick}
                    style={{
                      background: "hsl(var(--muted))",
                      cursor: isDraggingArtboards ? "grabbing" : "default",
                    }}
                  >
                    {/* World grid (subtle, like PathCanvas) + pro drag shadow */}
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
                      {/* Subtle lift shadow for dragged artboards — Figma-grade tactility */}
                      <filter id="dragShadow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="1.5" stdDeviation="1.2" floodOpacity="0.18" />
                      </filter>
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
                      const isBeingDragged = draggingArtboardIds.includes(frame.id);
                      // cheap preview: first path layer's from (or empty) — now from memo for large doc perf
                      const previewD = framePreviews.get(frame.id) || "";

                      // Pro drag visuals (1q2i): lifted + active feedback while dragging
                      const dragStroke = isBeingDragged
                        ? "#0d99ff"
                        : isSel
                          ? "#0d99ff"
                          : "hsl(var(--border))";
                      const dragWidth = isBeingDragged ? 3 : isSel ? 2.5 : 1;
                      const dragOpacity = isBeingDragged ? 0.65 : 1;
                      const dragShadow = isBeingDragged ? "url(#dragShadow)" : undefined;

                      return (
                        <g key={frame.id} transform={`translate(${b.x} ${b.y})`}>
                          <rect
                            x={0}
                            y={0}
                            width={b.w}
                            height={b.h}
                            fill="#fff"
                            stroke={dragStroke}
                            strokeWidth={dragWidth}
                            rx="1"
                            opacity={dragOpacity}
                            filter={dragShadow}
                          />
                          {previewD && (
                            <path
                              d={previewD}
                              fill="none"
                              stroke="#111"
                              strokeWidth={Math.max(0.8, Math.min(2.2, b.w / 24))}
                              opacity={isBeingDragged ? 0.5 : 0.85}
                              vectorEffect="non-scaling-stroke"
                            />
                          )}
                          <text
                            x={4}
                            y={-4}
                            fontSize={Math.max(3, b.w * 0.08)}
                            fill="hsl(var(--muted-foreground))"
                            pointerEvents="none"
                            opacity={isBeingDragged ? 0.6 : 1}
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

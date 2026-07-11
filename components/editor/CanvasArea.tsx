"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Copy,
  Grid3x3,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { PathCanvas } from "./PathCanvas";
import { useEditorStore } from "@/lib/store/editorStore";
import type { Viewport } from "@/lib/shapeshifter/camera";
import {
  clientToWorld,
  computeGridSpec,
  fitViewportToAspect,
  snapValueToStep,
  zoomAtWorldPoint,
} from "@/lib/shapeshifter/camera";
import {
  getInterpolatedPath,
  getPathDataBounds,
  isPointInFillRegion,
  parsePath,
  pathToString,
  scalePathToBounds,
  updateCommandPoint,
} from "@/lib/shapeshifter/pathUtils";
import { evaluateBlock } from "@/lib/shapeshifter/interpolators";
import {
  numberAtTime,
  pathDAtTime,
  sampleMotionPath,
  colorAtTime,
} from "@/lib/shapeshifter/playheadResolve";
import { snapRectToGuides, type GuideLine } from "@/lib/shapeshifter/smartGuides";
import { collectPointsInLasso, pointInPolygon } from "@/lib/shapeshifter/gestures/HitTests";
import { generateId } from "@/lib/shapeshifter/ids";
import { gradientDomId, gradientToSvg } from "@/lib/shapeshifter/gradients";
import type { Command, PathData, Selection } from "@/lib/shapeshifter/types";
import { toast } from "sonner";

interface CanvasAreaProps {
  resetFrom: number;
  resetPreview: number;
  resetTo: number;
  resetAllViews: () => void;
}

export function CanvasArea({ resetFrom, resetPreview, resetTo, resetAllViews }: CanvasAreaProps) {
  const {
    isPlaying,
    progress,
    zoom,
    setZoom,
    getCompatibilityStatus,
    editingSide,
    isActionMode,
    toolMode,
    layers,
    selectedLayerId,
    frames,
    selectedFrameId,
    addFrame,
    renameFrame,
    deleteFrame,
    selectFrame,
    worldViewport,
    setWorldViewport,
    fitWorldToFrames,
    bringFrameIntoView,
    selectPoint,
    selectLayer,
    selectLayers,
    selectedLayerIds,
    selectedPoints,
    updateSelectedLayer,
    setToolMode,
    snapToGrid,
    gridDivisions,
    setGridDivisions,
    hasCanvasSelection,
    selectionKind,
    deselectAll,
    spacePanActive,
    animation,
  } = useEditorStore();

  /** Figma mental model: Select = objects; Direct = vector points. */
  const isObjectTool = toolMode === "select";
  const isPointTool = toolMode === "direct";

  const compatibility = getCompatibilityStatus();
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId);

  // r5o: Freeform world host in CanvasArea (!isActionMode). Smallest extension of existing
  // projection + frames x/y model. World camera + culling + gestures follow PathCanvas
  // patterns exactly (viewBox math, raf, pointer, focal zoom, lasso via HitTests).
  // moveFrames for multi-artboard. Double-click focus: selectFrame + camera lerp.
  // Zero changes to PathCanvas or actionMode paths. ToolMode (from palette/keyboard) drives world select/lasso.
  // Aspect-corrected world viewport so the canvas fills the (non-square) panel
  // edge-to-edge while screen↔world mapping stays exact for every consumer below.
  const [worldSize, setWorldSize] = useState({ w: 0, h: 0 });
  const worldView = useMemo(
    () => fitViewportToAspect(worldViewport, worldSize.w > 0 && worldSize.h > 0 ? worldSize.w / worldSize.h : 1),
    [worldViewport, worldSize],
  );
  const setWorldView = useCallback(
    (next: Viewport | ((previous: Viewport) => Viewport)) => {
      const resolved =
        typeof next === "function" ? next(useEditorStore.getState().worldViewport) : next;
      setWorldViewport(resolved);
    },
    [setWorldViewport],
  );

  // Inline vector editing on the world canvas (no separate "edit stage"):
  // the selected frame shows its anchor points in place and you drag them directly.
  const pointDragRef = useRef<Selection | null>(null);
  // History is pushed lazily on the first real movement of a drag, so a plain
  // click that only selects never creates a phantom undo step.
  const pointDragMovedRef = useRef(false);
  const editFrame = frames.find((f) => f.id === selectedFrameId);
  const editLayer = layers.find((l) => l.id === selectedLayerId);
  const editPath: PathData | null =
    editLayer && editLayer.type !== "group" ? (editLayer[editingSide] as PathData) : null;
  const editOrigin = editFrame ? { x: editFrame.x || 0, y: editFrame.y || 0 } : null;
  /** Layer Position transform — anchors live in path space, then this offset. */
  const editLayerTx = Number(editLayer?.translateX) || 0;
  const editLayerTy = Number(editLayer?.translateY) || 0;

  const currentFillColor = layers.find((l) => l.id === selectedLayerId)?.fillColor || "#111111";

  // Dynamic paint bucket cursor tinted with current selected color (for CSS cursor)
  const paintBucketCursor = React.useMemo(() => {
    const c = currentFillColor.replace("#", "%23");
    return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cg%3E%3Cpath fill='${c}' stroke='%23000' stroke-width='0.8' d='M3 3 L13 3 L14 13 L2 13 Z'/%3E%3Cpath fill='none' stroke='%23000' stroke-width='1' d='M3 3 L3 13 M13 3 L13 13'/%3E%3Cpath fill='%23ddd' d='M5 5 L11 5 L10 11 L6 11 Z'/%3E%3Cpath fill='none' stroke='%23000' stroke-width='0.5' d='M4 2 L12 2'/%3E%3C/g%3E%3C/svg%3E") 4 2, crosshair`;
  }, [currentFillColor]);

  // Anchor handles drawn at a constant on-screen size regardless of zoom.
  const worldPerPx = worldSize.w > 0 ? worldView.w / worldSize.w : 1;
  const anchorR = worldPerPx * 4;
  // Screen pixels per world unit drives the adaptive pixel grid + snapping.
  const pxPerUnit = worldPerPx > 0 ? 1 / worldPerPx : 1;
  const gridSpec = useMemo(
    () => computeGridSpec(pxPerUnit, { divisions: gridDivisions }),
    [pxPerUnit, gridDivisions],
  );
  // Snap anchors to the visible sub-grid, but never coarser than 1px (clean ints
  // for the 24×24 case) and never finer than the grid you can actually see.
  const editSnap = Math.min(gridSpec.minor, 1);

  /**
   * Bounds from a path `d` string via real parse (not naive number pairing — that
   * mis-reads arcs/flags and produced wrong, jumpy selection boxes).
   */
  const boundsFromPathD = (d: string) => {
    if (!d?.trim()) return null;
    try {
      return getPathDataBounds(parsePath(d));
    } catch {
      return null;
    }
  };

  const [isWorldPanning, setIsWorldPanning] = useState(false);
  const [lastWorldPan, setLastWorldPan] = useState({ x: 0, y: 0 });
  const [renamingFrameId, setRenamingFrameId] = useState<string | null>(null);
  const [smartGuides, setSmartGuides] = useState<GuideLine[]>([]);
  const altCloneDoneRef = useRef(false);
  /** World-canvas rotation session (degrees). */
  const layerRotateRef = useRef<{
    center: { x: number; y: number };
    startAngle: number;
    baseRotations: Array<{ id: string | number; rotation: number }>;
    moved: boolean;
  } | null>(null);
  /** Figma selection scope — driven by the store (frame | layer | none). */
  const selectTarget = selectionKind === "none" ? "frame" : selectionKind;
  const [marquee, setMarquee] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
    /** frames on empty canvas; layers when starting inside an artboard */
    scope: "frames" | "layers";
    frameId?: string;
  } | null>(null);
  const marqueeBaseRef = useRef<string[]>([]);
  /**
   * Layer AABB resize session. Geometry is frozen at pointer-down and re-projected
   * every move (Figma / PathCanvas pattern). Scaling the *already-mutated* path from
   * the original bounds each frame compounds and feels wildly buggy.
   */
  const layerResizeRef = useRef<{
    handle: "nw" | "ne" | "sw" | "se" | "e" | "w" | "n" | "s";
    /** Control AABB (primary path-local) at drag start. */
    origin: { x: number; y: number; w: number; h: number };
    translate: { x: number; y: number };
    grabOffset: { x: number; y: number };
    /** Frozen source geometry per selected layer (never re-scale live paths). */
    items: Array<{
      id: string | number;
      origFrom: PathData;
      origTo: PathData | null;
      /** Path-local AABB freeze */
      origin: { x: number; y: number; w: number; h: number };
      /** Frame-local AABB (path + translate) at grab */
      frameOrigin?: { x: number; y: number; w: number; h: number };
      baseTranslate?: { x: number; y: number };
    }>;
    moved: boolean;
  } | null>(null);
  const worldSvgRef = useRef<SVGSVGElement>(null);
  const worldLassoRef = useRef<Array<{ x: number; y: number }>>([]);
  const worldLassoRafRef = useRef<number | null>(null);
  // Zero-friction polish (19u): ref to cancel prior in-flight world camera lerp on rapid dblclicks
  // or repeated focus gestures. Prevents concurrent RAFs from fighting and causing camera jank
  // during world<->detail transitions on complex multi-frame docs. Exact pattern match to
  // lassoRafRef / paintPreviewRafRef in PathCanvas + worldLassoRafRef here.
  const worldCameraRafRef = useRef<number | null>(null);
  const [, setWorldLassoFrame] = useState(0);
  const [worldSelectedIds, setWorldSelectedIds] = useState<string[]>(() =>
    selectedFrameId ? [selectedFrameId] : [],
  );

  /**
   * Frame has solid blue selection chrome only when the *frame* is the selection
   * (Figma: selecting a child layer does NOT light up the parent frame title as selected).
   */
  const isFrameChromeSelected = useCallback(
    (frameId: string) => {
      if (!hasCanvasSelection || selectTarget !== "frame") return false;
      if (worldSelectedIds.includes(frameId)) return true;
      return worldSelectedIds.length === 0 && frameId === selectedFrameId;
    },
    [hasCanvasSelection, selectTarget, worldSelectedIds, selectedFrameId],
  );

  /** Frame contains the active layer selection — soft “parent” outline only, not primary chrome. */
  const isFrameContainingSelection = useCallback(
    (frameId: string) =>
      hasCanvasSelection &&
      selectTarget === "layer" &&
      frameId === selectedFrameId,
    [hasCanvasSelection, selectTarget, selectedFrameId],
  );

  // Keep multi-select ids aligned when the store selects a frame from outside the canvas
  // (timeline, panels) while something is selected.
  useEffect(() => {
    if (!hasCanvasSelection || !selectedFrameId) return;
    setWorldSelectedIds((prev) => {
      if (prev.length === 0) return [selectedFrameId];
      if (prev.includes(selectedFrameId)) return prev;
      // External selectFrame replaces multi-select with the new active frame.
      return [selectedFrameId];
    });
  }, [selectedFrameId, hasCanvasSelection]);
  // Hover feedback (Figma-style): frame / layer under the cursor when idle in select/direct.
  const [hoveredFrameId, setHoveredFrameId] = useState<string | null>(null);
  const [hoveredLayerKey, setHoveredLayerKey] = useState<string | null>(null);
  // Paint tool hover state for live preview + cursor icon
  const [paintHoverValid, setPaintHoverValid] = useState(false);

  // Custom paint bucket cursor (static, offset for tip of handle)


  // Pen tool state. The active sub-path is the one currently being drawn; the
  // "outgoing" handle of the last committed anchor curves the next segment; the
  // drag session upgrades the just-placed anchor into a smooth bézier on drag.
  const penActiveSubpathRef = useRef<number | null>(null);
  const penOutgoingRef = useRef<{ x: number; y: number } | null>(null);
  const penDragRef = useRef<null | {
    subIdx: number;
    cmdIdx: number;
    anchorLocal: { x: number; y: number };
    isMove: boolean;
    c1: { x: number; y: number };
    pendingOutgoing: { x: number; y: number } | null;
  }>(null);
  const [penPreview, setPenPreview] = useState<{ x: number; y: number } | null>(null);

  // Finishing the current pen path (Esc/Enter, tool switch, frame switch, double-click last point).
  const finishPen = useCallback(() => {
    penActiveSubpathRef.current = null;
    penOutgoingRef.current = null;
    penDragRef.current = null;
    setPenPreview(null);
  }, []);

  useEffect(() => {
    finishPen();
  }, [toolMode, selectedFrameId, editingSide, finishPen]);

  // Clear paint preview state when leaving paint tool
  useEffect(() => {
    if (toolMode !== "paint") {
      setPaintHoverValid(false);
    }
  }, [toolMode]);

  // Artboard dragging state.
  const [isDraggingArtboards, setIsDraggingArtboards] = useState(false);
  const [draggingArtboardIds, setDraggingArtboardIds] = useState<string[]>([]);
  const [artboardDragStart, setArtboardDragStart] = useState<{ x: number; y: number } | null>(null);
  const artboardDragMovedRef = useRef(false);
  // Total delta already committed this drag — lets us snap the *absolute* offset
  // each frame instead of accumulating sub-pixel deltas into 0.0123px drift.
  const artboardAppliedRef = useRef({ x: 0, y: 0 });
  // World artboard dragging.
  // Called from pointer down when artboards are hit in select mode.
  const startWorldArtboardDrag = (clientX: number, clientY: number, ids: string[]) => {
    if (!ids.length) return;
    const p = worldPointFromEvent(clientX, clientY);
    if (!p) return;

    setIsDraggingArtboards(true);
    setDraggingArtboardIds(ids);
    setArtboardDragStart(p);
    artboardAppliedRef.current = { x: 0, y: 0 };
    artboardDragMovedRef.current = false;
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

  // Keep the world viewport matched to the rendered svg's aspect ratio so the
  // canvas fills the whole panel (not a centered square) with exact hit-testing.
  useEffect(() => {
    const el = worldSvgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) setWorldSize({ w: r.width, h: r.height });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [isActionMode]);

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
  /** Per-frame path layers for world render (all visible path/clip layers, not just first). */
  type WorldLayerDraw = {
    id: string | number;
    d: string;
    fill: string | null;
    stroke: string | null;
    fillOpacity: number;
    strokeOpacity: number;
    fillGradient: any;
    fillType?: string;
    translateX: number;
    translateY: number;
    rotation?: number;
  };

  /** Numeric property at playhead — prefers timeline block, else layer field. */
  const numberPropAt = useCallback(
    (
      frame: (typeof frames)[number],
      layer: { id: string | number; [k: string]: any },
      propertyName: string,
      morph: boolean,
    ): number => {
      const base = Number(layer[propertyName]) || 0;
      const block = frame.animation?.blocks?.find(
        (b: any) =>
          b.propertyName === propertyName && String(b.layerId) === String(layer.id),
      );
      if (!block || !morph) return base;
      const dur = Math.max(1, frame.animation?.duration || 1000);
      const curMs = progress * dur;
      let t = progress;
      if (curMs <= block.startTime) t = 0;
      else if (curMs >= block.endTime) t = 1;
      else
        t =
          evaluateBlock(progress, dur, block) ??
          (curMs - block.startTime) / Math.max(1, block.endTime - block.startTime);
      const a = Number(block.fromValue) || 0;
      const b = Number(block.toValue) || 0;
      return a + (b - a) * Math.max(0, Math.min(1, t));
    },
    [progress],
  );

  const frameLayerDraws = useCallback(
    (frame: (typeof frames)[number], morph: boolean): WorldLayerDraw[] => {
      // Active frame uses live store layers so multi-edit + playhead stay in sync.
      const sourceLayers =
        frame.id === selectedFrameId ? layers : (frame.layers ?? []);
      const layerList = sourceLayers.filter(
        (l: any) =>
          l &&
          l.visible !== false &&
          (l.type === "path" || l.type === "clipPath" || l.from || l.pathData),
      );
      const blocks =
        frame.id === selectedFrameId
          ? animation.blocks
          : (frame.animation?.blocks ?? []);
      const dur = Math.max(
        1,
        frame.id === selectedFrameId
          ? animation.duration
          : frame.animation?.duration || 1000,
      );
      const curMs = progress * dur;
      const useTime = morph || progress > 0.001 || isPlaying;
      return layerList.map((layer: any) => {
        const d = useTime
          ? pathDAtTime(layer, blocks, curMs, dur, progress)
          : pathToString(layer.from || layer.pathData);
        const tx = useTime
          ? numberAtTime(layer, blocks, "translateX", curMs, dur)
          : Number(layer.translateX) || 0;
        const ty = useTime
          ? numberAtTime(layer, blocks, "translateY", curMs, dur)
          : Number(layer.translateY) || 0;
        const fillColor = useTime
          ? colorAtTime(
              layer,
              blocks,
              "fillColor",
              curMs,
              dur,
              layer.fillColor || "",
            )
          : layer.fillColor;
        const fillAlpha = useTime
          ? numberAtTime(layer, blocks, "fillAlpha", curMs, dur)
          : (layer.fillAlpha ?? 1);
        const strokeAlpha = useTime
          ? numberAtTime(layer, blocks, "strokeAlpha", curMs, dur)
          : (layer.strokeAlpha ?? 1);
        const rot = useTime
          ? numberAtTime(layer, blocks, "rotation", curMs, dur)
          : Number(layer.rotation) || 0;
        return {
          id: layer.id,
          d,
          fill:
            fillColor && fillColor !== "none" && fillColor !== "" ? fillColor : null,
          stroke:
            layer.strokeColor && layer.strokeColor !== "" ? layer.strokeColor : null,
          fillOpacity: fillAlpha,
          strokeOpacity: strokeAlpha,
          fillGradient: layer.fillGradient,
          fillType: layer.fillType,
          translateX: tx,
          translateY: ty,
          rotation: rot,
        };
      });
    },
    [progress, layers, selectedFrameId, animation, isPlaying],
  );

  const handleWorldWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      // Figma model: plain scroll pans, ⌘/Ctrl+scroll (and trackpad pinch, which
      // the browser reports as ctrlKey) zooms toward the pointer.
      if (e.ctrlKey || e.metaKey) {
        const m = worldPointFromEvent(e.clientX, e.clientY);
        if (!m) return;
        // Gentle, clamped so a single mouse notch is ~0.86× (not a violent jump)
        // while trackpad pinch (small deltas, many events) stays smooth.
        const d = Math.max(-100, Math.min(100, e.deltaY));
        const zf = Math.exp(-d * 0.0015);
        setWorldView(zoomAtWorldPoint(worldView, m, worldView.scale * zf, 0.05, 20));
        return;
      }
      // Pan: vertical wheel scrolls Y, horizontal wheel (or Shift) scrolls X.
      const dxPx = e.shiftKey ? e.deltaY : e.deltaX;
      const dyPx = e.shiftKey ? 0 : e.deltaY;
      setWorldView((prev) => ({
        ...prev,
        x: prev.x + dxPx * worldPerPx,
        y: prev.y + dyPx * worldPerPx,
      }));
    },
    [setWorldView, worldPointFromEvent, worldView, worldPerPx],
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

  /** Distance from point to segment AB (local frame space). */
  const distToSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const abx = bx - ax;
    const aby = by - ay;
    const len2 = abx * abx + aby * aby;
    if (len2 < 1e-12) return Math.hypot(px - ax, py - ay);
    let t = ((px - ax) * abx + (py - ay) * aby) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
  };

  /**
   * Figma-style hit: topmost path/clip layer under the cursor (any frame).
   * Local frame coordinates; fill hit or stroke proximity.
   */
  const hitLayerAtWorld = useCallback(
    (pt: { x: number; y: number } | null): { frameId: string; layerId: string | number } | null => {
      if (!pt) return null;
      const strokeTol = Math.max(worldPerPx * 10, 2);
      for (const f of [...frames].reverse()) {
        const b = getFrameBounds(f);
        if (pt.x < b.x || pt.x > b.x + b.w || pt.y < b.y || pt.y > b.y + b.h) continue;
        const local = { x: pt.x - b.x, y: pt.y - b.y };
        const candidates = [...(f.layers ?? [])]
          .filter(
            (l: any) =>
              l &&
              l.visible !== false &&
              l.locked !== true &&
              (l.type === "path" || l.type === "clipPath" || l.from || l.pathData),
          )
          .reverse();
        for (const layer of candidates) {
          const path: PathData = layer.pathData ?? layer.from;
          if (!path?.subPaths?.length) continue;
          // Hit in path-local space (inverse of layer translate)
          const tx = Number(layer.translateX) || 0;
          const ty = Number(layer.translateY) || 0;
          const localPath = { x: local.x - tx, y: local.y - ty };
          const hasFill = Boolean(
            layer.fillColor && layer.fillColor !== "none" && layer.fillColor !== "",
          );
          if (hasFill && isPointInFillRegion(localPath, path)) {
            return { frameId: f.id, layerId: layer.id };
          }
          // Stroke / open paths: near anchors or polyline segments of each command
          let nearStroke = false;
          for (const sp of path.subPaths) {
            let prev: { x: number; y: number } | null = null;
            for (const cmd of sp.commands) {
              const pts = cmd.points ?? [];
              if (pts.length === 0) continue;
              const end = pts[pts.length - 1];
              for (const p of pts) {
                if (Math.hypot(localPath.x - p.x, localPath.y - p.y) <= strokeTol) {
                  nearStroke = true;
                  break;
                }
              }
              if (nearStroke) break;
              if (
                prev &&
                distToSeg(localPath.x, localPath.y, prev.x, prev.y, end.x, end.y) <= strokeTol
              ) {
                nearStroke = true;
                break;
              }
              // Cubic: also check control-point polyline approximation
              if (pts.length >= 3 && prev) {
                for (let i = 0; i < pts.length - 1; i++) {
                  if (
                    distToSeg(local.x, local.y, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <=
                    strokeTol
                  ) {
                    nearStroke = true;
                    break;
                  }
                }
              }
              if (nearStroke) break;
              prev = end;
            }
            if (nearStroke) break;
          }
          if (nearStroke) return { frameId: f.id, layerId: layer.id };
          if (!hasFill && isPointInFillRegion(local, path)) {
            return { frameId: f.id, layerId: layer.id };
          }
        }
      }
      return null;
    },
    [frames, getFrameBounds, worldPerPx],
  );

  // Layer object drag (Figma: grab selected shape and move it inside the frame)
  const layerDragRef = useRef<{
    start: { x: number; y: number };
    applied: { x: number; y: number };
    moved: boolean;
  } | null>(null);

  // Hit-test the selected layer's anchor points in world space (path + Position).
  const hitAnchor = useCallback(
    (pt: { x: number; y: number }): Selection | null => {
      if (!editPath || !editOrigin) return null;
      // Slightly generous hit target — Figma points are easy to grab.
      const tol = Math.max(anchorR * 2.8, worldPerPx * 10);
      for (let s = 0; s < editPath.subPaths.length; s++) {
        const cmds = editPath.subPaths[s].commands;
        for (let c = 0; c < cmds.length; c++) {
          const pts = cmds[c].points;
          for (let pi = 0; pi < pts.length; pi++) {
            const wx = editOrigin.x + editLayerTx + pts[pi].x;
            const wy = editOrigin.y + editLayerTy + pts[pi].y;
            if (Math.hypot(pt.x - wx, pt.y - wy) <= tol) {
              return {
                layerId: selectedLayerId,
                side: editingSide,
                subPathIndex: s,
                commandIndex: c,
                pointIndex: pi,
              };
            }
          }
        }
      }
      return null;
    },
    [
      editPath,
      editOrigin,
      anchorR,
      worldPerPx,
      selectedLayerId,
      editingSide,
      editLayerTx,
      editLayerTy,
    ],
  );

  // Commit an edited path back to the selected layer (mirrors inline anchor drag).
  const commitEditPath = useCallback(
    (next: PathData, recordHistory = true) => {
      updateSelectedLayer(
        editingSide === "from" ? { from: next, pathData: next } : { to: next },
        { recordHistory },
      );
    },
    [editingSide, updateSelectedLayer],
  );

  // Pen — pointer down: place an anchor. Click near the active sub-path's first
  // anchor to close; otherwise append a segment (curved if the previous anchor
  // pulled an outgoing handle), and open a drag session so a drag pulls handles.
  const penPointerDown = useCallback(
    (local: { x: number; y: number }) => {
      if (!editPath) return;
      const path: PathData = structuredClone(editPath);
      const active = penActiveSubpathRef.current;
      const closeTol = Math.max(editSnap * 1.5, worldPerPx * 6);

      if (active != null && path.subPaths[active]) {
        const sub = path.subPaths[active];
        const first = sub.commands[0]?.points[0];
        // Close the loop.
        if (
          sub.commands.length > 1 &&
          first &&
          Math.hypot(local.x - first.x, local.y - first.y) <= closeTol
        ) {
          useEditorStore.getState().pushHistory?.();
          sub.commands.push({ id: generateId(), type: "Z", points: [] } as Command);
          penActiveSubpathRef.current = null;
          penOutgoingRef.current = null;
          penDragRef.current = null;
          setPenPreview(null);
          commitEditPath(path, false);
          return;
        }
        // Click the last point again to finish the open path (common pen UX).
        const lastCmd = sub.commands[sub.commands.length - 1];
        const lastAnchor = lastCmd?.points[lastCmd.points.length - 1];
        if (
          lastAnchor &&
          Math.hypot(local.x - lastAnchor.x, local.y - lastAnchor.y) <= closeTol
        ) {
          finishPen();
          return;
        }
        // Append a new segment to the active sub-path.
        const prevCmd = sub.commands[sub.commands.length - 1];
        const prevAnchor = prevCmd?.points[prevCmd.points.length - 1] ?? local;
        const out = penOutgoingRef.current;
        let cmd: Command;
        let c1: { x: number; y: number };
        if (out) {
          c1 = { ...out };
          cmd = { id: generateId(), type: "C", points: [c1, { ...local }, { ...local }] };
        } else {
          c1 = { ...prevAnchor };
          cmd = { id: generateId(), type: "L", points: [{ ...local }] };
        }
        useEditorStore.getState().pushHistory?.();
        sub.commands.push(cmd);
        penDragRef.current = {
          subIdx: active,
          cmdIdx: sub.commands.length - 1,
          anchorLocal: { ...local },
          isMove: false,
          c1,
          pendingOutgoing: null,
        };
        penOutgoingRef.current = null;
        commitEditPath(path, false);
        return;
      }

      // Start a brand-new sub-path.
      useEditorStore.getState().pushHistory?.();
      path.subPaths.push({
        commands: [{ id: generateId(), type: "M", points: [{ ...local }] } as Command],
      });
      const subIdx = path.subPaths.length - 1;
      penActiveSubpathRef.current = subIdx;
      penDragRef.current = {
        subIdx,
        cmdIdx: 0,
        anchorLocal: { ...local },
        isMove: true,
        c1: { ...local },
        pendingOutgoing: null,
      };
      penOutgoingRef.current = null;
      commitEditPath(path, false);
    },
    [editPath, editSnap, worldPerPx, commitEditPath, finishPen],
  );

  // Pen — pointer drag: pull a symmetric bézier handle out of the just-placed
  // anchor (incoming handle curves the segment that ended here; outgoing handle
  // is remembered for the next segment).
  const penPointerDrag = useCallback(
    (localRaw: { x: number; y: number }) => {
      const sess = penDragRef.current;
      if (!sess || !editPath) return;
      const path: PathData = structuredClone(editPath);
      const sub = path.subPaths[sess.subIdx];
      const cmd = sub?.commands[sess.cmdIdx];
      if (!cmd) return;
      const anchor = sess.anchorLocal;
      const drag = { x: localRaw.x - anchor.x, y: localRaw.y - anchor.y };
      sess.pendingOutgoing = { x: anchor.x + drag.x, y: anchor.y + drag.y };
      if (!sess.isMove) {
        const incoming = { x: anchor.x - drag.x, y: anchor.y - drag.y };
        cmd.type = "C";
        cmd.points = [{ ...sess.c1 }, incoming, { ...anchor }];
      }
      commitEditPath(path, false);
    },
    [editPath, commitEditPath],
  );

  // Resize the selected artboard from its right / bottom / corner (top-left stays
  // put so content stays anchored). Snaps to whole pixels like everything else.
  const startFrameResize = useCallback(
    (e: React.PointerEvent, handle: "se" | "e" | "s") => {
      if (!editFrame) return;
      e.stopPropagation();
      e.preventDefault();
      const b = getFrameBounds(editFrame);
      useEditorStore.getState().pushHistory?.();
      const move = (ev: PointerEvent) => {
        const p = worldPointFromEvent(ev.clientX, ev.clientY);
        if (!p) return;
        let newW = handle === "s" ? b.w : p.x - b.x;
        let newH = handle === "e" ? b.h : p.y - b.y;
        const snap = snapToGrid && !(ev.metaKey || ev.ctrlKey);
        newW = Math.max(1, snap ? Math.round(newW) : Number(newW.toFixed(2)));
        newH = Math.max(1, snap ? Math.round(newH) : Number(newH.toFixed(2)));
        useEditorStore.getState().updateVector({ width: newW, height: newH });
      };
      const up = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    },
    [editFrame, getFrameBounds, worldPointFromEvent, snapToGrid],
  );

  // Pen — pointer up: persist the outgoing handle for the next segment.
  const penPointerUp = useCallback(() => {
    const sess = penDragRef.current;
    if (!sess) return;
    penOutgoingRef.current = sess.pendingOutgoing;
    penDragRef.current = null;
  }, []);

  // Paint bucket: fill the focused frame's vector if the click lands in its fill region.
  const applyWorldPaint = useCallback(
    (local: { x: number; y: number }) => {
      if (!editLayer || !editPath) return;
      if (isPointInFillRegion(local, editPath)) {
        const layer = editLayer as { fillColor?: string; fillAlpha?: number; fillType?: string };
        const color = currentFillColor;
        updateSelectedLayer({
          fillColor: color,
          fillAlpha: layer.fillAlpha ?? 1,
          fillType: (layer.fillType as "nonZero" | "evenOdd") || "nonZero",
        });
      }
    },
    [editLayer, editPath, updateSelectedLayer, currentFillColor],
  );

  // World pointer handlers (exact PathCanvas parity for gestures + artboard ops)
  const handleWorldPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const p = worldPointFromEvent(e.clientX, e.clientY);
      // Middle, Alt, or Space/H pan (Figma hand)
      if (e.button === 1 || e.altKey || spacePanActive) {
        if (spacePanActive) {
          (window as unknown as { __ssSpacePanUsed?: boolean }).__ssSpacePanUsed = true;
        }
        setIsWorldPanning(true);
        setLastWorldPan({ x: e.clientX, y: e.clientY });
        worldSvgRef.current?.setPointerCapture(e.pointerId);
        return;
      }
      if (!p) return;
      altCloneDoneRef.current = false;

      // Pen / Paint operate in the focused frame's local space.
      const rawLocal = { x: p.x - (editOrigin?.x ?? 0), y: p.y - (editOrigin?.y ?? 0) };
      const snappedLocal =
        snapToGrid && !(e.metaKey || e.ctrlKey)
          ? { x: snapValueToStep(rawLocal.x, editSnap), y: snapValueToStep(rawLocal.y, editSnap) }
          : rawLocal;
      if (toolMode === "pen") {
        if (!editPath || !editOrigin) return; // silent: need a focused frame
        penPointerDown(snappedLocal);
        worldSvgRef.current?.setPointerCapture(e.pointerId);
        return;
      }
      if (toolMode === "paint") {
        if (!editOrigin) {
          const fid = hitArtboard(p);
          if (fid) selectFrame(fid);
          return;
        }
        applyWorldPaint(rawLocal);
        return;
      }
      // Knife: click nearest point on selected path → insert cut (split) there
      if (toolMode === "knife") {
        if (!editOrigin) {
          const fid = hitArtboard(p);
          if (fid) selectFrame(fid);
          return;
        }
        const layer = layers.find((l) => String(l.id) === String(selectedLayerId));
        if (!layer || layer.locked) return;
        const lx = rawLocal.x - (Number(layer.translateX) || 0);
        const ly = rawLocal.y - (Number(layer.translateY) || 0);
        useEditorStore.getState().addPointOnPath(lx, ly);
        return;
      }

      // ── Vector tool: point edit on anchors; empty drag = marquee (Figma) ──
      if (isPointTool && editPath && editOrigin) {
        const anchor = hitAnchor(p);
        if (anchor) {
          selectPoint(anchor);
          pointDragRef.current = anchor;
          pointDragMovedRef.current = false;
          layerDragRef.current = null;
          worldSvgRef.current?.setPointerCapture(e.pointerId);
          return;
        }
        const layerHit = hitLayerAtWorld(p);
        if (layerHit) {
          // Click a shape → that layer's vector network
          if (layerHit.frameId !== selectedFrameId) selectFrame(layerHit.frameId);
          selectLayer(layerHit.layerId);
          setWorldSelectedIds([layerHit.frameId]);
          useEditorStore.getState().clearSelection?.();
          worldSvgRef.current?.setPointerCapture(e.pointerId);
          return;
        }
        // Empty space in vector mode: start marquee (same as Move) — do NOT block drag-select
        useEditorStore.getState().clearSelection?.();
      }

      const isLassoTool = toolMode === "pencil";
      if (isLassoTool) {
        worldLassoRef.current = [p];
        if (worldLassoRafRef.current) cancelAnimationFrame(worldLassoRafRef.current);
        worldLassoRafRef.current = null;
        worldSvgRef.current?.setPointerCapture(e.pointerId);
        return;
      }

      // ── Marquee / object select (Move tool, or empty drag from Vector) ──
      const additive = e.shiftKey;
      layerDragRef.current = null;
      layerResizeRef.current = null;
      pointDragRef.current = null;

      // Only drag-move a single object in Move tool when hitting a shape (not marquee)
      if (isObjectTool) {
        const layerHit = hitLayerAtWorld(p);
        if (layerHit) {
          if (layerHit.frameId !== selectedFrameId) selectFrame(layerHit.frameId);
          if (additive && selectionKind === "layer") {
            // Shift+click toggle layer into multi-select
            const cur = selectedLayerIds.map(String);
            const id = String(layerHit.layerId);
            const next = cur.includes(id)
              ? selectedLayerIds.filter((x) => String(x) !== id)
              : [...selectedLayerIds, layerHit.layerId];
            selectLayers(next);
          } else {
            selectLayer(layerHit.layerId);
            layerDragRef.current = { start: p, applied: { x: 0, y: 0 }, moved: false };
          }
          setWorldSelectedIds([layerHit.frameId]);
          worldSvgRef.current?.setPointerCapture(e.pointerId);
          return;
        }
      }

      const hitId = hitArtboard(p);
      if (hitId) {
        // Empty space *inside* a frame → marquee layers inside it (Figma)
        if (additive && selectionKind === "frame") {
          if (worldSelectedIds.includes(hitId) && hasCanvasSelection) {
            const next = worldSelectedIds.filter((id) => id !== hitId);
            setWorldSelectedIds(next);
            if (next.length === 0) deselectAll();
            else if (!next.includes(selectedFrameId)) selectFrame(next[next.length - 1]!);
            worldSvgRef.current?.setPointerCapture(e.pointerId);
            return;
          }
          setWorldSelectedIds([...new Set([...worldSelectedIds, hitId])]);
          selectFrame(hitId);
          worldSvgRef.current?.setPointerCapture(e.pointerId);
          return;
        }
        // Start layer marquee (selection updates live while dragging)
        if (!additive) {
          setWorldSelectedIds([hitId]);
        }
        marqueeBaseRef.current = [];
        setMarquee({ start: p, current: p, scope: "layers", frameId: hitId });
      } else {
        // Empty world → marquee frames
        marqueeBaseRef.current = additive ? worldSelectedIds : [];
        if (!additive) {
          setWorldSelectedIds([]);
          deselectAll();
        }
        setMarquee({ start: p, current: p, scope: "frames" });
      }
      worldSvgRef.current?.setPointerCapture(e.pointerId);
    },
    [
      worldPointFromEvent,
      hitArtboard,
      hitLayerAtWorld,
      toolMode,
      isObjectTool,
      isPointTool,
      selectFrame,
      selectLayer,
      selectLayers,
      selectedFrameId,
      selectedLayerIds,
      worldSelectedIds,
      hasCanvasSelection,
      selectionKind,
      deselectAll,
      editPath,
      hitAnchor,
      selectPoint,
      snapToGrid,
      editSnap,
      penPointerDown,
      applyWorldPaint,
      editOrigin,
      spacePanActive,
      getFrameBounds,
      worldPerPx,
    ],
  );

  const handleWorldPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Idle (no button) — hover feedback for select/direct, rubber-band preview for pen.
      if (e.buttons === 0) {
        if (toolMode === "select" || toolMode === "direct") {
          const hp = worldPointFromEvent(e.clientX, e.clientY);
          const layerHit = hp ? hitLayerAtWorld(hp) : null;
          const id = layerHit?.frameId ?? (hp ? hitArtboard(hp) : null);
          setHoveredFrameId((prev) => (prev === id ? prev : id));
          const lk = layerHit ? `${layerHit.frameId}:${layerHit.layerId}` : null;
          setHoveredLayerKey((prev) => (prev === lk ? prev : lk));
        } else if (toolMode === "pen" && penActiveSubpathRef.current != null && editOrigin) {
          const hp = worldPointFromEvent(e.clientX, e.clientY);
          if (hp) {
            const free = e.metaKey || e.ctrlKey || !snapToGrid;
            const lx = hp.x - editOrigin.x;
            const ly = hp.y - editOrigin.y;
            setPenPreview({
              x: free ? lx : snapValueToStep(lx, editSnap),
              y: free ? ly : snapValueToStep(ly, editSnap),
            });
          }
        } else if (hoveredFrameId || hoveredLayerKey) {
          setHoveredFrameId(null);
          setHoveredLayerKey(null);
        }
        return;
      }

      // Pen handle drag (pull a bézier handle from the just-placed anchor).
      if (penDragRef.current && editOrigin) {
        const hp = worldPointFromEvent(e.clientX, e.clientY);
        if (hp) penPointerDrag({ x: hp.x - editOrigin.x, y: hp.y - editOrigin.y });
        return;
      }

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

      if (toolMode === "paint" && editOrigin && editPath) {
        const rawLocal = { x: p.x - editOrigin.x, y: p.y - editOrigin.y };
        const valid = isPointInFillRegion(rawLocal, editPath);
        setPaintHoverValid(valid);
      } else if (toolMode === "paint") {
        // No focused frame: allow preview on any artboard
        const fid = hitArtboard(p);
        setPaintHoverValid(!!fid);
      } else if (paintHoverValid) {
        setPaintHoverValid(false);
      }

      // Inline anchor drag (path-local coords = world − frame origin − layer Position)
      if (pointDragRef.current && editPath && editOrigin) {
        const sel = pointDragRef.current;
        const rawLocal = {
          x: p.x - editOrigin.x - editLayerTx,
          y: p.y - editOrigin.y - editLayerTy,
        };
        // Snap to the visible grid so anchors land on clean pixels (⌘/Ctrl frees it).
        const local =
          snapToGrid && !(e.metaKey || e.ctrlKey)
            ? { x: snapValueToStep(rawLocal.x, editSnap), y: snapValueToStep(rawLocal.y, editSnap) }
            : rawLocal;
        const updated = updateCommandPoint(
          editPath,
          sel.subPathIndex,
          sel.commandIndex,
          sel.pointIndex,
          local,
        );
        // Snapshot the pre-edit state once, on the first actual move, so undo
        // reverts the whole drag (and a click-without-move adds no undo step).
        if (!pointDragMovedRef.current) {
          useEditorStore.getState().pushHistory?.();
          pointDragMovedRef.current = true;
        }
        updateSelectedLayer(
          editingSide === "from" ? { from: updated, pathData: updated } : { to: updated },
          { recordHistory: false },
        );
        return;
      }

      const syncActiveFrameLayers = () => {
        useEditorStore.setState((state) => ({
          frames: state.frames.map((fr) =>
            fr.id === state.selectedFrameId
              ? { ...fr, layers: structuredClone(state.layers) }
              : fr,
          ),
        }));
      };

      // Layer object drag (multi-select + smart guides + Alt-clone)
      if (layerDragRef.current) {
        const drag = layerDragRef.current;
        let totalDx = p.x - drag.start.x;
        let totalDy = p.y - drag.start.y;
        if (e.shiftKey) {
          if (Math.abs(totalDx) > Math.abs(totalDy)) totalDy = 0;
          else totalDx = 0;
        }
        // Alt-drag: duplicate once at drag start (Figma clone)
        if (e.altKey && !altCloneDoneRef.current && (Math.abs(totalDx) > 2 || Math.abs(totalDy) > 2)) {
          useEditorStore.getState().duplicateSelectedLayersOffset(0, 0);
          altCloneDoneRef.current = true;
        }
        if (snapToGrid && !(e.metaKey || e.ctrlKey)) {
          totalDx = snapValueToStep(totalDx, editSnap);
          totalDy = snapValueToStep(totalDy, editSnap);
        }
        // Smart guides: snap multi-select AABB to siblings + frame
        if (!(e.metaKey || e.ctrlKey) && editOrigin && editFrame) {
          const st = useEditorStore.getState();
          const ids = st.selectedLayerIds;
          let minX = Infinity,
            minY = Infinity,
            maxX = -Infinity,
            maxY = -Infinity;
          for (const id of ids) {
            const layer = st.layers.find((l) => String(l.id) === String(id));
            if (!layer?.from) continue;
            const bb = getPathDataBounds(layer.from as PathData);
            if (!bb) continue;
            const tx = (layer.translateX ?? 0) + totalDx;
            const ty = (layer.translateY ?? 0) + totalDy;
            minX = Math.min(minX, editOrigin.x + bb.x + tx);
            minY = Math.min(minY, editOrigin.y + bb.y + ty);
            maxX = Math.max(maxX, editOrigin.x + bb.x + bb.w + tx);
            maxY = Math.max(maxY, editOrigin.y + bb.y + bb.h + ty);
          }
          if (Number.isFinite(minX)) {
            const moving = {
              x: minX,
              y: minY,
              w: maxX - minX,
              h: maxY - minY,
            };
            const targets: Array<{ x: number; y: number; w: number; h: number }> = [];
            const fb = getFrameBounds(editFrame);
            targets.push({ x: fb.x, y: fb.y, w: fb.w, h: fb.h });
            targets.push({
              x: fb.x + fb.w / 2,
              y: fb.y,
              w: 0,
              h: fb.h,
            });
            for (const layer of st.layers) {
              if (ids.some((id) => String(id) === String(layer.id))) continue;
              if (!layer.from || layer.visible === false) continue;
              const bb = getPathDataBounds(layer.from as PathData);
              if (!bb) continue;
              targets.push({
                x: editOrigin.x + bb.x + (layer.translateX ?? 0),
                y: editOrigin.y + bb.y + (layer.translateY ?? 0),
                w: bb.w,
                h: bb.h,
              });
            }
            const thr = worldPerPx * 6;
            const snapped = snapRectToGuides(moving, targets, thr);
            totalDx += snapped.x - moving.x;
            totalDy += snapped.y - moving.y;
            setSmartGuides(snapped.guides);
          }
        } else {
          setSmartGuides([]);
        }
        const dx = totalDx - drag.applied.x;
        const dy = totalDy - drag.applied.y;
        if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) {
          if (!drag.moved) {
            useEditorStore.getState().pushHistory?.();
            drag.moved = true;
          }
          useEditorStore.getState().translateSelectedLayer(dx, dy, { recordHistory: false });
          syncActiveFrameLayers();
          drag.applied = { x: totalDx, y: totalDy };
        }
        return;
      }

      // Layer rotation (world handle above selection)
      if (layerRotateRef.current) {
        const rz = layerRotateRef.current;
        const ang = (Math.atan2(p.y - rz.center.y, p.x - rz.center.x) * 180) / Math.PI;
        let delta = ang - rz.startAngle;
        if (e.shiftKey) delta = Math.round(delta / 15) * 15;
        if (!rz.moved) {
          useEditorStore.getState().pushHistory?.();
          rz.moved = true;
        }
        const st = useEditorStore.getState();
        const map = new Map(rz.baseRotations.map((b) => [String(b.id), b.rotation]));
        useEditorStore.setState({
          layers: st.layers.map((layer) => {
            const base = map.get(String(layer.id));
            if (base == null || layer.locked) return layer;
            return { ...layer, rotation: base + delta };
          }),
        });
        syncActiveFrameLayers();
        return;
      }

      // Layer resize — control AABB is frame-local union; each item scales from freeze.
      if (layerResizeRef.current && editOrigin) {
        const rz = layerResizeRef.current;
        const o = rz.origin;
        const localX = p.x - editOrigin.x - rz.grabOffset.x;
        const localY = p.y - editOrigin.y - rz.grabOffset.y;
        const minSize = Math.max(editSnap, 0.5);
        const right0 = o.x + o.w;
        const bottom0 = o.y + o.h;
        let nx = o.x;
        let ny = o.y;
        let nw = o.w;
        let nh = o.h;
        const h = rz.handle;
        if (h.includes("e")) nw = Math.max(minSize, localX - o.x);
        if (h.includes("s")) nh = Math.max(minSize, localY - o.y);
        if (h.includes("w")) {
          nx = Math.min(localX, right0 - minSize);
          nw = right0 - nx;
        }
        if (h.includes("n")) {
          ny = Math.min(localY, bottom0 - minSize);
          nh = bottom0 - ny;
        }
        if (e.shiftKey && o.w > 1e-6 && o.h > 1e-6) {
          const aspect = o.w / o.h;
          const isCorner = h === "nw" || h === "ne" || h === "sw" || h === "se";
          if (isCorner) {
            if (nw / Math.max(nh, minSize) > aspect) nh = nw / aspect;
            else nw = nh * aspect;
            if (h.includes("w")) nx = right0 - nw;
            if (h.includes("n")) ny = bottom0 - nh;
          } else if (h === "e" || h === "w") {
            nh = nw / aspect;
            ny = o.y + (o.h - nh) / 2;
          } else if (h === "n" || h === "s") {
            nw = nh * aspect;
            nx = o.x + (o.w - nw) / 2;
          }
        }
        if (snapToGrid && !(e.metaKey || e.ctrlKey)) {
          nx = snapValueToStep(nx, editSnap);
          ny = snapValueToStep(ny, editSnap);
          nw = Math.max(minSize, snapValueToStep(nw, editSnap));
          nh = Math.max(minSize, snapValueToStep(nh, editSnap));
          if (h.includes("w")) nx = right0 - nw;
          if (h.includes("n")) ny = bottom0 - nh;
        }
        if (!rz.moved) {
          useEditorStore.getState().pushHistory?.();
          rz.moved = true;
        }
        const sx = nw / Math.max(0.001, o.w);
        const sy = nh / Math.max(0.001, o.h);
        const st = useEditorStore.getState();
        const nextLayers = st.layers.map((layer) => {
          const item = rz.items.find((it) => String(it.id) === String(layer.id)) as
            | (typeof rz.items)[number] & {
                frameOrigin?: { x: number; y: number; w: number; h: number };
                baseTranslate?: { x: number; y: number };
              }
            | undefined;
          if (!item) return layer;
          const po = item.origin; // path-local freeze
          const fo = item.frameOrigin ?? {
            x: po.x + (item.baseTranslate?.x ?? 0),
            y: po.y + (item.baseTranslate?.y ?? 0),
            w: po.w,
            h: po.h,
          };
          // New frame-local rect for this object under the scaled control AABB
          const nfx = nx + (fo.x - o.x) * sx;
          const nfy = ny + (fo.y - o.y) * sy;
          const pathFrom = { x: po.x, y: po.y, width: po.w, height: po.h };
          const pathTo = {
            x: po.x,
            y: po.y,
            width: po.w * sx,
            height: po.h * sy,
          };
          const from = scalePathToBounds(item.origFrom, pathFrom, pathTo);
          const to = item.origTo
            ? scalePathToBounds(item.origTo, pathFrom, pathTo)
            : layer.to;
          // Keep path origin; move via translate so the object sits in nfx/nfy
          return {
            ...layer,
            from,
            to,
            pathData: from,
            translateX: nfx - po.x,
            translateY: nfy - po.y,
          };
        });
        useEditorStore.setState({ layers: nextLayers });
        syncActiveFrameLayers();
        return;
      }

      // Artboard dragging — title chip only
      if (isDraggingArtboards && draggingArtboardIds.length > 0 && artboardDragStart) {
        let totalDx = p.x - artboardDragStart.x;
        let totalDy = p.y - artboardDragStart.y;

        // Shift = axis lock (classic pro constraint)
        if (e.shiftKey) {
          if (Math.abs(totalDx) > Math.abs(totalDy)) {
            totalDy = 0;
          } else {
            totalDx = 0;
          }
        }

        // Snap the absolute offset to whole pixels so frames stay grid-aligned
        // (⌘/Ctrl frees it for fine placement).
        if (snapToGrid && !(e.metaKey || e.ctrlKey)) {
          totalDx = snapValueToStep(totalDx, 1);
          totalDy = snapValueToStep(totalDy, 1);
        }

        const applied = artboardAppliedRef.current;
        const dx = totalDx - applied.x;
        const dy = totalDy - applied.y;
        if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) {
          if (!artboardDragMovedRef.current) {
            useEditorStore.getState().pushHistory();
            artboardDragMovedRef.current = true;
          }
          useEditorStore.getState().moveFrames(draggingArtboardIds, dx, dy);
          artboardAppliedRef.current = { x: totalDx, y: totalDy };
        }
        return;
      }

      // Marquee: frames on empty canvas, or *all* layers inside a frame (Figma multi-select)
      if (marquee) {
        const minX = Math.min(marquee.start.x, p.x);
        const maxX = Math.max(marquee.start.x, p.x);
        const minY = Math.min(marquee.start.y, p.y);
        const maxY = Math.max(marquee.start.y, p.y);
        // Tiny drag = click, not a selection box yet
        const dragDist = Math.hypot(p.x - marquee.start.x, p.y - marquee.start.y);
        setMarquee({ ...marquee, current: p });

        if (marquee.scope === "layers" && marquee.frameId) {
          const fr = frames.find((f) => f.id === marquee.frameId);
          if (fr) {
            const fb = getFrameBounds(fr);
            // Prefer live layers when this is the active frame
            const layerList =
              fr.id === selectedFrameId ? layers : (fr.layers ?? []);
            const hitIds: (string | number)[] = [];
            for (const layer of layerList) {
              if (
                !layer ||
                layer.visible === false ||
                (layer.type !== "path" &&
                  layer.type !== "clipPath" &&
                  !layer.from &&
                  !layer.pathData)
              )
                continue;
              const path = layer.pathData ?? layer.from;
              const d = pathToString(path);
              const bb = boundsFromPathD(d);
              if (!bb) continue;
              const tx = Number(layer.translateX) || 0;
              const ty = Number(layer.translateY) || 0;
              const wx = fb.x + bb.x + tx;
              const wy = fb.y + bb.y + ty;
              const intersects = !(
                wx + bb.w < minX ||
                wx > maxX ||
                wy + bb.h < minY ||
                wy > maxY
              );
              if (intersects) hitIds.push(layer.id);
            }
            if (dragDist < worldPerPx * 4) {
              // Still a click — wait for a real drag distance
            } else if (hitIds.length > 0) {
              if (String(selectedFrameId) !== String(marquee.frameId)) {
                selectFrame(marquee.frameId);
              }
              // Load frame doc without wiping multi-select: selectFrame clears layers;
              // re-apply multi after if we had to switch frames.
              selectLayers(hitIds);
              setWorldSelectedIds([marquee.frameId]);
            } else {
              // Marquee open but nothing hit yet — select the frame shell
              selectFrame(marquee.frameId);
              setWorldSelectedIds([marquee.frameId]);
            }
          }
        } else {
          const hits = frames
            .filter((f) => {
              const b = getFrameBounds(f);
              return !(b.x + b.w < minX || b.x > maxX || b.y + b.h < minY || b.y > maxY);
            })
            .map((f) => f.id);
          const next = Array.from(new Set([...marqueeBaseRef.current, ...hits]));
          setWorldSelectedIds(next);
          if (hits.length > 0) {
            // Multi-frame: select each (last is primary active doc)
            const primary = hits.includes(selectedFrameId) ? selectedFrameId : hits[hits.length - 1]!;
            selectFrame(primary);
            // Keep multi ids after selectFrame (which doesn't know about multi)
            setWorldSelectedIds(next);
          }
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
      editLayerTx,
      editLayerTy,
      artboardDragStart,
      marquee,
      frames,
      getFrameBounds,
      editPath,
      editOrigin,
      editingSide,
      updateSelectedLayer,
      snapToGrid,
      editSnap,
      hitArtboard,
      hitLayerAtWorld,
      hoveredFrameId,
      hoveredLayerKey,
      penPointerDrag,
      selectFrame,
      selectLayer,
      selectedFrameId,
      editSnap,
    ],
  );

  const handleWorldPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const layerDragSession = layerDragRef.current;
      const hadLayerMove = !!(layerDragSession && layerDragSession.moved);
      const dropPoint = hadLayerMove ? worldPointFromEvent(e.clientX, e.clientY) : null;
      const dropFrameId = dropPoint ? hitArtboard(dropPoint) : null;
      const hadLayerGesture = !!(
        layerDragSession ||
        layerResizeRef.current ||
        layerRotateRef.current
      );
      layerDragRef.current = null;
      layerResizeRef.current = null;
      layerRotateRef.current = null;
      setSmartGuides([]);
      altCloneDoneRef.current = false;
      if (hadLayerGesture) {
        try {
          worldSvgRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      // Figma motion: a real layer drag writes Position tracks on the timeline
      if (hadLayerMove) {
        useEditorStore.getState().recordLayerTranslationAtPlayhead();
        // Keep the active frame snapshot in sync with live layers
        useEditorStore.setState((state) => ({
          frames: state.frames.map((fr) =>
            fr.id === state.selectedFrameId
              ? {
                  ...fr,
                  layers: structuredClone(state.layers),
                  animation: structuredClone(state.animation),
                }
              : fr,
          ),
        }));
        // Figma-style cross-frame ownership: the object keeps its exact world
        // position, but its local transform and animation tracks are rebased to
        // the destination frame. The drag already owns the single undo snapshot.
        if (dropFrameId && dropFrameId !== useEditorStore.getState().selectedFrameId) {
          const moved = useEditorStore
            .getState()
            .moveSelectedLayersToFrame(dropFrameId, { recordHistory: false });
          if (moved) setWorldSelectedIds([dropFrameId]);
        }
      }
      // Pen: persist the handle pulled during this anchor's drag (history already
      // pushed on pointer-down), then keep the path open for the next anchor.
      if (penDragRef.current) {
        penPointerUp();
        if (worldSvgRef.current?.hasPointerCapture(e.pointerId)) {
          worldSvgRef.current.releasePointerCapture(e.pointerId);
        }
        return;
      }
      // End an inline anchor edit. History was already snapshotted on the first
      // move (pointDragMovedRef), so there's nothing to push here.
      if (pointDragRef.current) {
        pointDragRef.current = null;
        pointDragMovedRef.current = false;
        if (worldSvgRef.current?.hasPointerCapture(e.pointerId)) {
          worldSvgRef.current.releasePointerCapture(e.pointerId);
        }
        return;
      }
      setIsWorldPanning(false);
      const curTool = toolMode;
      if (worldSvgRef.current?.hasPointerCapture(e.pointerId)) {
        worldSvgRef.current.releasePointerCapture(e.pointerId);
      }

      // Commit / clear the marquee (selection applied live while dragging).
      if (marquee) {
        const dragDist = Math.hypot(
          (marquee.current?.x ?? marquee.start.x) - marquee.start.x,
          (marquee.current?.y ?? marquee.start.y) - marquee.start.y,
        );
        // Click (no real drag) on empty frame paper → select that frame only
        if (dragDist < worldPerPx * 4 && marquee.scope === "layers" && marquee.frameId) {
          selectFrame(marquee.frameId);
          setWorldSelectedIds([marquee.frameId]);
        }
        setMarquee(null);
      }

      // Lasso commit. When a frame is focused for inline editing, the lasso
      // free-selects that frame's anchor points (Figma-style). Otherwise it
      // selects whole frames (reuses pointInPolygon - 9rp parity).
      if (curTool === "pencil" && worldLassoRef.current.length >= 3) {
        const additive = e.shiftKey;
        if (editPath && editOrigin) {
          const localPoly = worldLassoRef.current.map((pt) => ({
            x: pt.x - editOrigin.x,
            y: pt.y - editOrigin.y,
          }));
          const hits = collectPointsInLasso(editPath, localPoly, {
            tolerance: 0.6,
            sampleCurves: true,
          });
          const store = useEditorStore.getState();
          if (hits.length > 0) {
            if (!additive) store.clearSelection?.();
            store.selectMultiplePoints(
              hits.map((h) => ({ layerId: selectedLayerId, side: editingSide, ...h })),
            );
          } else if (!additive) {
            store.clearSelection?.();
          }
        } else {
          const poly = worldLassoRef.current;
          const hitIds = frames
            .filter((f) => {
              const b = getFrameBounds(f);
              const c = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
              return pointInPolygon(c, poly);
            })
            .map((f) => f.id);
          if (hitIds.length > 0) {
            setWorldSelectedIds((prev) =>
              additive ? Array.from(new Set([...prev, ...hitIds])) : hitIds,
            );
          } else if (!additive) {
            setWorldSelectedIds([]);
          }
        }
      }
      if (worldLassoRafRef.current) {
        cancelAnimationFrame(worldLassoRafRef.current);
        worldLassoRafRef.current = null;
      }
      setWorldLassoFrame(0);
      worldLassoRef.current = [];

      // End artboard drag. (Frame x/y live outside the layers history, so there's
      // no layer snapshot to push here — pushing would only add a phantom step.)
      if (isDraggingArtboards) {
        setIsDraggingArtboards(false);
        setDraggingArtboardIds([]);
        setArtboardDragStart(null);
        artboardDragMovedRef.current = false;
      }

      if (toolMode === "paint") {
        setPaintHoverValid(false);
      }
    },
    [
      toolMode,
      frames,
      getFrameBounds,
      isDraggingArtboards,
      marquee,
      editPath,
      editOrigin,
      selectedLayerId,
      editingSide,
      penPointerUp,
      worldPointFromEvent,
      hitArtboard,
    ],
  );

  // Double-click focus (select + camera lerp to artboard rect) - seamless world to detail transition
  // Double-click an artboard to zoom into it for editing — stays on the same
  // canvas (Figma-style "enter frame"), no separate edit screen.
  const handleWorldDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      // Double-click finishes an in-progress pen path
      if (toolMode === "pen" && penActiveSubpathRef.current != null) {
        e.preventDefault();
        finishPen();
        return;
      }
      const p = worldPointFromEvent(e.clientX, e.clientY);
      if (!p) return;
      // Figma: double-click a shape → enter vector network (Direct / point edit).
      // This is NOT object resize — corners become editable anchors.
      const layerHit = hitLayerAtWorld(p);
      if (layerHit) {
        if (layerHit.frameId !== selectedFrameId) selectFrame(layerHit.frameId);
        selectLayer(layerHit.layerId);
        setWorldSelectedIds([layerHit.frameId]);
        useEditorStore.getState().clearSelection?.();
        setToolMode("direct");
        // Zoom the artboard into view so 24×24 anchors are actually grabbable
        bringFrameIntoView(layerHit.frameId, { animate: true });
        return;
      }
      const hit = hitArtboard(p);
      if (!hit) return;
      // Empty frame body: select the frame (exits vector edit via selectFrame) and frame it
      selectFrame(hit);
      setWorldSelectedIds([hit]);
      bringFrameIntoView(hit, { animate: true });
    },
    [
      worldPointFromEvent,
      hitArtboard,
      hitLayerAtWorld,
      selectFrame,
      selectLayer,
      selectedFrameId,
      bringFrameIntoView,
      toolMode,
      finishPen,
      setToolMode,
    ],
  );

  // Figma-style world zoom shortcuts (only on the freeform canvas).
  useEffect(() => {
    if (isActionMode) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA" || t?.isContentEditable) return;
      // Finish the in-progress pen path without closing it.
      if ((e.key === "Escape" || e.key === "Enter") && penActiveSubpathRef.current != null) {
        e.preventDefault();
        finishPen();
        return;
      }
      // Figma: first Esc exits vector edit → object still selected; second Esc deselects
      if (e.key === "Escape" && toolMode === "direct") {
        e.preventDefault();
        setToolMode("select");
        useEditorStore.getState().clearSelection?.();
        if (selectedLayerId != null) selectLayer(selectedLayerId);
        return;
      }
      // Figma: Esc clears the entire object selection
      if (e.key === "Escape" && toolMode === "select") {
        e.preventDefault();
        setWorldSelectedIds([]);
        deselectAll();
        return;
      }
      if (e.metaKey || e.ctrlKey) return;
      if (e.shiftKey && e.code === "Digit1") {
        e.preventDefault();
        fitWorldToFrames();
      } else if (e.shiftKey && e.code === "Digit2") {
        // Zoom *to* the selected frame (tight fit), not just pan it into view.
        if (selectedFrameId) {
          e.preventDefault();
          fitWorldToFrames([selectedFrameId]);
        }
      } else if (e.code === "Digit0") {
        e.preventDefault();
        zoomWorldAtCenter(1 / useEditorStore.getState().worldViewport.scale);
      } else if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        zoomWorldAtCenter(1.25);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        zoomWorldAtCenter(0.8);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    isActionMode,
    fitWorldToFrames,
    bringFrameIntoView,
    selectedFrameId,
    selectedLayerId,
    selectLayer,
    zoomWorldAtCenter,
    finishPen,
    toolMode,
    setToolMode,
    deselectAll,
  ]);

  return (
    <div className="relative flex min-w-0 flex-1 overflow-hidden bg-muted">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <motion.div
            className="flex h-full w-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <div className="relative flex h-full min-h-0 w-full flex-col">
              {/* Full-bleed canvas — no chrome border (Figma-style workspace) */}
              <div
                className="relative min-h-0 w-full flex-1 overflow-hidden bg-muted"
                role="img"
                aria-label="Canvas"
              >
                {/* Top-right: zoom / fit / grid — absolute, not a layout row */}
                <div className="pointer-events-none absolute right-3 top-3 z-30 flex items-center gap-0.5 rounded-lg border border-white/10 bg-[#2C2C2C]/90 p-0.5 shadow-lg backdrop-blur-md">
                  <div className="pointer-events-auto flex items-center gap-0.5">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="h-7 w-7 text-xs text-white/60 hover:bg-white/10 hover:text-white"
                      onClick={() =>
                        isActionMode
                          ? setZoom(Math.max(0.5, zoom - 0.25))
                          : zoomWorldAtCenter(0.8)
                      }
                      aria-label="Zoom out"
                    >
                      -
                    </Button>
                    <span className="min-w-[2.5rem] select-none px-0.5 text-center font-mono text-[10px] font-medium text-white/55">
                      {Math.round((isActionMode ? zoom : worldView.scale) * 100)}%
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="h-7 w-7 text-xs text-white/60 hover:bg-white/10 hover:text-white"
                      onClick={() =>
                        isActionMode
                          ? setZoom(Math.min(4, zoom + 0.25))
                          : zoomWorldAtCenter(1.25)
                      }
                      aria-label="Zoom in"
                    >
                      +
                    </Button>
                    {!isActionMode && (
                      <>
                        <div className="mx-0.5 h-4 w-px bg-white/10" />
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                className="h-7 w-auto gap-0.5 px-1.5 font-mono text-[10px] text-white/55 hover:bg-white/10 hover:text-white"
                                onClick={() => {
                                  const cycle = [4, 5, 8];
                                  const next =
                                    cycle[(cycle.indexOf(gridDivisions) + 1) % cycle.length] ?? 4;
                                  setGridDivisions(next);
                                }}
                                aria-label="Grid divisions"
                              >
                                <Grid3x3 className="size-3" />
                                {gridDivisions}
                              </Button>
                            }
                          />
                          <TooltipContent>
                            Grid: major every {gridDivisions} px · click to cycle 4/5/8
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                size="icon-xs"
                                variant="ghost"
                                className="h-7 w-auto px-1.5 text-[10px] font-medium text-white/55 hover:bg-white/10 hover:text-white"
                                onClick={() => fitWorldToFrames()}
                                aria-label="Zoom to fit"
                              />
                            }
                          >
                            Fit
                          </TooltipTrigger>
                          <TooltipContent>Zoom to fit all frames (⇧1)</TooltipContent>
                        </Tooltip>
                      </>
                    )}
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      className="h-7 w-7 text-white/55 hover:bg-white/10 hover:text-white"
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

                {isActionMode && (
                  <div className="pointer-events-auto absolute left-14 top-3 z-30 flex items-center gap-2 rounded-lg border border-white/10 bg-[#2C2C2C]/90 px-2.5 py-1 shadow-lg backdrop-blur-md">
                    <span className="text-[12px] font-medium text-white/90">
                      {isPlaying
                        ? "Preview"
                        : editingSide === "from"
                          ? "Editing Start"
                          : "Editing End"}
                    </span>
                    <Button
                      size="xs"
                      variant="outline"
                      className="h-6 border-white/15 bg-transparent px-2 text-[10px] text-white/80 hover:bg-white/10"
                      onClick={() => useEditorStore.getState().closeActionMode()}
                    >
                      Done
                    </Button>
                  </div>
                )}

                {!isActionMode && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="absolute bottom-3 left-3 z-20 h-8 gap-1.5 rounded-lg border border-border/80 bg-background/95 px-3 text-xs font-medium text-foreground shadow-md backdrop-blur-sm hover:bg-background"
                    onClick={addFrame}
                  >
                    <Plus className="size-3.5" strokeWidth={2} />
                    Add frame
                  </Button>
                )}
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
                    onPointerLeave={() => {
                      setHoveredFrameId(null);
                      if (toolMode === "paint") {
                        setPaintHoverValid(false);
                      }
                    }}
                    onDoubleClick={handleWorldDoubleClick}
                    style={{
                      background: "var(--muted)",
                      cursor: isWorldPanning || isDraggingArtboards || layerDragRef.current
                        ? "grabbing"
                        : toolMode === "paint"
                          ? paintBucketCursor
                          : toolMode === "pen" || toolMode === "pencil"
                            ? "crosshair"
                            : hoveredLayerKey
                              ? "move"
                              : "default",
                    }}
                  >
                    <defs>
                      {/* Adaptive pixel grid that lives INSIDE the artboard. The tile size tracks
                          zoom (every-pixel when close, coarser when far) and stroke widths stay
                          constant on-screen via worldPerPx. */}
                      <pattern
                        id="frame-grid-minor"
                        width={gridSpec.minor}
                        height={gridSpec.minor}
                        patternUnits="userSpaceOnUse"
                      >
                        <path
                          d={`M ${gridSpec.minor} 0 L 0 0 0 ${gridSpec.minor}`}
                          fill="none"
                          stroke="#000000"
                          strokeOpacity="0.07"
                          strokeWidth={worldPerPx * 0.6}
                        />
                      </pattern>
                      <pattern
                        id="frame-grid-major"
                        width={gridSpec.major}
                        height={gridSpec.major}
                        patternUnits="userSpaceOnUse"
                      >
                        <path
                          d={`M ${gridSpec.major} 0 L 0 0 0 ${gridSpec.major}`}
                          fill="none"
                          stroke="#000000"
                          strokeOpacity="0.14"
                          strokeWidth={worldPerPx}
                        />
                      </pattern>
                      {/* Subtle lift shadow for artboards — Figma-grade tactility */}
                      <filter id="dragShadow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="1.5" stdDeviation="1.4" floodOpacity="0.2" />
                      </filter>
                    </defs>
                    {/* Artboards: white paper, grid inside the frame, thin zoom-independent border */}
                    {culledFrames.map((frame) => {
                      const b = getFrameBounds(frame);
                      const isSel = isFrameChromeSelected(frame.id);
                      const isParentOfLayer = isFrameContainingSelection(frame.id);
                      const isBeingDragged = draggingArtboardIds.includes(frame.id);
                      const isHovered =
                        hoveredFrameId === frame.id && !isSel && !isParentOfLayer;
                      // Morph when playing/scrubbing; selected frame at t=0 can show live edit path.
                      const morph = isPlaying || progress > 0;
                      let draws = frameLayerDraws(frame, morph);
                      if (
                        !morph &&
                        frame.id === selectedFrameId &&
                        editPath &&
                        editLayer &&
                        editLayer.type !== "group"
                      ) {
                        draws = draws.map((draw) =>
                          String(draw.id) === String(editLayer.id)
                            ? { ...draw, d: pathToString(editPath) }
                            : draw,
                        );
                      }
                      // Onion-skin: faint ghost of the opposite morph side on the
                      // selected frame while editing (not during playback).
                      const onionD =
                        !isPlaying &&
                        progress === 0 &&
                        frame.id === selectedFrameId &&
                        editLayer &&
                        editLayer.type !== "group"
                          ? pathToString(
                              (editLayer[editingSide === "from" ? "to" : "from"] as PathData) ??
                                ({ subPaths: [] } as PathData),
                            )
                          : "";
                      // Figma: solid blue = frame selected; soft dashed blue = child layer selected inside
                      const borderColor =
                        isSel || isBeingDragged
                          ? "#0d99ff"
                          : isParentOfLayer
                            ? "rgba(13,153,255,0.55)"
                            : isHovered
                              ? "#7cc4ff"
                              : "var(--border)";
                      const borderWidth = isBeingDragged
                        ? 2
                        : isSel || isParentOfLayer
                          ? 1.5
                          : isHovered
                            ? 1.5
                            : 1;
                      const borderDash = isParentOfLayer && !isSel ? `${worldPerPx * 3} ${worldPerPx * 2}` : undefined;
                      const rx = Math.max(0.5, b.w * 0.015);

                      return (
                        <g
                          key={frame.id}
                          transform={`translate(${b.x} ${b.y})`}
                          opacity={1}
                        >
                          {/* white paper */}
                          <rect
                            x={0}
                            y={0}
                            width={b.w}
                            height={b.h}
                            rx={rx}
                            fill="#ffffff"
                            filter="url(#dragShadow)"
                          />
                          {/* adaptive grid inside the frame: sub-grid then emphasised major */}
                          <rect
                            x={0}
                            y={0}
                            width={b.w}
                            height={b.h}
                            rx={rx}
                            fill="url(#frame-grid-minor)"
                            pointerEvents="none"
                          />
                          <rect
                            x={0}
                            y={0}
                            width={b.w}
                            height={b.h}
                            rx={rx}
                            fill="url(#frame-grid-major)"
                            pointerEvents="none"
                          />
                          {/* Clip layer content to artboard (Figma “Clip content”) */}
                          <clipPath id={`frame-clip-${frame.id}`}>
                            <rect x={0} y={0} width={b.w} height={b.h} rx={rx} />
                          </clipPath>
                          <g
                            clipPath={
                              frame.id === selectedFrameId && layerDragRef.current
                                ? undefined
                                : `url(#frame-clip-${frame.id})`
                            }
                          >
                          {/* End-state morph ghost (Figma-like spatial feedback for from→to) */}
                          {onionD && !isPlaying && progress < 0.001 && (
                            <path
                              d={onionD}
                              fill="none"
                              stroke="#0d99ff"
                              strokeWidth={Math.max(0.8, Math.min(2.2, b.w / 24))}
                              strokeDasharray={`${worldPerPx * 4} ${worldPerPx * 3}`}
                              opacity={0.35}
                              vectorEffect="non-scaling-stroke"
                              pointerEvents="none"
                            />
                          )}
                          {draws.map((draw) => {
                            const gradId = draw.fillGradient
                              ? `${gradientDomId(frame.id)}-${draw.id}`
                              : null;
                            const pathFill = gradId
                              ? `url(#${gradId})`
                              : (draw.fill ?? "none");
                            const pathStroke =
                              draw.stroke ?? (draw.fill || draw.fillGradient ? "none" : "#111111");
                            const isLayerSel =
                              hasCanvasSelection &&
                              selectTarget === "layer" &&
                              frame.id === selectedFrameId &&
                              selectedLayerIds.some((id) => String(id) === String(draw.id));
                            const isLayerHover =
                              hoveredLayerKey === `${frame.id}:${draw.id}` && !isLayerSel;
                            // Hover outline only here (tight AABB). Selected chrome is a
                            // single world-space overlay below so box + handles never desync.
                            const hoverBb =
                              !isPointTool &&
                              isLayerHover &&
                              !isLayerSel &&
                              draw.d
                                ? boundsFromPathD(draw.d)
                                : null;
                            const tformParts: string[] = [];
                            if (draw.translateX || draw.translateY) {
                              tformParts.push(
                                `translate(${draw.translateX || 0} ${draw.translateY || 0})`,
                              );
                            }
                            if (draw.rotation) {
                              tformParts.push(`rotate(${draw.rotation})`);
                            }
                            const tform = tformParts.length ? tformParts.join(" ") : undefined;
                            return (
                              <g key={String(draw.id)} transform={tform}>
                                {draw.fillGradient && gradId && (
                                  <defs
                                    dangerouslySetInnerHTML={{
                                      __html: gradientToSvg(
                                        draw.fillGradient,
                                        gradId,
                                        draw.fillOpacity,
                                      ),
                                    }}
                                  />
                                )}
                                {draw.d && (
                                  <path
                                    d={draw.d}
                                    fill={pathFill}
                                    fillOpacity={gradId ? 1 : draw.fillOpacity}
                                    fillRule={
                                      draw.fillType === "evenOdd" ? "evenodd" : "nonzero"
                                    }
                                    stroke={pathStroke}
                                    strokeOpacity={draw.strokeOpacity}
                                    strokeWidth={Math.max(0.8, Math.min(2.2, b.w / 24))}
                                    opacity={1}
                                    vectorEffect="non-scaling-stroke"
                                    pointerEvents="none"
                                  />
                                )}
                                {hoverBb && (
                                  <rect
                                    x={hoverBb.x}
                                    y={hoverBb.y}
                                    width={hoverBb.w}
                                    height={hoverBb.h}
                                    fill="none"
                                    stroke="#0d99ff"
                                    strokeWidth={1}
                                    strokeOpacity={0.55}
                                    vectorEffect="non-scaling-stroke"
                                    pointerEvents="none"
                                  />
                                )}
                              </g>
                            );
                          })}
                          </g>
                          {/* thin, zoom-independent border / selection */}
                          <rect
                            x={0}
                            y={0}
                            width={b.w}
                            height={b.h}
                            rx={rx}
                            fill="none"
                            stroke={borderColor}
                            strokeWidth={borderWidth}
                            strokeDasharray={borderDash}
                            vectorEffect="non-scaling-stroke"
                            pointerEvents="none"
                          />
                        </g>
                      );
                    })}
                    {/* Smart guides (magenta, Figma-like) */}
                    {smartGuides.map((g, i) =>
                      g.orientation === "v" ? (
                        <line
                          key={`sg-v-${i}`}
                          x1={g.pos}
                          y1={g.from}
                          x2={g.pos}
                          y2={g.to}
                          stroke="#FF00FF"
                          strokeWidth={1}
                          vectorEffect="non-scaling-stroke"
                          pointerEvents="none"
                        />
                      ) : (
                        <line
                          key={`sg-h-${i}`}
                          x1={g.from}
                          y1={g.pos}
                          x2={g.to}
                          y2={g.pos}
                          stroke="#FF00FF"
                          strokeWidth={1}
                          vectorEffect="non-scaling-stroke"
                          pointerEvents="none"
                        />
                      ),
                    )}

                    {/* Motion paths for all selected layers with Position tracks */}
                    {!isPlaying &&
                      selectTarget === "layer" &&
                      editOrigin &&
                      (selectedLayerIds.length
                        ? selectedLayerIds
                        : selectedLayerId != null
                          ? [selectedLayerId]
                          : []
                      ).map((id) => {
                        const layer = layers.find((l) => String(l.id) === String(id));
                        if (!layer) return null;
                        const pts = sampleMotionPath(
                          layer,
                          animation.blocks,
                          animation.duration,
                          40,
                        );
                        if (pts.length < 2) return null;
                        const poly = pts
                          .map(
                            (pt) =>
                              `${editOrigin.x + pt.x},${editOrigin.y + pt.y}`,
                          )
                          .join(" ");
                        const cur = {
                          x:
                            editOrigin.x +
                            numberAtTime(
                              layer,
                              animation.blocks,
                              "translateX",
                              progress * animation.duration,
                              animation.duration,
                            ),
                          y:
                            editOrigin.y +
                            numberAtTime(
                              layer,
                              animation.blocks,
                              "translateY",
                              progress * animation.duration,
                              animation.duration,
                            ),
                        };
                        const primary = String(id) === String(selectedLayerId);
                        return (
                          <g key={`mp-${id}`} pointerEvents="none">
                            <polyline
                              points={poly}
                              fill="none"
                              stroke="#0d99ff"
                              strokeWidth={primary ? 1.25 : 1}
                              strokeDasharray={`${worldPerPx * 4} ${worldPerPx * 3}`}
                              opacity={primary ? 0.75 : 0.4}
                              vectorEffect="non-scaling-stroke"
                            />
                            <circle
                              cx={cur.x}
                              cy={cur.y}
                              r={worldPerPx * (primary ? 3.5 : 2.5)}
                              fill="#0d99ff"
                              opacity={primary ? 0.9 : 0.5}
                            />
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
                    {/* Marquee (rubber-band) selection rectangle */}
                    {marquee && (
                      <rect
                        x={Math.min(marquee.start.x, marquee.current.x)}
                        y={Math.min(marquee.start.y, marquee.current.y)}
                        width={Math.abs(marquee.current.x - marquee.start.x)}
                        height={Math.abs(marquee.current.y - marquee.start.y)}
                        fill="#0d99ff"
                        fillOpacity="0.08"
                        stroke="#0d99ff"
                        strokeWidth="1"
                        strokeDasharray="4 3"
                        vectorEffect="non-scaling-stroke"
                        pointerEvents="none"
                      />
                    )}
                    {/* Bézier handles — Direct tool only (Figma: edit mode, not Select) */}
                    {!isPlaying &&
                      isPointTool &&
                      editPath &&
                      editOrigin &&
                      (() => {
                        const segs: Array<[{ x: number; y: number }, { x: number; y: number }, string]> = [];
                        for (let s = 0; s < editPath.subPaths.length; s++) {
                          const cmds = editPath.subPaths[s].commands;
                          let cur: { x: number; y: number } | null = null;
                          let subStart: { x: number; y: number } | null = null;
                          for (let c = 0; c < cmds.length; c++) {
                            const cmd = cmds[c];
                            if (cmd.type === "M") {
                              cur = cmd.points[0];
                              subStart = cmd.points[0];
                            } else if (cmd.type === "L") {
                              cur = cmd.points[0];
                            } else if (cmd.type === "C") {
                              const [c1, c2, end] = cmd.points;
                              if (cur) segs.push([cur, c1, `c-${s}-${c}-1`]);
                              if (end) segs.push([end, c2, `c-${s}-${c}-2`]);
                              cur = end ?? cur;
                            } else if (cmd.type === "Q") {
                              const [ctrl, end] = cmd.points;
                              if (cur) segs.push([cur, ctrl, `q-${s}-${c}-1`]);
                              if (end) segs.push([end, ctrl, `q-${s}-${c}-2`]);
                              cur = end ?? cur;
                            } else if (cmd.type === "Z") {
                              cur = subStart;
                            }
                          }
                        }
                        return (
                          <g pointerEvents="none">
                            {segs.map(([a, b, k]) => (
                              <line
                                key={k}
                                x1={editOrigin.x + a.x}
                                y1={editOrigin.y + a.y}
                                x2={editOrigin.x + b.x}
                                y2={editOrigin.y + b.y}
                                stroke="#0d99ff"
                                strokeOpacity={0.5}
                                strokeWidth={worldPerPx}
                              />
                            ))}
                          </g>
                        );
                      })()}

                    {/* Pen rubber-band + close target (always show first-point target while drawing) */}
                    {!isPlaying &&
                      toolMode === "pen" &&
                      editOrigin &&
                      penActiveSubpathRef.current != null &&
                      editPath?.subPaths[penActiveSubpathRef.current] &&
                      (() => {
                        const sub = editPath.subPaths[penActiveSubpathRef.current as number];
                        const lastCmd = sub.commands[sub.commands.length - 1];
                        const lastAnchor = lastCmd?.points[lastCmd.points.length - 1];
                        const first = sub.commands[0]?.points[0];
                        if (!lastAnchor || !first) return null;
                        const closeTol = Math.max(editSnap * 1.5, worldPerPx * 6);
                        const willClose =
                          sub.commands.length > 1 &&
                          (penPreview
                            ? Math.hypot(penPreview.x - first.x, penPreview.y - first.y) <= closeTol
                            : false);
                        return (
                          <g pointerEvents="none">
                            {penPreview && (
                              <line
                                x1={editOrigin.x + lastAnchor.x}
                                y1={editOrigin.y + lastAnchor.y}
                                x2={editOrigin.x + penPreview.x}
                                y2={editOrigin.y + penPreview.y}
                                stroke="#0d99ff"
                                strokeOpacity={0.7}
                                strokeWidth={worldPerPx}
                                strokeDasharray={`${worldPerPx * 2} ${worldPerPx * 2}`}
                              />
                            )}
                            {penPreview && (
                              <circle
                                cx={editOrigin.x + penPreview.x}
                                cy={editOrigin.y + penPreview.y}
                                r={anchorR * 0.9}
                                fill={willClose ? "#0d99ff" : "#ffffff"}
                                stroke="#0d99ff"
                                strokeWidth={1.25}
                                vectorEffect="non-scaling-stroke"
                              />
                            )}
                            {/* Always highlight the start point as a close target while pen is active */}
                            {sub.commands.length > 1 && (
                              <circle
                                cx={editOrigin.x + first.x}
                                cy={editOrigin.y + first.y}
                                r={willClose ? anchorR * 1.7 : anchorR * 1.3}
                                fill="none"
                                stroke={willClose ? "#0d99ff" : "#0d99ff"}
                                strokeOpacity={willClose ? 1 : 0.5}
                                strokeWidth={willClose ? 1.5 : 1}
                                vectorEffect="non-scaling-stroke"
                              />
                            )}
                          </g>
                        );
                      })()}

                    {/* Paint bucket live preview (world view) - shows the region that would be filled with the currently selected color */}
                    {toolMode === "paint" && paintHoverValid && (
                      editOrigin && editPath ? (
                        <g transform={`translate(${editOrigin.x} ${editOrigin.y})`} pointerEvents="none">
                          <path
                            d={pathToString(editPath)}
                            fill={currentFillColor}
                            fillOpacity={Math.max(0.25, Math.min(0.65, (layers.find((l) => l.id === selectedLayerId)?.fillAlpha ?? 1) * 0.7))}
                            stroke="#0d99ff"
                            strokeWidth={worldPerPx * 1.5}
                            strokeDasharray={`${worldPerPx * 3} ${worldPerPx * 1.5}`}
                            vectorEffect="non-scaling-stroke"
                            opacity={0.85}
                          />
                        </g>
                      ) : hoveredFrameId ? (
                        (() => {
                          const f = frames.find((ff) => ff.id === hoveredFrameId);
                          if (!f) return null;
                          const b = getFrameBounds(f);
                          return (
                            <g pointerEvents="none">
                              <rect
                                x={b.x}
                                y={b.y}
                                width={b.w}
                                height={b.h}
                                fill={currentFillColor}
                                fillOpacity={0.4}
                                stroke="#0d99ff"
                                strokeWidth={worldPerPx * 1.5}
                                strokeDasharray={`${worldPerPx * 3} ${worldPerPx * 1.5}`}
                                rx={Math.max(0.5, b.w * 0.015)}
                              />
                            </g>
                          );
                        })()
                      ) : null
                    )}

                    {/* Vector network — Direct tool (Figma double-click edit) */}
                    {!isPlaying && isPointTool && editPath && editOrigin && (
                      <g pointerEvents="none">
                        {/* Soft path outline so you can see the network under the points */}
                        <path
                          d={pathToString(editPath)}
                          transform={`translate(${editOrigin.x + editLayerTx} ${editOrigin.y + editLayerTy})`}
                          fill="none"
                          stroke="#0d99ff"
                          strokeOpacity={0.35}
                          strokeWidth={1.25}
                          vectorEffect="non-scaling-stroke"
                        />
                        {editPath.subPaths.map((sp, s) =>
                          sp.commands.map((cmd, c) =>
                            cmd.points.map((pt, pi) => {
                              const wx = editOrigin.x + editLayerTx + pt.x;
                              const wy = editOrigin.y + editLayerTy + pt.y;
                              const isSel = selectedPoints.some(
                                (q) =>
                                  q.subPathIndex === s &&
                                  q.commandIndex === c &&
                                  q.pointIndex === pi,
                              );
                              const isAnchor = pi === cmd.points.length - 1;
                              const r = isAnchor ? anchorR : anchorR * 0.75;
                              return isAnchor ? (
                                <rect
                                  key={`a-${s}-${c}-${pi}`}
                                  x={wx - r}
                                  y={wy - r}
                                  width={r * 2}
                                  height={r * 2}
                                  rx={r * 0.15}
                                  fill={isSel ? "#0d99ff" : "#ffffff"}
                                  stroke="#0d99ff"
                                  strokeWidth={1.5}
                                  vectorEffect="non-scaling-stroke"
                                  style={{ cursor: "grab", pointerEvents: "auto" }}
                                />
                              ) : (
                                <circle
                                  key={`h-${s}-${c}-${pi}`}
                                  cx={wx}
                                  cy={wy}
                                  r={r}
                                  fill={isSel ? "#0d99ff" : "#ffffff"}
                                  stroke="#0d99ff"
                                  strokeWidth={1.25}
                                  vectorEffect="non-scaling-stroke"
                                  style={{ cursor: "grab", pointerEvents: "auto" }}
                                />
                              );
                            }),
                          ),
                        )}
                      </g>
                    )}

                    {/* Frame resize — only when the *frame* is selected (not a child layer) */}
                    {!isPlaying &&
                      isObjectTool &&
                      hasCanvasSelection &&
                      selectTarget === "frame" &&
                      editFrame &&
                      (() => {
                        const b = getFrameBounds(editFrame);
                        const hs = worldPerPx * 3;
                        const handles: Array<{
                          h: "se" | "e" | "s";
                          x: number;
                          y: number;
                          cursor: string;
                        }> = [
                          { h: "se", x: b.x + b.w, y: b.y + b.h, cursor: "nwse-resize" },
                          { h: "e", x: b.x + b.w, y: b.y + b.h / 2, cursor: "ew-resize" },
                          { h: "s", x: b.x + b.w / 2, y: b.y + b.h, cursor: "ns-resize" },
                        ];
                        return (
                          <g>
                            {handles.map((hh) => (
                              <rect
                                key={hh.h}
                                x={hh.x - hs}
                                y={hh.y - hs}
                                width={hs * 2}
                                height={hs * 2}
                                rx={worldPerPx * 1}
                                fill="#ffffff"
                                stroke="#0d99ff"
                                strokeWidth={1.25}
                                vectorEffect="non-scaling-stroke"
                                style={{ cursor: hh.cursor }}
                                onPointerDown={(e) => startFrameResize(e, hh.h)}
                              />
                            ))}
                          </g>
                        );
                      })()}

                    {/* Layer selection — union AABB for multi + rotate handle (Select only) */}
                    {!isPlaying &&
                      isObjectTool &&
                      hasCanvasSelection &&
                      selectTarget === "layer" &&
                      editFrame &&
                      editOrigin &&
                      (() => {
                        const ids =
                          selectedLayerIds.length > 0
                            ? selectedLayerIds
                            : selectedLayerId != null
                              ? [selectedLayerId]
                              : [];
                        if (ids.length === 0) return null;
                        // Frame-local union of path AABB + translate for all selected
                        let uMinX = Infinity,
                          uMinY = Infinity,
                          uMaxX = -Infinity,
                          uMaxY = -Infinity;
                        const itemsMeta: Array<{
                          id: string | number;
                          bb: { x: number; y: number; w: number; h: number };
                          tx: number;
                          ty: number;
                        }> = [];
                        for (const id of ids) {
                          const L = layers.find((l) => String(l.id) === String(id));
                          if (!L || L.type === "group") continue;
                          const sourcePath = (L.pathData ?? L.from) as PathData;
                          let bb = getPathDataBounds(sourcePath);
                          if (!bb) continue;
                          const tx = Number(L.translateX) || 0;
                          const ty = Number(L.translateY) || 0;
                          itemsMeta.push({ id: L.id, bb, tx, ty });
                          uMinX = Math.min(uMinX, bb.x + tx);
                          uMinY = Math.min(uMinY, bb.y + ty);
                          uMaxX = Math.max(uMaxX, bb.x + bb.w + tx);
                          uMaxY = Math.max(uMaxY, bb.y + bb.h + ty);
                        }
                        if (!Number.isFinite(uMinX)) return null;
                        // World coords for chrome
                        const ox = editOrigin.x + uMinX;
                        const oy = editOrigin.y + uMinY;
                        const ow = Math.max(0.01, uMaxX - uMinX);
                        const oh = Math.max(0.01, uMaxY - uMinY);
                        // Control AABB in frame-local (includes translate) for resize math
                        const controlLocal = {
                          x: uMinX,
                          y: uMinY,
                          w: ow,
                          h: oh,
                        };
                        const hs = worldPerPx * 3;
                        const hit = worldPerPx * 5;
                        const handles: Array<{
                          h: "nw" | "ne" | "sw" | "se" | "e" | "w" | "n" | "s";
                          x: number;
                          y: number;
                          cursor: string;
                        }> = [
                          { h: "nw", x: ox, y: oy, cursor: "nwse-resize" },
                          { h: "ne", x: ox + ow, y: oy, cursor: "nesw-resize" },
                          { h: "sw", x: ox, y: oy + oh, cursor: "nesw-resize" },
                          { h: "se", x: ox + ow, y: oy + oh, cursor: "nwse-resize" },
                          { h: "n", x: ox + ow / 2, y: oy, cursor: "ns-resize" },
                          { h: "s", x: ox + ow / 2, y: oy + oh, cursor: "ns-resize" },
                          { h: "w", x: ox, y: oy + oh / 2, cursor: "ew-resize" },
                          { h: "e", x: ox + ow, y: oy + oh / 2, cursor: "ew-resize" },
                        ];
                        const rotHandleY = oy - worldPerPx * 18;
                        const rotHandleX = ox + ow / 2;
                        const beginResize = (
                          e: React.PointerEvent,
                          handle: (typeof handles)[number]["h"],
                        ) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const items = itemsMeta
                            .map((m) => {
                              const L = layers.find((l) => String(l.id) === String(m.id));
                              if (!L || L.locked) return null;
                              const of = structuredClone(
                                (L.from ?? L.pathData) as PathData,
                              );
                              return {
                                id: L.id,
                                origFrom: of,
                                origTo: L.to
                                  ? structuredClone(L.to as PathData)
                                  : null,
                                // Store frame-local bounds (path + translate) for proportional scale
                                origin: {
                                  x: m.bb.x + m.tx,
                                  y: m.bb.y + m.ty,
                                  w: m.bb.w,
                                  h: m.bb.h,
                                },
                                pathOrigin: {
                                  x: m.bb.x,
                                  y: m.bb.y,
                                  w: m.bb.w,
                                  h: m.bb.h,
                                },
                                translate: { x: m.tx, y: m.ty },
                              };
                            })
                            .filter(Boolean) as Array<{
                            id: string | number;
                            origFrom: PathData;
                            origTo: PathData | null;
                            origin: { x: number; y: number; w: number; h: number };
                            pathOrigin: { x: number; y: number; w: number; h: number };
                            translate: { x: number; y: number };
                          }>;
                          const world = worldPointFromEvent(e.clientX, e.clientY);
                          const cornerX = handle.includes("w")
                            ? controlLocal.x
                            : handle.includes("e")
                              ? controlLocal.x + controlLocal.w
                              : controlLocal.x + controlLocal.w / 2;
                          const cornerY = handle.includes("n")
                            ? controlLocal.y
                            : handle.includes("s")
                              ? controlLocal.y + controlLocal.h
                              : controlLocal.y + controlLocal.h / 2;
                          const localAtGrab = world
                            ? {
                                x: world.x - editOrigin.x,
                                y: world.y - editOrigin.y,
                              }
                            : { x: cornerX, y: cornerY };
                          layerResizeRef.current = {
                            handle,
                            origin: { ...controlLocal },
                            translate: { x: 0, y: 0 },
                            grabOffset: {
                              x: localAtGrab.x - cornerX,
                              y: localAtGrab.y - cornerY,
                            },
                            items: items.map((it) => ({
                              id: it.id,
                              origFrom: it.origFrom,
                              origTo: it.origTo,
                              origin: it.pathOrigin,
                              frameOrigin: it.origin,
                              baseTranslate: it.translate,
                            })),
                            moved: false,
                          };
                          worldSvgRef.current?.setPointerCapture(e.pointerId);
                        };
                        const beginRotate = (e: React.PointerEvent) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const world = worldPointFromEvent(e.clientX, e.clientY);
                          if (!world) return;
                          const center = { x: ox + ow / 2, y: oy + oh / 2 };
                          const startAngle =
                            (Math.atan2(world.y - center.y, world.x - center.x) * 180) /
                            Math.PI;
                          layerRotateRef.current = {
                            center,
                            startAngle,
                            baseRotations: ids.map((id) => {
                              const L = layers.find((l) => String(l.id) === String(id));
                              return {
                                id,
                                rotation: Number(L?.rotation) || 0,
                              };
                            }),
                            moved: false,
                          };
                          worldSvgRef.current?.setPointerCapture(e.pointerId);
                        };
                        return (
                          <g pointerEvents="none">
                            <rect
                              x={ox}
                              y={oy}
                              width={ow}
                              height={oh}
                              fill="none"
                              stroke="#0d99ff"
                              strokeWidth={1.5}
                              vectorEffect="non-scaling-stroke"
                            />
                            {/* Rotate stem + handle (Figma-style above center) */}
                            <line
                              x1={rotHandleX}
                              y1={oy}
                              x2={rotHandleX}
                              y2={rotHandleY}
                              stroke="#0d99ff"
                              strokeWidth={1}
                              vectorEffect="non-scaling-stroke"
                            />
                            <circle
                              cx={rotHandleX}
                              cy={rotHandleY}
                              r={hs * 1.1}
                              fill="#ffffff"
                              stroke="#0d99ff"
                              strokeWidth={1.25}
                              vectorEffect="non-scaling-stroke"
                              pointerEvents="all"
                              style={{ cursor: "grab", pointerEvents: "auto" }}
                              onPointerDown={beginRotate}
                            />
                            {(
                              [
                                {
                                  h: "n" as const,
                                  x1: ox,
                                  y1: oy,
                                  x2: ox + ow,
                                  y2: oy,
                                  c: "ns-resize",
                                },
                                {
                                  h: "s" as const,
                                  x1: ox,
                                  y1: oy + oh,
                                  x2: ox + ow,
                                  y2: oy + oh,
                                  c: "ns-resize",
                                },
                                {
                                  h: "w" as const,
                                  x1: ox,
                                  y1: oy,
                                  x2: ox,
                                  y2: oy + oh,
                                  c: "ew-resize",
                                },
                                {
                                  h: "e" as const,
                                  x1: ox + ow,
                                  y1: oy,
                                  x2: ox + ow,
                                  y2: oy + oh,
                                  c: "ew-resize",
                                },
                              ] as const
                            ).map((edge) => (
                              <line
                                key={`hit-${edge.h}`}
                                x1={edge.x1}
                                y1={edge.y1}
                                x2={edge.x2}
                                y2={edge.y2}
                                stroke="transparent"
                                strokeWidth={hit * 2}
                                pointerEvents="stroke"
                                vectorEffect="non-scaling-stroke"
                                style={{ cursor: edge.c, pointerEvents: "stroke" }}
                                onPointerDown={(e) => beginResize(e, edge.h)}
                              />
                            ))}
                            {handles.map((hh) => (
                              <rect
                                key={hh.h}
                                x={hh.x - hs}
                                y={hh.y - hs}
                                width={hs * 2}
                                height={hs * 2}
                                rx={worldPerPx * 1}
                                fill="#ffffff"
                                stroke="#0d99ff"
                                strokeWidth={1.25}
                                vectorEffect="non-scaling-stroke"
                                pointerEvents="all"
                                style={{ cursor: hh.cursor, pointerEvents: "auto" }}
                                onPointerDown={(e) => beginResize(e, hh.h)}
                              />
                            ))}
                          </g>
                        );
                      })()}
                  </svg>
                ) : (
                  <PathCanvas
                    side={isPlaying ? "preview" : editingSide}
                    resetKey={isPlaying ? resetPreview : editingSide === "from" ? resetFrom : resetTo}
                    width={456}
                    height={456}
                  />
                )}

                {/* Constant-size HTML labels above each artboard (don't scale with zoom),
                    with inline rename + duplicate/delete on the selected frame. */}
                {!isActionMode && worldSize.w > 0 && (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden">
                    {culledFrames.map((frame) => {
                      const b = getFrameBounds(frame);
                      const sx = ((b.x - worldView.x) / worldView.w) * worldSize.w;
                      const sy = ((b.y - worldView.y) / worldView.h) * worldSize.h;
                      const fw = (b.w / worldView.w) * worldSize.w;
                      const cx = sx + fw / 2;
                      if (sy < -40 || sy > worldSize.h + 40 || cx < -120 || cx > worldSize.w + 120)
                        return null;
                      const isSel = isFrameChromeSelected(frame.id);
                      const isParentOfLayer = isFrameContainingSelection(frame.id);
                      const isRenaming = renamingFrameId === frame.id;
                      // Show title for selected frame or parent-of-layer, and always a quiet label when nearby
                      const showTitleChrome = isSel || isParentOfLayer || frame.id === hoveredFrameId;
                      return (
                        <div
                          key={frame.id}
                          className="pointer-events-auto absolute -translate-x-1/2"
                          style={{ left: Math.round(cx), top: Math.round(sy) - 28 }}
                        >
                          {isRenaming ? (
                            <input
                              autoFocus
                              defaultValue={frame.name}
                              onBlur={(e) => {
                                renameFrame(frame.id, e.target.value);
                                setRenamingFrameId(null);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  renameFrame(frame.id, (e.target as HTMLInputElement).value);
                                  setRenamingFrameId(null);
                                } else if (e.key === "Escape") {
                                  setRenamingFrameId(null);
                                }
                              }}
                              className="h-6 w-36 rounded-md border border-primary bg-card px-2 text-center text-[11px] text-foreground shadow-sm outline-none"
                              onPointerDown={(e) => e.stopPropagation()}
                            />
                          ) : (
                            <div
                              className={cn(
                                "flex items-center gap-0.5 rounded-md py-0.5 pl-1 pr-1 transition-colors",
                                // Figma: only the *frame* selection paints the title primary — not a child layer.
                                isSel
                                  ? "border border-primary/35 bg-card/95 shadow-sm ring-1 ring-primary/15 backdrop-blur-sm"
                                  : isParentOfLayer
                                    ? "border border-transparent bg-transparent"
                                    : showTitleChrome
                                      ? "border border-transparent bg-card/80 backdrop-blur-sm"
                                      : "border border-transparent bg-transparent",
                                isDraggingArtboards && draggingArtboardIds.includes(frame.id)
                                  ? "cursor-grabbing"
                                  : "cursor-default",
                              )}
                            >
                              {/* Name: click = select frame; double-click = rename only (never the shape). */}
                              <button
                                type="button"
                                className={cn(
                                  "max-w-[160px] truncate rounded px-1.5 text-[11px] leading-5",
                                  isSel
                                    ? "font-medium text-primary"
                                    : isParentOfLayer
                                      ? "text-muted-foreground/70"
                                      : "text-muted-foreground hover:text-foreground",
                                )}
                                title="Click to select frame · double-click to rename frame"
                                onPointerDown={(e) => {
                                  if (e.button !== 0) return;
                                  // Figma: a title drag both selects and moves the frame in one gesture.
                                  e.stopPropagation();
                                  const additive = e.shiftKey;
                                  let next: string[];
                                  if (additive) {
                                    next = worldSelectedIds.includes(frame.id)
                                      ? worldSelectedIds.filter((id) => id !== frame.id)
                                      : [...worldSelectedIds, frame.id];
                                  } else {
                                    next = [frame.id];
                                  }
                                  setWorldSelectedIds(next);
                                  if (next.length === 0) {
                                    deselectAll();
                                    return;
                                  }
                                  selectFrame(frame.id);
                                  if (!additive) {
                                    e.preventDefault();
                                    startWorldArtboardDrag(e.clientX, e.clientY, next);
                                    worldSvgRef.current?.setPointerCapture(e.pointerId);
                                  }
                                }}
                                onDoubleClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  // Rename the *frame* only — not a layer. Requires intent (dblclick on label).
                                  setWorldSelectedIds([frame.id]);
                                  selectFrame(frame.id);
                                  setRenamingFrameId(frame.id);
                                }}
                              >
                                {frame.name}
                              </button>
                              {isSel && (
                                <>
                                  <button
                                    type="button"
                                    data-frame-chrome-action
                                    title="Duplicate frame"
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={() => {
                                      const st = useEditorStore.getState();
                                      st.selectFrame(frame.id);
                                      st.duplicateFrame();
                                    }}
                                    className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground cursor-pointer"
                                  >
                                    <Copy className="size-3" />
                                  </button>
                                  <button
                                    type="button"
                                    data-frame-chrome-action
                                    title="Delete frame"
                                    disabled={frames.length <= 1}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    onClick={() => deleteFrame(frame.id)}
                                    className="grid size-5 place-items-center rounded text-muted-foreground hover:bg-muted hover:text-destructive disabled:pointer-events-none disabled:opacity-40 cursor-pointer"
                                  >
                                    <Trash2 className="size-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Bottom-center size readout (W × H) for the selected / hovered frame. */}
                {!isActionMode && worldSize.w > 0 && (
                  <div className="pointer-events-none absolute inset-0 overflow-hidden">
                    {culledFrames.map((frame) => {
                      const show = frame.id === selectedFrameId || frame.id === hoveredFrameId;
                      if (!show) return null;
                      const b = getFrameBounds(frame);
                      const sx = ((b.x - worldView.x) / worldView.w) * worldSize.w;
                      const sy = ((b.y - worldView.y) / worldView.h) * worldSize.h;
                      const fw = (b.w / worldView.w) * worldSize.w;
                      const fh = (b.h / worldView.h) * worldSize.h;
                      const cx = sx + fw / 2;
                      const by = sy + fh;
                      if (by < -20 || by > worldSize.h + 30 || cx < -120 || cx > worldSize.w + 120)
                        return null;
                      const fmt = (n: number) =>
                        Number.isInteger(n) ? String(n) : Number(n.toFixed(2)).toString();
                      return (
                        <div
                          key={frame.id}
                          className="absolute -translate-x-1/2 rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-medium text-primary-foreground shadow-sm"
                          style={{ left: Math.round(cx), top: Math.round(by) + 8 }}
                        >
                          {fmt(b.w)} × {fmt(b.h)}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </div>

        {/* Compatibility chip — floats over the canvas, never steals layout height */}
        {compatibility.warning && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 z-40 flex justify-center px-3">
            <div className="pointer-events-auto flex max-w-[min(420px,calc(100%-1.5rem))] items-center gap-2 rounded-full border border-amber-500/35 bg-card/95 py-1 pl-3 pr-1 text-[11px] text-foreground/85 shadow-lg backdrop-blur-md">
              <span className="min-w-0 truncate">{compatibility.warning}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 rounded-full px-2.5 text-[10px] font-medium text-primary hover:bg-primary/10"
                onClick={() => useEditorStore.getState().autoFixSelectedLayer()}
              >
                Auto Fix
              </Button>
            </div>
          </div>
        )}

        {/* Playback is consolidated in the top transport bar + timeline scrubber
            (no duplicate canvas-bottom player). */}
      </div>
    </div>
  );
}

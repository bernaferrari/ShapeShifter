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
import {
  PAGE_ROOT_ID,
  useEditorStore,
  type LayerSelectionRef,
} from "@/lib/store/editorStore";
import type { Viewport } from "@/lib/shapeshifter/camera";
import {
  clientToWorld,
  computeGridSpec,
  fitViewportToAspect,
  snapValueToStep,
  zoomAtWorldPoint,
} from "@/lib/shapeshifter/camera";
import {
  getPathDataBounds,
  isPointInFillRegion,
  parsePath,
  pathToString,
  scalePathToBounds,
  updateCommandPoint,
} from "@/lib/shapeshifter/pathUtils";
import {
  numberAtTime,
  sampleMotionPath,
} from "@/lib/shapeshifter/playheadResolve";
import { snapRectToGuides, type GuideLine } from "@/lib/shapeshifter/smartGuides";
import { collectPointsInLasso, pointInPolygon } from "@/lib/shapeshifter/gestures/HitTests";
import {
  ObjectDragGesture,
  type ObjectDragModifiers,
} from "@/lib/shapeshifter/gestures/select/ObjectDragGesture";
import { generateId } from "@/lib/shapeshifter/ids";
import { gradientDomId, gradientToSvg } from "@/lib/shapeshifter/gradients";
import {
  collectOwnedLayersInRect,
  getOwnedLayerBounds,
  unionOwnedLayerBounds,
  type SceneOwner,
} from "@/lib/shapeshifter/scene/selection";
import {
  resolveWorldLayerDraws,
  type WorldLayerDraw,
} from "@/lib/shapeshifter/scene/render";
import { hitTestOwnedLayers } from "@/lib/shapeshifter/scene/hitTest";
import type { Command, PathData, Selection } from "@/lib/shapeshifter/types";

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
    rootLayers,
    rootAnimation,
    selectedFrameId,
    addFrame,
    renameFrame,
    deleteFrame,
    selectFrame,
    selectRootLayer,
    worldViewport,
    setWorldViewport,
    fitWorldToFrames,
    bringFrameIntoView,
    selectPoint,
    selectLayer,
    selectLayers,
    selectLayerRefs,
    selectedLayerIds,
    selectedLayerRefs,
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
  const editOrigin =
    selectedFrameId === PAGE_ROOT_ID
      ? { x: 0, y: 0 }
      : editFrame
        ? { x: editFrame.x || 0, y: editFrame.y || 0 }
        : null;
  const sceneOwners = useMemo<SceneOwner[]>(
    () => [
      {
        ownerId: PAGE_ROOT_ID,
        origin: { x: 0, y: 0 },
        layers: selectedFrameId === PAGE_ROOT_ID ? layers : rootLayers,
      },
      ...frames.map((frame) => ({
        ownerId: frame.id,
        origin: { x: frame.x || 0, y: frame.y || 0 },
        layers: frame.id === selectedFrameId ? layers : (frame.layers ?? []),
      })),
    ],
    [frames, layers, rootLayers, selectedFrameId],
  );
  const selectedLayerRefKeys = useMemo(
    () =>
      new Set(
        selectedLayerRefs.map((ref) => `${ref.ownerId}:${String(ref.layerId)}`),
      ),
    [selectedLayerRefs],
  );
  const selectedLayerOwnerCount = useMemo(
    () => new Set(selectedLayerRefs.map((ref) => ref.ownerId)).size,
    [selectedLayerRefs],
  );
  const documentSelectionBounds = useMemo(
    () => unionOwnedLayerBounds(sceneOwners, selectedLayerRefs),
    [sceneOwners, selectedLayerRefs],
  );
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
  const marqueeLayerBaseRef = useRef<LayerSelectionRef[]>([]);
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
    if (selectedFrameId === PAGE_ROOT_ID) {
      setWorldSelectedIds([]);
      return;
    }
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
  const frameLayerDraws = useCallback(
    (frame: (typeof frames)[number], morph: boolean): WorldLayerDraw[] => {
      // Active frame uses live store layers so multi-edit + playhead stay in sync.
      const active = frame.id === selectedFrameId;
      return resolveWorldLayerDraws(
        active ? layers : (frame.layers ?? []),
        active ? animation : frame.animation,
        progress,
        morph || progress > 0.001 || isPlaying,
      );
    },
    [progress, layers, selectedFrameId, animation, isPlaying],
  );

  const pageRootFrame = useMemo(
    () => ({
      id: PAGE_ROOT_ID,
      name: "Page",
      x: 0,
      y: 0,
      layers: rootLayers,
      vector: { id: PAGE_ROOT_ID, name: "Page", width: 1, height: 1, alpha: 1 },
      animation: rootAnimation,
      hiddenLayerIds: [] as string[],
    }),
    [rootAnimation, rootLayers],
  );
  const pageRootDraws = useMemo(
    () => frameLayerDraws(pageRootFrame, isPlaying || progress > 0),
    [frameLayerDraws, isPlaying, pageRootFrame, progress],
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

  /**
   * Figma-style hit: topmost path/clip layer under the cursor (any frame).
   * Local frame coordinates; fill hit or stroke proximity.
   */
  const hitLayerAtWorld = useCallback(
    (pt: { x: number; y: number } | null): { frameId: string; layerId: string | number } | null => {
      if (!pt) return null;
      const rootOwner = sceneOwners.find((owner) => owner.ownerId === PAGE_ROOT_ID);
      const frameOwners = [...sceneOwners]
        .filter((owner) => owner.ownerId !== PAGE_ROOT_ID)
        .filter((owner) => {
          const frame = frames.find((candidate) => candidate.id === owner.ownerId);
          if (!frame) return false;
          const bounds = getFrameBounds(frame);
          return (
            pt.x >= bounds.x &&
            pt.x <= bounds.x + bounds.w &&
            pt.y >= bounds.y &&
            pt.y <= bounds.y + bounds.h
          );
        })
        .reverse();
      const hit = hitTestOwnedLayers(
        rootOwner ? [rootOwner, ...frameOwners] : frameOwners,
        pt,
        Math.max(worldPerPx * 10, 2),
      );
      return hit ? { frameId: hit.ownerId, layerId: hit.layerId } : null;
    },
    [frames, getFrameBounds, sceneOwners, worldPerPx],
  );

  const selectOwnedLayer = useCallback(
    (hit: { frameId: string; layerId: string | number }) => {
      if (hit.frameId === PAGE_ROOT_ID) {
        selectRootLayer(hit.layerId);
      } else {
        if (hit.frameId !== useEditorStore.getState().selectedFrameId) {
          selectFrame(hit.frameId);
        }
        selectLayer(hit.layerId);
      }
    },
    [selectFrame, selectLayer, selectRootLayer],
  );

  // Layer object drag (Figma: grab selected shape and move it inside the frame)
  const layerDragRef = useRef<ObjectDragGesture | null>(null);

  const syncActiveOwner = useCallback((includeAnimation = false) => {
    useEditorStore.setState((state) =>
      state.selectedFrameId === PAGE_ROOT_ID
        ? {
            rootLayers: structuredClone(state.layers),
            ...(includeAnimation
              ? { rootAnimation: structuredClone(state.animation) }
              : {}),
          }
        : {
            frames: state.frames.map((frame) =>
              frame.id === state.selectedFrameId
                ? {
                    ...frame,
                    layers: structuredClone(state.layers),
                    ...(includeAnimation
                      ? { animation: structuredClone(state.animation) }
                      : {}),
                  }
                : frame,
            ),
          },
    );
  }, []);

  const resolveObjectDragTotal = useCallback(
    (total: { x: number; y: number }, modifiers: ObjectDragModifiers) => {
      let next = { ...total };
      if (snapToGrid && !modifiers.bypassSnap) {
        next = {
          x: snapValueToStep(next.x, editSnap),
          y: snapValueToStep(next.y, editSnap),
        };
      }

      if (!modifiers.bypassSnap && documentSelectionBounds) {
        const moving = {
          ...documentSelectionBounds,
          x: documentSelectionBounds.x + next.x,
          y: documentSelectionBounds.y + next.y,
        };
        const targets = frames.map((frame) => getFrameBounds(frame));
        for (const owner of sceneOwners) {
          for (const item of getOwnedLayerBounds(owner)) {
            if (selectedLayerRefKeys.has(`${item.ownerId}:${String(item.layerId)}`)) continue;
            targets.push(item.bounds);
          }
        }
        const snapped = snapRectToGuides(moving, targets, worldPerPx * 6);
        next.x += snapped.x - moving.x;
        next.y += snapped.y - moving.y;
        setSmartGuides(snapped.guides);
      } else {
        setSmartGuides([]);
      }
      return next;
    },
    [
      documentSelectionBounds,
      editSnap,
      frames,
      getFrameBounds,
      sceneOwners,
      selectedLayerRefKeys,
      snapToGrid,
      worldPerPx,
    ],
  );

  const beginObjectDrag = useCallback(
    (start: { x: number; y: number }) =>
      new ObjectDragGesture(start, {
        beginTransaction: () => useEditorStore.getState().pushHistory(),
        cloneSelection: () =>
          useEditorStore.getState().duplicateSelectedLayersOffset(0, 0, {
            recordHistory: false,
          }),
        resolveTotalDelta: resolveObjectDragTotal,
        applyDelta: (delta) => {
          useEditorStore
            .getState()
            .translateSelectedLayer(delta.x, delta.y, { recordHistory: false });
          syncActiveOwner();
        },
        commit: (result) => {
          const store = useEditorStore.getState();
          store.recordLayerTranslationAtPlayhead();
          syncActiveOwner(true);
          const selectionOwners = new Set(
            useEditorStore.getState().selectedLayerRefs.map((ref) => ref.ownerId),
          );
          // A cross-owner group retains each object's parent. Reparenting the group
          // is a separate document command; collapsing it into one hit frame here
          // would destroy its owner-relative hierarchy.
          if (selectionOwners.size > 1) {
            setSmartGuides([]);
            return;
          }
          const dropFrameId = hitArtboard(result.end);
          if (dropFrameId && dropFrameId !== useEditorStore.getState().selectedFrameId) {
            const moved = useEditorStore
              .getState()
              .moveSelectedLayersToFrame(dropFrameId, { recordHistory: false });
            if (moved) setWorldSelectedIds([dropFrameId]);
          } else if (
            !dropFrameId &&
            useEditorStore.getState().selectedFrameId !== PAGE_ROOT_ID
          ) {
            const moved = useEditorStore
              .getState()
              .moveSelectedLayersToRoot({ recordHistory: false });
            if (moved) setWorldSelectedIds([]);
          }
          setSmartGuides([]);
        },
        rollback: () => useEditorStore.getState().cancelLastHistoryTransaction(),
        cancelled: () => setSmartGuides([]),
      }),
    [hitArtboard, resolveObjectDragTotal, syncActiveOwner],
  );

  const cancelObjectDrag = useCallback(() => {
    const drag = layerDragRef.current;
    layerDragRef.current = null;
    drag?.cancel();
    setSmartGuides([]);
  }, []);

  const cancelLayerTransform = useCallback(() => {
    const transform = layerResizeRef.current ?? layerRotateRef.current;
    layerResizeRef.current = null;
    layerRotateRef.current = null;
    if (transform?.moved) {
      useEditorStore.getState().cancelLastHistoryTransaction();
    }
    setSmartGuides([]);
  }, []);

  useEffect(
    () => () => {
      cancelObjectDrag();
      cancelLayerTransform();
    },
    [cancelLayerTransform, cancelObjectDrag, toolMode],
  );

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
        window.removeEventListener("pointercancel", up);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
      window.addEventListener("pointercancel", up);
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
      // Middle or Space/H pans. Alt is reserved for Figma-style drag duplication.
      if (e.button === 1 || spacePanActive) {
        if (spacePanActive) {
          (window as unknown as { __ssSpacePanUsed?: boolean }).__ssSpacePanUsed = true;
        }
        setIsWorldPanning(true);
        setLastWorldPan({ x: e.clientX, y: e.clientY });
        try {
          worldSvgRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* ignore — drag still proceeds via this element's own listeners */
        }
        return;
      }
      if (!p) return;

      // Pen / Paint operate in the focused frame's local space.
      const rawLocal = { x: p.x - (editOrigin?.x ?? 0), y: p.y - (editOrigin?.y ?? 0) };
      const snappedLocal =
        snapToGrid && !(e.metaKey || e.ctrlKey)
          ? { x: snapValueToStep(rawLocal.x, editSnap), y: snapValueToStep(rawLocal.y, editSnap) }
          : rawLocal;
      if (toolMode === "pen") {
        if (!editPath || !editOrigin) return; // silent: need a focused frame
        penPointerDown(snappedLocal);
        try {
          worldSvgRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* ignore — drag still proceeds via this element's own listeners */
        }
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
          try {
            worldSvgRef.current?.setPointerCapture(e.pointerId);
          } catch {
            /* ignore — drag still proceeds via this element's own listeners */
          }
          return;
        }
        const layerHit = hitLayerAtWorld(p);
        if (layerHit) {
          // Click a shape → that layer's vector network
          selectOwnedLayer(layerHit);
          setWorldSelectedIds(layerHit.frameId === PAGE_ROOT_ID ? [] : [layerHit.frameId]);
          useEditorStore.getState().clearSelection?.();
          try {
            worldSvgRef.current?.setPointerCapture(e.pointerId);
          } catch {
            /* ignore — drag still proceeds via this element's own listeners */
          }
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
        try {
          worldSvgRef.current?.setPointerCapture(e.pointerId);
        } catch {
          /* ignore — drag still proceeds via this element's own listeners */
        }
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
          const hitKey = `${layerHit.frameId}:${String(layerHit.layerId)}`;
          if (additive && selectionKind === "layer") {
            const next = selectedLayerRefKeys.has(hitKey)
              ? selectedLayerRefs.filter(
                  (ref) => `${ref.ownerId}:${String(ref.layerId)}` !== hitKey,
                )
              : [
                  ...selectedLayerRefs,
                  { ownerId: layerHit.frameId, layerId: layerHit.layerId },
                ];
            selectLayerRefs(next);
          } else {
            // Grabbing any member of an existing multi-selection moves the group.
            if (!selectedLayerRefKeys.has(hitKey)) selectOwnedLayer(layerHit);
            layerDragRef.current = beginObjectDrag(p);
          }
          setWorldSelectedIds(layerHit.frameId === PAGE_ROOT_ID ? [] : [layerHit.frameId]);
          try {
            worldSvgRef.current?.setPointerCapture(e.pointerId);
          } catch {
            /* ignore — drag still proceeds via this element's own listeners */
          }
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
            try {
              worldSvgRef.current?.setPointerCapture(e.pointerId);
            } catch {
              /* ignore — drag still proceeds via this element's own listeners */
            }
            return;
          }
          setWorldSelectedIds([...new Set([...worldSelectedIds, hitId])]);
          selectFrame(hitId);
          try {
            worldSvgRef.current?.setPointerCapture(e.pointerId);
          } catch {
            /* ignore — drag still proceeds via this element's own listeners */
          }
          return;
        }
        // Start layer marquee (selection updates live while dragging)
        if (!additive) {
          setWorldSelectedIds([hitId]);
        }
        marqueeLayerBaseRef.current = additive ? selectedLayerRefs : [];
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
      try {
        worldSvgRef.current?.setPointerCapture(e.pointerId);
      } catch {
        /* ignore — drag still proceeds via this element's own listeners */
      }
    },
    [
      worldPointFromEvent,
      hitArtboard,
      hitLayerAtWorld,
      selectOwnedLayer,
      selectLayerRefs,
      beginObjectDrag,
      toolMode,
      isObjectTool,
      isPointTool,
      selectFrame,
      selectLayer,
      selectLayers,
      selectedFrameId,
      selectedLayerIds,
      selectedLayerRefs,
      selectedLayerRefKeys,
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

      // ObjectDragGesture owns transaction, clone, constraints, snapping, delta,
      // cancel, and owner-aware commit. React only forwards world coordinates.
      if (layerDragRef.current) {
        layerDragRef.current.update(p, {
          shift: e.shiftKey,
          alt: e.altKey,
          bypassSnap: e.metaKey || e.ctrlKey,
        });
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
        syncActiveOwner();
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
        syncActiveOwner();
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
          if (dragDist >= worldPerPx * 4) {
            const hits = collectOwnedLayersInRect(sceneOwners, {
              x: minX,
              y: minY,
              w: maxX - minX,
              h: maxY - minY,
            });
            const byKey = new Map<string, LayerSelectionRef>();
            for (const ref of [...marqueeLayerBaseRef.current, ...hits]) {
              byKey.set(`${ref.ownerId}:${String(ref.layerId)}`, ref);
            }
            const next = [...byKey.values()];
            if (next.length > 0) {
              selectLayerRefs(next);
              setWorldSelectedIds(
                Array.from(
                  new Set(
                    next
                      .map((ref) => ref.ownerId)
                      .filter((ownerId) => ownerId !== PAGE_ROOT_ID),
                  ),
                ),
              );
            } else {
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
      selectOwnedLayer,
      hoveredFrameId,
      hoveredLayerKey,
      penPointerDrag,
      selectFrame,
      selectLayer,
      selectedFrameId,
      editSnap,
      syncActiveOwner,
      sceneOwners,
      selectLayerRefs,
    ],
  );

  const handleWorldPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const objectDrag = layerDragRef.current;
      const layerTransform = layerResizeRef.current ?? layerRotateRef.current;
      const hadLayerGesture = !!(
        objectDrag ||
        layerResizeRef.current ||
        layerRotateRef.current
      );
      layerDragRef.current = null;
      layerResizeRef.current = null;
      layerRotateRef.current = null;
      setSmartGuides([]);
      if (hadLayerGesture) {
        try {
          worldSvgRef.current?.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      if (objectDrag) {
        const end = worldPointFromEvent(e.clientX, e.clientY);
        if (end) objectDrag.finish(end);
        else objectDrag.cancel();
      }
      if (layerTransform?.moved) syncActiveOwner(true);
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
      syncActiveOwner,
    ],
  );

  const handleWorldPointerCancel = useCallback(
    (e: React.PointerEvent) => {
      cancelObjectDrag();
      cancelLayerTransform();
      pointDragRef.current = null;
      pointDragMovedRef.current = false;
      setIsWorldPanning(false);
      setMarquee(null);
      setSmartGuides([]);
      try {
        worldSvgRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        /* Pointer capture may already be gone on native cancellation. */
      }
    },
    [cancelLayerTransform, cancelObjectDrag],
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
        selectOwnedLayer(layerHit);
        setWorldSelectedIds(layerHit.frameId === PAGE_ROOT_ID ? [] : [layerHit.frameId]);
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
      selectOwnedLayer,
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
      // Escape cancels an in-flight object transaction before changing selection.
      // The rollback restores the pre-drag document and removes its undo entry.
      if (e.key === "Escape" && layerDragRef.current) {
        e.preventDefault();
        cancelObjectDrag();
        return;
      }
      if (
        e.key === "Escape" &&
        (layerResizeRef.current || layerRotateRef.current)
      ) {
        e.preventDefault();
        cancelLayerTransform();
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
    cancelObjectDrag,
    cancelLayerTransform,
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
                    onPointerCancel={handleWorldPointerCancel}
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
                              layerDragRef.current &&
                              selectedLayerRefs.some((ref) => ref.ownerId === frame.id)
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
                              selectedLayerRefKeys.has(`${frame.id}:${String(draw.id)}`);
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
                                    strokeWidth={
                                      draw.strokeWidth || Math.max(0.8, Math.min(2.2, b.w / 24))
                                    }
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
                    {/* Page-root vectors live directly in world coordinates and are never clipped. */}
                    {pageRootDraws.map((draw) => {
                      const gradId = draw.fillGradient
                        ? `${gradientDomId(PAGE_ROOT_ID)}-${draw.id}`
                        : null;
                      const selected =
                        hasCanvasSelection &&
                        selectedLayerRefKeys.has(`${PAGE_ROOT_ID}:${String(draw.id)}`);
                      const hovered = hoveredLayerKey === `${PAGE_ROOT_ID}:${draw.id}` && !selected;
                      const bounds = hovered && draw.d ? boundsFromPathD(draw.d) : null;
                      const transform = [
                        draw.translateX || draw.translateY
                          ? `translate(${draw.translateX || 0} ${draw.translateY || 0})`
                          : "",
                        draw.rotation ? `rotate(${draw.rotation})` : "",
                      ]
                        .filter(Boolean)
                        .join(" ");
                      return (
                        <g key={`root-${draw.id}`} transform={transform || undefined}>
                          {draw.fillGradient && gradId && (
                            <defs
                              dangerouslySetInnerHTML={{
                                __html: gradientToSvg(draw.fillGradient, gradId, draw.fillOpacity),
                              }}
                            />
                          )}
                          <path
                            d={draw.d}
                            fill={gradId ? `url(#${gradId})` : (draw.fill ?? "none")}
                            fillOpacity={gradId ? 1 : draw.fillOpacity}
                            fillRule={draw.fillType === "evenOdd" ? "evenodd" : "nonzero"}
                            stroke={
                              draw.stroke ?? (draw.fill || draw.fillGradient ? "none" : "#111111")
                            }
                            strokeOpacity={draw.strokeOpacity}
                            strokeWidth={draw.strokeWidth || worldPerPx}
                            vectorEffect="non-scaling-stroke"
                            pointerEvents="none"
                          />
                          {bounds && (
                            <rect
                              x={bounds.x}
                              y={bounds.y}
                              width={bounds.w}
                              height={bounds.h}
                              fill="none"
                              stroke="#0d99ff"
                              strokeOpacity={0.55}
                              strokeWidth={worldPerPx}
                              vectorEffect="non-scaling-stroke"
                              pointerEvents="none"
                            />
                          )}
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

                    {/* One world-space group box when selection spans owners. */}
                    {!isPlaying &&
                      isObjectTool &&
                      hasCanvasSelection &&
                      selectedLayerOwnerCount > 1 &&
                      documentSelectionBounds && (
                        <rect
                          x={documentSelectionBounds.x}
                          y={documentSelectionBounds.y}
                          width={Math.max(0.01, documentSelectionBounds.w)}
                          height={Math.max(0.01, documentSelectionBounds.h)}
                          fill="none"
                          stroke="#0d99ff"
                          strokeWidth={1.5}
                          vectorEffect="non-scaling-stroke"
                          pointerEvents="none"
                        />
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
                      selectedLayerOwnerCount <= 1 &&
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
                          try {
                            worldSvgRef.current?.setPointerCapture(e.pointerId);
                          } catch {
                            /* ignore — drag still proceeds via this element's own listeners */
                          }
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
                          try {
                            worldSvgRef.current?.setPointerCapture(e.pointerId);
                          } catch {
                            /* ignore — drag still proceeds via this element's own listeners */
                          }
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
                                    try {
                                      worldSvgRef.current?.setPointerCapture(e.pointerId);
                                    } catch {
                                      /* ignore — drag still proceeds via this element's own listeners */
                                    }
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

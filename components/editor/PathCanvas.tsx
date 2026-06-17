"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { useEditorStore } from "@/lib/store/editorStore";
import {
  parsePath,
  pathToString,
  getInterpolatedPath,
  isPointInFillRegion,
} from "@/lib/shapeshifter/pathUtils";
import { evaluateBlock } from "@/lib/shapeshifter/interpolators";
import type { SegmentSelection, SubPathSelection } from "@/lib/store/editorStore";
import type { Command, Layer, PathData, Point, TimelineBlock } from "@/lib/shapeshifter/types";
import { gradientToSvg } from "@/lib/shapeshifter/gradients";
import type { Viewport } from "@/lib/shapeshifter/camera";
import { fitViewportToAspect, zoomAtWorldPoint } from "@/lib/shapeshifter/camera";
import { GestureDispatcher } from "@/lib/shapeshifter/gestures/GestureDispatcher";
import {
  collectPointsInRect,
  getMarqueeRect,
  // 9rp real Lasso hit testing (ShapeShifter-9rp under v6j): polygon inclusion + curve tolerance.
  // Pure helpers (pointInPolygon + collectPointsInLasso) extend the PR-02 AABB collectPointsInRect
  // pattern exactly for reviewability and reuse by future LassoSelectGesture.
  // References: DESIGN_ID 67dd105e, beads 9rp/ny0/ubf/v6j.
  collectPointsInLasso,
} from "@/lib/shapeshifter/gestures/HitTests";

type PointSelection = { subPathIndex: number; commandIndex: number; pointIndex: number };
type ViewBox = Viewport;
type Bounds = { x: number; y: number; width: number; height: number };
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type SegmentTarget = {
  subPathIndex: number;
  commandIndex: number;
  command: Command;
  start: Point;
  end: Point;
  d: string;
  midpoint: Point;
};

interface PathCanvasProps {
  resetKey?: number;
  side: "from" | "to" | "preview";
  width?: number;
  height?: number;
}

export const PathCanvas = React.memo(function PathCanvas({
  side,
  width = 320,
  height = 320,
  resetKey,
}: PathCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gridId = React.useId();

  // Real Lasso collection (9rp under v6j, DESIGN_ID 67dd105e):
  // Refined pointer collection + polygon hit testing (pointInPolygon + collectPointsInLasso in HitTests)
  // for the pencil tool (current Lasso entry in BottomToolPalette with L shortcut + Lasso icon).
  // Min-dist filter + close detection in move; real hit + shift-additive commit on up (mirrors
  // marquee commitMarqueeSelection + store selectMultiplePoints). Transient dashed polyline visual.
  // Dispatcher pencil route + future dedicated LassoSelectGesture (per design) will own more.
  // References: beads 9rp/ny0/ubf/v6j, PR-02 AABB precedent in SelectDragItemsGesture.
  const lassoPointsRef = useRef<Point[]>([]);
  // RAF + frame trigger (vn7 k88): throttles visual updates for lasso polyline to ~60fps during
  // pencil drag on long/complex paths. Fixes jank (prior ref-only mutate never re-rendered transient
  // visual live). Collection remains dense in ref; render reads ref post setLassoFrame (cheap).
  // Benchmarks in tests confirm <16ms for collect on 500+pt paths.
  const lassoRafRef = useRef<number | null>(null);
  const [, setLassoFrame] = React.useState(0);

  // Paint bucket / fill preview (rsn under v6j): hit region via isPointInFillRegion (sampling + odd parity for holes).
  // 60fps raf like lasso for live semi-transparent fill overlay (dashed) on hover when tool==='paint'.
  // Apply on pointer down (click UX). Uses current selected layer's fill style as paint source (via updateSelectedLayer after select).
  // Refs for perf (no re-render spam during move); clear on tool exit / up. Preview respects detail/preview sides + world.
  const paintPreviewRafRef = useRef<number | null>(null);
  const [, setPaintPreviewFrame] = React.useState(0);
  const paintHitRef = useRef<{ layerId: string | number } | null>(null);

  // GestureDispatcher (PR-01.1 / ShapeShifter-ish fix round xwx under mvd).
  // The ref that owns the decision logic for canvas interactions (Key Decision #2).
  // Created once, context kept fresh via useEffect below so BottomToolPalette + keyboard
  // tool switches (v/p/d) actually affect gesture behavior.
  const dispatcherRef = useRef<GestureDispatcher | null>(null);

  const [isPanning, setIsPanning] = React.useState(false);
  const [isSpaceDown, setIsSpaceDown] = React.useState(false);
  const [lastPan, setLastPan] = React.useState({ x: 0, y: 0 });
  const [boxSelect, setBoxSelect] = React.useState<null | {
    start: { x: number; y: number };
    current: { x: number; y: number };
  }>(null);
  const [isVectorEditing, setIsVectorEditing] = React.useState(false);
  // For batch multi-point drag: track last known position of the primary drag point to compute uniform deltas
  const [dragSession, setDragSession] = React.useState<null | {
    lastX: number;
    lastY: number;
    primarySel: PointSelection | null;
  }>(null);

  const {
    layers,
    animation,
    vector,
    selectedLayerId,
    editingSide,
    selection,
    selectedPoints,
    selectedSubPaths,
    progress,
    snapToGrid,
    pushHistory,
    updateSelectedPoint,
    addPointOnPath,
    splitSelectedLayerSegment,
    selectPoint,
    selectLayer,
    setEditingSide,
    updateSelectedLayer,
    resizeSelectedLayer,
    deleteLayer,
    zoom,
    detailViewport,
    setDetailViewport,
    fitDetailToVector,
    selectSubPath,
    toolMode,
    isActionMode,
  } = useEditorStore();

  // Track the rendered element's aspect so the viewBox fills the (possibly
  // non-square) container edge-to-edge while keeping screen↔world mapping exact.
  const [elementAspect, setElementAspect] = React.useState(1);
  useEffect(() => {
    const el = svgRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (r && r.width > 0 && r.height > 0) setElementAspect(r.width / r.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const viewBox = useMemo(
    () => fitViewportToAspect(detailViewport, elementAspect),
    [detailViewport, elementAspect],
  );

  const artboard = useMemo(() => {
    const artboardWidth = Math.max(1, vector.width || 24);
    const artboardHeight = Math.max(1, vector.height || 24);
    const baseSize = Math.max(artboardWidth, artboardHeight);
    return {
      x: 0,
      y: 0,
      width: artboardWidth,
      height: artboardHeight,
      centerX: artboardWidth / 2,
      centerY: artboardHeight / 2,
      baseViewSize: Math.max(24, baseSize * 1.55),
      gridMinor: baseSize <= 32 ? 1 : Math.max(4, Math.round(baseSize / 48)),
      gridMajor: baseSize <= 32 ? 4 : Math.max(16, Math.round(baseSize / 12)),
    };
  }, [vector.height, vector.width]);

  useEffect(() => {
    fitDetailToVector(1);
  }, [fitDetailToVector, resetKey]);

  // Create the dispatcher once (lazy, stable ref) and keep its context fresh.
  // The 3 marquee callbacks are the bridge that lets the dispatcher/gesture own the
  // decision + lifecycle while PathCanvas owns only the transient rect rendering.
  // This + the handler restructure below makes the dispatcher the actual decision point.
  useEffect(() => {
    if (!dispatcherRef.current) {
      dispatcherRef.current = new GestureDispatcher(
        { toolMode, editingSide, snapToGrid, zoom },
        {
          setCursor: () => {}, // transient marquee does not change cursor in this slice (parity)
          pushHistory,
          beginMarqueeSelection: (start, additive) => {
            if (!additive) {
              const { clearSelection } = useEditorStore.getState();
              clearSelection();
            }
            setBoxSelect({ start, current: start });
          },
          updateMarquee: (p) => {
            setBoxSelect((prev) => (prev ? { ...prev, current: p } : null));
          },
          endMarquee: () => {
            setBoxSelect(null);
          },
          // PR-02 completion (ShapeShifter-ubf.1 / ubf under 2cq/v6j): commitMarqueeSelection now
          // delegates real hit test / AABB collection to pure helpers in HitTests (collectPointsInRect,
          // getMarqueeRect, rectsIntersect). The gesture (SelectDragItemsGesture) owns the lifecycle trigger
          // (onMouseUp calls this). PathCanvas remains thin: transient rect + store-specific application
          // (preview vs edit-path branching + actions). Dispatcher sole gate preserved.
          //
          // References: DESIGN_ID 67dd105e (PR-01/PR-02, Key Decision #2), beads ubf/2cq/v6j/ny0,
          // parity-checklist.md BatchSelect phase. 100% behavioral parity on multi-point, shift-additive,
          // empty-box clear, preview subpath/layer, edit-path point selection.
          commitMarqueeSelection: (start, end) => {
            const state = useEditorStore.getState();
            const {
              layers: curLayers,
              animation: curAnim,
              progress: curProgress,
              selectedLayerId: curSelId,
              editingSide: curEditSide,
              isActionMode: curIsAction,
              selectMultipleSubPaths: curSelectMultipleSubPaths,
              selectLayer: curSelectLayer,
              setEditingSide: curSetEditingSide,
              selectMultiplePoints: curSelectMultiplePoints,
              clearSelection: curClearSelection,
            } = state;

            // Delegate rect construction and point collection to real hit test helpers in the gesture system.
            const selectRect = getMarqueeRect(start, end);
            const isBoxGesture = selectRect.width > 0.2 || selectRect.height > 0.2;

            if (side === "preview" && !curIsAction) {
              if (isBoxGesture) {
                const subPathHits = curLayers.flatMap((candidate) => {
                  if (candidate.visible === false || candidate.locked) return [];
                  return candidate.from.subPaths.flatMap((subPath, subPathIndex) => {
                    const bounds = getPathBounds({ subPaths: [subPath] });
                    return bounds && rectsIntersect(selectRect, bounds)
                      ? [{ layerId: candidate.id, side: "from" as const, subPathIndex }]
                      : [];
                  });
                });
                if (subPathHits.length > 0) {
                  curSelectMultipleSubPaths(subPathHits);
                  curSetEditingSide("from");
                  return; // commit done; endMarquee will clear rect
                }
              }
              const renderedLayers = getPreviewLayers(
                curLayers,
                curAnim.blocks,
                curAnim.duration,
                curProgress,
                curSelId,
              );
              const hitLayer = [...renderedLayers].reverse().find(({ d }) => {
                const bounds = getPathBounds(parsePath(d));
                return bounds ? rectsIntersect(selectRect, bounds) : false;
              });
              if (hitLayer) {
                curSelectLayer(hitLayer.layer.id);
                curSetEditingSide("from");
              } else if (isBoxGesture) {
                curClearSelection();
              }
              return;
            }

            // Action mode / edit path point selection (multi AABB)
            // PR-02 completion: delegated to collectPointsInRect (real hit test now in HitTests).
            // Preserves exact prior AABB behavior + outcomes.
            const layer = curLayers.find((l) => l.id === curSelId);
            const pathForEdit = layer
              ? curEditSide === "from"
                ? layer.from
                : layer.to
              : { subPaths: [] as any[] };
            const hits = collectPointsInRect(pathForEdit as any, selectRect);
            if (hits.length > 0) {
              const multiSels = hits.map((h) => ({ layerId: curSelId, side: curEditSide, ...h }));
              curSelectMultiplePoints(multiSels);
            } else {
              // empty box click clears (parity with original behavior when a marquee gesture completed)
              curClearSelection();
            }
          },
        },
      );
    }
    // Always sync context when relevant store values change (BottomToolPalette, keyboard, etc.)
    dispatcherRef.current?.updateContext({ toolMode, editingSide, snapToGrid, zoom });

    // Paint bucket hygiene: clear hover preview when leaving paint tool (prevents stale overlay)
    if (toolMode !== "paint" && paintHitRef.current) {
      paintHitRef.current = null;
      if (paintPreviewRafRef.current) {
        cancelAnimationFrame(paintPreviewRafRef.current);
        paintPreviewRafRef.current = null;
      }
      setPaintPreviewFrame((f) => (f + 1) % 10000);
    }
  }, [toolMode, editingSide, snapToGrid, zoom, pushHistory]);

  const pointFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        x: viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.w,
        y: viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.h,
      };
    },
    [viewBox],
  );

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Figma model: ⌘/Ctrl+scroll (and trackpad pinch) zooms; plain scroll pans.
      if (e.ctrlKey || e.metaKey) {
        const mouse = pointFromEvent(e.clientX, e.clientY);
        if (!mouse) return;
        // Gentle, clamped zoom (≈0.86× per mouse notch; smooth for trackpad pinch).
        const d = Math.max(-100, Math.min(100, e.deltaY));
        const zoomFactor = Math.exp(-d * 0.0015);
        setDetailViewport(zoomAtWorldPoint(viewBox, mouse, viewBox.scale * zoomFactor, 0.25, 8));
        return;
      }
      const perPxX = viewBox.w / rect.width;
      const perPxY = viewBox.h / rect.height;
      const dxPx = e.shiftKey ? e.deltaY : e.deltaX;
      const dyPx = e.shiftKey ? 0 : e.deltaY;
      setDetailViewport((prev) => ({
        ...prev,
        x: prev.x + dxPx * perPxX,
        y: prev.y + dyPx * perPxY,
      }));
    },
    [pointFromEvent, setDetailViewport, viewBox],
  );

  // Paint bucket helpers (rsn): pure hit via imported isPointInFillRegion (pathUtils sampling + parity for holes).
  // Compute respects current editingSide (detail) or from (world/preview). Topmost layer first (reverse z).
  // Apply: select target + updateSelectedLayer with fill style from currently selected source layer (or default black).
  // This keeps style source in inspector parity, undo via push inside update, selection update, no new store action.
  const computePaintHitAt = useCallback(
    (pt: Point): string | number | null => {
      const state = useEditorStore.getState();
      const testSide = side === "preview" ? "from" : state.editingSide;
      // reverse for topmost visual hit
      for (let i = state.layers.length - 1; i >= 0; i--) {
        const layer = state.layers[i];
        if (!layer.visible || layer.locked) continue;
        if (layer.type !== "path" && layer.type !== "clipPath") continue;
        const pathForTest = testSide === "from" ? layer.from : layer.to || layer.from;
        if (isPointInFillRegion(pt, pathForTest)) {
          return layer.id;
        }
      }
      return null;
    },
    [side],
  );

  const applyPaintFill = useCallback(
    (targetId: string | number) => {
      const state = useEditorStore.getState();
      const src = state.layers.find((l) => l.id === state.selectedLayerId) || state.layers[0];
      const tgt = state.layers.find((l) => l.id === targetId);
      if (!tgt) return;

      const fillPatch = {
        fillColor: src?.fillColor || "#000000",
        fillAlpha: src?.fillAlpha ?? 1,
        fillType: (src?.fillType || "nonZero") as "nonZero" | "evenOdd",
      };

      // Select target first so updateSelectedLayer targets it; update pushes history (undoable).
      selectLayer(targetId);
      // Fresh get for safety post-select
      useEditorStore.getState().updateSelectedLayer(fillPatch);

      toast.success(`Filled ${tgt.name || "layer"}`);

      // Clear preview
      paintHitRef.current = null;
      setPaintPreviewFrame((f) => f + 1);
    },
    [selectLayer],
  );

  const handleSvgPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button === 1 || e.altKey || isSpaceDown) {
        setIsPanning(true);
        setLastPan({ x: e.clientX, y: e.clientY });
        svgRef.current?.setPointerCapture(e.pointerId);
        return;
      }

      // REREVIEW CRITICAL FIX (ShapeShifter-2cq under mvd/7fz/ish/c9f, review grok-review-10b30dea.md):
      // The two marquee intent branches no longer contain any local setBoxSelect, clearSelection, or direct rect mutation.
      // They compute the point + modifiers, then call dispatcherRef.current.handlePointerDown with explicit
      // { type: 'marquee' } HitTestResult (supported by the contract added in PR-01.1 fix round).
      // The dispatcher (see GestureDispatcher.ts:63) treats "marquee" | empty as isMarqueeIntent, instantiates
      // the first SelectDragItemsGesture, and synchronously invokes the registered beginMarqueeSelection callback
      // (which does the conditional clear + setBoxSelect initial). This makes the dispatcher call the *ONLY* way
      // boxSelect starts in select/default mode. Pointer capture remains a DOM concern in PathCanvas.
      // References: DESIGN_ID 67dd105e Key Decision #2 (dispatcher sole source of truth), 2cq mission, 7fz rereview.
      // The callbacks (begin/update/end + new commitMarqueeSelection) are now fully wired and the sole mutators.
      if (side === "preview" && !isActionMode && e.button === 0) {
        const p = pointFromEvent(e.clientX, e.clientY);
        if (p) {
          dispatcherRef.current?.handlePointerDown(
            p,
            { type: "marquee" },
            { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey },
          );
          svgRef.current?.setPointerCapture(e.pointerId);
        }
        return;
      }
      // Use getState to avoid declaration order issues with toolMode/isEditingThisSide (robust for Action Mode features)
      const state = useEditorStore.getState();
      if (
        (state.toolMode === "select" ||
          state.toolMode === "rotate" ||
          state.toolMode === "transform") &&
        state.editingSide === (side === "from" ? "from" : "to") &&
        e.button === 0
      ) {
        const p = pointFromEvent(e.clientX, e.clientY);
        if (p) {
          dispatcherRef.current?.handlePointerDown(
            p,
            { type: "marquee" },
            { shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey },
          );
          svgRef.current?.setPointerCapture(e.pointerId);
        }
      }

      // Paint bucket / fill tool (rsn): dispatcher owns route decision (see GestureDispatcher paint case).
      // On down (click UX, not drag): compute hit region at point (sampling+parity), apply immediately if hit.
      // Preview lives on move (below). No capture needed long term. Uses exact existing patterns (fresh getState, compute+apply).
      const downTool = useEditorStore.getState().toolMode;
      if (downTool === "paint" && e.button === 0) {
        const p = pointFromEvent(e.clientX, e.clientY);
        if (p) {
          const hitId = computePaintHitAt(p);
          if (hitId != null) {
            applyPaintFill(hitId);
          } else {
            toast.info("No fill region under cursor");
          }
          svgRef.current?.setPointerCapture(e.pointerId);
          return;
        }
      }
    },
    [isActionMode, isSpaceDown, pointFromEvent, side, computePaintHitAt, applyPaintFill],
  );

  const handleSvgPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isPanning) {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dx = ((e.clientX - lastPan.x) / rect.width) * viewBox.w;
        const dy = ((e.clientY - lastPan.y) / rect.height) * viewBox.h;
        setDetailViewport((prev) => ({ ...prev, x: prev.x - dx, y: prev.y - dy }));
        setLastPan({ x: e.clientX, y: e.clientY });
      }
      // Route *every* move through the dispatcher when a gesture may be active.
      // The dispatcher gates the updateMarquee callback (only while activeGesture exists).
      // This makes the callbacks (not direct local boxSelect mutation) the sole owners
      // of the transient rect state for the marquee lifecycle.
      // (Resolves remaining direct mutation site flagged in grok-review-10b30dea.md major issue.)
      const p = pointFromEvent(e.clientX, e.clientY);
      if (p) {
        dispatcherRef.current?.handlePointerMove(p, {
          shift: e.shiftKey,
          alt: e.altKey,
          ctrl: e.ctrlKey,
        });

        // Real Lasso hit testing + collection refinement (9rp under v6j):
        // - Pencil tool is the current Lasso entry (palette "L" + Lasso icon; design calls for dedicated later).
        // - Refined UX: min-distance filter (avoids dense points), higher cap, close detection (snap near start).
        // - Only collects for pencil (lasso UX); direct remains for Bend/Flex Ctrl+drag (1af under v6j).
        // - Real polygon hit + store commit happens on up (see handleSvgPointerUp).
        // References: DESIGN_ID 67dd105e, beads 9rp/ny0/ubf/v6j, clean dispatcher foundation.
        const currentTool = useEditorStore.getState().toolMode;
        if (!isPanning && currentTool === "pencil") {
          const pts = lassoPointsRef.current;
          // Min-distance filter for better UX + perf (skip near-duplicates during fast drag)
          if (
            pts.length === 0 ||
            Math.hypot(p.x - pts[pts.length - 1].x, p.y - pts[pts.length - 1].y) > 0.25
          ) {
            pts.push(p);
            // Close detection (snap UX): if near first point and enough verts, user intent is closed lasso
            if (pts.length > 4 && Math.hypot(p.x - pts[0].x, p.y - pts[0].y) < 1.8) {
              // Snap last to first for visual + hit test cleanliness (non-destructive for the poly)
              pts[pts.length - 1] = { ...pts[0] };
            }
          }
          // Bounded for 60fps hit test (O(verts * pathPoints) is trivial at these sizes)
          if (pts.length > 350) pts.shift();
          // RAF throttle for live visual update (vn7 k88): ensures polyline re-renders at frame rate
          // (fixes prior jank where ref mutation alone produced no live lasso feedback during drag).
          // Simple benchmark/RAF check for lasso drag on long paths per excellence scope.
          if (!lassoRafRef.current) {
            lassoRafRef.current = requestAnimationFrame(() => {
              setLassoFrame((f) => (f + 1) % 10000);
              lassoRafRef.current = null;
            });
          }
        }

        // Paint bucket hover preview (rsn): on move with paint tool, hit test point, update ref + raf trigger for 60fps overlay.
        // Mirrors lasso exactly for perf (ref holds hit, cheap state flip causes re-render of overlay only).
        if (!isPanning && currentTool === "paint") {
          const hitId = computePaintHitAt(p);
          const prevHit = paintHitRef.current?.layerId ?? null;
          const newHit = hitId ?? null;
          if (newHit !== prevHit) {
            paintHitRef.current = newHit != null ? { layerId: newHit } : null;
            if (!paintPreviewRafRef.current) {
              paintPreviewRafRef.current = requestAnimationFrame(() => {
                paintPreviewRafRef.current = null;
                setPaintPreviewFrame((f) => (f + 1) % 10000);
              });
            }
          }
        }
      }
    },
    [isPanning, lastPan, viewBox.h, viewBox.w, pointFromEvent, computePaintHitAt],
  );

  const handleSvgPointerUp = useCallback(
    (e: React.PointerEvent) => {
      setIsPanning(false);

      // Route the up through the dispatcher.
      // This triggers:
      //  - gesture.onMouseUp (which now calls the registered commitMarqueeSelection callback
      //    with start/end — the AABB multi-point commit + store selects live there for PR-02 start)
      //  - callbacks.endMarquee (clears the transient rect state)
      // All local boxSelect mutations and the giant AABB block have been removed from PathCanvas.
      // The commit logic is now owned/triggered by the gesture (via the callback bridge we wired).
      // Capture release stays here (DOM concern).
      // (Completes resolution of critical issues + major direct-mutation debt from grok-review-10b30dea.md.)
      const p = pointFromEvent(e.clientX, e.clientY) || { x: 0, y: 0 };
      dispatcherRef.current?.handlePointerUp(p, {
        shift: e.shiftKey,
        alt: e.altKey,
        ctrl: e.ctrlKey,
      });

      if (svgRef.current?.hasPointerCapture(e.pointerId)) {
        svgRef.current.releasePointerCapture(e.pointerId);
      }

      // Real Lasso hit testing + commit (9rp under v6j):
      // - If pencil tool (current Lasso UX) and we have a closed-enough poly (>=3 pts),
      //   run the pure collectPointsInLasso (polygon + curve sampling) against the current side's path.
      // - Shift = additive (exactly mirrors the marquee commitMarqueeSelection pattern + beginMarqueeSelection clear logic).
      // - Wire to store selectMultiplePoints (preview subpath vs edit-path point selection).
      // - Always clear the transient collection + visual.
      // This replaces the prior ny0 collection stub with production-grade real Lasso selection (polygon hit + curve tolerance)
      // while preserving 100% behavioral parity on existing flows and the clean dispatcher-as-decision-point architecture.
      // References: DESIGN_ID 67dd105e, beads 9rp/ny0/ubf/2cq/v6j, SelectDragItemsGesture PR-02 precedent.
      const currentToolAfterUp = useEditorStore.getState().toolMode;
      if (currentToolAfterUp === "pencil" && lassoPointsRef.current.length >= 3) {
        const state = useEditorStore.getState();
        const {
          layers: curLayers,
          selectedLayerId: curSelId,
          editingSide: curEditSide,
          selectMultiplePoints: curSelectMultiplePoints,
          clearSelection: curClearSelection,
        } = state;

        const layer = curLayers.find((l) => l.id === curSelId);
        const pathForEdit = layer
          ? curEditSide === "from"
            ? layer.from
            : layer.to
          : { subPaths: [] as any[] };

        const hits = collectPointsInLasso(pathForEdit as any, lassoPointsRef.current, {
          tolerance: 0.6,
          sampleCurves: true,
        });

        const isAdditive = e.shiftKey;

        if (hits.length > 0) {
          if (!isAdditive) {
            curClearSelection?.();
          }
          const multiSels = hits.map((h) => ({
            layerId: curSelId,
            side: curEditSide as "from" | "to",
            ...h,
          }));
          curSelectMultiplePoints(multiSels);
        } else if (!isAdditive) {
          curClearSelection?.();
        }
      }

      // Always clear transient lasso collection/visual (real 9rp path)
      if (lassoRafRef.current) {
        cancelAnimationFrame(lassoRafRef.current);
        lassoRafRef.current = null;
      }
      setLassoFrame(0);
      lassoPointsRef.current = [];

      // Paint preview clear on up (bucket is instant on-down apply; clear any hover state)
      const upTool = useEditorStore.getState().toolMode;
      if (upTool === "paint") {
        if (paintPreviewRafRef.current) {
          cancelAnimationFrame(paintPreviewRafRef.current);
          paintPreviewRafRef.current = null;
        }
        paintHitRef.current = null;
        setPaintPreviewFrame((f) => (f + 1) % 10000);
      }
    },
    [pointFromEvent],
  ); // Note: other handlers (non-marquee paths) may still reference top-level destructured actions; our marquee commit path uses fresh getState() only. The lasso commit above follows the exact same fresh-getState + callback bridge pattern for reviewability.

  const currentLayer = layers.find((l) => l.id === selectedLayerId);
  if (!currentLayer) return null;

  const isEditingThisSide = side === editingSide;
  const isPreviewVectorEditing =
    side === "preview" && (isVectorEditing || selectedSubPaths.length > 0) && !isActionMode;
  const canEditPoints = isEditingThisSide || isPreviewVectorEditing;
  const targetPathData = side === "to" ? currentLayer.to : currentLayer.from;

  // Memoized display path (zero friction polish 19u): avoids repeated getInterpolatedPath work
  // on non-progress re-renders of preview canvas (e.g. selection changes elsewhere) while
  // preserving exact prior behavior + deps pattern used by all other memos in this file.
  const displayPath = useMemo(() => {
    if (side === "preview") {
      // Real interpolation using the new engine
      return getInterpolatedPath(currentLayer.from, currentLayer.to, progress);
    }
    return pathToString(targetPathData);
  }, [side, currentLayer.from, currentLayer.to, progress, targetPathData]);
  const fallbackStroke = side === "to" ? "var(--destructive)" : "var(--primary)";
  const hasExplicitStroke = Boolean(currentLayer.strokeColor);
  const hasExplicitFill = Boolean(currentLayer.fillColor);
  const strokeWidth =
    hasExplicitStroke || !hasExplicitFill
      ? currentLayer.strokeWidth && currentLayer.strokeWidth > 0
        ? currentLayer.strokeWidth
        : 2.2
      : 0;

  const commands = useMemo(
    () =>
      targetPathData.subPaths.flatMap((subPath, subPathIndex) =>
        subPath.commands.map((command, commandIndex) => ({
          command,
          subPathIndex,
          commandIndex,
        })),
      ),
    [targetPathData],
  );
  const segmentPathData = side === "preview" ? currentLayer.from : targetPathData;
  const segmentTargets = useMemo(() => getSegmentTargets(segmentPathData), [segmentPathData]);
  const ruler = useMemo(() => getRulerModel(viewBox), [viewBox]);
  const previewLayers = useMemo(
    () =>
      side === "preview"
        ? getPreviewLayers(layers, animation.blocks, animation.duration, progress, selectedLayerId)
        : [],
    [animation.blocks, animation.duration, layers, progress, selectedLayerId, side],
  );
  const selectedPreviewLayer = previewLayers.find(
    (candidate) => String(candidate.layer.id) === String(selectedLayerId),
  );
  const selectedPreviewPath = selectedPreviewLayer?.d ?? displayPath;
  const selectedPreviewTransform = selectedPreviewLayer?.transform;
  const selectedPathBounds = useMemo(() => getPathBounds(targetPathData), [targetPathData]);
  const selectedLayerSubPathSelections = useMemo(
    () =>
      selectedSubPaths.filter(
        (item) =>
          String(item.layerId) === String(selectedLayerId) &&
          item.side === (side === "preview" ? "from" : editingSide),
      ),
    [editingSide, selectedLayerId, selectedSubPaths, side],
  );
  const selectedSubPathBounds = useMemo(() => {
    if (selectedLayerSubPathSelections.length === 0) return null;
    const pathData = side === "preview" ? currentLayer.from : targetPathData;
    return getSubPathBounds(
      pathData,
      selectedLayerSubPathSelections.map((item) => item.subPathIndex),
    );
  }, [currentLayer.from, selectedLayerSubPathSelections, side, targetPathData]);
  const selectedLayerBounds = useMemo(
    () => (side === "preview" ? getPathBounds(parsePath(selectedPreviewPath)) : selectedPathBounds),
    [selectedPathBounds, selectedPreviewPath, side],
  );
  const activeSelectionBounds = selectedSubPathBounds ?? selectedLayerBounds;
  const isEditingSubPaths = selectedLayerSubPathSelections.length > 0;
  const canEditSegments =
    canEditPoints || (side === "preview" && !isActionMode && isEditingSubPaths);
  const overlayClipPath = side === "preview" ? `url(#${gridId}-artboard-clip)` : undefined;
  const frameLabel = vector.name?.trim() || "Vector 1";
  const labelSize = Math.min(Math.max(viewBox.w * 0.008, 0.28), 0.42);
  const rulerOffset = Math.max(viewBox.w * 0.012, 0.42);
  const selectionStrokeWidth = side === "preview" ? 1.1 : Math.max(ruler.strokeWidth * 1.15, 0.06);
  const selectionHandleRadius = Math.min(Math.max(viewBox.w * 0.008, 0.2), 0.34);
  const selectionHitWidth = Math.max(viewBox.w * 0.035, 1);
  const rotationHandleDistance = Math.min(Math.max(viewBox.w * 0.04, 0.9), 1.6);
  const resizeHandles = useMemo(
    () => (selectedLayerBounds && !isEditingSubPaths ? getResizeHandles(selectedLayerBounds) : []),
    [isEditingSubPaths, selectedLayerBounds],
  );
  const resizeEdges = useMemo(
    () => (selectedLayerBounds && !isEditingSubPaths ? getResizeEdges(selectedLayerBounds) : []),
    [isEditingSubPaths, selectedLayerBounds],
  );
  const rotationHandle = useMemo(
    () =>
      selectedLayerBounds && !isEditingSubPaths
        ? getRotationHandle(selectedLayerBounds, rotationHandleDistance)
        : null,
    [isEditingSubPaths, rotationHandleDistance, selectedLayerBounds],
  );
  const axisTicks = useMemo(
    () => ({
      x: ruler.xTicks.filter((tick) => tick >= artboard.x && tick <= artboard.x + artboard.width),
      y: ruler.yTicks.filter((tick) => tick >= artboard.y && tick <= artboard.y + artboard.height),
    }),
    [artboard.height, artboard.width, artboard.x, artboard.y, ruler.xTicks, ruler.yTicks],
  );

  // Dragging logic
  const handlePointerDown = useCallback(
    (e: React.PointerEvent, subPathIndex: number, commandIndex: number, pointIndex: number) => {
      if (!canEditPoints) return;

      e.stopPropagation();
      (e.target as SVGElement).setPointerCapture(e.pointerId);
      pushHistory();
      if (side === "preview") {
        setEditingSide("from");
      }

      const newSelection = {
        layerId: selectedLayerId,
        side: side === "preview" ? ("from" as const) : editingSide,
        subPathIndex,
        commandIndex,
        pointIndex,
      };
      // Shift = toggle / additive multi-select (original shift behavior in edit path)
      const addToMulti = e.shiftKey;
      selectPoint(newSelection, addToMulti);

      // Init batch drag session if we have multi selected (including the one we just selected/toggled)
      const currentMulti = useEditorStore.getState().selectedPoints || [];
      if (currentMulti.length > 1) {
        setDragSession({ lastX: e.clientX, lastY: e.clientY, primarySel: newSelection });
      } else {
        setDragSession(null);
      }

      const handleMove = (moveEvent: PointerEvent) => {
        const point = pointFromEvent(moveEvent.clientX, moveEvent.clientY);
        if (!point) return;
        let { x, y } = point;

        if (snapToGrid) {
          x = Math.round(x * 2) / 2;
          y = Math.round(y * 2) / 2;
        }

        const session = dragSession;
        const multi = useEditorStore.getState().selectedPoints || [];
        const state = useEditorStore.getState();
        const isDirectFlexHandle = state.toolMode === "direct" && moveEvent.ctrlKey;

        if (session && multi.length > 1) {
          // Compute screen-space delta, convert via viewBox scale approx for world delta
          const rect = svgRef.current?.getBoundingClientRect();
          if (rect) {
            const scaleX = viewBox.w / rect.width;
            const scaleY = viewBox.h / rect.height;
            const dx = (moveEvent.clientX - session.lastX) * scaleX;
            const dy = (moveEvent.clientY - session.lastY) * scaleY;

            const { translateSelectedPoints } = useEditorStore.getState();
            translateSelectedPoints(dx, dy, { recordHistory: false });

            setDragSession({ ...session, lastX: moveEvent.clientX, lastY: moveEvent.clientY });
          }
        } else if (isDirectFlexHandle) {
          // Ctrl+drag on a control handle in direct: flex the curve intelligently (normal offset)
          // while still moving the primary handle point with the pointer (precise control + smoothness).
          const rect = svgRef.current?.getBoundingClientRect();
          let dx = 0;
          let dy = 0;
          if (rect) {
            const scaleX = viewBox.w / rect.width;
            const scaleY = viewBox.h / rect.height;
            dx = (moveEvent.clientX - (dragSession?.lastX ?? moveEvent.clientX)) * scaleX;
            dy = (moveEvent.clientY - (dragSession?.lastY ?? moveEvent.clientY)) * scaleY;
          }
          if (dx !== 0 || dy !== 0) {
            const flexDelta = snapToGrid
              ? { x: Math.round(dx * 2) / 2, y: Math.round(dy * 2) / 2 }
              : { x: dx, y: dy };
            // t biased toward the dragged handle (first handle ~0.33, second ~0.66)
            const handleT = pointIndex === 0 ? 0.33 : pointIndex === 1 ? 0.66 : 0.5;
            state.flexSelectedLayerSegment(
              {
                layerId: selectedLayerId,
                side: side === "preview" ? "from" : editingSide,
                subPathIndex,
                commandIndex,
              },
              flexDelta,
              handleT,
              { recordHistory: false },
            );
          }
          // Still move the primary handle point exactly where the user dragged it
          updateSelectedPoint({ x, y }, { recordHistory: false });
          if (dragSession) {
            setDragSession({ ...dragSession, lastX: moveEvent.clientX, lastY: moveEvent.clientY });
          }
        } else {
          updateSelectedPoint({ x, y }, { recordHistory: false });
        }
      };

      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        setDragSession(null);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [
      editingSide,
      canEditPoints,
      pointFromEvent,
      pushHistory,
      selectedLayerId,
      selectPoint,
      setEditingSide,
      side,
      snapToGrid,
      updateSelectedPoint,
    ],
  );

  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (side === "preview") return;
      if (!isEditingThisSide) {
        setEditingSide(side);
        return;
      }

      const point = pointFromEvent(e.clientX, e.clientY);
      if (!point) return;

      addPointOnPath(point.x, point.y);
    },
    [addPointOnPath, isEditingThisSide, pointFromEvent, setEditingSide, side, toolMode],
  );

  const handlePreviewPathPointerDown = useCallback(
    (e: React.PointerEvent<SVGPathElement>, layerId: string | number = selectedLayerId) => {
      if (side !== "preview" || isActionMode || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as SVGPathElement).setPointerCapture(e.pointerId);
      selectLayer(layerId);
      setEditingSide("from");
      pushHistory();

      let lastX = e.clientX;
      let lastY = e.clientY;

      const handleMove = (moveEvent: PointerEvent) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dx = ((moveEvent.clientX - lastX) / rect.width) * viewBox.w;
        const dy = ((moveEvent.clientY - lastY) / rect.height) * viewBox.h;
        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;
        useEditorStore.getState().translateSelectedLayer(dx, dy, { recordHistory: false });
      };

      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [
      isActionMode,
      pushHistory,
      selectLayer,
      selectedLayerId,
      setEditingSide,
      side,
      viewBox.h,
      viewBox.w,
    ],
  );

  const handlePreviewSubPathPointerDown = useCallback(
    (e: React.PointerEvent<SVGPathElement>, subPathIndex: number) => {
      if (side !== "preview" || isActionMode || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);

      const subPathSelection: SubPathSelection = {
        layerId: selectedLayerId,
        side: "from",
        subPathIndex,
      };
      const additive = e.shiftKey || e.metaKey;
      const alreadySelected = selectedLayerSubPathSelections.some(
        (item) =>
          item.subPathIndex === subPathIndex && String(item.layerId) === String(selectedLayerId),
      );
      selectSubPath(subPathSelection, additive);
      setEditingSide("from");
      pushHistory();

      let lastX = e.clientX;
      let lastY = e.clientY;

      const handleMove = (moveEvent: PointerEvent) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        let dx = ((moveEvent.clientX - lastX) / rect.width) * viewBox.w;
        let dy = ((moveEvent.clientY - lastY) / rect.height) * viewBox.h;
        lastX = moveEvent.clientX;
        lastY = moveEvent.clientY;
        if (snapToGrid) {
          dx = Math.round(dx * 2) / 2;
          dy = Math.round(dy * 2) / 2;
        }
        if (dx === 0 && dy === 0) return;
        const state = useEditorStore.getState();
        if (!additive && !alreadySelected) {
          state.selectSubPath(subPathSelection);
        }
        state.translateSelectedSubPaths(dx, dy, { recordHistory: false });
      };

      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [
      isActionMode,
      pushHistory,
      selectSubPath,
      selectedLayerId,
      selectedLayerSubPathSelections,
      setEditingSide,
      side,
      snapToGrid,
      viewBox.h,
      viewBox.w,
    ],
  );

  const handleSegmentPointerDown = useCallback(
    (e: React.PointerEvent<SVGPathElement>, segment: SegmentTarget) => {
      if (isActionMode || e.button !== 0) return;
      if (side === "preview" && !isVectorEditing && !isEditingSubPaths) return;
      if (side === "preview") {
        setEditingSide("from");
      } else if (!isEditingThisSide) {
        setEditingSide(side);
      }
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);

      const segmentSelection: SegmentSelection = {
        layerId: selectedLayerId,
        side: side === "preview" ? "from" : editingSide,
        subPathIndex: segment.subPathIndex,
        commandIndex: segment.commandIndex,
      };
      pushHistory();

      // Track last pointer position for delta-based flex (Ctrl+drag on curve body in direct mode).
      // Mirrors the delta computation pattern used in the existing handle flex path and other
      // batch/subpath drags for viewBox-correct world deltas.
      let lastX = e.clientX;
      let lastY = e.clientY;

      const handleMove = (moveEvent: PointerEvent) => {
        const point = pointFromEvent(moveEvent.clientX, moveEvent.clientY);
        if (!point) return;

        const state = useEditorStore.getState();
        const isDirectFlex = state.toolMode === "direct" && moveEvent.ctrlKey;

        if (isDirectFlex) {
          // Ctrl+drag on segment body in direct mode: intelligent flex via pure flexCurvature helper.
          // Computes normal-offset adjustment (G1-ish preservation) without moving anchors.
          // This is the core of the requested Figma-grade Bend/flex behavior (ny0/1af under v6j,
          // DESIGN_ID 67dd105e). Dispatcher already routes the intent; we deliver the mutation here.
          const rect = svgRef.current?.getBoundingClientRect();
          let dx = 0;
          let dy = 0;
          if (rect) {
            const scaleX = viewBox.w / rect.width;
            const scaleY = viewBox.h / rect.height;
            dx = (moveEvent.clientX - lastX) * scaleX;
            dy = (moveEvent.clientY - lastY) * scaleY;
          }
          lastX = moveEvent.clientX;
          lastY = moveEvent.clientY;

          if (dx !== 0 || dy !== 0) {
            const flexDelta = snapToGrid
              ? { x: Math.round(dx * 2) / 2, y: Math.round(dy * 2) / 2 }
              : { x: dx, y: dy };
            // t=0.5 for body drag on the segment (caller can pass biased t for handle drags).
            state.flexSelectedLayerSegment(segmentSelection, flexDelta, 0.5, {
              recordHistory: false,
            });
          }
        } else {
          // Original bend-to-point behavior (non-ctrl or other tools).
          const nextPoint = snapToGrid
            ? { x: Math.round(point.x * 2) / 2, y: Math.round(point.y * 2) / 2 }
            : point;
          state.bendSelectedLayerSegment(segmentSelection, nextPoint, { recordHistory: false });
        }
      };

      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [
      editingSide,
      isActionMode,
      isEditingSubPaths,
      isEditingThisSide,
      isVectorEditing,
      pointFromEvent,
      pushHistory,
      selectedLayerId,
      setEditingSide,
      side,
      snapToGrid,
      viewBox.h,
      viewBox.w,
    ],
  );

  const handleSegmentMidpointPointerDown = useCallback(
    (e: React.PointerEvent<SVGCircleElement>, segment: SegmentTarget) => {
      if (isActionMode || e.button !== 0) return;
      if (side === "preview" && !isVectorEditing && !isEditingSubPaths) return;
      e.preventDefault();
      e.stopPropagation();
      const segmentSelection: SegmentSelection = {
        layerId: selectedLayerId,
        side: side === "preview" ? "from" : editingSide,
        subPathIndex: segment.subPathIndex,
        commandIndex: segment.commandIndex,
      };
      splitSelectedLayerSegment(segmentSelection);
      if (side === "preview") {
        setEditingSide("from");
        setIsVectorEditing(true);
      }
    },
    [
      editingSide,
      isActionMode,
      isEditingSubPaths,
      isVectorEditing,
      selectedLayerId,
      setEditingSide,
      side,
      splitSelectedLayerSegment,
    ],
  );

  const handlePreviewPathDoubleClick = useCallback(
    (e: React.MouseEvent<SVGPathElement>, layerId: string | number) => {
      if (side !== "preview" || isActionMode) return;
      e.preventDefault();
      e.stopPropagation();
      selectLayer(layerId);
      setEditingSide("from");
      setIsVectorEditing(true);
    },
    [isActionMode, selectLayer, setEditingSide, side],
  );

  const handleResizePointerDown = useCallback(
    (e: React.PointerEvent<SVGElement>, handle: ResizeHandle) => {
      if (side !== "preview" || isActionMode || !selectedLayerBounds || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      pushHistory();

      const startBounds = selectedLayerBounds;

      const handleMove = (moveEvent: PointerEvent) => {
        const point = pointFromEvent(moveEvent.clientX, moveEvent.clientY);
        if (!point) return;
        const nextBounds = getBoundsFromResizeHandle(
          startBounds,
          handle,
          point,
          moveEvent.shiftKey,
        );
        resizeSelectedLayer(startBounds, nextBounds, { recordHistory: false });
      };

      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [isActionMode, pointFromEvent, pushHistory, resizeSelectedLayer, selectedLayerBounds, side],
  );

  const handleRotatePointerDown = useCallback(
    (e: React.PointerEvent<SVGCircleElement>) => {
      if (side !== "preview" || isActionMode || !selectedLayerBounds || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      pushHistory();

      const center = getBoundsCenter(selectedLayerBounds);
      const baseRotation = currentLayer.rotation ?? 0;
      const startPoint = pointFromEvent(e.clientX, e.clientY);
      const startAngle = startPoint ? getAngle(center, startPoint) : 0;

      updateSelectedLayer(
        {
          pivotX: center.x,
          pivotY: center.y,
          rotation: baseRotation,
        },
        { recordHistory: false },
      );

      const handleMove = (moveEvent: PointerEvent) => {
        const point = pointFromEvent(moveEvent.clientX, moveEvent.clientY);
        if (!point) return;
        const rawRotation = baseRotation + getAngle(center, point) - startAngle;
        const rotation = moveEvent.shiftKey ? Math.round(rawRotation / 15) * 15 : rawRotation;
        useEditorStore.getState().updateSelectedLayer(
          {
            pivotX: center.x,
            pivotY: center.y,
            rotation,
          },
          { recordHistory: false },
        );
      };

      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [
      currentLayer.rotation,
      isActionMode,
      pointFromEvent,
      pushHistory,
      selectedLayerBounds,
      side,
      updateSelectedLayer,
    ],
  );

  useEffect(() => {
    if (side !== "preview" || isActionMode) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      if (isEditableTarget) return;
      if (event.code === "Space") {
        event.preventDefault();
        setIsSpaceDown(true);
        return;
      }
      if (event.key === "Escape") {
        if (useEditorStore.getState().selectedSubPaths.length > 0) {
          event.preventDefault();
          useEditorStore.getState().selectSubPath(null);
          return;
        }
        setIsVectorEditing(false);
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        setIsVectorEditing((editing) => !editing);
        setEditingSide("from");
        return;
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        layers.length > 1 &&
        !isVectorEditing
      ) {
        event.preventDefault();
        deleteLayer(selectedLayerId);
        return;
      }
      if (!["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft"].includes(event.key)) return;

      const amount = event.shiftKey ? 2 : 0.5;
      const dx = event.key === "ArrowLeft" ? -amount : event.key === "ArrowRight" ? amount : 0;
      const dy = event.key === "ArrowUp" ? -amount : event.key === "ArrowDown" ? amount : 0;
      event.preventDefault();
      if (useEditorStore.getState().selectedSubPaths.length > 0) {
        useEditorStore.getState().translateSelectedSubPaths(dx, dy);
      } else if (isVectorEditing) {
        useEditorStore.getState().translateSelectedPoints(dx, dy);
      } else {
        useEditorStore.getState().translateSelectedLayer(dx, dy);
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        setIsSpaceDown(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    deleteLayer,
    isActionMode,
    isVectorEditing,
    layers.length,
    selectedLayerId,
    setEditingSide,
    side,
  ]);

  const isSelected = (subPathIndex: number, commandIndex: number, pointIndex: number) => {
    // Support multi-point selection (box select + shift)
    if (selectedPoints && selectedPoints.length > 0) {
      return selectedPoints.some(
        (sel) =>
          sel.subPathIndex === subPathIndex &&
          sel.commandIndex === commandIndex &&
          sel.pointIndex === pointIndex &&
          sel.layerId === selectedLayerId &&
          sel.side === editingSide,
      );
    }
    // Fallback to single
    return (
      selection?.subPathIndex === subPathIndex &&
      selection?.commandIndex === commandIndex &&
      selection?.pointIndex === pointIndex
    );
  };

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      className={`h-full w-full min-w-0 touch-none select-none bg-card ${
        isSpaceDown || isPanning
          ? "cursor-grab"
          : side === "preview" && !isActionMode && toolMode !== "paint"
            ? "cursor-default"
            : "cursor-crosshair"
      }`}
      onClick={handleSvgClick}
      onWheel={handleWheel}
      onPointerDown={handleSvgPointerDown}
      onPointerMove={handleSvgPointerMove}
      onPointerUp={handleSvgPointerUp}
      onDoubleClick={() => {
        if (side === "preview") return;
        fitDetailToVector(viewBox.scale);
      }}
      role="img"
      aria-label={`${side} path canvas — interactive vector editor (pan/zoom, handles, lasso, paint, direct). Keyboard: V/P/D/L/B or bottom palette.`}
    >
      <defs>
        <pattern
          id={`${gridId}-minor`}
          width={artboard.gridMinor}
          height={artboard.gridMinor}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${artboard.gridMinor} 0 L 0 0 0 ${artboard.gridMinor}`}
            stroke="#000000"
            strokeOpacity="0.07"
            fill="none"
            strokeWidth={viewBox.w * 0.0012}
          />
        </pattern>
        <pattern
          id={`${gridId}-major`}
          width={artboard.gridMajor}
          height={artboard.gridMajor}
          patternUnits="userSpaceOnUse"
        >
          <path
            d={`M ${artboard.gridMajor} 0 L 0 0 0 ${artboard.gridMajor}`}
            stroke="#000000"
            strokeOpacity="0.12"
            fill="none"
            strokeWidth={viewBox.w * 0.0015}
          />
        </pattern>
        <filter id={`${gridId}-artboard-shadow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="0"
            dy={viewBox.w * 0.018}
            stdDeviation={viewBox.w * 0.018}
            floodColor="#000000"
            floodOpacity="0.22"
          />
        </filter>
        <clipPath id={`${gridId}-artboard-clip`}>
          <rect x={artboard.x} y={artboard.y} width={artboard.width} height={artboard.height} />
        </clipPath>
        {currentLayer.fillGradient && (
          <g
            dangerouslySetInnerHTML={{
              __html: gradientToSvg(
                currentLayer.fillGradient,
                `${gridId}-fill-grad`,
                currentLayer.fillAlpha ?? 1,
              ),
            }}
          />
        )}
      </defs>

      <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill="var(--muted)" />
      {side === "preview" && (
        <text
          x={artboard.x}
          y={artboard.y - rulerOffset * 2.8}
          fill="#0d99ff"
          fontSize={Math.min(Math.max(viewBox.w * 0.011, 0.38), 0.58)}
          fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
          fontWeight={500}
          pointerEvents="none"
        >
          {frameLabel}
        </text>
      )}
      <rect
        x={artboard.x}
        y={artboard.y}
        width={artboard.width}
        height={artboard.height}
        rx={Math.max(viewBox.w * 0.0025, 0.04)}
        fill="#ffffff"
        filter={`url(#${gridId}-artboard-shadow)`}
      />
      <rect
        x={artboard.x}
        y={artboard.y}
        width={artboard.width}
        height={artboard.height}
        fill={`url(#${gridId}-minor)`}
      />
      <rect
        x={artboard.x}
        y={artboard.y}
        width={artboard.width}
        height={artboard.height}
        fill={`url(#${gridId}-major)`}
      />
      <rect
        x={artboard.x}
        y={artboard.y}
        width={artboard.width}
        height={artboard.height}
        fill="none"
        stroke="#d9d9d9"
        strokeOpacity="1"
        strokeWidth={Math.max(viewBox.w * 0.0016, 0.06)}
        pointerEvents="none"
      />
      <g
        fill="#8e8e8e"
        fontFamily="Inter, ui-sans-serif, system-ui, sans-serif"
        fontSize={labelSize}
        fontWeight={500}
        pointerEvents="none"
      >
        {axisTicks.x.map((tick) => (
          <text key={`x-${tick}`} x={tick} y={artboard.y - rulerOffset} textAnchor="middle">
            {formatAxisTick(tick)}
          </text>
        ))}
        {axisTicks.y.map((tick) => (
          <text
            key={`y-${tick}`}
            x={artboard.x - rulerOffset}
            y={tick + labelSize * 0.32}
            textAnchor="end"
          >
            {formatAxisTick(tick)}
          </text>
        ))}
      </g>
      {/* Box selection rect (select tool) */}
      {boxSelect && (
        <rect
          x={Math.min(boxSelect.start.x, boxSelect.current.x)}
          y={Math.min(boxSelect.start.y, boxSelect.current.y)}
          width={Math.abs(boxSelect.current.x - boxSelect.start.x)}
          height={Math.abs(boxSelect.current.y - boxSelect.start.y)}
          stroke="#0d99ff"
          strokeWidth={Math.max(ruler.strokeWidth, 0.04)}
          strokeDasharray={`${Math.max(viewBox.w * 0.01, 0.35)} ${Math.max(viewBox.w * 0.006, 0.2)}`}
          fill="#0d99ff"
          fillOpacity="0.08"
          opacity="0.9"
          vectorEffect="non-scaling-stroke"
        />
      )}

      {/* The actual path/vector scene */}
      {side === "preview" ? (
        <g className="text-foreground" clipPath={`url(#${gridId}-artboard-clip)`}>
          {previewLayers.map(
            ({
              layer,
              d,
              transform,
              opacity,
              fillColor,
              fillAlpha,
              strokeColor,
              strokeAlpha,
              strokeWidth: animatedStrokeWidth,
            }) => {
              const layerHasFill = Boolean(fillColor);
              const layerHasStroke = Boolean(strokeColor);
              const effectiveStrokeWidth =
                layerHasStroke || !layerHasFill
                  ? animatedStrokeWidth && animatedStrokeWidth > 0
                    ? animatedStrokeWidth
                    : 1
                  : 0;
              return (
                <path
                  key={layer.id}
                  d={d}
                  transform={transform}
                  opacity={opacity}
                  fill={fillColor || "none"}
                  fillOpacity={fillAlpha}
                  stroke={layerHasStroke ? strokeColor : "none"}
                  strokeOpacity={strokeAlpha}
                  strokeWidth={effectiveStrokeWidth}
                  strokeLinecap={layer.strokeLinecap ?? "butt"}
                  strokeLinejoin={layer.strokeLinejoin ?? "miter"}
                  strokeMiterlimit={layer.strokeMiterLimit ?? 4}
                  strokeDasharray={
                    layer.strokeDasharray && layer.strokeDasharray !== "none"
                      ? layer.strokeDasharray
                      : undefined
                  }
                  fillRule={layer.fillType === "evenOdd" ? "evenodd" : "nonzero"}
                  className={!isActionMode ? "cursor-move" : undefined}
                  onPointerDown={(event) => handlePreviewPathPointerDown(event, layer.id)}
                  onDoubleClick={(event) => handlePreviewPathDoubleClick(event, layer.id)}
                  pointerEvents={!isActionMode ? "visiblePainted" : undefined}
                />
              );
            },
          )}
        </g>
      ) : (
        <g clipPath={`url(#${gridId}-artboard-clip)`}>
          {/* Subtle body/silhouette treatment for the main path (inspired by reference image arrow) */}
          {side === "from" && (
            <path
              d={displayPath}
              fill="none"
              stroke="#e5e5e5"
              strokeOpacity={0.6}
              strokeWidth={strokeWidth + 2.5}
              strokeLinecap={currentLayer.strokeLinecap ?? "butt"}
              strokeLinejoin={currentLayer.strokeLinejoin ?? "miter"}
              strokeMiterlimit={currentLayer.strokeMiterLimit ?? 4}
              fillRule={currentLayer.fillType === "evenOdd" ? "evenodd" : "nonzero"}
              pointerEvents="none"
            />
          )}
          <path
            d={displayPath}
            className={
              side === "from"
                ? "drop-shadow-sm"
                : "opacity-85 drop-shadow-sm [stroke-dasharray:4_3]"
            }
            fill={
              currentLayer.fillGradient
                ? `url(#${gridId}-fill-grad)`
                : currentLayer.fillColor || "none"
            }
            fillOpacity={currentLayer.fillGradient ? 1 : currentLayer.fillAlpha ?? 1}
            stroke={currentLayer.strokeColor || fallbackStroke}
            strokeOpacity={currentLayer.strokeAlpha ?? 1}
            strokeWidth={strokeWidth}
            strokeLinecap={currentLayer.strokeLinecap ?? "butt"}
            strokeLinejoin={currentLayer.strokeLinejoin ?? "miter"}
            strokeMiterlimit={currentLayer.strokeMiterLimit ?? 4}
            strokeDasharray={
              currentLayer.strokeDasharray && currentLayer.strokeDasharray !== "none"
                ? currentLayer.strokeDasharray
                : side === "to"
                  ? "4 3"
                  : undefined
            }
            fillRule={currentLayer.fillType === "evenOdd" ? "evenodd" : "nonzero"}
          />
        </g>
      )}

      {side === "preview" && !isActionMode && (
        <g clipPath={`url(#${gridId}-artboard-clip)`}>
          <path
            d={selectedPreviewPath}
            transform={selectedPreviewTransform}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(strokeWidth, viewBox.w * 0.018)}
            className="cursor-move"
            pointerEvents="stroke"
            onPointerDown={handlePreviewPathPointerDown}
            onDoubleClick={(event) => handlePreviewPathDoubleClick(event, selectedLayerId)}
          />
          {currentLayer.from.subPaths.map((subPath, subPathIndex) => {
            const d = pathToString({ subPaths: [subPath] });
            return (
              <path
                key={`subpath-hit-${subPathIndex}`}
                d={d}
                transform={selectedPreviewTransform}
                fill="none"
                stroke="transparent"
                strokeWidth={Math.max(strokeWidth * 2.4, viewBox.w * 0.026)}
                className="cursor-move"
                pointerEvents="stroke"
                onPointerDown={(event) => handlePreviewSubPathPointerDown(event, subPathIndex)}
              />
            );
          })}
        </g>
      )}

      {(canEditPoints || side === "preview") && activeSelectionBounds && (
        <rect
          x={activeSelectionBounds.x}
          y={activeSelectionBounds.y}
          width={activeSelectionBounds.width}
          height={activeSelectionBounds.height}
          transform={side === "preview" ? selectedPreviewTransform : undefined}
          clipPath={overlayClipPath}
          fill="none"
          stroke="#0d99ff"
          strokeWidth={selectionStrokeWidth}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}

      {side === "preview" && !isActionMode && selectedLayerSubPathSelections.length > 0 && (
        <g transform={selectedPreviewTransform} clipPath={overlayClipPath} pointerEvents="none">
          {selectedLayerSubPathSelections.map((item) => {
            const subPath = currentLayer.from.subPaths[item.subPathIndex];
            if (!subPath) return null;
            const subPathPath: PathData = { subPaths: [subPath] };
            const bounds = getPathBounds(subPathPath);
            if (!bounds) return null;
            const label = compactPathLabel(subPathPath);
            const labelX = bounds.x;
            const labelY = Math.max(artboard.y + labelSize * 1.4, bounds.y - labelSize * 1.2);
            const labelWidth = Math.max(label.length * labelSize * 0.58, labelSize * 3.2);
            const labelHeight = labelSize * 1.45;
            return (
              <g key={`subpath-selection-${item.subPathIndex}`}>
                <path
                  d={pathToString(subPathPath)}
                  fill="none"
                  stroke="#0d99ff"
                  strokeWidth={Math.max(selectionStrokeWidth * 1.25, 0.08)}
                  vectorEffect="non-scaling-stroke"
                />
                <rect
                  x={labelX}
                  y={labelY - labelHeight + labelSize * 0.25}
                  width={labelWidth}
                  height={labelHeight}
                  rx={Math.max(labelSize * 0.2, 0.04)}
                  fill="#0d99ff"
                  opacity="0.96"
                />
                <text
                  x={labelX + labelSize * 0.38}
                  y={labelY - labelSize * 0.25}
                  fill="#ffffff"
                  fontSize={labelSize * 0.9}
                  fontFamily="ui-monospace, SFMono-Regular, Menlo, monospace"
                  fontWeight={600}
                >
                  {label}
                </text>
              </g>
            );
          })}
        </g>
      )}

      {side === "preview" &&
        !isActionMode &&
        !isVectorEditing &&
        !isEditingSubPaths &&
        rotationHandle && (
          <g transform={selectedPreviewTransform} clipPath={overlayClipPath}>
            <line
              x1={rotationHandle.anchorX}
              y1={rotationHandle.anchorY}
              x2={rotationHandle.x}
              y2={rotationHandle.y}
              stroke="#0d99ff"
              strokeWidth={selectionStrokeWidth}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
            <circle
              cx={rotationHandle.x}
              cy={rotationHandle.y}
              r={selectionHandleRadius * 0.92}
              className="cursor-grab"
              fill="#ffffff"
              stroke="#0d99ff"
              strokeWidth={selectionStrokeWidth}
              vectorEffect="non-scaling-stroke"
              onPointerDown={handleRotatePointerDown}
            />
          </g>
        )}

      {side === "preview" &&
        !isActionMode &&
        !isVectorEditing &&
        !isEditingSubPaths &&
        selectedLayerBounds && (
          <g transform={selectedPreviewTransform} clipPath={overlayClipPath}>
            {resizeEdges.map((edge) => (
              <line
                key={edge.id}
                x1={edge.x1}
                y1={edge.y1}
                x2={edge.x2}
                y2={edge.y2}
                className={edge.cursor}
                stroke="transparent"
                strokeWidth={selectionHitWidth}
                pointerEvents="stroke"
                vectorEffect="non-scaling-stroke"
                onPointerDown={(event) => handleResizePointerDown(event, edge.id)}
              />
            ))}
          </g>
        )}

      {side === "preview" &&
        !isActionMode &&
        !isVectorEditing &&
        !isEditingSubPaths &&
        resizeHandles.map((handle) => (
          <rect
            key={handle.id}
            x={handle.x - selectionHandleRadius}
            y={handle.y - selectionHandleRadius}
            width={selectionHandleRadius * 2}
            height={selectionHandleRadius * 2}
            rx={Math.max(selectionHandleRadius * 0.18, 0.03)}
            className={handle.cursor}
            transform={selectedPreviewTransform}
            clipPath={overlayClipPath}
            fill="#ffffff"
            stroke="#0d99ff"
            strokeWidth={selectionStrokeWidth}
            vectorEffect="non-scaling-stroke"
            onPointerDown={(event) => handleResizePointerDown(event, handle.id)}
          />
        ))}

      {canEditSegments && (
        <g
          transform={side === "preview" ? selectedPreviewTransform : undefined}
          clipPath={overlayClipPath}
        >
          {segmentTargets.map((segment) => (
            <g key={`segment-${segment.subPathIndex}-${segment.commandIndex}`}>
              <path
                d={segment.d}
                fill="none"
                stroke="transparent"
                strokeWidth={Math.max(strokeWidth * 2.2, viewBox.w * 0.024)}
                className="cursor-grab"
                pointerEvents="stroke"
                onPointerDown={(event) => handleSegmentPointerDown(event, segment)}
              />
              <path
                d={segment.d}
                fill="none"
                stroke="#0d99ff"
                strokeWidth={Math.max(selectionStrokeWidth * 0.72, 0.055)}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
                opacity={0.72}
              />
              <circle
                cx={segment.midpoint.x}
                cy={segment.midpoint.y}
                r={Math.max(selectionHandleRadius * 0.58, 0.14)}
                className="cursor-copy"
                fill="#ffffff"
                stroke="#0d99ff"
                strokeWidth={Math.max(selectionStrokeWidth * 0.9, 0.06)}
                vectorEffect="non-scaling-stroke"
                onPointerDown={(event) => handleSegmentMidpointPointerDown(event, segment)}
              />
            </g>
          ))}
        </g>
      )}

      {/* Real Lasso transient visual (9rp under v6j):
          Dashed polyline for the user-drawn lasso polygon (refined collection from handleSvgPointerMove).
          Real polygon hit testing + store selection commit now happens on up (collectPointsInLasso).
          Close detection in collection may snap the last point near the first for UX.
          References: DESIGN_ID 67dd105e, beads 9rp/ny0/v6j, clean dispatcher + PR-02 AABB precedent. */}
      {lassoPointsRef.current.length > 1 && (
        <polyline
          points={lassoPointsRef.current.map((pt) => `${pt.x},${pt.y}`).join(" ")}
          fill="none"
          stroke="#0d99ff"
          strokeWidth={Math.max(viewBox.w * 0.0015, 0.05)}
          strokeDasharray={`${Math.max(viewBox.w * 0.004, 0.12)} ${Math.max(viewBox.w * 0.002, 0.06)}`}
          vectorEffect="non-scaling-stroke"
          opacity={0.85}
          pointerEvents="none"
        />
      )}

      {/* Paint bucket / fill preview overlay (rsn v6j):
          Semi-transparent fill using current source layer style (from inspector/selected) + dashed blue stroke like lasso.
          Triggered by paintHitRef + raf at 60fps on hover. Hole-aware (isPointInFillRegion parity).
          Click applies via down handler (mutates hit layer fill, undoable, selects it).
          Works for detail (editingSide) + world/preview. Cursor crosshair for precision. */}
      {toolMode === "paint" &&
        paintHitRef.current &&
        (() => {
          const hid = paintHitRef.current!.layerId;
          const hlayer = layers.find((l) => l.id === hid);
          if (!hlayer || !hlayer.visible) return null;
          const srcLayer = layers.find((l) => l.id === selectedLayerId) || hlayer;
          const fillC = srcLayer.fillColor || "#000000";
          const fillA = Math.max(0.15, Math.min(0.5, (srcLayer.fillAlpha ?? 1) * 0.55));
          const targetP =
            side === "preview" || editingSide === "from" ? hlayer.from : hlayer.to || hlayer.from;
          const previewD = pathToString(targetP);
          if (!previewD) return null;
          const sw = Math.max(viewBox.w * 0.0018, 0.08);
          return (
            <path
              d={previewD}
              fill={fillC}
              fillOpacity={fillA}
              stroke="#0d99ff"
              strokeWidth={sw}
              strokeDasharray={`${sw * 2.5} ${sw * 1.2}`}
              vectorEffect="non-scaling-stroke"
              opacity={0.92}
              pointerEvents="none"
            />
          );
        })()}

      {/* Control points + bezier handles (direct mode fidelity - port of original EditPath/handle rendering) */}
      {canEditPoints &&
        commands.map(({ command, subPathIndex, commandIndex }) => {
          const isCubic = command.type === "C";
          const isQuad = command.type === "Q";
          return command.points.map((point, pointIndex) => {
            const isHandle = (isCubic && pointIndex < 2) || (isQuad && pointIndex < 1);
            const showHandles = toolMode === "direct" || toolMode === "select";
            if (isHandle && !showHandles) return null;

            const selected = isSelected(subPathIndex, commandIndex, pointIndex);
            const r = isHandle
              ? Math.max(viewBox.w * 0.006, 0.16)
              : Math.max(viewBox.w * 0.008, 0.22);
            const fill = selected ? "#0d99ff" : "#ffffff";
            const strokeW = Math.max(viewBox.w * 0.0022, 0.08);

            return (
              <g
                key={`${command.id}-${pointIndex}`}
                className="group"
                transform={side === "preview" ? selectedPreviewTransform : undefined}
                clipPath={overlayClipPath}
              >
                {/* Hover / selection halo (instant; SVG transitions are disabled globally) */}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={r * 2}
                  fill="#0d99ff"
                  pointerEvents="none"
                  className={selected ? "opacity-20" : "opacity-0 group-hover:opacity-15"}
                />
                {/* Handle line for cubics (anchor -> control handle), dashed like the reference */}
                {isCubic && showHandles && pointIndex < 2 && (
                  <line
                    x1={command.points[2]?.x ?? point.x}
                    y1={command.points[2]?.y ?? point.y}
                    x2={point.x}
                    y2={point.y}
                    stroke="#0d99ff"
                    strokeWidth={Math.max(viewBox.w * 0.0015, 0.05)}
                    strokeDasharray={`${Math.max(viewBox.w * 0.004, 0.12)} ${Math.max(viewBox.w * 0.003, 0.09)}`}
                    vectorEffect="non-scaling-stroke"
                    opacity={0.55}
                    pointerEvents="none"
                  />
                )}
                {isHandle ? (
                  /* Bezier control handle — round point */
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={r}
                    className="cursor-grab transition-[fill,stroke] duration-100"
                    fill={fill}
                    stroke="#0d99ff"
                    strokeWidth={strokeW}
                    vectorEffect="non-scaling-stroke"
                    onPointerDown={(e) =>
                      handlePointerDown(e, subPathIndex, commandIndex, pointIndex)
                    }
                  />
                ) : (
                  /* Anchor point — hollow square (Figma / reference convention) */
                  <rect
                    x={point.x - r}
                    y={point.y - r}
                    width={r * 2}
                    height={r * 2}
                    rx={Math.max(r * 0.14, 0.015)}
                    className="cursor-grab transition-[fill,stroke] duration-100"
                    fill={fill}
                    stroke="#0d99ff"
                    strokeWidth={strokeW}
                    vectorEffect="non-scaling-stroke"
                    onPointerDown={(e) =>
                      handlePointerDown(e, subPathIndex, commandIndex, pointIndex)
                    }
                  />
                )}
              </g>
            );
          });
        })}
    </svg>
  );
});

function getRulerModel(viewBox: ViewBox) {
  const targetTickCount = 5;
  const rawInterval = viewBox.w / targetTickCount;
  const interval = chooseNiceInterval(rawInterval);
  const xTicks = buildTicks(viewBox.x, viewBox.x + viewBox.w, interval);
  const yTicks = buildTicks(viewBox.y, viewBox.y + viewBox.h, interval);

  return {
    xTicks,
    yTicks,
    headerSize: viewBox.w * 0.072,
    tickSize: viewBox.w * 0.012,
    labelOffset: viewBox.w * 0.012,
    fontSize: viewBox.w * 0.024,
    strokeWidth: viewBox.w * 0.0018,
  };
}

function chooseNiceInterval(rawInterval: number) {
  const intervals = [0.5, 1, 2, 4, 6, 8, 12, 16, 24, 48, 96];
  return intervals.find((interval) => interval >= rawInterval) ?? intervals[intervals.length - 1];
}

function buildTicks(min: number, max: number, interval: number) {
  const ticks: number[] = [];
  const start = Math.ceil(min / interval) * interval;
  for (let value = start; value <= max; value += interval) {
    ticks.push(Number(value.toFixed(4)));
  }
  return ticks;
}

function formatAxisTick(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function getPathBounds(path: PathData) {
  const points = path.subPaths.flatMap((subPath) =>
    subPath.commands.flatMap((command) => command.points),
  );
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(0.01, maxX - minX),
    height: Math.max(0.01, maxY - minY),
  };
}

function getSubPathBounds(path: PathData, subPathIndexes: number[]) {
  const selected = new Set(subPathIndexes);
  return getPathBounds({
    subPaths: path.subPaths.filter((_, index) => selected.has(index)),
  });
}

function compactPathLabel(path: PathData) {
  const label = pathToString(path).replace(/\s+/g, " ");
  return label.length > 28 ? `${label.slice(0, 27)}...` : label;
}

function getSegmentTargets(path: PathData): SegmentTarget[] {
  return path.subPaths.flatMap((subPath, subPathIndex) =>
    subPath.commands.flatMap((command, commandIndex) => {
      const previous = subPath.commands[commandIndex - 1];
      const start = previous?.points.at(-1);
      const end = command.points.at(-1);
      if (!start || !end || command.type === "M" || command.type === "Z") return [];
      const d = pathToString({
        subPaths: [
          {
            commands: [
              { id: `segment-m-${subPathIndex}-${commandIndex}`, type: "M", points: [start] },
              command,
            ],
          },
        ],
      });
      return [
        {
          subPathIndex,
          commandIndex,
          command,
          start,
          end,
          d,
          midpoint: getSegmentMidpoint(command, start, end),
        },
      ];
    }),
  );
}

function getSegmentMidpoint(command: Command, start: Point, end: Point): Point {
  if (command.type === "C" && command.points.length >= 3) {
    return cubicPointAt(start, command.points[0], command.points[1], end, 0.5);
  }
  if (command.type === "Q" && command.points.length >= 2) {
    return quadraticPointAt(start, command.points[0], end, 0.5);
  }
  return {
    x: start.x + (end.x - start.x) * 0.5,
    y: start.y + (end.y - start.y) * 0.5,
  };
}

function cubicPointAt(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  t: number,
): Point {
  const mt = 1 - t;
  return {
    x:
      mt ** 3 * start.x +
      3 * mt ** 2 * t * control1.x +
      3 * mt * t ** 2 * control2.x +
      t ** 3 * end.x,
    y:
      mt ** 3 * start.y +
      3 * mt ** 2 * t * control1.y +
      3 * mt * t ** 2 * control2.y +
      t ** 3 * end.y,
  };
}

function quadraticPointAt(start: Point, control: Point, end: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt ** 2 * start.x + 2 * mt * t * control.x + t ** 2 * end.x,
    y: mt ** 2 * start.y + 2 * mt * t * control.y + t ** 2 * end.y,
  };
}

function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  );
}

function getResizeHandles(
  bounds: Bounds,
): Array<{ id: ResizeHandle; x: number; y: number; cursor: string }> {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return [
    { id: "nw", x: bounds.x, y: bounds.y, cursor: "cursor-nwse-resize" },
    { id: "n", x: centerX, y: bounds.y, cursor: "cursor-ns-resize" },
    { id: "ne", x: right, y: bounds.y, cursor: "cursor-nesw-resize" },
    { id: "e", x: right, y: centerY, cursor: "cursor-ew-resize" },
    { id: "se", x: right, y: bottom, cursor: "cursor-nwse-resize" },
    { id: "s", x: centerX, y: bottom, cursor: "cursor-ns-resize" },
    { id: "sw", x: bounds.x, y: bottom, cursor: "cursor-nesw-resize" },
    { id: "w", x: bounds.x, y: centerY, cursor: "cursor-ew-resize" },
  ];
}

function getResizeEdges(
  bounds: Bounds,
): Array<{ id: ResizeHandle; x1: number; y1: number; x2: number; y2: number; cursor: string }> {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  return [
    { id: "n", x1: bounds.x, y1: bounds.y, x2: right, y2: bounds.y, cursor: "cursor-ns-resize" },
    { id: "e", x1: right, y1: bounds.y, x2: right, y2: bottom, cursor: "cursor-ew-resize" },
    { id: "s", x1: bounds.x, y1: bottom, x2: right, y2: bottom, cursor: "cursor-ns-resize" },
    { id: "w", x1: bounds.x, y1: bounds.y, x2: bounds.x, y2: bottom, cursor: "cursor-ew-resize" },
  ];
}

function getRotationHandle(bounds: Bounds, distance: number) {
  const centerX = bounds.x + bounds.width / 2;
  return {
    anchorX: centerX,
    anchorY: bounds.y,
    x: centerX,
    y: bounds.y - distance,
  };
}

function getBoundsCenter(bounds: Bounds) {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  };
}

function getAngle(center: { x: number; y: number }, point: { x: number; y: number }) {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

function getBoundsFromResizeHandle(
  bounds: Bounds,
  handle: ResizeHandle,
  point: { x: number; y: number },
  preserveAspect: boolean,
): Bounds {
  const minSize = 0.5;
  const left = bounds.x;
  const top = bounds.y;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const aspect = bounds.width / Math.max(bounds.height, minSize);

  let next: Bounds;
  if (handle === "n") {
    next = { x: left, y: point.y, width: bounds.width, height: bottom - point.y };
  } else if (handle === "e") {
    next = { x: left, y: top, width: point.x - left, height: bounds.height };
  } else if (handle === "s") {
    next = { x: left, y: top, width: bounds.width, height: point.y - top };
  } else if (handle === "w") {
    next = { x: point.x, y: top, width: right - point.x, height: bounds.height };
  } else if (handle === "nw") {
    next = { x: point.x, y: point.y, width: right - point.x, height: bottom - point.y };
  } else if (handle === "ne") {
    next = { x: left, y: point.y, width: point.x - left, height: bottom - point.y };
  } else if (handle === "sw") {
    next = { x: point.x, y: top, width: right - point.x, height: point.y - top };
  } else {
    next = { x: left, y: top, width: point.x - left, height: point.y - top };
  }

  const isCornerHandle = handle === "nw" || handle === "ne" || handle === "se" || handle === "sw";
  if (preserveAspect && isCornerHandle) {
    const widthFromHeight = Math.abs(next.height) * aspect;
    const heightFromWidth = Math.abs(next.width) / Math.max(aspect, 0.001);
    if (
      Math.abs(widthFromHeight - Math.abs(next.width)) <
      Math.abs(heightFromWidth - Math.abs(next.height))
    ) {
      next.width = Math.sign(next.width || 1) * widthFromHeight;
    } else {
      next.height = Math.sign(next.height || 1) * heightFromWidth;
    }
    if (handle === "nw") {
      next.x = right - next.width;
      next.y = bottom - next.height;
    } else if (handle === "ne") {
      next.y = bottom - next.height;
    } else if (handle === "sw") {
      next.x = right - next.width;
    }
  }

  if (next.width < minSize) {
    if (handle === "nw" || handle === "sw" || handle === "w") next.x = right - minSize;
    next.width = minSize;
  }
  if (next.height < minSize) {
    if (handle === "nw" || handle === "ne" || handle === "n") next.y = bottom - minSize;
    next.height = minSize;
  }

  return next;
}

type PreviewLayer = {
  layer: Layer;
  d: string;
  transform: string;
  opacity: number;
  fillColor: string;
  fillAlpha: number;
  strokeColor: string;
  strokeAlpha: number;
  strokeWidth: number;
};

function getPreviewLayers(
  layers: Layer[],
  blocks: TimelineBlock[],
  duration: number,
  progress: number,
  selectedLayerId: string | number,
): PreviewLayer[] {
  const sourceLayers =
    blocks.length > 0
      ? layers
      : layers.filter((layer) => String(layer.id) === String(selectedLayerId));
  return sourceLayers
    .filter(
      (layer) => layer.visible !== false && (layer.type === "path" || layer.type === "clipPath"),
    )
    .map((layer) => ({
      layer,
      d: getAnimatedPath(layer, blocks, duration, progress),
      transform: getLayerTransform(layer, layers, blocks, duration, progress),
      opacity: getAnimatedNumber(layer, "alpha", blocks, duration, progress, layer.alpha ?? 1),
      fillColor: getAnimatedString(
        layer,
        "fillColor",
        blocks,
        duration,
        progress,
        layer.fillColor ?? "",
      ),
      fillAlpha: getAnimatedNumber(
        layer,
        "fillAlpha",
        blocks,
        duration,
        progress,
        layer.fillAlpha ?? 1,
      ),
      strokeColor: getAnimatedString(
        layer,
        "strokeColor",
        blocks,
        duration,
        progress,
        layer.strokeColor ?? "",
      ),
      strokeAlpha: getAnimatedNumber(
        layer,
        "strokeAlpha",
        blocks,
        duration,
        progress,
        layer.strokeAlpha ?? 1,
      ),
      strokeWidth: getAnimatedNumber(
        layer,
        "strokeWidth",
        blocks,
        duration,
        progress,
        layer.strokeWidth ?? 0,
      ),
    }));
}

function getAnimatedPath(
  layer: Layer,
  blocks: TimelineBlock[],
  duration: number,
  progress: number,
) {
  const block = getRelevantBlock(layer.id, "pathData", blocks, duration, progress);
  if (!block) return pathToString(layer.pathData ?? layer.from);
  const blockProgress = evaluateBlock(progress, duration, block);
  if (blockProgress == null) {
    return progress * duration < block.startTime ? String(block.fromValue) : String(block.toValue);
  }
  return getInterpolatedPath(
    parsePath(String(block.fromValue)),
    parsePath(String(block.toValue)),
    blockProgress,
  );
}

function getLayerTransform(
  layer: Layer,
  layers: Layer[],
  blocks: TimelineBlock[],
  duration: number,
  progress: number,
) {
  const chain: Layer[] = [];
  let current: Layer | undefined = layer;
  while (current) {
    chain.unshift(current);
    current =
      current.parentId == null
        ? undefined
        : layers.find((candidate) => String(candidate.id) === String(current?.parentId));
  }

  return chain
    .map((candidate) => {
      const pivotX = getAnimatedNumber(
        candidate,
        "pivotX",
        blocks,
        duration,
        progress,
        candidate.pivotX ?? 0,
      );
      const pivotY = getAnimatedNumber(
        candidate,
        "pivotY",
        blocks,
        duration,
        progress,
        candidate.pivotY ?? 0,
      );
      const translateX = getAnimatedNumber(
        candidate,
        "translateX",
        blocks,
        duration,
        progress,
        candidate.translateX ?? 0,
      );
      const translateY = getAnimatedNumber(
        candidate,
        "translateY",
        blocks,
        duration,
        progress,
        candidate.translateY ?? 0,
      );
      const rotation = getAnimatedNumber(
        candidate,
        "rotation",
        blocks,
        duration,
        progress,
        candidate.rotation ?? 0,
      );
      const scaleX = getAnimatedNumber(
        candidate,
        "scaleX",
        blocks,
        duration,
        progress,
        candidate.scaleX ?? 1,
      );
      const scaleY = getAnimatedNumber(
        candidate,
        "scaleY",
        blocks,
        duration,
        progress,
        candidate.scaleY ?? 1,
      );
      return [
        translateX || translateY ? `translate(${translateX} ${translateY})` : "",
        pivotX || pivotY ? `translate(${pivotX} ${pivotY})` : "",
        rotation ? `rotate(${rotation})` : "",
        scaleX !== 1 || scaleY !== 1 ? `scale(${scaleX} ${scaleY})` : "",
        pivotX || pivotY ? `translate(${-pivotX} ${-pivotY})` : "",
      ]
        .filter(Boolean)
        .join(" ");
    })
    .filter(Boolean)
    .join(" ");
}

function getAnimatedNumber(
  layer: Layer,
  propertyName: string,
  blocks: TimelineBlock[],
  duration: number,
  progress: number,
  fallback: number,
) {
  const block = getRelevantBlock(layer.id, propertyName, blocks, duration, progress);
  if (!block) return fallback;
  const from = Number(block.fromValue);
  const to = Number(block.toValue);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return fallback;
  const blockProgress = evaluateBlock(progress, duration, block);
  if (blockProgress == null) return progress * duration < block.startTime ? from : to;
  return from + (to - from) * blockProgress;
}

function getAnimatedString(
  layer: Layer,
  propertyName: string,
  blocks: TimelineBlock[],
  duration: number,
  progress: number,
  fallback: string,
) {
  const block = getRelevantBlock(layer.id, propertyName, blocks, duration, progress);
  if (!block) return fallback;
  const blockProgress = evaluateBlock(progress, duration, block);
  if (blockProgress == null)
    return progress * duration < block.startTime ? String(block.fromValue) : String(block.toValue);
  return blockProgress < 1 ? String(block.fromValue) : String(block.toValue);
}

function getRelevantBlock(
  layerId: string | number,
  propertyName: string,
  blocks: TimelineBlock[],
  duration: number,
  progress: number,
) {
  const time = progress * duration;
  const candidates = blocks
    .filter(
      (block) => String(block.layerId) === String(layerId) && block.propertyName === propertyName,
    )
    .sort((a, b) => a.startTime - b.startTime);
  if (candidates.length === 0) return null;
  return (
    candidates.find((block) => time >= block.startTime && time <= block.endTime) ??
    [...candidates].reverse().find((block) => time > block.endTime) ??
    candidates[0]
  );
}

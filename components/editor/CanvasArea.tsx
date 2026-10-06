"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import { WorldSelectionOverlay } from "./canvas/WorldSelectionOverlay";
import { CoordinateRulers } from "./canvas/CoordinateRulers";
import { CanvasNavigationControls } from "./canvas/CanvasNavigationControls";
import { WorldArtboards } from "./canvas/WorldArtboards";
import { WorldDraggedLayers } from "./canvas/WorldDraggedLayers";
import { WorldFrameChrome } from "./canvas/WorldFrameChrome";
import { useArtboardDrag } from "./canvas/useArtboardDrag";
import { getCanvasFrameBounds, useWorldCamera } from "./canvas/useWorldCamera";
import { useCanvasTouchGestures } from "./canvas/useCanvasTouchGestures";
import { useCoarsePointer } from "./hooks/useCompactLayout";
import { useWorldObjectSelection } from "./canvas/useWorldObjectSelection";
import { useWorldPen } from "./canvas/useWorldPen";
import { useWorldPenCreation } from "./canvas/useWorldPenCreation";
import { useWorldSceneModel } from "./canvas/useWorldSceneModel";
import { useWorldMarquee } from "./canvas/useWorldMarquee";
import { useWorldLasso } from "./canvas/useWorldLasso";
import { useWorldPointEditing } from "./canvas/useWorldPointEditing";
import { evaluateAndroidScene } from "@/lib/shapeshifter/scene/evaluate";
import { useWorldLayerTransform } from "./canvas/useWorldLayerTransform";
import { useWorldFrameResize } from "./canvas/useWorldFrameResize";
import { useWorldPan } from "./canvas/useWorldPan";
import { useWorldPointerPreview } from "./canvas/useWorldPointerPreview";
import { useWorldCanvasShortcuts } from "./canvas/useWorldCanvasShortcuts";
import { useWorldPointerRouter } from "./canvas/useWorldPointerRouter";
import { useWorldShapeDrawing } from "./canvas/useWorldShapeDrawing";
import {
  WorldBezierHandles,
  WorldFrameResizeHandles,
  WorldFreehandLasso,
  WorldMarqueeOverlay,
  WorldMotionPaths,
  WorldPaintPreview,
  WorldPenPreview,
  WorldSmartGuides,
  WorldVectorNetwork,
} from "./canvas/WorldEditingOverlays";
import { useShallow } from "zustand/react/shallow";
import { PAGE_ROOT_ID, useEditorStore } from "@/lib/store/editorStore";
import { computeGridSpec, computeGridVisibility } from "@/lib/shapeshifter/camera";
import { isPointInFillRegion } from "@/lib/shapeshifter/pathUtils";
import { vectorFromPageMetadata } from "@/lib/shapeshifter/vectorSpace";
import type { PathData } from "@/lib/shapeshifter/types";

interface CanvasAreaProps {
  resetAllViews: () => void;
  compact?: boolean;
  showRulers?: boolean;
  onToggleRulers?: () => void;
}

export function CanvasArea({
  resetAllViews,
  compact = false,
  showRulers = false,
  onToggleRulers,
}: CanvasAreaProps) {
  const {
    isPlaying,
    progress,
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
    selectedFrameIds,
    selectFrame,
    selectFrames,
    setSelectedFrameIds,
    worldViewport,
    setWorldViewport,
    fitWorldToFrames,
    bringFrameIntoView,
    bringLayerIntoView,
    selectLayer,
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
    syncActiveOwner,
    document,
  } = useEditorStore(
    useShallow((state) => ({
      isPlaying: state.isPlaying,
      progress: state.progress,
      getCompatibilityStatus: state.getCompatibilityStatus,
      editingSide: state.editingSide,
      isActionMode: state.isActionMode,
      toolMode: state.toolMode,
      layers: state.layers,
      selectedLayerId: state.selectedLayerId,
      frames: state.frames,
      rootLayers: state.rootLayers,
      rootAnimation: state.rootAnimation,
      selectedFrameId: state.selectedFrameId,
      selectedFrameIds: state.selectedFrameIds,
      selectFrame: state.selectFrame,
      selectFrames: state.selectFrames,
      setSelectedFrameIds: state.setSelectedFrameIds,
      worldViewport: state.worldViewport,
      setWorldViewport: state.setWorldViewport,
      fitWorldToFrames: state.fitWorldToFrames,
      bringFrameIntoView: state.bringFrameIntoView,
      bringLayerIntoView: state.bringLayerIntoView,
      selectLayer: state.selectLayer,
      selectLayerRefs: state.selectLayerRefs,
      selectedLayerIds: state.selectedLayerIds,
      selectedLayerRefs: state.selectedLayerRefs,
      selectedPoints: state.selectedPoints,
      updateSelectedLayer: state.updateSelectedLayer,
      setToolMode: state.setToolMode,
      snapToGrid: state.snapToGrid,
      gridDivisions: state.gridDivisions,
      setGridDivisions: state.setGridDivisions,
      hasCanvasSelection: state.hasCanvasSelection,
      selectionKind: state.selectionKind,
      deselectAll: state.deselectAll,
      spacePanActive: state.spacePanActive,
      animation: state.animation,
      syncActiveOwner: state.syncActiveOwner,
      document: state.document,
    })),
  );

  /** Figma mental model: Select = objects; Direct = vector points. */
  const isObjectTool = toolMode === "select";
  const isPointTool = toolMode === "direct";

  const compatibility = getCompatibilityStatus();
  const rootVector = useMemo(
    () => vectorFromPageMetadata(document.page, PAGE_ROOT_ID),
    [document.page],
  );

  const {
    editFrame,
    editLayer,
    editPath,
    editOrigin,
    editLayerTranslation,
    currentFillColor,
    rulerFrame,
    sceneOwners,
    selectedLayerRefKeys,
    selectedLayerOwnerCount,
    documentSelectionBounds,
    activeSelectedLayerIds,
  } = useWorldSceneModel({
    frames,
    layers,
    rootLayers,
    selectedFrameId,
    selectedFrameIds,
    selectedLayerId,
    selectedLayerIds,
    selectedLayerRefs,
    selectionKind,
    editingSide,
    progress,
    animation,
    rootAnimation,
    showPlayheadPath: toolMode === "direct" && !isActionMode && !isPlaying,
  });
  const editLayerTx = editLayerTranslation.x;
  const editLayerTy = editLayerTranslation.y;
  const editSceneNode = useMemo(() => {
    if (!editLayer) return null;
    const scene = evaluateAndroidScene(layers, animation, progress, true);
    return scene.nodesById.get(String(editLayer.id)) ?? null;
  }, [animation, editLayer, layers, progress]);
  const editWorldMatrix = editSceneNode?.worldMatrix ?? null;
  const editLayerLocked = editSceneNode?.locked ?? editLayer?.locked ?? false;

  // Dynamic paint bucket cursor tinted with current selected color (for CSS cursor)
  const paintBucketCursor = React.useMemo(() => {
    const c = currentFillColor.replace("#", "%23");
    return `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 16 16'%3E%3Cg%3E%3Cpath fill='${c}' stroke='%23000' stroke-width='0.8' d='M3 3 L13 3 L14 13 L2 13 Z'/%3E%3Cpath fill='none' stroke='%23000' stroke-width='1' d='M3 3 L3 13 M13 3 L13 13'/%3E%3Cpath fill='%23ddd' d='M5 5 L11 5 L10 11 L6 11 Z'/%3E%3Cpath fill='none' stroke='%23000' stroke-width='0.5' d='M4 2 L12 2'/%3E%3C/g%3E%3C/svg%3E") 4 2, crosshair`;
  }, [currentFillColor]);

  /** Figma selection scope — driven by the store (frame | layer | none). */
  const selectTarget = selectionKind === "none" ? "frame" : selectionKind;
  const worldSvgRef = useRef<SVGSVGElement>(null);
  const worldSelectedIds = selectedFrameIds;
  const setWorldSelectedIds = useCallback(
    (next: string[] | ((previous: string[]) => string[])) => {
      const previous = useEditorStore.getState().selectedFrameIds;
      setSelectedFrameIds(typeof next === "function" ? next(previous) : next);
    },
    [setSelectedFrameIds],
  );

  const {
    viewportSize: worldSize,
    view: worldView,
    setView: setWorldView,
    worldPerPixel: worldPerPx,
    worldPointFromClient: worldPointFromEvent,
    visibleFrames: culledFrames,
    onWheel: handleWorldWheel,
    zoomAtCenter: zoomWorldAtCenter,
    fitToSelection: fitWorldToSelection,
  } = useWorldCamera({
    svgRef: worldSvgRef,
    isActionMode,
    frames,
    selectedFrameId,
    selectedFrameIds,
    selectionKind,
    selectionBounds: documentSelectionBounds,
    viewport: worldViewport,
    onViewportChange: setWorldViewport,
    onFitFrames: fitWorldToFrames,
    onBringFrameIntoView: bringFrameIntoView,
  });
  const {
    active: isWorldPanning,
    start: startWorldPan,
    update: updateWorldPan,
    finish: finishWorldPan,
    cancel: cancelWorldPan,
  } = useWorldPan({ svgRef: worldSvgRef, view: worldView, setView: setWorldView });

  // Anchor handles stay a constant on-screen size while the grid progressively
  // reveals finer subdivisions as the camera zooms in.
  const coarsePointer = useCoarsePointer();
  const anchorR = worldPerPx * (coarsePointer ? 5 : 4);
  const pxPerUnit = worldPerPx > 0 ? 1 / worldPerPx : 1;
  const gridSpec = useMemo(
    () => computeGridSpec(pxPerUnit, { divisions: gridDivisions }),
    [pxPerUnit, gridDivisions],
  );
  const gridVisibility = useMemo(() => computeGridVisibility(pxPerUnit), [pxPerUnit]);
  const editSnap = Math.min(gridSpec.minor, 1);
  const {
    hitTest: hitWorldAnchor,
    start: startWorldPointEditing,
    update: updateWorldPointEditing,
    finish: finishWorldPointEditing,
    cancel: cancelWorldPointEditing,
    hasDrag: hasWorldPointDrag,
  } = useWorldPointEditing({
    path: editPath,
    ownerOrigin: editOrigin,
    layerTranslation: editLayerTranslation,
    worldMatrix: editWorldMatrix,
    locked: editLayerLocked,
    layerId: selectedLayerId,
    editingSide,
    // Fingers need a far larger target than a cursor.
    hitRadius: coarsePointer ? worldPerPx * 24 : Math.max(anchorR * 2.8, worldPerPx * 10),
    snapStep: snapToGrid ? editSnap : undefined,
    syncActiveOwner,
  });
  const {
    startResize: startLayerResize,
    startRotate: startLayerRotate,
    update: updateLayerTransform,
    finish: finishLayerTransform,
    cancel: cancelLayerTransform,
    hasTransform: hasLayerTransform,
  } = useWorldLayerTransform({
    svgRef: worldSvgRef,
    ownerOrigin: editOrigin,
    snapToGrid,
    snapStep: editSnap,
    syncActiveOwner,
  });
  const {
    start: startFrameResize,
    update: updateFrameResize,
    finish: finishFrameResize,
    cancel: cancelFrameResize,
    hasGesture: hasFrameResize,
  } = useWorldFrameResize({
    svgRef: worldSvgRef,
    frame: editFrame,
    worldPointFromClient: worldPointFromEvent,
  });

  const {
    marquee,
    beginLayers: beginLayerMarquee,
    beginFrames: beginFrameMarquee,
    update: updateMarquee,
    finish: finishMarquee,
    cancel: cancelMarquee,
  } = useWorldMarquee({
    frames,
    sceneOwners,
    selectedFrameId,
    selectedFrameIds,
    selectedLayerRefs,
    worldPerPixel: worldPerPx,
    setWorldSelectedIds,
  });
  const {
    points: worldLassoPoints,
    begin: beginWorldLasso,
    update: updateWorldLasso,
    finish: finishWorldLasso,
    cancel: cancelWorldLasso,
  } = useWorldLasso({
    editPath,
    editOrigin,
    editLayerTranslation,
    selectedLayerId,
    editingSide,
    frames,
    selectedFrameIds,
  });

  const {
    isDragging: isDraggingArtboards,
    draggingIds: draggingArtboardIds,
    start: startWorldArtboardDrag,
    update: updateArtboardDrag,
    finish: finishArtboardDrag,
    cancel: cancelArtboardDrag,
  } = useArtboardDrag({ snapToGrid, worldPointFromClient: worldPointFromEvent });

  const getFrameBounds = getCanvasFrameBounds;

  const {
    smartGuides,
    dropPreview: layerDropPreview,
    isDragging: isLayerObjectDragging,
    isDragPending: isLayerDragPending,
    hasDrag: hasObjectDrag,
    draggedDraws: draggedWorldDraws,
    hitArtboard,
    hitLayerAtWorld,
    selectOwnedLayer,
    startDrag: startObjectDrag,
    updateDrag: updateObjectDrag,
    finishDrag: finishObjectDrag,
    cancelDrag: cancelObjectDrag,
    clearPendingDrag: clearPendingObjectDrag,
    clearFeedback: clearObjectFeedback,
  } = useWorldObjectSelection({
    frames,
    sceneOwners,
    selectedLayerRefs,
    selectedLayerRefKeys,
    selectionBounds: documentSelectionBounds,
    snapToGrid,
    snapStep: editSnap,
    worldPerPixel: worldPerPx,
    selectedFrameId,
    animation,
    rootAnimation,
    progress,
    syncActiveOwner,
  });

  useEffect(
    () => () => {
      cancelObjectDrag();
      cancelLayerTransform();
      cancelFrameResize();
      cancelWorldPointEditing();
      cancelArtboardDrag();
      cancelWorldPan();
    },
    [
      cancelArtboardDrag,
      cancelFrameResize,
      cancelLayerTransform,
      cancelObjectDrag,
      cancelWorldPointEditing,
      cancelWorldPan,
      toolMode,
    ],
  );

  // Commit an edited path back to the selected layer (mirrors inline anchor drag).
  const commitEditPath = useCallback(
    (next: PathData, recordHistory = true) => {
      updateSelectedLayer(editingSide === "from" ? { from: next, pathData: next } : { to: next }, {
        recordHistory,
      });
    },
    [editingSide, updateSelectedLayer],
  );

  const {
    activeSubpathRef: penActiveSubpathRef,
    scopeRef: penScopeRef,
    finishedAtRef: penFinishedAtRef,
    dragRef: penDragRef,
    preview: penPreview,
    setPreview: setPenPreview,
    finish: finishPen,
    pointerDown: penPointerDown,
    pointerDrag: penPointerDrag,
    pointerUp: penPointerUp,
    cancelPointer: penPointerCancel,
    beginPath: beginPenPath,
  } = useWorldPen({
    path: editPath,
    snapStep: editSnap,
    worldPerPixel: worldPerPx,
    commit: commitEditPath,
  });
  const startWorldPenPath = useWorldPenCreation({
    activeSubpathRef: penActiveSubpathRef,
    beginPath: beginPenPath,
    hitArtboard,
    snapStep: editSnap,
  });
  const {
    hoveredFrameId,
    hoveredLayerKey,
    paintHoverValid,
    updateIdle: updateIdlePointerPreview,
    updatePaintPreview,
    clearPaintPreview,
    handlePointerLeave,
  } = useWorldPointerPreview({
    toolMode,
    worldPointFromClient: worldPointFromEvent,
    hitLayerAtWorld,
    hitArtboard,
    penActiveSubpathRef,
    setPenPreview,
    editOrigin,
    editPath,
    snapToGrid,
    snapStep: editSnap,
  });

  useEffect(() => {
    if (
      toolMode === "pen" &&
      penScopeRef.current?.ownerId === selectedFrameId &&
      String(penScopeRef.current.layerId) === String(selectedLayerId) &&
      penScopeRef.current.side === editingSide
    )
      return;
    finishPen();
  }, [toolMode, selectedFrameId, selectedLayerId, editingSide, finishPen, penScopeRef]);

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

  const shapeDrawing = useWorldShapeDrawing({
    hitArtboard,
    snapStep: editSnap,
    worldPerPixel: worldPerPx,
  });
  const {
    handlePointerDown: handleWorldPointerDown,
    handlePointerMove: handleWorldPointerMove,
    handlePointerUp: handleWorldPointerUp,
    handlePointerCancel: handleWorldPointerCancel,
  } = useWorldPointerRouter({
    startPenPath: startWorldPenPath,
    startShapeDrawing: shapeDrawing.start,
    updateShapeDrawing: shapeDrawing.update,
    finishShapeDrawing: shapeDrawing.finish,
    cancelShapeDrawing: shapeDrawing.cancel,
    svgRef: worldSvgRef,
    worldPointFromEvent,
    toolMode,
    spacePanActive,
    snapToGrid,
    snapStep: editSnap,
    editOrigin,
    editWorldMatrix,
    editLayerLocked,
    editPathPresent: Boolean(editPath),
    layers,
    selectedLayerId,
    selectedFrameId,
    worldSelectedIds,
    selectedLayerRefs,
    selectedLayerRefKeys,
    selectionKind,
    hasCanvasSelection,
    startWorldPan,
    updateWorldPan,
    finishWorldPan,
    cancelWorldPan,
    penDragRef,
    penPointerDown,
    penPointerDrag,
    penPointerUp,
    penPointerCancel,
    applyWorldPaint,
    hitWorldAnchor,
    startWorldPointEditing,
    updateWorldPointEditing,
    finishWorldPointEditing,
    cancelWorldPointEditing,
    hitLayerAtWorld,
    hitArtboard,
    selectOwnedLayer,
    clearPendingObjectDrag,
    startObjectDrag,
    updateObjectDrag,
    finishObjectDrag,
    cancelObjectDrag,
    hasObjectDrag,
    clearObjectFeedback,
    selectFrame,
    selectFrames,
    selectLayerRefs,
    beginLayerMarquee,
    beginFrameMarquee,
    updateMarquee,
    finishMarquee,
    cancelMarquee,
    beginWorldLasso,
    updateWorldLasso,
    finishWorldLasso,
    cancelWorldLasso,
    updateFrameResize,
    finishFrameResize,
    cancelFrameResize,
    hasFrameResize,
    updateLayerTransform,
    finishLayerTransform,
    cancelLayerTransform,
    hasLayerTransform,
    updateArtboardDrag,
    finishArtboardDrag,
    cancelArtboardDrag,
    startArtboardDrag: startWorldArtboardDrag,
    isDraggingArtboards,
    updateIdlePointerPreview,
    updatePaintPreview,
    clearPaintPreview,
  });

  // Double-click focus (select + camera lerp to artboard rect) - seamless world to detail transition
  // Double-click an artboard to zoom into it for editing — stays on the same
  // canvas (Figma-style "enter frame"), no separate edit screen.
  const handleWorldDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (Date.now() - penFinishedAtRef.current < 400) {
        e.preventDefault();
        return;
      }
      // Double-click finishes an in-progress pen path
      if (toolMode === "pen" && penActiveSubpathRef.current != null) {
        e.preventDefault();
        finishPen();
        setToolMode("select");
        return;
      }
      const p = worldPointFromEvent(e.clientX, e.clientY);
      if (!p) return;
      // Figma: double-click a shape → enter vector network (Direct / point edit).
      // This is NOT object resize — corners become editable anchors.
      const layerHit = hitLayerAtWorld(p);
      if (layerHit) {
        selectOwnedLayer(layerHit);
        useEditorStore.getState().clearSelection?.();
        // Like Figma, entering vector editing never moves the camera.
        setToolMode("direct");
        return;
      }
      const hit = hitArtboard(p);
      if (!hit) return;
      // Empty frame body: select the frame (exits vector edit via selectFrame).
      selectFrame(hit);
      setWorldSelectedIds([hit]);
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
      bringLayerIntoView,
      toolMode,
      finishPen,
      setToolMode,
    ],
  );

  // Figma: right-click selects what is under the cursor before the menu opens.
  const worldTouchHandlers = useCanvasTouchGestures({
    svgRef: worldSvgRef,
    view: worldView,
    setView: setWorldView,
    // A manual gesture takes ownership immediately, including HTML frame titles.
    onGestureStart: () => useEditorStore.getState().setWorldViewport({}),
    handlers: {
      onPointerDown: handleWorldPointerDown,
      onPointerMove: handleWorldPointerMove,
      onPointerUp: handleWorldPointerUp,
      onPointerCancel: handleWorldPointerCancel,
    },
  });
  const handleWorldContextMenu = useCallback(
    (event: React.MouseEvent) => {
      if (compact) {
        event.preventDefault();
        return;
      }
      const point = worldPointFromEvent(event.clientX, event.clientY);
      if (!point || isPointTool) return;
      const layerHit = hitLayerAtWorld(point);
      if (layerHit) {
        if (!selectedLayerRefKeys.has(`${layerHit.frameId}:${String(layerHit.layerId)}`))
          selectOwnedLayer(layerHit);
        return;
      }
      const frameHit = hitArtboard(point);
      if (frameHit) {
        selectFrame(frameHit);
        setWorldSelectedIds([frameHit]);
        return;
      }
      setWorldSelectedIds([]);
      deselectAll();
    },
    [
      worldPointFromEvent,
      compact,
      isPointTool,
      hitLayerAtWorld,
      selectedLayerRefKeys,
      selectOwnedLayer,
      hitArtboard,
      selectFrame,
      setWorldSelectedIds,
      deselectAll,
    ],
  );

  useWorldCanvasShortcuts({
    enabled: true,
    penActiveSubpathRef,
    finishPen,
    hasObjectDrag,
    cancelObjectDrag,
    hasLayerTransform,
    cancelLayerTransform,
    hasFrameResize,
    cancelFrameResize,
    hasWorldPointDrag,
    cancelWorldPointEditing,
    isDraggingArtboards,
    cancelArtboardDrag,
    isWorldPanning,
    cancelWorldPan,
    isPointTool,
    isObjectTool,
    exitPointMode: () => {
      setToolMode("select");
      useEditorStore.getState().clearSelection?.();
      if (selectedLayerId != null) selectLayer(selectedLayerId);
    },
    clearObjectSelection: () => {
      setWorldSelectedIds([]);
      deselectAll();
    },
    fitWorldToFrames,
    fitWorldToSelection,
    resetWorldZoom: () => zoomWorldAtCenter(1 / useEditorStore.getState().worldViewport.scale),
    zoomWorldAtCenter,
  });

  const paintPreviewFrame = hoveredFrameId
    ? frames.find((frame) => frame.id === hoveredFrameId)
    : undefined;
  const paintPreviewFrameBounds = paintPreviewFrame ? getFrameBounds(paintPreviewFrame) : null;

  return (
    <div className="relative flex min-w-0 flex-1 overflow-hidden bg-muted">
      <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full w-full">
            <div className="relative flex h-full min-h-0 w-full flex-col">
              {/* Full-bleed canvas — no chrome border (Figma-style workspace) */}
              <div
                className="relative min-h-0 w-full flex-1 overflow-hidden bg-muted"
                role="region"
                aria-label="Canvas"
                style={{ userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none" }}
                onPointerDownCapture={worldTouchHandlers.onPointerDownCapture}
                onClickCapture={worldTouchHandlers.onClickCapture}
                onPointerMoveCapture={worldTouchHandlers.onPointerMoveCapture}
                onPointerUpCapture={worldTouchHandlers.onPointerUpCapture}
                onLostPointerCapture={worldTouchHandlers.onLostPointerCapture}
              >
                <CanvasNavigationControls
                  zoomPercent={worldView.scale * 100}
                  compact={compact}
                  onFitFrame={
                    selectedFrameId === PAGE_ROOT_ID
                      ? undefined
                      : () => useEditorStore.getState().fitWorldToFrames([selectedFrameId])
                  }
                  showWorldControls
                  gridDivisions={gridDivisions}
                  onZoomOut={() => zoomWorldAtCenter(0.8)}
                  onZoomIn={() => zoomWorldAtCenter(1.25)}
                  onZoomToActualSize={() =>
                    zoomWorldAtCenter(1 / useEditorStore.getState().worldViewport.scale)
                  }
                  onSetGrid={setGridDivisions}
                  onFitSelection={fitWorldToSelection}
                  onReset={resetAllViews}
                  showRulers={showRulers}
                  onToggleRulers={onToggleRulers}
                />

                {showRulers && worldSize.w > 0 && worldSize.h > 0 && (
                  <CoordinateRulers
                    viewport={worldView}
                    width={worldSize.w}
                    height={worldSize.h}
                    origin={
                      rulerFrame ? { x: rulerFrame.x || 0, y: rulerFrame.y || 0 } : { x: 0, y: 0 }
                    }
                    scopeLabel={rulerFrame ? rulerFrame.name : "World"}
                  />
                )}
                {layerDropPreview && worldSize.w > 0 && worldSize.h > 0 && (
                  <div
                    className="pointer-events-none absolute z-30 -translate-y-[calc(100%+10px)] rounded-md bg-foreground px-2 py-1 text-[11px] font-medium text-background shadow-lg"
                    style={{
                      left: Math.round(
                        ((layerDropPreview.point.x - worldView.x) / worldView.w) * worldSize.w + 12,
                      ),
                      top: Math.round(
                        ((layerDropPreview.point.y - worldView.y) / worldView.h) * worldSize.h,
                      ),
                    }}
                    role="status"
                    aria-live="polite"
                  >
                    {layerDropPreview.label}
                  </div>
                )}
                {
                  <svg
                    ref={worldSvgRef}
                    width="100%"
                    height="100%"
                    viewBox={`${worldView.x} ${worldView.y} ${worldView.w} ${worldView.h}`}
                    preserveAspectRatio="xMidYMid meet"
                    aria-label="World canvas"
                    className="touch-none"
                    onWheel={handleWorldWheel}
                    onPointerDown={worldTouchHandlers.onPointerDown}
                    onPointerMove={worldTouchHandlers.onPointerMove}
                    onPointerUp={worldTouchHandlers.onPointerUp}
                    onPointerCancel={worldTouchHandlers.onPointerCancel}
                    onPointerLeave={handlePointerLeave}
                    onDoubleClick={handleWorldDoubleClick}
                    onContextMenu={handleWorldContextMenu}
                    style={{
                      background: "var(--muted)",
                      cursor:
                        isWorldPanning || isDraggingArtboards || isLayerDragPending
                          ? "grabbing"
                          : toolMode === "hand"
                            ? "grab"
                            : toolMode === "paint"
                              ? paintBucketCursor
                              : toolMode === "pen" ||
                                  toolMode === "pencil" ||
                                  toolMode === "rectangle" ||
                                  toolMode === "ellipse"
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
                          strokeOpacity={gridVisibility.minorOpacity}
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
                          strokeOpacity={gridVisibility.majorOpacity}
                          strokeWidth={worldPerPx}
                        />
                      </pattern>
                      {/* Subtle lift shadow for artboards. */}
                      <filter id="dragShadow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="1.5" stdDeviation="1.4" floodOpacity="0.2" />
                      </filter>
                    </defs>
                    <WorldArtboards
                      frames={culledFrames}
                      getFrameBounds={getFrameBounds}
                      activeLayers={layers}
                      activeAnimation={animation}
                      rootLayers={selectedFrameId === PAGE_ROOT_ID ? layers : rootLayers}
                      rootAnimation={selectedFrameId === PAGE_ROOT_ID ? animation : rootAnimation}
                      rootVector={rootVector}
                      selectedFrameId={selectedFrameId}
                      selectedFrameIds={selectedFrameIds}
                      selectedLayerRefs={selectedLayerRefs}
                      selectedLayerRefKeys={selectedLayerRefKeys}
                      selectionKind={selectionKind}
                      hasCanvasSelection={hasCanvasSelection}
                      editingSide={editingSide}
                      editLayer={editLayer}
                      editPath={editPath}
                      hoveredFrameId={hoveredFrameId}
                      hoveredLayerKey={hoveredLayerKey}
                      draggingFrameIds={draggingArtboardIds}
                      layerDropTargetId={layerDropPreview?.ownerId}
                      isLayerDragging={isLayerObjectDragging}
                      isPointTool={isPointTool}
                      isPlaying={isPlaying}
                      progress={progress}
                      worldPerPx={worldPerPx}
                      gridVisibility={gridVisibility}
                    />
                    {/* Dragged objects are composited above every frame so a destination
                        artboard can never hide the object before it is reparented. */}
                    <WorldDraggedLayers draws={draggedWorldDraws} worldPerPx={worldPerPx} />
                    <WorldSmartGuides guides={smartGuides} />
                    <WorldMotionPaths
                      visible={!isPlaying && selectTarget === "layer"}
                      origin={editOrigin}
                      layers={layers}
                      animation={animation}
                      selectedLayerIds={
                        selectedLayerIds.length
                          ? selectedLayerIds
                          : selectedLayerId != null
                            ? [selectedLayerId]
                            : []
                      }
                      primaryLayerId={selectedLayerId}
                      progress={progress}
                      worldPerPixel={worldPerPx}
                    />
                    <WorldFreehandLasso points={worldLassoPoints} />
                    {marquee && (
                      <WorldMarqueeOverlay start={marquee.start} current={marquee.current} />
                    )}
                    {!isPlaying && isPointTool && editPath && editOrigin && (
                      <WorldBezierHandles
                        path={editPath}
                        origin={editOrigin}
                        worldMatrix={editWorldMatrix}
                        worldPerPixel={worldPerPx}
                      />
                    )}
                    {!isPlaying &&
                      toolMode === "pen" &&
                      editOrigin &&
                      editPath &&
                      penActiveSubpathRef.current != null && (
                        <WorldPenPreview
                          path={editPath}
                          activeSubpath={penActiveSubpathRef.current}
                          preview={penPreview}
                          origin={editOrigin}
                          worldMatrix={editWorldMatrix}
                          snapStep={editSnap}
                          worldPerPixel={worldPerPx}
                          anchorRadius={anchorR}
                        />
                      )}
                    {toolMode === "paint" && paintHoverValid && (
                      <WorldPaintPreview
                        path={editPath}
                        origin={editOrigin}
                        worldMatrix={editWorldMatrix}
                        frameBounds={paintPreviewFrameBounds}
                        color={currentFillColor}
                        fillAlpha={editLayer?.fillAlpha ?? 1}
                        worldPerPixel={worldPerPx}
                      />
                    )}
                    {!isPlaying && isPointTool && editPath && editOrigin && (
                      <WorldVectorNetwork
                        path={editPath}
                        origin={editOrigin}
                        translation={{ x: editLayerTx, y: editLayerTy }}
                        worldMatrix={editWorldMatrix}
                        selectedPoints={selectedPoints}
                        anchorRadius={anchorR}
                      />
                    )}
                    {!isPlaying &&
                      isObjectTool &&
                      !spacePanActive &&
                      hasCanvasSelection &&
                      selectTarget === "frame" &&
                      editFrame && (
                        <WorldFrameResizeHandles
                          bounds={getFrameBounds(editFrame)}
                          worldPerPixel={worldPerPx}
                          touch={coarsePointer}
                          onResizeStart={startFrameResize}
                        />
                      )}
                    <WorldSelectionOverlay
                      visible={
                        !isPlaying &&
                        !spacePanActive &&
                        isObjectTool &&
                        hasCanvasSelection &&
                        selectTarget === "layer"
                      }
                      activeOrigin={editOrigin}
                      activeLayers={layers}
                      animation={animation}
                      progress={progress}
                      activeLayerIds={activeSelectedLayerIds}
                      selectedOwnerCount={selectedLayerOwnerCount}
                      documentBounds={documentSelectionBounds}
                      worldPerPx={worldPerPx}
                      worldPointFromClient={worldPointFromEvent}
                      onResizeStart={startLayerResize}
                      onRotateStart={startLayerRotate}
                    />
                    {shapeDrawing.preview && (
                      <path
                        d={shapeDrawing.preview.d}
                        transform={`translate(${shapeDrawing.preview.origin.x} ${shapeDrawing.preview.origin.y})`}
                        fill="var(--primary)"
                        fillOpacity={0.15}
                        stroke="var(--primary)"
                        strokeWidth={worldPerPx}
                        pointerEvents="none"
                      />
                    )}
                  </svg>
                }

                {worldSize.w > 0 && (
                  <WorldFrameChrome
                    frames={culledFrames}
                    viewport={worldView}
                    viewportSize={worldSize}
                    hoveredFrameId={hoveredFrameId}
                    draggingFrameIds={draggingArtboardIds}
                    isDragging={isDraggingArtboards}
                    interactive={toolMode !== "hand" && !spacePanActive}
                    onStartDrag={startWorldArtboardDrag}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Compatibility chip — floats over the canvas, never steals layout height */}
        {compatibility.warning && (
          <div className="pointer-events-none absolute inset-x-0 top-3 z-40 flex justify-center px-3">
            <div className="pointer-events-auto flex max-w-[min(420px,calc(100%-1.5rem))] items-center gap-2 rounded-full bg-card py-1 pl-3 pr-1 text-[12px] text-foreground/85 [box-shadow:var(--elevation-floating)]">
              <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden />
              <span className="min-w-0 truncate">{compatibility.warning}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 shrink-0 rounded-full px-2.5 text-[11px] font-medium text-primary hover:bg-primary/10"
                onClick={() => useEditorStore.getState().autoFixSelectedLayer()}
              >
                Fix
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

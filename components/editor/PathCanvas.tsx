"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import { parsePath, pathToString, getInterpolatedPath } from "@/lib/shapeshifter/pathUtils";
import { evaluateBlock } from "@/lib/shapeshifter/interpolators";
import type { SubPathSelection } from "@/lib/store/editorStore";
import type { Layer, PathData, TimelineBlock } from "@/lib/shapeshifter/types";

type PointSelection = { subPathIndex: number; commandIndex: number; pointIndex: number };
type ViewBox = { x: number; y: number; w: number; h: number; scale: number };
type Bounds = { x: number; y: number; width: number; height: number };
type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

interface PathCanvasProps {
  resetKey?: number;
  side: "from" | "to" | "preview";
  width?: number;
  height?: number;
  zoom?: number;
}

export const PathCanvas = React.memo(function PathCanvas({
  side,
  width = 320,
  height = 320,
  resetKey,
  zoom = 1,
}: PathCanvasProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const gridId = React.useId();
  const suppressNextZoomSync = useRef(false);

  const [viewBox, setViewBox] = React.useState<ViewBox>({ x: 0, y: 0, w: 48, h: 48, scale: 1 });
  const [isPanning, setIsPanning] = React.useState(false);
  const [isSpaceDown, setIsSpaceDown] = React.useState(false);
  const [lastPan, setLastPan] = React.useState({ x: 0, y: 0 });
  const [boxSelect, setBoxSelect] = React.useState<null | {start: {x:number; y:number}; current: {x:number; y:number}}>(null);
  const [isVectorEditing, setIsVectorEditing] = React.useState(false);
  // For batch multi-point drag: track last known position of the primary drag point to compute uniform deltas
  const [dragSession, setDragSession] = React.useState<null | { lastX: number; lastY: number; primarySel: PointSelection | null }>(null);

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
    selectPoint,
    selectLayer,
    setEditingSide,
    updateSelectedLayer,
    resizeSelectedLayer,
    deleteLayer,
    setZoom,
    selectSubPath,
    toolMode,
    isActionMode,
  } = useEditorStore();

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
    const scale = Math.max(0.25, Math.min(8, zoom));
    if (suppressNextZoomSync.current) {
      suppressNextZoomSync.current = false;
      return;
    }
    const size = artboard.baseViewSize / scale;
    setViewBox({
      x: artboard.centerX - size / 2,
      y: artboard.centerY - size / 2,
      w: size,
      h: size,
      scale,
    });
  }, [artboard.baseViewSize, artboard.centerX, artboard.centerY, resetKey, zoom]);

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
      const mouse = pointFromEvent(e.clientX, e.clientY);
      if (!mouse) return;

      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.25, Math.min(8, viewBox.scale * zoomFactor));
      const newW = artboard.baseViewSize / newScale;
      const newH = artboard.baseViewSize / newScale;

      const newX = mouse.x - (mouse.x - viewBox.x) * (newW / viewBox.w);
      const newY = mouse.y - (mouse.y - viewBox.y) * (newH / viewBox.h);

      suppressNextZoomSync.current = true;
      setZoom(newScale);
      setViewBox({ x: newX, y: newY, w: newW, h: newH, scale: newScale });
    },
    [artboard.baseViewSize, pointFromEvent, setZoom, viewBox],
  );

  const handleSvgPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 1 || e.altKey || isSpaceDown) {
      setIsPanning(true);
      setLastPan({ x: e.clientX, y: e.clientY });
      svgRef.current?.setPointerCapture(e.pointerId);
      return;
    }
    if (side === "preview" && !isActionMode && e.button === 0) {
      const p = pointFromEvent(e.clientX, e.clientY);
      if (p) {
        setBoxSelect({ start: p, current: p });
        svgRef.current?.setPointerCapture(e.pointerId);
      }
      return;
    }
    // Use getState to avoid declaration order issues with toolMode/isEditingThisSide (robust for Action Mode features)
    const state = useEditorStore.getState();
    if (state.toolMode === "select" && state.editingSide === (side === "from" ? "from" : "to") && e.button === 0) {
      const p = pointFromEvent(e.clientX, e.clientY);
      if (p) {
        // If not holding shift, clear previous selection on new box start (original BatchSelect behavior)
        if (!e.shiftKey) {
          const { clearSelection } = useEditorStore.getState();
          clearSelection();
        }
        setBoxSelect({ start: p, current: p });
        svgRef.current?.setPointerCapture(e.pointerId);
      }
    }
  }, [isActionMode, isSpaceDown, pointFromEvent, side]);

  const handleSvgPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isPanning) {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect) return;
        const dx = ((e.clientX - lastPan.x) / rect.width) * viewBox.w;
        const dy = ((e.clientY - lastPan.y) / rect.height) * viewBox.h;
        setViewBox((prev) => ({ ...prev, x: prev.x - dx, y: prev.y - dy }));
        setLastPan({ x: e.clientX, y: e.clientY });
      }
      if (boxSelect) {
        const p = pointFromEvent(e.clientX, e.clientY);
        if (p) setBoxSelect(prev => prev ? {...prev, current: p} : null);
      }
    },
    [isPanning, lastPan, viewBox.h, viewBox.w, boxSelect, pointFromEvent],
  );

  const handleSvgPointerUp = useCallback((e: React.PointerEvent) => {
    setIsPanning(false);
    if (boxSelect) {
      // Hit test points inside box (simple AABB for now)
      const {start, current} = boxSelect;
      const minX = Math.min(start.x, current.x);
      const maxX = Math.max(start.x, current.x);
      const minY = Math.min(start.y, current.y);
      const maxY = Math.max(start.y, current.y);
      if (side === "preview" && !isActionMode) {
        const selectRect = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
        const renderedLayers = getPreviewLayers(
          layers,
          animation.blocks,
          animation.duration,
          progress,
          selectedLayerId,
        );
        const hitLayer = [...renderedLayers]
          .reverse()
          .find(({ d }) => {
            const bounds = getPathBounds(parsePath(d));
            return bounds ? rectsIntersect(selectRect, bounds) : false;
          });
        if (hitLayer) {
          selectLayer(hitLayer.layer.id);
          setEditingSide("from");
        } else if (Math.abs(maxX - minX) > 0.2 || Math.abs(maxY - minY) > 0.2) {
          const { clearSelection } = useEditorStore.getState();
          clearSelection();
        }
        setBoxSelect(null);
        if (svgRef.current?.hasPointerCapture(e.pointerId)) {
          svgRef.current.releasePointerCapture(e.pointerId);
        }
        return;
      }
      let hit = null;
      // Use current layer commands
      const layer = layers.find(l => l.id === selectedLayerId);
      if (layer) {
        const path = editingSide === "from" ? layer.from : layer.to;
        for (let si = 0; si < path.subPaths.length; si++) {
          const sp = path.subPaths[si];
          for (let ci = 0; ci < sp.commands.length; ci++) {
            const cmd = sp.commands[ci];
            for (let pi = 0; pi < cmd.points.length; pi++) {
              const pt = cmd.points[pi];
              if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) {
                hit = {subPathIndex: si, commandIndex: ci, pointIndex: pi};
                break;
              }
            }
            if (hit) break;
          }
          if (hit) break;
        }
      }
      // Collect ALL points inside the box (full batch select parity with original)
      const hits: PointSelection[] = [];
      if (layer) {
        const path = editingSide === "from" ? layer.from : layer.to;
        for (let si = 0; si < path.subPaths.length; si++) {
          const sp = path.subPaths[si];
          for (let ci = 0; ci < sp.commands.length; ci++) {
            const cmd = sp.commands[ci];
            for (let pi = 0; pi < cmd.points.length; pi++) {
              const pt = cmd.points[pi];
              if (pt.x >= minX && pt.x <= maxX && pt.y >= minY && pt.y <= maxY) {
                hits.push({ subPathIndex: si, commandIndex: ci, pointIndex: pi });
              }
            }
          }
        }
      }
      if (hits.length > 0) {
        const multiSels = hits.map(h => ({ layerId: selectedLayerId, side: editingSide, ...h }));
        // Use new multi action
        const { selectMultiplePoints } = useEditorStore.getState();
        selectMultiplePoints(multiSels);
      } else if (boxSelect) {
        // empty box click clears in select mode (original behavior)
        const { clearSelection } = useEditorStore.getState();
        clearSelection();
      }
      setBoxSelect(null);
    }
    if (svgRef.current?.hasPointerCapture(e.pointerId)) {
      svgRef.current.releasePointerCapture(e.pointerId);
    }
  }, [animation.blocks, animation.duration, boxSelect, editingSide, isActionMode, layers, progress, selectLayer, selectedLayerId, setEditingSide, side]);

  

  const currentLayer = layers.find((l) => l.id === selectedLayerId);
  if (!currentLayer) return null;

  const isEditingThisSide = side === editingSide;
  const isPreviewVectorEditing = side === "preview" && isVectorEditing && !isActionMode;
  const canEditPoints = isEditingThisSide || isPreviewVectorEditing;
  const targetPathData = side === "to" ? currentLayer.to : currentLayer.from;

  // For preview, we'll use a simple lerp for now (will be replaced by real morph later)
  const getDisplayPath = () => {
    if (side === "preview") {
      // Real interpolation using the new engine
      return getInterpolatedPath(currentLayer.from, currentLayer.to, progress);
    }
    return pathToString(targetPathData);
  };

  const displayPath = getDisplayPath();
  const fallbackStroke = side === "to" ? "hsl(var(--destructive))" : "hsl(var(--primary))";
  const hasExplicitStroke = Boolean(currentLayer.strokeColor);
  const hasExplicitFill = Boolean(currentLayer.fillColor);
  const strokeWidth =
    hasExplicitStroke || !hasExplicitFill ? (currentLayer.strokeWidth && currentLayer.strokeWidth > 0 ? currentLayer.strokeWidth : 2.2) : 0;

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
  const ruler = useMemo(() => getRulerModel(viewBox), [viewBox]);
  const previewLayers = useMemo(
    () =>
      side === "preview"
        ? getPreviewLayers(layers, animation.blocks, animation.duration, progress, selectedLayerId)
        : [],
    [animation.blocks, animation.duration, layers, progress, selectedLayerId, side],
  );
  const selectedPreviewLayer = previewLayers.find((candidate) => String(candidate.layer.id) === String(selectedLayerId));
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
    return getSubPathBounds(pathData, selectedLayerSubPathSelections.map((item) => item.subPathIndex));
  }, [currentLayer.from, selectedLayerSubPathSelections, side, targetPathData]);
  const selectedLayerBounds = useMemo(
    () => (side === "preview" ? getPathBounds(parsePath(selectedPreviewPath)) : selectedPathBounds),
    [selectedPathBounds, selectedPreviewPath, side],
  );
  const activeSelectionBounds = selectedSubPathBounds ?? selectedLayerBounds;
  const isEditingSubPaths = selectedLayerSubPathSelections.length > 0;
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
    () => (selectedLayerBounds && !isEditingSubPaths ? getRotationHandle(selectedLayerBounds, rotationHandleDistance) : null),
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
        side: side === "preview" ? "from" as const : editingSide,
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
    [isActionMode, pushHistory, selectLayer, selectedLayerId, setEditingSide, side, viewBox.h, viewBox.w],
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
        (item) => item.subPathIndex === subPathIndex && String(item.layerId) === String(selectedLayerId),
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
        const nextBounds = getBoundsFromResizeHandle(startBounds, handle, point, moveEvent.shiftKey);
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

      updateSelectedLayer({
        pivotX: center.x,
        pivotY: center.y,
        rotation: baseRotation,
      }, { recordHistory: false });

      const handleMove = (moveEvent: PointerEvent) => {
        const point = pointFromEvent(moveEvent.clientX, moveEvent.clientY);
        if (!point) return;
        const rawRotation = baseRotation + getAngle(center, point) - startAngle;
        const rotation = moveEvent.shiftKey ? Math.round(rawRotation / 15) * 15 : rawRotation;
        useEditorStore.getState().updateSelectedLayer({
          pivotX: center.x,
          pivotY: center.y,
          rotation,
        }, { recordHistory: false });
      };

      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [currentLayer.rotation, isActionMode, pointFromEvent, pushHistory, selectedLayerBounds, side, updateSelectedLayer],
  );

  useEffect(() => {
    if (side !== "preview" || isActionMode) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditableTarget =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
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
      if ((event.key === "Backspace" || event.key === "Delete") && layers.length > 1 && !isVectorEditing) {
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
  }, [deleteLayer, isActionMode, isVectorEditing, layers.length, selectedLayerId, setEditingSide, side]);

  const isSelected = (subPathIndex: number, commandIndex: number, pointIndex: number) => {
    // Support multi-point selection (box select + shift)
    if (selectedPoints && selectedPoints.length > 0) {
      return selectedPoints.some(
        (sel) => sel.subPathIndex === subPathIndex && 
                 sel.commandIndex === commandIndex && 
                 sel.pointIndex === pointIndex &&
                 sel.layerId === selectedLayerId &&
                 sel.side === editingSide
      );
    }
    // Fallback to single
    return selection?.subPathIndex === subPathIndex &&
           selection?.commandIndex === commandIndex &&
           selection?.pointIndex === pointIndex;
  };

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      className={`h-full w-full min-w-0 touch-none select-none bg-card ${
        isSpaceDown || isPanning ? "cursor-grab" : side === "preview" && !isActionMode ? "cursor-default" : "cursor-crosshair"
      }`}
      onClick={handleSvgClick}
      onWheel={handleWheel}
      onPointerDown={handleSvgPointerDown}
      onPointerMove={handleSvgPointerMove}
      onPointerUp={handleSvgPointerUp}
      onDoubleClick={() => {
        if (side === "preview") return;
        const scale = Math.max(0.5, Math.min(8, zoom));
        const size = artboard.baseViewSize / scale;
        setViewBox({
          x: artboard.centerX - size / 2,
          y: artboard.centerY - size / 2,
          w: size,
          h: size,
          scale,
        });
      }}
      role="img"
      aria-label={`${side} path canvas`}
    >
      <defs>
        <pattern id={`${gridId}-minor`} width={artboard.gridMinor} height={artboard.gridMinor} patternUnits="userSpaceOnUse">
          <path d={`M ${artboard.gridMinor} 0 L 0 0 0 ${artboard.gridMinor}`} stroke="#000000" strokeOpacity="0.045" fill="none" strokeWidth={viewBox.w * 0.0012} />
        </pattern>
        <pattern id={`${gridId}-major`} width={artboard.gridMajor} height={artboard.gridMajor} patternUnits="userSpaceOnUse">
          <path d={`M ${artboard.gridMajor} 0 L 0 0 0 ${artboard.gridMajor}`} stroke="#000000" strokeOpacity="0.08" fill="none" strokeWidth={viewBox.w * 0.0015} />
        </pattern>
        <filter id={`${gridId}-artboard-shadow`} x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy={viewBox.w * 0.018} stdDeviation={viewBox.w * 0.018} floodColor="#000000" floodOpacity="0.22" />
        </filter>
        <clipPath id={`${gridId}-artboard-clip`}>
          <rect x={artboard.x} y={artboard.y} width={artboard.width} height={artboard.height} />
        </clipPath>
      </defs>

      <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill="#252525" />
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
      <rect x={artboard.x} y={artboard.y} width={artboard.width} height={artboard.height} fill={`url(#${gridId}-minor)`} />
      <rect x={artboard.x} y={artboard.y} width={artboard.width} height={artboard.height} fill={`url(#${gridId}-major)`} />
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
          <text
            key={`x-${tick}`}
            x={tick}
            y={artboard.y - rulerOffset}
            textAnchor="middle"
          >
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
                  strokeDasharray={layer.strokeDasharray && layer.strokeDasharray !== "none" ? layer.strokeDasharray : undefined}
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
          <path
            d={displayPath}
            className={side === "from" ? "drop-shadow-sm" : "opacity-85 drop-shadow-sm [stroke-dasharray:4_3]"}
            fill={currentLayer.fillColor || "none"}
            fillOpacity={currentLayer.fillAlpha ?? 1}
            stroke={currentLayer.strokeColor || fallbackStroke}
            strokeOpacity={currentLayer.strokeAlpha ?? 1}
            strokeWidth={strokeWidth}
            strokeLinecap={currentLayer.strokeLinecap ?? "butt"}
            strokeLinejoin={currentLayer.strokeLinejoin ?? "miter"}
            strokeMiterlimit={currentLayer.strokeMiterLimit ?? 4}
            strokeDasharray={currentLayer.strokeDasharray && currentLayer.strokeDasharray !== "none" ? currentLayer.strokeDasharray : (side === "to" ? "4 3" : undefined)}
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

      {side === "preview" &&
        !isActionMode &&
        selectedLayerSubPathSelections.length > 0 && (
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
            const r = isHandle ? Math.max(viewBox.w * 0.006, 0.16) : Math.max(viewBox.w * 0.008, 0.22);
            const fill = selected ? "#0d99ff" : "#ffffff";
            const strokeW = Math.max(viewBox.w * 0.0022, 0.08);

            return (
              <g
                key={`${command.id}-${pointIndex}`}
                transform={side === "preview" ? selectedPreviewTransform : undefined}
                clipPath={overlayClipPath}
              >
                {/* Handle line for cubics (original draws point -> handleIn / handleOut) */}
                {isCubic && showHandles && pointIndex < 2 && (
                  <line
                    x1={command.points[2]?.x ?? point.x}
                    y1={command.points[2]?.y ?? point.y}
                    x2={point.x}
                    y2={point.y}
                    stroke="#0d99ff"
                    strokeWidth={Math.max(viewBox.w * 0.0018, 0.06)}
                    vectorEffect="non-scaling-stroke"
                    opacity={0.6}
                  />
                )}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={r}
                  className="cursor-grab transition-[fill,stroke,transform] duration-100"
                  fill={fill}
                  stroke="#0d99ff"
                  strokeWidth={strokeW}
                  vectorEffect="non-scaling-stroke"
                  onPointerDown={(e) =>
                    handlePointerDown(e, subPathIndex, commandIndex, pointIndex)
                  }
                />
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
  const points = path.subPaths.flatMap((subPath) => subPath.commands.flatMap((command) => command.points));
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

function rectsIntersect(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) {
  return (
    a.x <= b.x + b.width &&
    a.x + a.width >= b.x &&
    a.y <= b.y + b.height &&
    a.y + a.height >= b.y
  );
}

function getResizeHandles(bounds: Bounds): Array<{ id: ResizeHandle; x: number; y: number; cursor: string }> {
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

function getResizeEdges(bounds: Bounds): Array<{ id: ResizeHandle; x1: number; y1: number; x2: number; y2: number; cursor: string }> {
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
    if (Math.abs(widthFromHeight - Math.abs(next.width)) < Math.abs(heightFromWidth - Math.abs(next.height))) {
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
    .filter((layer) => layer.visible !== false && (layer.type === "path" || layer.type === "clipPath"))
    .map((layer) => ({
      layer,
      d: getAnimatedPath(layer, blocks, duration, progress),
      transform: getLayerTransform(layer, layers, blocks, duration, progress),
      opacity: getAnimatedNumber(layer, "alpha", blocks, duration, progress, layer.alpha ?? 1),
      fillColor: getAnimatedString(layer, "fillColor", blocks, duration, progress, layer.fillColor ?? ""),
      fillAlpha: getAnimatedNumber(layer, "fillAlpha", blocks, duration, progress, layer.fillAlpha ?? 1),
      strokeColor: getAnimatedString(layer, "strokeColor", blocks, duration, progress, layer.strokeColor ?? ""),
      strokeAlpha: getAnimatedNumber(layer, "strokeAlpha", blocks, duration, progress, layer.strokeAlpha ?? 1),
      strokeWidth: getAnimatedNumber(layer, "strokeWidth", blocks, duration, progress, layer.strokeWidth ?? 0),
    }));
}

function getAnimatedPath(layer: Layer, blocks: TimelineBlock[], duration: number, progress: number) {
  const block = getRelevantBlock(layer.id, "pathData", blocks, duration, progress);
  if (!block) return pathToString(layer.pathData ?? layer.from);
  const blockProgress = evaluateBlock(progress, duration, block);
  if (blockProgress == null) {
    return progress * duration < block.startTime ? String(block.fromValue) : String(block.toValue);
  }
  return getInterpolatedPath(parsePath(String(block.fromValue)), parsePath(String(block.toValue)), blockProgress);
}

function getLayerTransform(layer: Layer, layers: Layer[], blocks: TimelineBlock[], duration: number, progress: number) {
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
      const pivotX = getAnimatedNumber(candidate, "pivotX", blocks, duration, progress, candidate.pivotX ?? 0);
      const pivotY = getAnimatedNumber(candidate, "pivotY", blocks, duration, progress, candidate.pivotY ?? 0);
      const translateX = getAnimatedNumber(candidate, "translateX", blocks, duration, progress, candidate.translateX ?? 0);
      const translateY = getAnimatedNumber(candidate, "translateY", blocks, duration, progress, candidate.translateY ?? 0);
      const rotation = getAnimatedNumber(candidate, "rotation", blocks, duration, progress, candidate.rotation ?? 0);
      const scaleX = getAnimatedNumber(candidate, "scaleX", blocks, duration, progress, candidate.scaleX ?? 1);
      const scaleY = getAnimatedNumber(candidate, "scaleY", blocks, duration, progress, candidate.scaleY ?? 1);
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
  if (blockProgress == null) return progress * duration < block.startTime ? String(block.fromValue) : String(block.toValue);
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
    .filter((block) => String(block.layerId) === String(layerId) && block.propertyName === propertyName)
    .sort((a, b) => a.startTime - b.startTime);
  if (candidates.length === 0) return null;
  return (
    candidates.find((block) => time >= block.startTime && time <= block.endTime) ??
    [...candidates].reverse().find((block) => time > block.endTime) ??
    candidates[0]
  );
}

"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import { parsePath, pathToString, getInterpolatedPath } from "@/lib/shapeshifter/pathUtils";
import { evaluateBlock } from "@/lib/shapeshifter/interpolators";
import type { Layer, TimelineBlock } from "@/lib/shapeshifter/types";

type PointSelection = { subPathIndex: number; commandIndex: number; pointIndex: number };
type ViewBox = { x: number; y: number; w: number; h: number; scale: number };

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

  const [viewBox, setViewBox] = React.useState<ViewBox>({ x: 0, y: 0, w: 48, h: 48, scale: 1 });
  const [isPanning, setIsPanning] = React.useState(false);
  const [lastPan, setLastPan] = React.useState({ x: 0, y: 0 });
  const [boxSelect, setBoxSelect] = React.useState<null | {start: {x:number; y:number}; current: {x:number; y:number}}>(null);
  // For batch multi-point drag: track last known position of the primary drag point to compute uniform deltas
  const [dragSession, setDragSession] = React.useState<null | { lastX: number; lastY: number; primarySel: PointSelection | null }>(null);

  useEffect(() => {
    const scale = Math.max(0.5, Math.min(8, zoom));
    const size = 48 / scale;
    setViewBox({ x: 24 - size / 2, y: 24 - size / 2, w: size, h: size, scale });
  }, [resetKey, zoom]);

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


  const {
    layers,
    animation,
    selectedLayerId,
    editingSide,
    selection,
    selectedPoints,
    progress,
    snapToGrid,
    pushHistory,
    updateSelectedPoint,
    translateSelectedLayer,
    addPointOnPath,
    selectPoint,
    setEditingSide,
    toolMode,
    isActionMode,
  } = useEditorStore();

  
  

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const mouse = pointFromEvent(e.clientX, e.clientY);
      if (!mouse) return;

      const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
      const newScale = Math.max(0.5, Math.min(10, viewBox.scale * zoomFactor));
      const newW = 48 / newScale;
      const newH = 48 / newScale;

      const newX = mouse.x - (mouse.x - viewBox.x) * (newW / viewBox.w);
      const newY = mouse.y - (mouse.y - viewBox.y) * (newH / viewBox.h);

      setViewBox({ x: newX, y: newY, w: newW, h: newH, scale: newScale });
    },
    [pointFromEvent, viewBox],
  );

  const handleSvgPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 1 || e.altKey) {
      setIsPanning(true);
      setLastPan({ x: e.clientX, y: e.clientY });
      svgRef.current?.setPointerCapture(e.pointerId);
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
  }, [pointFromEvent, side]);

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
  }, [boxSelect, layers, selectedLayerId, editingSide, selectPoint]);

  

  const currentLayer = layers.find((l) => l.id === selectedLayerId);
  if (!currentLayer) return null;

  const isEditingThisSide = side === editingSide;
  const targetPathData = side === "from" ? currentLayer.from : currentLayer.to;

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

  // Dragging logic
  const handlePointerDown = useCallback(
    (e: React.PointerEvent, subPathIndex: number, commandIndex: number, pointIndex: number) => {
      if (!isEditingThisSide) return;

      e.stopPropagation();
      (e.target as SVGElement).setPointerCapture(e.pointerId);
      pushHistory();

      const newSelection = {
        layerId: selectedLayerId,
        side: editingSide,
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
      isEditingThisSide,
      pointFromEvent,
      pushHistory,
      selectedLayerId,
      selectPoint,
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
    (e: React.PointerEvent<SVGPathElement>) => {
      if (side !== "preview" || isActionMode || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      (e.currentTarget as SVGPathElement).setPointerCapture(e.pointerId);
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
        translateSelectedLayer(dx, dy, { recordHistory: false });
      };

      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [isActionMode, pushHistory, side, translateSelectedLayer, viewBox.h, viewBox.w],
  );

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
      className="h-full w-full min-w-0 cursor-crosshair touch-none select-none bg-card"
      onClick={handleSvgClick}
      onWheel={handleWheel}
      onPointerDown={handleSvgPointerDown}
      onPointerMove={handleSvgPointerMove}
      onPointerUp={handleSvgPointerUp}
      onDoubleClick={() => {
        const size = 48 / Math.max(0.5, Math.min(8, zoom));
        setViewBox({ x: 24 - size / 2, y: 24 - size / 2, w: size, h: size, scale: zoom });
      }}
      role="img"
      aria-label={`${side} path canvas`}
    >
      {/* Subtle infinite grid + viewport axes */}
      <defs>
        <pattern id={`${gridId}-minor`} width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M 4 0 L 0 0 0 4" className="stroke-muted-foreground/20" fill="none" strokeWidth="0.06" />
        </pattern>
        <pattern id={`${gridId}-major`} width="12" height="12" patternUnits="userSpaceOnUse">
          <path d="M 12 0 L 0 0 0 12" className="stroke-muted-foreground/30" fill="none" strokeWidth="0.08" />
        </pattern>
      </defs>
      <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill={`url(#${gridId}-minor)`} />
      <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={viewBox.h} fill={`url(#${gridId}-major)`} />
      <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={ruler.headerSize} className="fill-card/70" />
      <rect x={viewBox.x} y={viewBox.y} width={ruler.headerSize} height={viewBox.h} className="fill-card/70" />
      <line x1={viewBox.x} y1={viewBox.y + ruler.headerSize} x2={viewBox.x + viewBox.w} y2={viewBox.y + ruler.headerSize} className="stroke-border/70" strokeWidth={ruler.strokeWidth} />
      <line x1={viewBox.x + ruler.headerSize} y1={viewBox.y} x2={viewBox.x + ruler.headerSize} y2={viewBox.y + viewBox.h} className="stroke-border/70" strokeWidth={ruler.strokeWidth} />
      {ruler.xTicks.map((tick) => (
        <g key={`x-${tick}`} aria-hidden="true">
          <line x1={tick} y1={viewBox.y + ruler.headerSize - ruler.tickSize} x2={tick} y2={viewBox.y + ruler.headerSize} className="stroke-border/75" strokeWidth={ruler.strokeWidth} />
          <text
            x={tick}
            y={viewBox.y + ruler.headerSize - ruler.labelOffset}
            className="fill-muted-foreground opacity-70"
            fontSize={ruler.fontSize}
            textAnchor="middle"
            dominantBaseline="alphabetic"
          >
            {formatTick(tick)}
          </text>
        </g>
      ))}
      {ruler.yTicks.map((tick) => (
        <g key={`y-${tick}`} aria-hidden="true">
          <line x1={viewBox.x + ruler.headerSize - ruler.tickSize} y1={tick} x2={viewBox.x + ruler.headerSize} y2={tick} className="stroke-border/75" strokeWidth={ruler.strokeWidth} />
          <text
            x={viewBox.x + ruler.headerSize - ruler.labelOffset}
            y={tick}
            className="fill-muted-foreground opacity-70"
            fontSize={ruler.fontSize}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {formatTick(tick)}
          </text>
        </g>
      ))}
      <line x1="0" y1={viewBox.y} x2="0" y2={viewBox.y + viewBox.h} className="stroke-primary/45" strokeWidth="0.14" />
      <line x1={viewBox.x} y1="0" x2={viewBox.x + viewBox.w} y2="0" className="stroke-primary/45" strokeWidth="0.14" />
      <rect x="0" y="0" width="48" height="48" className="fill-transparent stroke-border/70" strokeWidth="0.18" />
      {/* Box selection rect (select tool) */}
      {boxSelect && (
        <rect
          x={Math.min(boxSelect.start.x, boxSelect.current.x)}
          y={Math.min(boxSelect.start.y, boxSelect.current.y)}
          width={Math.abs(boxSelect.current.x - boxSelect.start.x)}
          height={Math.abs(boxSelect.current.y - boxSelect.start.y)}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth="0.4"
          strokeDasharray="2 1"
          opacity="0.8"
        />
      )}

      {/* The actual path/vector scene */}
      {side === "preview" ? (
        <g className="text-foreground drop-shadow-sm">
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
                  onPointerDown={String(layer.id) === String(selectedLayerId) ? handlePreviewPathPointerDown : undefined}
                  pointerEvents={!isActionMode ? "visiblePainted" : undefined}
                />
              );
            },
          )}
        </g>
      ) : (
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
      )}

      {side === "preview" && !isActionMode && (
        <path
          d={displayPath}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(strokeWidth, 8)}
          className="cursor-move"
          pointerEvents="stroke"
          onPointerDown={handlePreviewPathPointerDown}
        />
      )}

      {side === "preview" && !isActionMode && (
        <path
          d={displayPath}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={Math.max(strokeWidth, 2.2) + 1.6}
          strokeOpacity="0.22"
          strokeLinecap={currentLayer.strokeLinecap ?? "butt"}
          strokeLinejoin={currentLayer.strokeLinejoin ?? "miter"}
          strokeDasharray="1.2 1.2"
          pointerEvents="none"
        />
      )}

      {/* Control points + bezier handles (direct mode fidelity - port of original EditPath/handle rendering) */}
      {isEditingThisSide &&
        commands.map(({ command, subPathIndex, commandIndex }) => {
          const isCubic = command.type === "C";
          const isQuad = command.type === "Q";
          return command.points.map((point, pointIndex) => {
            const isHandle = (isCubic && pointIndex < 2) || (isQuad && pointIndex < 1);
            const showHandles = toolMode === "direct" || toolMode === "select";
            if (isHandle && !showHandles) return null;

            const r = isHandle ? 1.2 : 1.6;
            const fill = isHandle ? "hsl(var(--accent))" : (isSelected(subPathIndex, commandIndex, pointIndex) ? "hsl(var(--primary))" : "hsl(var(--primary))");
            const strokeW = isHandle ? 1 : 2;

            return (
              <g key={`${command.id}-${pointIndex}`}>
                {/* Handle line for cubics (original draws point -> handleIn / handleOut) */}
                {isCubic && showHandles && pointIndex < 2 && (
                  <line
                    x1={command.points[2]?.x ?? point.x}
                    y1={command.points[2]?.y ?? point.y}
                    x2={point.x}
                    y2={point.y}
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth="0.5"
                    strokeDasharray="1 1"
                    opacity={0.6}
                  />
                )}
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={r}
                  className={`cursor-grab transition-[fill,stroke,transform] duration-100 ${
                    isSelected(subPathIndex, commandIndex, pointIndex)
                      ? "stroke-background stroke-2"
                      : isHandle ? "stroke-accent/60 hover:stroke-accent" : "stroke-background stroke-2 hover:stroke-accent"
                  }`}
                  fill={fill}
                  strokeWidth={strokeW}
                  onPointerDown={(e) =>
                    handlePointerDown(e, subPathIndex, commandIndex, pointIndex)
                  }
                />
                {/* Small label for handles in direct mode (dev aid, matches original hit distinction) */}
                {isHandle && toolMode === "direct" && (
                  <text x={point.x + 2} y={point.y - 2} fontSize="3" fill="hsl(var(--muted-foreground))" opacity="0.7">
                    {pointIndex === 0 ? "in" : "out"}
                  </text>
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

function formatTick(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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

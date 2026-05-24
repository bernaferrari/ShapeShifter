"use client";

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import { pathToString, getInterpolatedPath } from "@/lib/shapeshifter/pathUtils";

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

  const [viewBox, setViewBox] = React.useState({ x: 0, y: 0, w: 48, h: 48, scale: 1 });
  const [isPanning, setIsPanning] = React.useState(false);
  const [lastPan, setLastPan] = React.useState({ x: 0, y: 0 });

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
    }
  }, []);

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
    },
    [isPanning, lastPan, viewBox.h, viewBox.w],
  );

  const handleSvgPointerUp = useCallback((e: React.PointerEvent) => {
    setIsPanning(false);
    if (svgRef.current?.hasPointerCapture(e.pointerId)) {
      svgRef.current.releasePointerCapture(e.pointerId);
    }
  }, []);

  const {
    layers,
    selectedLayerId,
    editingSide,
    selection,
    progress,
    snapToGrid,
    pushHistory,
    updateSelectedPoint,
    addPointOnPath,
    selectPoint,
    setEditingSide,
    toolMode,
  } = useEditorStore();

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
  const previewStroke = hasExplicitStroke ? currentLayer.strokeColor : "currentColor";
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
      selectPoint(newSelection);

      const handleMove = (moveEvent: PointerEvent) => {
        const point = pointFromEvent(moveEvent.clientX, moveEvent.clientY);
        if (!point) return;
        let { x, y } = point;

        if (snapToGrid) {
          x = Math.round(x * 2) / 2;
          y = Math.round(y * 2) / 2;
        }

        updateSelectedPoint({ x, y }, { recordHistory: false });
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

  const isSelected = (subPathIndex: number, commandIndex: number, pointIndex: number) =>
    selection?.subPathIndex === subPathIndex &&
    selection?.commandIndex === commandIndex &&
    selection?.pointIndex === pointIndex;

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
      {/* Subtle grid */}
      <defs>
        <pattern id="grid" width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M 4 0 L 0 0 0 4" className="stroke-border" fill="none" strokeWidth="0.4" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="48" height="48" fill="url(#grid)" />

      {/* The actual path */}
      <path
        d={displayPath}
        className={
          side === "preview"
            ? "text-foreground drop-shadow-sm"
            : side === "from"
              ? "drop-shadow-sm"
              : "opacity-85 drop-shadow-sm [stroke-dasharray:4_3]"
        }
        fill={currentLayer.fillColor || "none"}
        fillOpacity={currentLayer.fillAlpha ?? 1}
        stroke={side === "preview" ? previewStroke : currentLayer.strokeColor || fallbackStroke}
        strokeOpacity={currentLayer.strokeAlpha ?? 1}
        strokeWidth={side === "preview" ? Math.max(strokeWidth, 2.2) : strokeWidth}
        strokeLinecap={currentLayer.strokeLinecap ?? "butt"}
        strokeLinejoin={currentLayer.strokeLinejoin ?? "miter"}
        strokeMiterlimit={currentLayer.strokeMiterLimit ?? 4}
        fillRule={currentLayer.fillType === "evenOdd" ? "evenodd" : "nonzero"}
      />

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

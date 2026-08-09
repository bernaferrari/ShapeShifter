"use client";

import React, { useMemo, useRef } from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import { parsePath, pathToString, getInterpolatedPath } from "@/lib/shapeshifter/pathUtils";
import type { PathData } from "@/lib/shapeshifter/types";
import { gradientToSvg } from "@/lib/shapeshifter/gradients";
import { getPreviewLayers } from "./canvas/pathCanvasPreview";
import { useDetailCamera } from "./canvas/useDetailCamera";
import { usePathCanvasGestures } from "./canvas/usePathCanvasGestures";
import {
  compactPathLabel,
  formatAxisTick,
  getPathBounds,
  getResizeEdges,
  getResizeHandles,
  getRotationHandle,
  getRulerModel,
  getSegmentTargets,
  getSubPathBounds,
} from "./canvas/pathCanvasGeometry";
import { usePathCanvasEditing } from "./canvas/usePathCanvasEditing";

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
    zoom,
    detailViewport,
    setDetailViewport,
    fitDetailToVector,
    toolMode,
    isActionMode,
  } = useEditorStore();

  const currentFillColor = layers.find((l) => l.id === selectedLayerId)?.fillColor || "#111111";

  const {
    view: viewBox,
    pointFromClient: pointFromEvent,
    onWheel: handleWheel,
    isPanning,
    startPan,
    updatePan,
    endPan,
  } = useDetailCamera({
    svgRef,
    viewport: detailViewport,
    onViewportChange: setDetailViewport,
    onReset: fitDetailToVector,
    resetKey,
  });

  const {
    marquee: boxSelect,
    lassoPointsRef,
    paintHitRef,
    pointerDownPositionRef: pointerDownPosRef,
    paintCursor: paintBucketCursor,
    onPointerDown: handleSvgPointerDown,
    onPointerMove: handleSvgPointerMove,
    onPointerUp: handleSvgPointerUp,
  } = usePathCanvasGestures({
    side,
    svgRef,
    pointFromClient: pointFromEvent,
    isPanning,
    startPan,
    updatePan,
    endPan,
    toolMode,
    editingSide,
    snapToGrid,
    zoom,
    isActionMode,
    pushHistory,
    paintColor: currentFillColor,
  });

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

  const currentLayer = layers.find((l) => l.id === selectedLayerId);
  if (!currentLayer) return null;

  const isEditingThisSide = side === editingSide;
  const targetPathData = side === "to" ? (currentLayer.to ?? currentLayer.from) : currentLayer.from;

  // Memoized display path (zero friction polish 19u): avoids repeated getInterpolatedPath work
  // on non-progress re-renders of preview canvas (e.g. selection changes elsewhere) while
  // preserving exact prior behavior + deps pattern used by all other memos in this file.
  const displayPath = useMemo(() => {
    if (side === "preview") {
      // Real interpolation using the new engine
      return getInterpolatedPath(currentLayer.from, currentLayer.to ?? currentLayer.from, progress);
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
        ? getPreviewLayers(layers, animation.blocks, animation.duration, progress)
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
  const {
    isVectorEditing,
    canEditPoints,
    onPointPointerDown: handlePointerDown,
    onCanvasClick: handleSvgClick,
    onPreviewPathPointerDown: handlePreviewPathPointerDown,
    onPreviewSubPathPointerDown: handlePreviewSubPathPointerDown,
    onSegmentPointerDown: handleSegmentPointerDown,
    onSegmentMidpointPointerDown: handleSegmentMidpointPointerDown,
    onPreviewPathDoubleClick: handlePreviewPathDoubleClick,
    onResizePointerDown: handleResizePointerDown,
    onRotatePointerDown: handleRotatePointerDown,
    onCanvasDoubleClick: handleCanvasDoubleClick,
    isPointSelected: isSelected,
  } = usePathCanvasEditing({
    side,
    svgRef,
    view: viewBox,
    pointFromClient: pointFromEvent,
    pointerDownPositionRef: pointerDownPosRef,
    currentLayer,
    selectedLayerId,
    editingSide,
    selectedPoints,
    selection,
    selectedLayerSubPaths: selectedLayerSubPathSelections,
    isEditingThisSide,
    isActionMode,
    snapToGrid,
    selectedLayerBounds,
    selectedPreviewTransform,
  });
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

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      className={`h-full w-full min-w-0 touch-none select-none bg-card ${
        isPanning
          ? "cursor-grab"
          : side === "preview" && !isActionMode
            ? "cursor-default"
            : "cursor-crosshair"
      }`}
      style={toolMode === "paint" ? { cursor: paintBucketCursor } : undefined}
      onClick={handleSvgClick}
      onWheel={handleWheel}
      onPointerDown={handleSvgPointerDown}
      onPointerMove={handleSvgPointerMove}
      onPointerUp={handleSvgPointerUp}
      onDoubleClick={handleCanvasDoubleClick}
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
            fillOpacity={currentLayer.fillGradient ? 1 : (currentLayer.fillAlpha ?? 1)}
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
                data-segment="1"
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
                onPointerDown={(event) => handleSegmentMidpointPointerDown(event, segment)}
                data-segment="1"
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
                    data-point="1"
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
                    onPointerDown={(e) =>
                      handlePointerDown(e, subPathIndex, commandIndex, pointIndex)
                    }
                    data-point="1"
                  />
                )}
              </g>
            );
          });
        })}
    </svg>
  );
});

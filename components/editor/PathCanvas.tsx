"use client";

import React, { useRef, useCallback } from "react";
import { useEditorStore } from "@/lib/store/editorStore";
import { getAllCommands, pathToString, getInterpolatedPath } from "@/lib/shapeshifter/pathUtils";
import { Command } from "@/lib/shapeshifter/types";

interface PathCanvasProps {
  resetKey?: number;
  side: "from" | "to" | "preview";
  width?: number;
  height?: number;
}

export const PathCanvas = React.memo(function PathCanvas({
  side,
  width = 520,
  height = 520,
  resetKey,
}: PathCanvasProps & { resetKey?: number }) {
  const svgRef = useRef<SVGSVGElement>(null);

  // Pan and Zoom state (local to each canvas for independence)
  const [viewBox, setViewBox] = React.useState({ x: 0, y: 0, w: 48, h: 48, scale: 1 });

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;

      const mouseX = ((e.clientX - rect.left) / rect.width) * viewBox.w + viewBox.x;
      const mouseY = ((e.clientY - rect.top) / rect.height) * viewBox.h + viewBox.y;

      const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
      const newScale = Math.max(0.5, Math.min(10, viewBox.scale * zoomFactor));
      const newW = 48 / newScale;
      const newH = 48 / newScale;

      const newX = mouseX - (mouseX - viewBox.x) * (newW / viewBox.w);
      const newY = mouseY - (mouseY - viewBox.y) * (newH / viewBox.h);

      setViewBox({ x: newX, y: newY, w: newW, h: newH, scale: newScale });
    },
    [viewBox],
  );

  // Pan with middle mouse or when holding space (simplified: drag background)
  const [isPanning, setIsPanning] = React.useState(false);
  const [lastPan, setLastPan] = React.useState({ x: 0, y: 0 });

  const handleSvgPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button === 1 || e.buttons === 4) {
      // middle mouse
      setIsPanning(true);
      setLastPan({ x: e.clientX, y: e.clientY });
      (e.target as SVGElement).setPointerCapture(e.pointerId);
    }
  }, []);

  const handleSvgPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (isPanning) {
        const dx = (e.clientX - lastPan.x) / (520 / viewBox.w);
        const dy = (e.clientY - lastPan.y) / (520 / viewBox.h);
        setViewBox((prev) => ({ ...prev, x: prev.x - dx, y: prev.y - dy }));
        setLastPan({ x: e.clientX, y: e.clientY });
      }
    },
    [isPanning, lastPan, viewBox.w],
  );

  const handleSvgPointerUp = useCallback(() => {
    setIsPanning(false);
  }, []);

  const {
    layers,
    selectedLayerId,
    editingSide,
    selection,
    progress,
    snapToGrid,
    updateSelectedPoint,
    addPointOnPath,
    selectPoint,
    clearSelection,
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

  const commands = getAllCommands(targetPathData);

  // Dragging logic
  const handlePointerDown = useCallback(
    (e: React.PointerEvent, cmdIndex: number, pointIndex: number) => {
      if (!isEditingThisSide) return;

      e.stopPropagation();
      (e.target as SVGElement).setPointerCapture(e.pointerId);

      const newSelection = {
        layerId: selectedLayerId,
        side: editingSide,
        subPathIndex: 0,
        commandIndex: cmdIndex,
        pointIndex,
      };
      selectPoint(newSelection);

      const handleMove = (moveEvent: PointerEvent) => {
        if (!svgRef.current) return;

        const rect = svgRef.current.getBoundingClientRect();
        let x = ((moveEvent.clientX - rect.left) / rect.width) * 48;
        let y = ((moveEvent.clientY - rect.top) / rect.height) * 48;

        if (snapToGrid) {
          x = Math.round(x * 2) / 2;
          y = Math.round(y * 2) / 2;
        }

        updateSelectedPoint({ x, y });
      };

      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };

      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [isEditingThisSide, selectedLayerId, editingSide, snapToGrid, updateSelectedPoint, selectPoint],
  );

  // Click on SVG background / path to add point
  const handleSvgClick = useCallback(
    (e: React.MouseEvent<SVGSVGElement>) => {
      if (!isEditingThisSide || !svgRef.current) return;

      const rect = svgRef.current.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 48;
      const y = ((e.clientY - rect.top) / rect.height) * 48;

      // Add point
      addPointOnPath(x, y);
    },
    [isEditingThisSide, addPointOnPath],
  );

  const isSelected = (cmdIdx: number, ptIdx: number) =>
    selection?.commandIndex === cmdIdx && selection?.pointIndex === ptIdx;

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox="0 0 48 48"
      className="path-canvas cursor-crosshair"
      onClick={handleSvgClick}
    >
      {/* Subtle grid */}
      <defs>
        <pattern id="grid" width="4" height="4" patternUnits="userSpaceOnUse">
          <path d="M 4 0 L 0 0 0 4" fill="none" stroke="var(--editor-grid)" strokeWidth="0.4" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="48" height="48" fill="url(#grid)" />

      {/* The actual path */}
      <path
        d={displayPath}
        className={side === "preview" ? "path-preview" : side === "from" ? "path-from" : "path-to"}
        fill="none"
        strokeWidth={side === "preview" ? 2.5 : 2.2}
      />

      {/* Control points (only for from/to when editing) */}
      {isEditingThisSide &&
        commands.map((cmd, cmdIdx) =>
          cmd.points.map((point, ptIdx) => (
            <g key={`${cmd.id}-${ptIdx}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r="1.6"
                className={`control-point ${isSelected(cmdIdx, ptIdx) ? "selected" : ""}`}
                onPointerDown={(e) => handlePointerDown(e, cmdIdx, ptIdx)}
              />
            </g>
          )),
        )}
    </svg>
  );
});

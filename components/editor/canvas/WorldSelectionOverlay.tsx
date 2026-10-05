"use client";

import React, { memo, useMemo } from "react";
import type { AnimationState, Layer, PathData, Point } from "@/lib/shapeshifter/types";
import type { SceneRect } from "@/lib/shapeshifter/scene/selection";
import {
  inverseAffine,
  transformPointWithMatrix,
  type AffineMatrix,
} from "@/lib/shapeshifter/scene/layerTransform";
import type { EvaluatedTransform } from "@/lib/shapeshifter/scene/evaluate";
import { buildWorldTransformSelection } from "./worldLayerTransforms";
import { useCoarsePointer } from "../hooks/useCompactLayout";

export interface FrozenLayerTransform {
  id: string | number;
  transform: EvaluatedTransform;
  worldMatrix: AffineMatrix;
  parentMatrix: AffineMatrix;
}

export type LayerResizeHandle = "nw" | "ne" | "sw" | "se" | "e" | "w" | "n" | "s";

export interface LayerResizeSession {
  handle: LayerResizeHandle;
  origin: SceneRect;
  grabOffset: Point;
  coordinateMatrix?: AffineMatrix;
  ownerOrigin?: Point;
  preserveAspect?: boolean;
  items: Array<{
    id: string | number;
    origFrom: PathData;
    origTo: PathData | null;
    origin: SceneRect;
    frameOrigin?: SceneRect;
    baseTranslate?: Point;
    evaluated?: FrozenLayerTransform;
  }>;
  moved: boolean;
}

const ROTATE_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M6 14a6 6 0 1 0 2-8.5" fill="none" stroke="white" stroke-width="4" stroke-linecap="round"/><path d="M6 14a6 6 0 1 0 2-8.5" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round"/><path d="M4 3.5v4.5h4.5" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 3.5v4.5h4.5" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
)}") 12 12, crosshair`;

export interface LayerRotateSession {
  center: Point;
  ownerOrigin: Point;
  startAngle: number;
  coordinateMatrix?: AffineMatrix;
  baseTransforms: Array<{
    id: string | number;
    rotation: number;
    translateX: number;
    translateY: number;
    pivotX: number;
    pivotY: number;
    evaluated?: FrozenLayerTransform;
  }>;
  moved: boolean;
}

interface WorldSelectionOverlayProps {
  visible: boolean;
  activeOrigin: Point | null;
  activeLayers: Layer[];
  animation?: AnimationState;
  progress?: number;
  activeLayerIds: Array<string | number>;
  selectedOwnerCount: number;
  documentBounds: SceneRect | null;
  worldPerPx: number;
  worldPointFromClient: (clientX: number, clientY: number) => Point | null;
  onResizeStart: (session: LayerResizeSession, pointerId: number) => void;
  onRotateStart: (session: LayerRotateSession, pointerId: number) => void;
}

function resizeCursor(handle: LayerResizeHandle, matrix: AffineMatrix) {
  const x = handle.includes("w") ? -1 : handle.includes("e") ? 1 : 0;
  const y = handle.includes("n") ? -1 : handle.includes("s") ? 1 : 0;
  const xLength = Math.hypot(matrix.a, matrix.b) || 1;
  const yLength = Math.hypot(matrix.c, matrix.d) || 1;
  const direction = {
    x: (matrix.a / xLength) * x + (matrix.c / yLength) * y,
    y: (matrix.b / xLength) * x + (matrix.d / yLength) * y,
  };
  const step = Math.round((Math.atan2(direction.y, direction.x) * 4) / Math.PI);
  return ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"][((step % 4) + 4) % 4]!;
}

function WorldSelectionOverlayComponent({
  visible,
  activeOrigin,
  activeLayers,
  animation,
  progress = 0,
  activeLayerIds,
  selectedOwnerCount,
  documentBounds,
  worldPerPx,
  worldPointFromClient,
  onResizeStart,
  onRotateStart,
}: WorldSelectionOverlayProps) {
  const coarsePointer = useCoarsePointer();
  const selection = useMemo(() => {
    if (!activeOrigin || selectedOwnerCount > 1 || activeLayerIds.length === 0) return null;
    return buildWorldTransformSelection(activeLayers, activeLayerIds, animation, progress);
  }, [activeLayerIds, activeLayers, activeOrigin, selectedOwnerCount, animation, progress]);

  if (!visible) return null;
  if (selectedOwnerCount > 1) {
    return documentBounds ? (
      <rect
        x={documentBounds.x}
        y={documentBounds.y}
        width={Math.max(0.01, documentBounds.w)}
        height={Math.max(0.01, documentBounds.h)}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    ) : null;
  }
  if (!selection || !activeOrigin) return null;

  const local = selection.bounds;
  const worldPoint = (point: Point) => {
    const ownerPoint = transformPointWithMatrix(point, selection.coordinateMatrix);
    return { x: activeOrigin.x + ownerPoint.x, y: activeOrigin.y + ownerPoint.y };
  };
  const handleSize = worldPerPx * 3;
  // Invisible grab area around each handle; fingers need a much larger one.
  const handleHit = handleSize * (coarsePointer ? 12 : 5);
  const handles = (
    [
      { handle: "nw", x: local.x, y: local.y },
      { handle: "ne", x: local.x + local.w, y: local.y },
      { handle: "sw", x: local.x, y: local.y + local.h },
      { handle: "se", x: local.x + local.w, y: local.y + local.h },
      { handle: "n", x: local.x + local.w / 2, y: local.y },
      { handle: "s", x: local.x + local.w / 2, y: local.y + local.h },
      { handle: "w", x: local.x, y: local.y + local.h / 2 },
      { handle: "e", x: local.x + local.w, y: local.y + local.h / 2 },
    ] satisfies Array<{ handle: LayerResizeHandle; x: number; y: number }>
  ).map((handle) => ({ ...handle, ...worldPoint(handle) }));
  const freezeItems = (): LayerResizeSession["items"] =>
    selection.items.map(({ node, localBounds, evaluated }) => ({
      id: node.id,
      origFrom: node.layer.from,
      origTo: node.layer.to ?? null,
      origin: localBounds,
      evaluated,
    }));
  const beginResize = (event: React.PointerEvent<SVGElement>, handle: LayerResizeHandle) => {
    if (!event.isPrimary || event.button !== 0 || !selection.items.length) return;
    event.stopPropagation();
    event.preventDefault();
    const corner = {
      x: handle.includes("w")
        ? local.x
        : handle.includes("e")
          ? local.x + local.w
          : local.x + local.w / 2,
      y: handle.includes("n")
        ? local.y
        : handle.includes("s")
          ? local.y + local.h
          : local.y + local.h / 2,
    };
    const pointer = worldPointFromClient(event.clientX, event.clientY);
    const inverse = inverseAffine(selection.coordinateMatrix);
    if (!inverse) return;
    const localPointer = pointer
      ? transformPointWithMatrix(
          { x: pointer.x - activeOrigin.x, y: pointer.y - activeOrigin.y },
          inverse,
        )
      : corner;
    onResizeStart(
      {
        handle,
        origin: local,
        ownerOrigin: activeOrigin,
        coordinateMatrix: selection.coordinateMatrix,
        preserveAspect: selection.preserveAspect,
        grabOffset: { x: localPointer.x - corner.x, y: localPointer.y - corner.y },
        items: freezeItems(),
        moved: false,
      },
      event.pointerId,
    );
  };
  const center = worldPoint({ x: local.x + local.w / 2, y: local.y + local.h / 2 });
  const beginRotate = (event: React.PointerEvent<SVGCircleElement>) => {
    if (!event.isPrimary || event.button !== 0 || !selection.canRotate) return;
    event.stopPropagation();
    event.preventDefault();
    const pointer = worldPointFromClient(event.clientX, event.clientY);
    const inverse = inverseAffine(selection.rotationMatrix);
    if (!pointer || !inverse) return;
    const localPointer = transformPointWithMatrix(
      { x: pointer.x - activeOrigin.x, y: pointer.y - activeOrigin.y },
      inverse,
    );
    const localCenter = transformPointWithMatrix(
      { x: center.x - activeOrigin.x, y: center.y - activeOrigin.y },
      inverse,
    );
    onRotateStart(
      {
        center,
        coordinateMatrix: selection.rotationMatrix,
        startAngle:
          (Math.atan2(localPointer.y - localCenter.y, localPointer.x - localCenter.x) * 180) /
          Math.PI,
        ownerOrigin: activeOrigin,
        baseTransforms: selection.items.map(({ node, evaluated }) => ({
          id: node.id,
          ...evaluated.transform,
          evaluated,
        })),
        moved: false,
      },
      event.pointerId,
    );
  };
  const matrix = selection.coordinateMatrix;
  const outlineTransform = `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e + activeOrigin.x} ${matrix.f + activeOrigin.y})`;
  const byHandle = new Map(handles.map((handle) => [handle.handle, handle]));
  const edges = [
    { handle: "n" as const, start: "nw" as const, end: "ne" as const },
    { handle: "s" as const, start: "sw" as const, end: "se" as const },
    { handle: "w" as const, start: "nw" as const, end: "sw" as const },
    { handle: "e" as const, start: "ne" as const, end: "se" as const },
  ];
  return (
    <g pointerEvents="none" data-selection-frame="true">
      <rect
        x={local.x}
        y={local.y}
        width={local.w}
        height={local.h}
        transform={outlineTransform}
        fill="none"
        stroke="var(--primary)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      {/* Figma: no rotation knob. Drag just outside a corner to rotate. */}
      {selection.canRotate &&
        (["nw", "ne", "se", "sw"] as const).map((corner) => {
          const point = byHandle.get(corner);
          if (!point) return null;
          const dx = point.x - center.x;
          const dy = point.y - center.y;
          const length = Math.hypot(dx, dy) || 1;
          const offset = worldPerPx * 12;
          return (
            <circle
              key={`rotate-${corner}`}
              cx={point.x + (dx / length) * offset}
              cy={point.y + (dy / length) * offset}
              r={worldPerPx * 11}
              fill="transparent"
              pointerEvents="all"
              data-rotate-handle={corner}
              style={{ cursor: ROTATE_CURSOR, pointerEvents: "auto" }}
              onPointerDown={beginRotate}
            />
          );
        })}
      {selection.items.length > 0 && (
        <>
          {edges.map(({ handle, start, end }) => {
            const from = byHandle.get(start)!;
            const to = byHandle.get(end)!;
            return (
              <line
                key={`hit-${handle}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="transparent"
                strokeWidth={10}
                pointerEvents="stroke"
                vectorEffect="non-scaling-stroke"
                style={{
                  cursor: resizeCursor(handle, selection.coordinateMatrix),
                  pointerEvents: "stroke",
                }}
                onPointerDown={(event) => beginResize(event, handle)}
              />
            );
          })}
          {handles.map(({ handle, x, y }) => (
            <g
              key={handle}
              pointerEvents="all"
              style={{ cursor: resizeCursor(handle, selection.coordinateMatrix) }}
              data-resize-handle={handle}
              onPointerDown={(event) => beginResize(event, handle)}
            >
              <rect
                x={x - handleHit / 2}
                y={y - handleHit / 2}
                width={handleHit}
                height={handleHit}
                fill="transparent"
              />
              {handle.length === 2 && (
                <rect
                  x={x - handleSize}
                  y={y - handleSize}
                  width={handleSize * 2}
                  height={handleSize * 2}
                  rx={worldPerPx}
                  fill="#ffffff"
                  stroke="var(--primary)"
                  strokeWidth={1.25}
                  vectorEffect="non-scaling-stroke"
                />
              )}
            </g>
          ))}
        </>
      )}
    </g>
  );
}

export const WorldSelectionOverlay = memo(WorldSelectionOverlayComponent);

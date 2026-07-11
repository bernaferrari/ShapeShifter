"use client";

import React, { memo, useMemo } from "react";
import { getPathDataBounds } from "@/lib/shapeshifter/pathUtils";
import type { Layer, PathData, Point } from "@/lib/shapeshifter/types";
import type { SceneRect } from "@/lib/shapeshifter/scene/selection";

export type LayerResizeHandle = "nw" | "ne" | "sw" | "se" | "e" | "w" | "n" | "s";

export interface LayerResizeSession {
  handle: LayerResizeHandle;
  origin: SceneRect;
  grabOffset: Point;
  items: Array<{
    id: string | number;
    origFrom: PathData;
    origTo: PathData | null;
    origin: SceneRect;
    frameOrigin?: SceneRect;
    baseTranslate?: Point;
  }>;
  moved: boolean;
}

export interface LayerRotateSession {
  center: Point;
  startAngle: number;
  baseRotations: Array<{ id: string | number; rotation: number }>;
  moved: boolean;
}

interface WorldSelectionOverlayProps {
  visible: boolean;
  activeOrigin: Point | null;
  activeLayers: Layer[];
  activeLayerIds: Array<string | number>;
  selectedOwnerCount: number;
  documentBounds: SceneRect | null;
  worldPerPx: number;
  worldPointFromClient: (clientX: number, clientY: number) => Point | null;
  onResizeStart: (session: LayerResizeSession, pointerId: number) => void;
  onRotateStart: (session: LayerRotateSession, pointerId: number) => void;
}

const HANDLE_CURSORS: Record<LayerResizeHandle, string> = {
  nw: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  se: "nwse-resize",
  n: "ns-resize",
  s: "ns-resize",
  w: "ew-resize",
  e: "ew-resize",
};

function WorldSelectionOverlayComponent({
  visible,
  activeOrigin,
  activeLayers,
  activeLayerIds,
  selectedOwnerCount,
  documentBounds,
  worldPerPx,
  worldPointFromClient,
  onResizeStart,
  onRotateStart,
}: WorldSelectionOverlayProps) {
  const selection = useMemo(() => {
    if (!activeOrigin || selectedOwnerCount > 1 || activeLayerIds.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const items: Array<{
      layer: Layer;
      bounds: SceneRect;
      translate: Point;
    }> = [];
    const selected = new Set(activeLayerIds.map(String));
    for (const layer of activeLayers) {
      if (!selected.has(String(layer.id)) || layer.type === "group") continue;
      const bounds = getPathDataBounds((layer.pathData ?? layer.from) as PathData);
      if (!bounds) continue;
      const translate = {
        x: Number(layer.translateX) || 0,
        y: Number(layer.translateY) || 0,
      };
      items.push({ layer, bounds, translate });
      minX = Math.min(minX, bounds.x + translate.x);
      minY = Math.min(minY, bounds.y + translate.y);
      maxX = Math.max(maxX, bounds.x + bounds.w + translate.x);
      maxY = Math.max(maxY, bounds.y + bounds.h + translate.y);
    }
    if (!Number.isFinite(minX)) return null;
    return {
      items,
      localBounds: {
        x: minX,
        y: minY,
        w: Math.max(0.01, maxX - minX),
        h: Math.max(0.01, maxY - minY),
      },
    };
  }, [activeLayerIds, activeLayers, activeOrigin, selectedOwnerCount]);

  if (!visible) return null;
  if (selectedOwnerCount > 1) {
    return documentBounds ? (
      <rect
        x={documentBounds.x}
        y={documentBounds.y}
        width={Math.max(0.01, documentBounds.w)}
        height={Math.max(0.01, documentBounds.h)}
        fill="none"
        stroke="#0d99ff"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        pointerEvents="none"
      />
    ) : null;
  }
  if (!selection || !activeOrigin) return null;

  const local = selection.localBounds;
  const world = {
    x: activeOrigin.x + local.x,
    y: activeOrigin.y + local.y,
    w: local.w,
    h: local.h,
  };
  const handleSize = worldPerPx * 3;
  const edgeHitSize = worldPerPx * 5;
  const handles: Array<{
    handle: LayerResizeHandle;
    x: number;
    y: number;
  }> = [
    { handle: "nw", x: world.x, y: world.y },
    { handle: "ne", x: world.x + world.w, y: world.y },
    { handle: "sw", x: world.x, y: world.y + world.h },
    { handle: "se", x: world.x + world.w, y: world.y + world.h },
    { handle: "n", x: world.x + world.w / 2, y: world.y },
    { handle: "s", x: world.x + world.w / 2, y: world.y + world.h },
    { handle: "w", x: world.x, y: world.y + world.h / 2 },
    { handle: "e", x: world.x + world.w, y: world.y + world.h / 2 },
  ];
  const freezeItems = (): LayerResizeSession["items"] =>
    selection.items
      .filter(({ layer }) => !layer.locked)
      .map(({ layer, bounds, translate }) => ({
        id: layer.id,
        origFrom: structuredClone((layer.from ?? layer.pathData) as PathData),
        origTo: layer.to ? structuredClone(layer.to as PathData) : null,
        origin: { ...bounds },
        frameOrigin: {
          x: bounds.x + translate.x,
          y: bounds.y + translate.y,
          w: bounds.w,
          h: bounds.h,
        },
        baseTranslate: { ...translate },
      }));
  const beginResize = (event: React.PointerEvent<SVGElement>, handle: LayerResizeHandle) => {
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
    const localPointer = pointer
      ? { x: pointer.x - activeOrigin.x, y: pointer.y - activeOrigin.y }
      : corner;
    onResizeStart(
      {
        handle,
        origin: { ...local },
        grabOffset: {
          x: localPointer.x - corner.x,
          y: localPointer.y - corner.y,
        },
        items: freezeItems(),
        moved: false,
      },
      event.pointerId,
    );
  };
  const rotateHandle = {
    x: world.x + world.w / 2,
    y: world.y - worldPerPx * 18,
  };
  const beginRotate = (event: React.PointerEvent<SVGCircleElement>) => {
    event.stopPropagation();
    event.preventDefault();
    const pointer = worldPointFromClient(event.clientX, event.clientY);
    if (!pointer) return;
    const center = { x: world.x + world.w / 2, y: world.y + world.h / 2 };
    onRotateStart(
      {
        center,
        startAngle:
          (Math.atan2(pointer.y - center.y, pointer.x - center.x) * 180) / Math.PI,
        baseRotations: selection.items.map(({ layer }) => ({
          id: layer.id,
          rotation: Number(layer.rotation) || 0,
        })),
        moved: false,
      },
      event.pointerId,
    );
  };

  return (
    <g pointerEvents="none">
      <rect
        x={world.x}
        y={world.y}
        width={world.w}
        height={world.h}
        fill="none"
        stroke="#0d99ff"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
      <line
        x1={rotateHandle.x}
        y1={world.y}
        x2={rotateHandle.x}
        y2={rotateHandle.y}
        stroke="#0d99ff"
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx={rotateHandle.x}
        cy={rotateHandle.y}
        r={handleSize * 1.1}
        fill="#ffffff"
        stroke="#0d99ff"
        strokeWidth={1.25}
        vectorEffect="non-scaling-stroke"
        pointerEvents="all"
        style={{ cursor: "grab", pointerEvents: "auto" }}
        onPointerDown={beginRotate}
      />
      {handles
        .filter(({ handle }) => handle.length === 1)
        .map(({ handle }) => {
          const edge =
            handle === "n"
              ? { x1: world.x, y1: world.y, x2: world.x + world.w, y2: world.y }
              : handle === "s"
                ? {
                    x1: world.x,
                    y1: world.y + world.h,
                    x2: world.x + world.w,
                    y2: world.y + world.h,
                  }
                : handle === "w"
                  ? { x1: world.x, y1: world.y, x2: world.x, y2: world.y + world.h }
                  : {
                      x1: world.x + world.w,
                      y1: world.y,
                      x2: world.x + world.w,
                      y2: world.y + world.h,
                    };
          return (
            <line
              key={`hit-${handle}`}
              {...edge}
              stroke="transparent"
              strokeWidth={edgeHitSize * 2}
              pointerEvents="stroke"
              vectorEffect="non-scaling-stroke"
              style={{ cursor: HANDLE_CURSORS[handle], pointerEvents: "stroke" }}
              onPointerDown={(event) => beginResize(event, handle)}
            />
          );
        })}
      {handles.map(({ handle, x, y }) => (
        <rect
          key={handle}
          x={x - handleSize}
          y={y - handleSize}
          width={handleSize * 2}
          height={handleSize * 2}
          rx={worldPerPx}
          fill="#ffffff"
          stroke="#0d99ff"
          strokeWidth={1.25}
          vectorEffect="non-scaling-stroke"
          pointerEvents="all"
          style={{ cursor: HANDLE_CURSORS[handle], pointerEvents: "auto" }}
          onPointerDown={(event) => beginResize(event, handle)}
        />
      ))}
    </g>
  );
}

export const WorldSelectionOverlay = memo(WorldSelectionOverlayComponent);

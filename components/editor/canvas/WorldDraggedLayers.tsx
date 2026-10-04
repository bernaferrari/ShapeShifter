import React from "react";
import { getAccuratePathBounds, parsePath } from "@/lib/shapeshifter/pathUtils";
import { transformPointWithMatrix } from "@/lib/shapeshifter/scene/layerTransform";
import { unionRects } from "@/lib/shapeshifter/scene/selection";
import type { WorldLayerDraw } from "@/lib/shapeshifter/scene/render";
import type { VectorMetadata } from "@/lib/shapeshifter/types";
import { ClipDefinitions, LayerDraw, VectorDrawableRootPaint } from "./WorldArtboards";

export interface DraggedWorldLayerDraw extends WorldLayerDraw {
  ownerId: string;
  origin: { x: number; y: number };
  vector?: VectorMetadata;
}

function paintBounds(draw: WorldLayerDraw) {
  const bounds = getAccuratePathBounds(parsePath(draw.d));
  if (!bounds) return [];
  const corners = [
    { x: bounds.x, y: bounds.y },
    { x: bounds.x + bounds.w, y: bounds.y },
    { x: bounds.x, y: bounds.y + bounds.h },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h },
  ].map((point) => transformPointWithMatrix(point, draw.worldMatrix));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const radius = draw.stroke ? (draw.strokeWidth / 2) * Math.max(1, draw.strokeMiterLimit) : 0;
  const paddingX = radius * Math.hypot(draw.worldMatrix.a, draw.worldMatrix.c);
  const paddingY = radius * Math.hypot(draw.worldMatrix.b, draw.worldMatrix.d);
  return [
    {
      x: Math.min(...xs) - paddingX,
      y: Math.min(...ys) - paddingY,
      w: Math.max(0.01, Math.max(...xs) - Math.min(...xs) + paddingX * 2),
      h: Math.max(0.01, Math.max(...ys) - Math.min(...ys) + paddingY * 2),
    },
  ];
}

/** Keep live artwork above every artboard with the same clips, trims, and paint as the canvas. */
export function WorldDraggedLayers({
  draws,
}: {
  draws: DraggedWorldLayerDraw[];
  worldPerPx: number;
}) {
  const owners = new Map<string, DraggedWorldLayerDraw[]>();
  for (const draw of draws) owners.set(draw.ownerId, [...(owners.get(draw.ownerId) ?? []), draw]);
  return [...owners].map(([ownerId, ownerDraws]) => {
    const first = ownerDraws[0]!;
    const bounds = unionRects(ownerDraws.flatMap(paintBounds));
    const content = ownerDraws
      .filter((draw) => !draw.isClipPath)
      .map((draw) => <LayerDraw key={String(draw.id)} draw={draw} ownerId={`drag-${ownerId}`} />);
    return (
      <g
        key={ownerId}
        transform={`translate(${first.origin.x} ${first.origin.y})`}
        pointerEvents="none"
        data-dragged-owner={ownerId}
      >
        <ClipDefinitions draws={ownerDraws} ownerId={`drag-${ownerId}`} />
        {first.vector && bounds ? (
          <VectorDrawableRootPaint
            vector={first.vector}
            ownerId={`drag-${ownerId}`}
            width={bounds.w}
            height={bounds.h}
            bounds={bounds}
          >
            {content}
          </VectorDrawableRootPaint>
        ) : (
          content
        )}
      </g>
    );
  });
}

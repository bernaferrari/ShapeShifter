import React from "react";
import { gradientDomId, gradientToSvg } from "@/lib/shapeshifter/gradients";
import { layerTransformToSvg } from "@/lib/shapeshifter/scene/layerTransform";
import type { WorldLayerDraw } from "@/lib/shapeshifter/scene/render";

export interface DraggedWorldLayerDraw extends WorldLayerDraw {
  ownerId: string;
  origin: { x: number; y: number };
}

/** Keeps an in-flight object above every artboard until ownership changes on drop. */
export function WorldDraggedLayers({
  draws,
  worldPerPx,
}: {
  draws: DraggedWorldLayerDraw[];
  worldPerPx: number;
}) {
  return draws.map((draw) => {
    const gradId = draw.fillGradient ? `${gradientDomId(`drag-${draw.ownerId}`)}-${draw.id}` : null;
    return (
      <g
        key={`drag-${draw.ownerId}-${draw.id}`}
        transform={`translate(${draw.origin.x} ${draw.origin.y})`}
        pointerEvents="none"
      >
        <g transform={layerTransformToSvg(draw)}>
          {draw.fillGradient && gradId && (
            <defs
              dangerouslySetInnerHTML={{
                __html: gradientToSvg(draw.fillGradient, gradId, draw.fillOpacity),
              }}
            />
          )}
          <path
            d={draw.d}
            fill={gradId ? `url(#${gradId})` : (draw.fill ?? "none")}
            fillOpacity={gradId ? 1 : draw.fillOpacity}
            fillRule={draw.fillType === "evenOdd" ? "evenodd" : "nonzero"}
            stroke={draw.stroke ?? (draw.fill || draw.fillGradient ? "none" : "#111111")}
            strokeOpacity={draw.strokeOpacity}
            strokeWidth={draw.strokeWidth || worldPerPx}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      </g>
    );
  });
}

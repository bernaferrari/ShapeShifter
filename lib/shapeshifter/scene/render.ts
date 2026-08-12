import type { AnimationState, Layer } from "../types";
import { evaluateAndroidScene } from "./evaluate";
import type { AffineMatrix } from "./layerTransform";

/** Render-ready paths resolved from the shared Android scene evaluator. */
export interface WorldLayerDraw {
  id: string | number;
  d: string;
  fill: string | null;
  stroke: string | null;
  fillOpacity: number;
  strokeOpacity: number;
  strokeWidth: number;
  fillGradient: Layer["fillGradient"];
  fillType: Layer["fillType"];
  strokeLinecap: NonNullable<Layer["strokeLinecap"]>;
  strokeLinejoin: NonNullable<Layer["strokeLinejoin"]>;
  strokeMiterLimit: number;
  strokeDasharray?: string;
  trimPathStart: number;
  trimPathEnd: number;
  trimPathOffset: number;
  translateX: number;
  translateY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  pivotX: number;
  pivotY: number;
  worldMatrix: AffineMatrix;
  clipNodeIds: Array<string | number>;
  isClipPath: boolean;
  parentId: string | number | null;
}

/** Resolve one owner document into a path draw list at the current playhead. */
export function resolveWorldLayerDraws(
  layers: Layer[],
  animation: AnimationState,
  progress: number,
  usePlayhead: boolean,
): WorldLayerDraw[] {
  return evaluateAndroidScene(layers, animation, progress, usePlayhead).nodes.flatMap((node) => {
    if (!node.visible || (node.type !== "path" && node.type !== "clipPath")) return [];
    return [
      {
        id: node.id,
        d: node.d,
        fill: node.fill,
        stroke: node.stroke,
        fillOpacity: node.fillOpacity,
        strokeOpacity: node.strokeOpacity,
        strokeWidth: node.strokeWidth,
        fillGradient: node.fillGradient,
        fillType: node.fillType,
        strokeLinecap: node.strokeLinecap ?? "butt",
        strokeLinejoin: node.strokeLinejoin ?? "miter",
        strokeMiterLimit: node.strokeMiterLimit,
        strokeDasharray: node.strokeDasharray,
        trimPathStart: node.trimPathStart,
        trimPathEnd: node.trimPathEnd,
        trimPathOffset: node.trimPathOffset,
        ...node.transform,
        worldMatrix: node.worldMatrix,
        clipNodeIds: node.clipNodeIds,
        isClipPath: node.type === "clipPath",
        parentId: node.parentId,
      },
    ];
  });
}

import type { Point } from "../types";
import type { SceneRect } from "./selection";

export interface LayerTransformValues {
  translateX?: number;
  translateY?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  pivotX?: number;
  pivotY?: number;
}

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

export function layerTransformToSvg(values: LayerTransformValues): string | undefined {
  const tx = finite(values.translateX, 0);
  const ty = finite(values.translateY, 0);
  const rotation = finite(values.rotation, 0);
  const sx = finite(values.scaleX, 1);
  const sy = finite(values.scaleY, 1);
  const px = finite(values.pivotX, 0);
  const py = finite(values.pivotY, 0);
  const parts = [
    tx || ty ? `translate(${tx} ${ty})` : "",
    px || py ? `translate(${px} ${py})` : "",
    rotation ? `rotate(${rotation})` : "",
    sx !== 1 || sy !== 1 ? `scale(${sx} ${sy})` : "",
    px || py ? `translate(${-px} ${-py})` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : undefined;
}

export function transformLayerPoint(point: Point, values: LayerTransformValues): Point {
  const tx = finite(values.translateX, 0);
  const ty = finite(values.translateY, 0);
  const rotation = (finite(values.rotation, 0) * Math.PI) / 180;
  const sx = finite(values.scaleX, 1);
  const sy = finite(values.scaleY, 1);
  const px = finite(values.pivotX, 0);
  const py = finite(values.pivotY, 0);
  const scaledX = (point.x - px) * sx;
  const scaledY = (point.y - py) * sy;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: scaledX * cos - scaledY * sin + px + tx,
    y: scaledX * sin + scaledY * cos + py + ty,
  };
}

export function inverseTransformLayerPoint(
  point: Point,
  values: LayerTransformValues,
): Point | null {
  const tx = finite(values.translateX, 0);
  const ty = finite(values.translateY, 0);
  const rotation = (-finite(values.rotation, 0) * Math.PI) / 180;
  const sx = finite(values.scaleX, 1);
  const sy = finite(values.scaleY, 1);
  const px = finite(values.pivotX, 0);
  const py = finite(values.pivotY, 0);
  if (Math.abs(sx) < 1e-9 || Math.abs(sy) < 1e-9) return null;
  const translatedX = point.x - tx - px;
  const translatedY = point.y - ty - py;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return {
    x: (translatedX * cos - translatedY * sin) / sx + px,
    y: (translatedX * sin + translatedY * cos) / sy + py,
  };
}

export function transformLayerRect(rect: SceneRect, values: LayerTransformValues): SceneRect {
  const corners = [
    transformLayerPoint({ x: rect.x, y: rect.y }, values),
    transformLayerPoint({ x: rect.x + rect.w, y: rect.y }, values),
    transformLayerPoint({ x: rect.x + rect.w, y: rect.y + rect.h }, values),
    transformLayerPoint({ x: rect.x, y: rect.y + rect.h }, values),
  ];
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return {
    x: minX,
    y: minY,
    w: Math.max(...xs) - minX,
    h: Math.max(...ys) - minY,
  };
}

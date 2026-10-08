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

/** SVG-compatible affine matrix: x'=a*x+c*y+e, y'=b*x+d*y+f. */
export interface AffineMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY_AFFINE: AffineMatrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function finite(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback;
}

export function multiplyAffine(left: AffineMatrix, right: AffineMatrix): AffineMatrix {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f,
  };
}

export function translateAffine(x: number, y: number): AffineMatrix {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}

export function scaleAffine(x: number, y: number): AffineMatrix {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}

export function rotateAffine(degrees: number): AffineMatrix {
  const radians = (degrees * Math.PI) / 180;
  return {
    a: Math.cos(radians),
    b: Math.sin(radians),
    c: -Math.sin(radians),
    d: Math.cos(radians),
    e: 0,
    f: 0,
  };
}

/** Android group transform order: scale, rotate, then translate around its pivot. */
export function layerTransformToMatrix(values: LayerTransformValues): AffineMatrix {
  const tx = finite(values.translateX, 0);
  const ty = finite(values.translateY, 0);
  const rotation = finite(values.rotation, 0);
  const sx = finite(values.scaleX, 1);
  const sy = finite(values.scaleY, 1);
  const px = finite(values.pivotX, 0);
  const py = finite(values.pivotY, 0);
  return [
    translateAffine(tx, ty),
    translateAffine(px, py),
    rotateAffine(rotation),
    scaleAffine(sx, sy),
    translateAffine(-px, -py),
  ].reduce(multiplyAffine, IDENTITY_AFFINE);
}

export function transformPointWithMatrix(point: Point, matrix: AffineMatrix): Point {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  };
}

export function inverseAffine(matrix: AffineMatrix): AffineMatrix | null {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (Math.abs(determinant) < 1e-9) return null;
  const inverse = 1 / determinant;
  return {
    a: matrix.d * inverse,
    b: -matrix.b * inverse,
    c: -matrix.c * inverse,
    d: matrix.a * inverse,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) * inverse,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) * inverse,
  };
}

export function matrixToSvg(matrix: AffineMatrix): string {
  return `matrix(${matrix.a} ${matrix.b} ${matrix.c} ${matrix.d} ${matrix.e} ${matrix.f})`;
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
  return transformPointWithMatrix(point, layerTransformToMatrix(values));
}

export function inverseTransformLayerPoint(
  point: Point,
  values: LayerTransformValues,
): Point | null {
  const inverse = inverseAffine(layerTransformToMatrix(values));
  return inverse ? transformPointWithMatrix(point, inverse) : null;
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

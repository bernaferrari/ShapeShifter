import type { Point } from "./types";
export type PrimitiveShape = "rectangle" | "ellipse";

export function primitiveBounds(
  start: Point,
  end: Point,
  { square = false, centered = false } = {},
) {
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  if (square) {
    const size = Math.max(Math.abs(dx), Math.abs(dy));
    dx = (dx < 0 ? -1 : 1) * size;
    dy = (dy < 0 ? -1 : 1) * size;
  }
  return centered
    ? {
        x: start.x - Math.abs(dx),
        y: start.y - Math.abs(dy),
        w: Math.abs(dx) * 2,
        h: Math.abs(dy) * 2,
      }
    : {
        x: Math.min(start.x, start.x + dx),
        y: Math.min(start.y, start.y + dy),
        w: Math.abs(dx),
        h: Math.abs(dy),
      };
}

/** Cubic ellipse remains editable and compatible with the Android path compiler. */
export function primitivePath(
  kind: PrimitiveShape,
  { x, y, w, h }: { x: number; y: number; w: number; h: number },
) {
  if (kind === "rectangle") return `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
  const k = 0.5522847498307936;
  const rx = w / 2,
    ry = h / 2,
    cx = x + rx,
    cy = y + ry;
  return `M${cx + rx} ${cy} C${cx + rx} ${cy + ry * k} ${cx + rx * k} ${cy + ry} ${cx} ${cy + ry} C${cx - rx * k} ${cy + ry} ${cx - rx} ${cy + ry * k} ${cx - rx} ${cy} C${cx - rx} ${cy - ry * k} ${cx - rx * k} ${cy - ry} ${cx} ${cy - ry} C${cx + rx * k} ${cy - ry} ${cx + rx} ${cy - ry * k} ${cx + rx} ${cy} Z`;
}

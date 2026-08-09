import type { Viewport } from "@/lib/shapeshifter/camera";
import { pathToString } from "@/lib/shapeshifter/pathUtils";
import type { Command, PathData, Point } from "@/lib/shapeshifter/types";

export type Bounds = { x: number; y: number; width: number; height: number };
export type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export type SegmentTarget = {
  subPathIndex: number;
  commandIndex: number;
  command: Command;
  start: Point;
  end: Point;
  d: string;
  midpoint: Point;
};

export function getRulerModel(view: Viewport) {
  const interval = chooseNiceInterval(view.w / 5);
  return {
    xTicks: buildTicks(view.x, view.x + view.w, interval),
    yTicks: buildTicks(view.y, view.y + view.h, interval),
    headerSize: view.w * 0.072,
    tickSize: view.w * 0.012,
    labelOffset: view.w * 0.012,
    fontSize: view.w * 0.024,
    strokeWidth: view.w * 0.0018,
  };
}

function chooseNiceInterval(rawInterval: number) {
  const intervals = [0.5, 1, 2, 4, 6, 8, 12, 16, 24, 48, 96];
  return intervals.find((interval) => interval >= rawInterval) ?? intervals.at(-1)!;
}

function buildTicks(min: number, max: number, interval: number) {
  const ticks: number[] = [];
  const start = Math.ceil(min / interval) * interval;
  for (let value = start; value <= max; value += interval) {
    ticks.push(Number(value.toFixed(4)));
  }
  return ticks;
}

export function formatAxisTick(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

export function getPathBounds(path: PathData): Bounds | null {
  const points = path.subPaths.flatMap((subPath) =>
    subPath.commands.flatMap((command) => command.points),
  );
  if (points.length === 0) return null;
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);
  return {
    x: minX,
    y: minY,
    width: Math.max(0.01, maxX - minX),
    height: Math.max(0.01, maxY - minY),
  };
}

export function getSubPathBounds(path: PathData, subPathIndexes: number[]) {
  const selected = new Set(subPathIndexes);
  return getPathBounds({
    subPaths: path.subPaths.filter((_, index) => selected.has(index)),
  });
}

export function compactPathLabel(path: PathData) {
  const label = pathToString(path).replace(/\s+/g, " ");
  return label.length > 28 ? `${label.slice(0, 27)}...` : label;
}

export function getSegmentTargets(path: PathData): SegmentTarget[] {
  return path.subPaths.flatMap((subPath, subPathIndex) =>
    subPath.commands.flatMap((command, commandIndex) => {
      const start = subPath.commands[commandIndex - 1]?.points.at(-1);
      const end = command.points.at(-1);
      if (!start || !end || command.type === "M" || command.type === "Z") return [];
      const d = pathToString({
        subPaths: [
          {
            commands: [
              { id: `segment-m-${subPathIndex}-${commandIndex}`, type: "M", points: [start] },
              command,
            ],
          },
        ],
      });
      return [
        {
          subPathIndex,
          commandIndex,
          command,
          start,
          end,
          d,
          midpoint: getSegmentMidpoint(command, start, end),
        },
      ];
    }),
  );
}

function getSegmentMidpoint(command: Command, start: Point, end: Point): Point {
  if (command.type === "C" && command.points.length >= 3) {
    return cubicPointAt(start, command.points[0], command.points[1], end, 0.5);
  }
  if (command.type === "Q" && command.points.length >= 2) {
    return quadraticPointAt(start, command.points[0], end, 0.5);
  }
  return { x: start.x + (end.x - start.x) * 0.5, y: start.y + (end.y - start.y) * 0.5 };
}

function cubicPointAt(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  t: number,
): Point {
  const mt = 1 - t;
  return {
    x:
      mt ** 3 * start.x +
      3 * mt ** 2 * t * control1.x +
      3 * mt * t ** 2 * control2.x +
      t ** 3 * end.x,
    y:
      mt ** 3 * start.y +
      3 * mt ** 2 * t * control1.y +
      3 * mt * t ** 2 * control2.y +
      t ** 3 * end.y,
  };
}

function quadraticPointAt(start: Point, control: Point, end: Point, t: number): Point {
  const mt = 1 - t;
  return {
    x: mt ** 2 * start.x + 2 * mt * t * control.x + t ** 2 * end.x,
    y: mt ** 2 * start.y + 2 * mt * t * control.y + t ** 2 * end.y,
  };
}

export function rectsIntersect(a: Bounds, b: Bounds) {
  return (
    a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y
  );
}

export function getResizeHandles(
  bounds: Bounds,
): Array<{ id: ResizeHandle; x: number; y: number; cursor: string }> {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  return [
    { id: "nw", x: bounds.x, y: bounds.y, cursor: "cursor-nwse-resize" },
    { id: "n", x: centerX, y: bounds.y, cursor: "cursor-ns-resize" },
    { id: "ne", x: right, y: bounds.y, cursor: "cursor-nesw-resize" },
    { id: "e", x: right, y: centerY, cursor: "cursor-ew-resize" },
    { id: "se", x: right, y: bottom, cursor: "cursor-nwse-resize" },
    { id: "s", x: centerX, y: bottom, cursor: "cursor-ns-resize" },
    { id: "sw", x: bounds.x, y: bottom, cursor: "cursor-nesw-resize" },
    { id: "w", x: bounds.x, y: centerY, cursor: "cursor-ew-resize" },
  ];
}

export function getResizeEdges(
  bounds: Bounds,
): Array<{ id: ResizeHandle; x1: number; y1: number; x2: number; y2: number; cursor: string }> {
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  return [
    { id: "n", x1: bounds.x, y1: bounds.y, x2: right, y2: bounds.y, cursor: "cursor-ns-resize" },
    { id: "e", x1: right, y1: bounds.y, x2: right, y2: bottom, cursor: "cursor-ew-resize" },
    { id: "s", x1: bounds.x, y1: bottom, x2: right, y2: bottom, cursor: "cursor-ns-resize" },
    { id: "w", x1: bounds.x, y1: bounds.y, x2: bounds.x, y2: bottom, cursor: "cursor-ew-resize" },
  ];
}

export function getRotationHandle(bounds: Bounds, distance: number) {
  const centerX = bounds.x + bounds.width / 2;
  return { anchorX: centerX, anchorY: bounds.y, x: centerX, y: bounds.y - distance };
}

export function getBoundsCenter(bounds: Bounds) {
  return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
}

export function getAngle(center: { x: number; y: number }, point: Point) {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

/** Convert SVG world coordinates into a transformed layer's local path space. */
export function makeWorldToLocal(transform: string | undefined): (point: Point) => Point {
  if (!transform?.trim()) return (point) => point;
  let inverse: DOMMatrix | null = null;
  try {
    const matrix = new DOMMatrix();
    const operationPattern = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/gi;
    let match: RegExpExecArray | null;
    while ((match = operationPattern.exec(transform))) {
      const operation = match[1].toLowerCase();
      const values = match[2]
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (operation === "translate") matrix.translateSelf(values[0] || 0, values[1] || 0);
      else if (operation === "scale") {
        matrix.scaleSelf(values[0] ?? 1, values[1] ?? values[0] ?? 1);
      } else if (operation === "rotate") matrix.rotateSelf(values[0] || 0);
      else if (operation === "matrix") matrix.multiplySelf(new DOMMatrix(values));
    }
    inverse = matrix.inverse();
  } catch {
    inverse = null;
  }
  if (!inverse) return (point) => point;
  return (point) => {
    const transformed = inverse.transformPoint(new DOMPoint(point.x, point.y));
    return { x: transformed.x, y: transformed.y };
  };
}

export function getBoundsFromResizeHandle(
  bounds: Bounds,
  handle: ResizeHandle,
  point: Point,
  preserveAspect: boolean,
): Bounds {
  const minSize = 0.5;
  const left = bounds.x;
  const top = bounds.y;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const aspect = bounds.width / Math.max(bounds.height, minSize);

  let next: Bounds;
  if (handle === "n") next = { x: left, y: point.y, width: bounds.width, height: bottom - point.y };
  else if (handle === "e") next = { x: left, y: top, width: point.x - left, height: bounds.height };
  else if (handle === "s") next = { x: left, y: top, width: bounds.width, height: point.y - top };
  else if (handle === "w")
    next = { x: point.x, y: top, width: right - point.x, height: bounds.height };
  else if (handle === "nw")
    next = { x: point.x, y: point.y, width: right - point.x, height: bottom - point.y };
  else if (handle === "ne")
    next = { x: left, y: point.y, width: point.x - left, height: bottom - point.y };
  else if (handle === "sw")
    next = { x: point.x, y: top, width: right - point.x, height: point.y - top };
  else next = { x: left, y: top, width: point.x - left, height: point.y - top };

  const isCorner = handle === "nw" || handle === "ne" || handle === "se" || handle === "sw";
  if (preserveAspect && isCorner) {
    const widthFromHeight = Math.abs(next.height) * aspect;
    const heightFromWidth = Math.abs(next.width) / Math.max(aspect, 0.001);
    if (
      Math.abs(widthFromHeight - Math.abs(next.width)) <
      Math.abs(heightFromWidth - Math.abs(next.height))
    ) {
      next.width = Math.sign(next.width || 1) * widthFromHeight;
    } else {
      next.height = Math.sign(next.height || 1) * heightFromWidth;
    }
    if (handle === "nw") {
      next.x = right - next.width;
      next.y = bottom - next.height;
    } else if (handle === "ne") next.y = bottom - next.height;
    else if (handle === "sw") next.x = right - next.width;
  }

  if (Math.abs(next.width) < minSize) next.width = Math.sign(next.width || 1) * minSize;
  if (Math.abs(next.height) < minSize) next.height = Math.sign(next.height || 1) * minSize;
  return next;
}

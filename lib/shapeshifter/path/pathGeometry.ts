import { arcToBeziers } from "../geometry";
import type { PathData, Point } from "../types";

export interface FlattenedSubPath {
  points: Point[];
  closed: boolean;
}

const EPSILON = 1e-9;

function pointLineDistance(point: Point, from: Point, to: Point) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < EPSILON) return Math.hypot(point.x - from.x, point.y - from.y);
  return Math.abs(dx * (from.y - point.y) - (from.x - point.x) * dy) / length;
}

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function flattenCubic(
  from: Point,
  control1: Point,
  control2: Point,
  to: Point,
  tolerance: number,
  points: Point[],
  depth = 0,
) {
  const flatness = Math.max(
    pointLineDistance(control1, from, to),
    pointLineDistance(control2, from, to),
  );
  if (flatness <= tolerance || depth >= 12) {
    points.push({ ...to });
    return;
  }
  const a = midpoint(from, control1);
  const b = midpoint(control1, control2);
  const c = midpoint(control2, to);
  const d = midpoint(a, b);
  const e = midpoint(b, c);
  const split = midpoint(d, e);
  flattenCubic(from, a, d, split, tolerance, points, depth + 1);
  flattenCubic(split, e, c, to, tolerance, points, depth + 1);
}

function flattenQuadratic(
  from: Point,
  control: Point,
  to: Point,
  tolerance: number,
  points: Point[],
  depth = 0,
) {
  const flatness = pointLineDistance(control, from, to);
  if (flatness <= tolerance || depth >= 12) {
    points.push({ ...to });
    return;
  }
  const a = midpoint(from, control);
  const b = midpoint(control, to);
  const split = midpoint(a, b);
  flattenQuadratic(from, a, split, tolerance, points, depth + 1);
  flattenQuadratic(split, b, to, tolerance, points, depth + 1);
}

/** Adaptive polyline representation for bounds, hit testing, trim previews, and clips. */
export function flattenPathData(pathData: PathData, tolerance = 0.25): FlattenedSubPath[] {
  const result: FlattenedSubPath[] = [];
  for (const subPath of pathData.subPaths ?? []) {
    const points: Point[] = [];
    let current: Point = { x: 0, y: 0 };
    let start: Point = { x: 0, y: 0 };
    let closed = false;
    for (const command of subPath.commands) {
      if (command.type === "M" && command.points[0]) {
        current = { ...command.points[0] };
        start = { ...current };
        points.push({ ...current });
        continue;
      }
      if (command.type === "Z") {
        closed = true;
        if (points.length && Math.hypot(current.x - start.x, current.y - start.y) > EPSILON) {
          points.push({ ...start });
        }
        current = { ...start };
        continue;
      }
      const end = command.points.at(-1);
      if (!end) continue;
      if (command.type === "C" && command.points.length === 3) {
        flattenCubic(current, command.points[0], command.points[1], end, tolerance, points);
      } else if (command.type === "Q" && command.points.length === 2) {
        flattenQuadratic(current, command.points[0], end, tolerance, points);
      } else if (command.type === "A" && command.arcParams) {
        let arcStart = current;
        for (const segment of arcToBeziers(
          current.x,
          current.y,
          command.arcParams.rx,
          command.arcParams.ry,
          command.arcParams.xRotation,
          command.arcParams.largeArc,
          command.arcParams.sweep,
          end.x,
          end.y,
        )) {
          flattenCubic(arcStart, segment.cp1, segment.cp2, segment.to, tolerance, points);
          arcStart = segment.to;
        }
      } else {
        points.push({ ...end });
      }
      current = { ...end };
    }
    if (points.length) result.push({ points, closed });
  }
  return result;
}

export function getAccuratePathBounds(pathData: PathData | null | undefined) {
  if (!pathData) return null;
  const flattened = flattenPathData(pathData, 0.05);
  const points = flattened.flatMap((subPath) => subPath.points);
  if (!points.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { x: minX, y: minY, w: Math.max(0.01, maxX - minX), h: Math.max(0.01, maxY - minY) };
}

export function distanceToSegment(point: Point, from: Point, to: Point) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < EPSILON) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

export function distanceToPath(point: Point, pathData: PathData, tolerance = 0.25) {
  let distance = Infinity;
  for (const subPath of flattenPathData(pathData, tolerance)) {
    for (let index = 1; index < subPath.points.length; index++) {
      distance = Math.min(distance, distanceToSegment(point, subPath.points[index - 1]!, subPath.points[index]!));
    }
  }
  return distance;
}

function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const current = polygon[index]!;
    const prior = polygon[previous]!;
    const intersects =
      (current.y > point.y) !== (prior.y > point.y) &&
      point.x < ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function windingContribution(point: Point, from: Point, to: Point) {
  if (from.y <= point.y) {
    if (to.y > point.y && (to.x - from.x) * (point.y - from.y) - (point.x - from.x) * (to.y - from.y) > 0)
      return 1;
  } else if (to.y <= point.y && (to.x - from.x) * (point.y - from.y) - (point.x - from.x) * (to.y - from.y) < 0) {
    return -1;
  }
  return 0;
}

export function isPointInPath(
  point: Point,
  pathData: PathData,
  fillType: "nonZero" | "evenOdd" = "nonZero",
) {
  const paths = flattenPathData(pathData);
  if (fillType === "evenOdd") {
    return paths.filter((subPath) => subPath.closed && pointInPolygon(point, subPath.points)).length % 2 === 1;
  }
  let winding = 0;
  for (const subPath of paths) {
    if (!subPath.closed) continue;
    for (let index = 1; index < subPath.points.length; index++) {
      winding += windingContribution(point, subPath.points[index - 1]!, subPath.points[index]!);
    }
  }
  return winding !== 0;
}

export function pathLength(pathData: PathData, tolerance = 0.25) {
  return flattenPathData(pathData, tolerance).reduce((total, subPath) => {
    let length = 0;
    for (let index = 1; index < subPath.points.length; index++) {
      length += Math.hypot(
        subPath.points[index]!.x - subPath.points[index - 1]!.x,
        subPath.points[index]!.y - subPath.points[index - 1]!.y,
      );
    }
    return total + length;
  }, 0);
}

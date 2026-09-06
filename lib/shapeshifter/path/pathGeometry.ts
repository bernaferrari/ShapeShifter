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

/**
 * Records the points that determine the exact axis-aligned bounds of a cubic
 * segment: both endpoints plus every interior extremum. Extrema per axis sit
 * at the roots of B'(t) = qa·t² + qb·t + qc, so unlike polyline bounds these
 * never miss a true peak between samples.
 */
function recordCubicExtrema(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  record: (point: Point) => void,
) {
  record(p0);
  record(p3);
  for (const axis of ["x", "y"] as const) {
    const qa = p3[axis] - p0[axis] + 3 * (p1[axis] - p2[axis]);
    const qb = 2 * (p0[axis] - 2 * p1[axis] + p2[axis]);
    const qc = p1[axis] - p0[axis];
    const ts: number[] = [];
    if (Math.abs(qa) < EPSILON) {
      if (Math.abs(qb) > EPSILON) ts.push(-qc / qb);
    } else {
      const disc = qb * qb - 4 * qa * qc;
      if (disc >= 0) {
        const r = Math.sqrt(disc);
        ts.push((-qb - r) / (2 * qa), (-qb + r) / (2 * qa));
      }
    }
    for (const t of ts) {
      if (t <= 0 || t >= 1) continue;
      const mt = 1 - t;
      record({
        x: mt * mt * mt * p0.x + 3 * mt * mt * t * p1.x + 3 * mt * t * t * p2.x + t * t * t * p3.x,
        y: mt * mt * mt * p0.y + 3 * mt * mt * t * p1.y + 3 * mt * t * t * p2.y + t * t * t * p3.y,
      });
    }
  }
}

function recordQuadraticExtrema(p0: Point, p1: Point, p2: Point, record: (point: Point) => void) {
  // Degree-elevate to a cubic so one extrema routine covers both curves.
  recordCubicExtrema(
    p0,
    { x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) },
    { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) },
    p2,
    record,
  );
}

/**
 * Curve-aware AABB. Bézier segments contribute their exact analytic extrema,
 * so bounds are correct regardless of curvature — no flattening tolerance
 * error that would scale with zoom downstream.
 */
export function getAccuratePathBounds(pathData: PathData | null | undefined) {
  if (!pathData) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seen = false;
  const record = (point: Point) => {
    seen = true;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  };
  for (const subPath of pathData.subPaths ?? []) {
    let current: Point = { x: 0, y: 0 };
    let start: Point = { x: 0, y: 0 };
    for (const command of subPath.commands) {
      if (command.type === "M" && command.points[0]) {
        current = { ...command.points[0] };
        start = { ...current };
        record(current);
        continue;
      }
      if (command.type === "Z") {
        record(start);
        current = { ...start };
        continue;
      }
      const end = command.points.at(-1);
      if (!end) continue;
      if (command.type === "C" && command.points.length === 3) {
        recordCubicExtrema(current, command.points[0], command.points[1], end, record);
      } else if (command.type === "Q" && command.points.length === 2) {
        recordQuadraticExtrema(current, command.points[0], end, record);
      } else if (command.type === "A" && command.arcParams) {
        let arcStart = current;
        for (const segment of arcToBeziers(
          arcStart.x,
          arcStart.y,
          command.arcParams.rx,
          command.arcParams.ry,
          command.arcParams.xRotation,
          command.arcParams.largeArc,
          command.arcParams.sweep,
          end.x,
          end.y,
        )) {
          recordCubicExtrema(arcStart, segment.cp1, segment.cp2, segment.to, record);
          arcStart = segment.to;
        }
      } else {
        record({ ...end });
      }
      current = { ...end };
    }
  }
  if (!seen) return null;
  return { x: minX, y: minY, w: Math.max(0.01, maxX - minX), h: Math.max(0.01, maxY - minY) };
}

export function distanceToSegment(point: Point, from: Point, to: Point) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < EPSILON) return Math.hypot(point.x - from.x, point.y - from.y);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared),
  );
  return Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
}

export function distanceToPath(point: Point, pathData: PathData, tolerance = 0.25) {
  let distance = Infinity;
  for (const subPath of flattenPathData(pathData, tolerance)) {
    for (let index = 1; index < subPath.points.length; index++) {
      distance = Math.min(
        distance,
        distanceToSegment(point, subPath.points[index - 1]!, subPath.points[index]!),
      );
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
      current.y > point.y !== prior.y > point.y &&
      point.x < ((prior.x - current.x) * (point.y - current.y)) / (prior.y - current.y) + current.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function windingContribution(point: Point, from: Point, to: Point) {
  if (from.y <= point.y) {
    if (
      to.y > point.y &&
      (to.x - from.x) * (point.y - from.y) - (point.x - from.x) * (to.y - from.y) > 0
    )
      return 1;
  } else if (
    to.y <= point.y &&
    (to.x - from.x) * (point.y - from.y) - (point.x - from.x) * (to.y - from.y) < 0
  ) {
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
    return (
      paths.filter((subPath) => subPath.closed && pointInPolygon(point, subPath.points)).length %
        2 ===
      1
    );
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

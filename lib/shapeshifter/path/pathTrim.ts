import { normalizePathData } from "../pathUtils";
import type { Command, PathData, Point, SubPath } from "../types";

type Segment = {
  id: string;
  type: "L" | "Q" | "C";
  points: Point[];
  length: number;
  offset: number;
  bins: Array<{ from: number; to: number; length: number; offset: number }>;
  speed: (t: number) => number;
};
const measured = new WeakMap<PathData, { segments: Segment[]; length: number }>();
const trimmed = new WeakMap<
  PathData,
  { start: number; end: number; offset: number; result: PathData }
>();
const EMPTY_PATH: PathData = { subPaths: [] };

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** De Casteljau subdivision retains the curve, including its boundary tangents. */
function split(points: Point[], t: number): [Point[], Point[]] {
  const left = [points[0]!];
  const right = [points.at(-1)!];
  let level = points;
  while (level.length > 1) {
    level = level.slice(1).map((point, index) => lerp(level[index]!, point, t));
    left.push(level[0]!);
    right.unshift(level.at(-1)!);
  }
  return [left, right];
}

function slice(points: Point[], from: number, to: number): Point[] {
  const prefix = to < 1 ? split(points, to)[0] : points;
  return from > 0 ? split(prefix, from / to)[1] : prefix;
}

function derivativeSpeed(points: Point[]): (t: number) => number {
  const degree = points.length - 1;
  const derivatives = points.slice(1).map((point, index) => ({
    x: degree * (point.x - points[index]!.x),
    y: degree * (point.y - points[index]!.y),
  }));
  return (t) => {
    const mt = 1 - t;
    const weights = degree === 1 ? [1] : degree === 2 ? [mt, t] : [mt * mt, 2 * mt * t, t * t];
    let x = 0;
    let y = 0;
    for (let index = 0; index < degree; index++) {
      x += derivatives[index]!.x * weights[index]!;
      y += derivatives[index]!.y * weights[index]!;
    }
    return Math.hypot(x, y);
  };
}

const GAUSS_NODES = [
  0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664, 0.906179845938664,
];
const GAUSS_WEIGHTS = [
  0.5688888888888889, 0.4786286704993665, 0.4786286704993665, 0.2369268850561891,
  0.2369268850561891,
];
function integral(speed: (t: number) => number, from: number, to: number) {
  const half = (to - from) / 2;
  const mid = (from + to) / 2;
  let value = 0;
  for (let index = 0; index < GAUSS_NODES.length; index++)
    value += GAUSS_WEIGHTS[index]! * speed(mid + half * GAUSS_NODES[index]!);
  return half * value;
}

function measureSegment(
  id: string,
  type: Segment["type"],
  points: Point[],
  offset: number,
): Segment | null {
  if (
    points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)) ||
    points
      .slice(1)
      .some(
        (point, index) =>
          !Number.isFinite((points.length - 1) * (point.x - points[index]!.x)) ||
          !Number.isFinite((points.length - 1) * (point.y - points[index]!.y)),
      )
  )
    return null;
  const speed = derivativeSpeed(points);
  const bins: Segment["bins"] = [];
  let length = 0;
  let invalid = false;
  const measure = (from: number, to: number, coarse: number, depth: number) => {
    if (invalid) return;
    const mid = (from + to) / 2;
    const left = integral(speed, from, mid);
    const right = integral(speed, mid, to);
    const fine = left + right;
    if (![coarse, fine].every(Number.isFinite)) {
      invalid = true;
      return;
    }
    if (depth >= 16 || Math.abs(fine - coarse) <= 1e-8 * (to - from) + fine * 1e-9) {
      bins.push({ from, to, length: fine, offset: length });
      length += fine;
    } else {
      measure(from, mid, left, depth + 1);
      measure(mid, to, right, depth + 1);
    }
  };
  if (type === "L") {
    length = Math.hypot(points[1]!.x - points[0]!.x, points[1]!.y - points[0]!.y);
  } else {
    // Seed four intervals so a loop/cusp cannot hide between one quadrature's samples.
    for (let index = 0; index < 4; index++) {
      const from = index / 4;
      const to = (index + 1) / 4;
      measure(from, to, integral(speed, from, to), 0);
    }
  }
  if (invalid || !Number.isFinite(length)) return null;
  return { id, type, points, offset, length, bins, speed };
}

function firstContour(path: PathData) {
  const cached = measured.get(path);
  if (cached) return cached;
  const normalized = normalizePathData(path);
  const segments: Segment[] = [];
  let current: Point = { x: 0, y: 0 };
  let start = current;
  let length = 0;
  contours: for (const subPath of normalized.subPaths) {
    for (const command of subPath.commands) {
      if (command.type === "M" && command.points[0]) {
        if (segments.length) break contours;
        current = command.points[0];
        start = current;
        continue;
      }
      const end = command.type === "Z" ? start : command.points.at(-1);
      if (!end) continue;
      const type = command.type === "C" ? "C" : command.type === "Q" ? "Q" : "L";
      const points = type === "L" ? [current, end] : [current, ...command.points];
      const segment = measureSegment(command.id, type, points, length);
      if (!segment) return { segments: [], length: 0 };
      if (segment.length > 0) {
        segments.push(segment);
        length += segment.length;
        if (!Number.isFinite(length)) return { segments: [], length: 0 };
      }
      current = end;
      if (command.type === "Z" && segments.length) break contours;
    }
    // Skia skips empty contours, but never traverses a second measured contour.
    if (segments.length) break;
  }
  const result = { segments, length };
  measured.set(path, result);
  return result;
}

function parameterAtDistance(segment: Segment, distance: number) {
  if (distance <= 0) return 0;
  if (distance >= segment.length) return 1;
  if (segment.type === "L") return distance / segment.length;
  const bin = segment.bins.find((candidate) => distance <= candidate.offset + candidate.length)!;
  const target = distance - bin.offset;
  let low = bin.from;
  let high = bin.to;
  let t = low + (high - low) * (target / bin.length);
  for (let index = 0; index < 32; index++) {
    const error = integral(segment.speed, bin.from, t) - target;
    if (Math.abs(error) <= Math.max(1e-9, segment.length * 1e-10)) break;
    if (error > 0) high = t;
    else low = t;
    const speed = segment.speed(t);
    const next = speed > 0 ? t - error / speed : NaN;
    t = next > low && next < high ? next : (low + high) / 2;
  }
  return t;
}

/**
 * Android's native applyTrim semantics: trim only the first contour before
 * painting either fill or stroke. Full 0→1 retains all contours and ignores
 * offset; equal endpoints are empty. Wrapped ranges become separate open
 * contours (fills close them implicitly). Negative remainders are clamped like
 * PathMeasure.getSegment, rather than being normalized into a positive offset.
 *
 * Lines and Bézier subdivisions are exact; length inversion uses adaptive
 * numerical integration. Arcs use the editor's existing cubic normalization.
 * Raw authored geometry and its IDs are never mutated.
 */
export function trimPathData(path: PathData, start = 0, end = 1, offset = 0): PathData {
  if (start === 0 && end === 1) return path;
  if (start === end) return EMPTY_PATH;
  if (![start, end, offset].every(Number.isFinite)) return EMPTY_PATH;
  const cached = trimmed.get(path);
  if (cached && cached.start === start && cached.end === end && cached.offset === offset)
    return cached.result;
  let contour: ReturnType<typeof firstContour>;
  try {
    contour = firstContour(path);
  } catch {
    return EMPTY_PATH;
  }
  const from = ((start + offset) % 1) * contour.length;
  const to = ((end + offset) % 1) * contour.length;
  if (![from, to].every(Number.isFinite)) return EMPTY_PATH;
  const ranges =
    from > to
      ? [
          [from, contour.length],
          [0, to],
        ]
      : [[from, to]];
  const subPaths: SubPath[] = [];
  for (const [rangeIndex, range] of ranges.entries()) {
    const rangeFrom = Math.max(0, range[0]!);
    const rangeTo = Math.min(contour.length, range[1]!);
    if (rangeFrom >= rangeTo) continue;
    const commands: Command[] = [];
    for (const segment of contour.segments) {
      const localFrom = Math.max(0, rangeFrom - segment.offset);
      const localTo = Math.min(segment.length, rangeTo - segment.offset);
      if (localFrom >= localTo) continue;
      const points = slice(
        segment.points,
        parameterAtDistance(segment, localFrom),
        parameterAtDistance(segment, localTo),
      );
      if (!commands.length)
        commands.push({
          id: `trim:${segment.id}:${rangeIndex}:move`,
          type: "M",
          points: [points[0]!],
        });
      commands.push({
        id: `trim:${segment.id}:${rangeIndex}`,
        type: segment.type,
        points: points.slice(1),
      });
    }
    if (commands.length) subPaths.push({ commands });
  }
  const result = { subPaths };
  trimmed.set(path, { start, end, offset, result });
  return result;
}

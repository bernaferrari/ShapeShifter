import type { Command, PathData, Point } from "../types";
import { generateId } from "../ids";
import { flattenPathData } from "./pathGeometry";

const clonePath = (path: PathData): PathData => structuredClone(path);

function pointSegmentDistanceSquared(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    return (point.x - from.x) ** 2 + (point.y - from.y) ** 2;
  }
  let t = ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const projX = from.x + t * dx;
  const projY = from.y + t * dy;
  return (point.x - projX) ** 2 + (point.y - projY) ** 2;
}

/**
 * Iterative Ramer–Douglas–Peucker over on-curve samples (never raw control
 * points). `keep` marks surviving sample indices; the recursion is an explicit
 * stack so pathological sawtooth paths cannot overflow the call stack.
 */
function ramerDouglasPeucker(points: Point[], tolerance: number): Point[] {
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const toleranceSquared = tolerance * tolerance;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [fromIndex, toIndex] = stack.pop()!;
    if (toIndex - fromIndex < 2) continue;
    const from = points[fromIndex];
    const to = points[toIndex];
    let maxDistanceSquared = 0;
    let splitIndex = -1;
    for (let index = fromIndex + 1; index < toIndex; index++) {
      const distanceSquared = pointSegmentDistanceSquared(points[index], from, to);
      if (distanceSquared > maxDistanceSquared) {
        maxDistanceSquared = distanceSquared;
        splitIndex = index;
      }
    }
    if (maxDistanceSquared <= toleranceSquared || splitIndex < 0) continue;
    keep[splitIndex] = 1;
    stack.push([fromIndex, splitIndex], [splitIndex, toIndex]);
  }
  return points.filter((_, index) => keep[index] === 1).map((point) => ({ ...point }));
}

/**
 * Curve-aware simplification. Raw command point arrays mix Bézier control
 * points with on-curve vertices, so simplifying them directly deletes control
 * points and collapses curves. Instead, each sub-path is flattened into
 * on-curve samples (de Casteljau adaptive subdivision, arcs included) and the
 * polyline is reduced with Ramer–Douglas–Peucker before being rebuilt as
 * M/L(/Z) commands. Curves therefore degrade gracefully to polylines within
 * `tolerance`, and control points are never mistaken for vertices.
 */
export function simplifyPath(path: PathData, tolerance = 0.5): PathData {
  const simplified = clonePath(path);
  simplified.subPaths = simplified.subPaths.map((subPath) => {
    // Only well-formed single-move sub-paths (the parsePath shape) qualify;
    // anything exotic is passed through untouched rather than corrupted.
    if (subPath.commands.filter((command) => command.type === "M").length !== 1) return subPath;

    const flattened = flattenPathData({ subPaths: [subPath] }, tolerance)[0];
    if (!flattened || flattened.points.length < 2) return subPath;

    const kept = ramerDouglasPeucker(flattened.points, tolerance);
    if (kept.length === flattened.points.length) return subPath;

    const closes = subPath.commands.some((command) => command.type === "Z");
    const closeId = subPath.commands.find((command) => command.type === "Z")?.id;
    const moveCommand = subPath.commands[0];
    const commands: Command[] = [
      { id: moveCommand?.id ?? generateId(), type: "M", points: [{ ...kept[0] }] },
      ...kept
        .slice(1)
        .map((point): Command => ({ id: generateId(), type: "L", points: [{ ...point }] })),
    ];
    if (closes) commands.push({ id: closeId ?? generateId(), type: "Z", points: [] });
    return { commands };
  });
  return simplified;
}

export function optimizePath(path: PathData, tolerance = 0.5): PathData {
  const optimized = clonePath(simplifyPath(path, tolerance));
  for (const subPath of optimized.subPaths) {
    for (const command of subPath.commands) {
      if (command.points.length <= 2 || (command.type !== "L" && command.type !== "C")) continue;
      for (let index = 1; index < command.points.length - 1; index++) {
        const previous = command.points[index - 1];
        const current = command.points[index];
        const next = command.points[index + 1];
        command.points[index] = {
          x: (previous.x + current.x * 2 + next.x) / 4,
          y: (previous.y + current.y * 2 + next.y) / 4,
        };
      }
    }
  }
  return optimized;
}

export function generateDashPattern(
  preset: "solid" | "dashed" | "dotted" | "dashdot" = "dashed",
): string {
  if (preset === "solid") return "";
  if (preset === "dotted") return "1 3";
  if (preset === "dashdot") return "4 2 1 2";
  return "4 2";
}

export function getTaperedStrokeWidth(time: number, baseWidth: number, taper = 0.6): number {
  const normalizedTime = Math.max(0, Math.min(1, time || 0.5));
  const factor = 1 - Math.abs(normalizedTime - 0.5) * 2 * taper;
  const width = baseWidth * Math.max(0.25, factor);
  return Number.isFinite(width) ? Math.max(0.25, Number(width.toFixed(2))) : baseWidth;
}

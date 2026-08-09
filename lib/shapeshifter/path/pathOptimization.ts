import type { PathData, Point } from "../types";

const clonePath = (path: PathData): PathData => structuredClone(path);

export function simplifyPath(path: PathData, tolerance = 0.5): PathData {
  const simplified = clonePath(path);
  const toleranceSquared = tolerance * tolerance;
  const distanceSquared = (first: Point, second: Point) =>
    (first.x - second.x) ** 2 + (first.y - second.y) ** 2;

  for (const subPath of simplified.subPaths) {
    subPath.commands = subPath.commands.map((command) => {
      if (command.points.length < 3) {
        return { ...command, points: command.points.map((point) => ({ ...point })) };
      }
      const kept: Point[] = [{ ...command.points[0] }];
      for (const point of command.points.slice(1, -1)) {
        if (distanceSquared(kept.at(-1)!, point) > toleranceSquared) kept.push({ ...point });
      }
      kept.push({ ...command.points.at(-1)! });
      return { ...command, points: kept };
    });
  }
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

import type { PathData, Point, FillType } from "../types";
import { arcToBeziers } from "../geometry";
import type { AffineMatrix } from "../scene/layerTransform";

function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    const crosses =
      currentPoint.y > point.y !== previousPoint.y > point.y &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

function sampleCubic(
  from: Point,
  control1: Point,
  control2: Point,
  to: Point,
  steps: number,
): Point[] {
  return Array.from({ length: steps }, (_, index) => {
    const time = (index + 1) / steps;
    const inverse = 1 - time;
    return {
      x:
        inverse ** 3 * from.x +
        3 * inverse ** 2 * time * control1.x +
        3 * inverse * time ** 2 * control2.x +
        time ** 3 * to.x,
      y:
        inverse ** 3 * from.y +
        3 * inverse ** 2 * time * control1.y +
        3 * inverse * time ** 2 * control2.y +
        time ** 3 * to.y,
    };
  });
}

function sampleQuadratic(from: Point, control: Point, to: Point, steps: number): Point[] {
  return Array.from({ length: steps }, (_, index) => {
    const time = (index + 1) / steps;
    const inverse = 1 - time;
    return {
      x: inverse ** 2 * from.x + 2 * inverse * time * control.x + time ** 2 * to.x,
      y: inverse ** 2 * from.y + 2 * inverse * time * control.y + time ** 2 * to.y,
    };
  });
}

export function pathToPolygons(path: PathData, steps = 12): Point[][] {
  const polygons: Point[][] = [];
  for (const subPath of path.subPaths) {
    const polygon: Point[] = [];
    let current: Point = { x: 0, y: 0 };
    for (const command of subPath.commands) {
      const end = command.points.at(-1);
      if (!end) continue;
      if (command.type === "M" && !polygon.length) {
        current = { ...end };
        polygon.push({ ...current });
      } else if (
        (command.type === "L" || command.type === "H" || command.type === "V") &&
        command.points[0]
      ) {
        current = { ...command.points[0] };
        polygon.push({ ...current });
      } else if (command.type === "C" && command.points.length === 3) {
        polygon.push(
          ...sampleCubic(current, command.points[0], command.points[1], command.points[2], steps),
        );
        current = { ...command.points[2] };
      } else if (command.type === "Q" && command.points.length === 2) {
        polygon.push(...sampleQuadratic(current, command.points[0], command.points[1], steps));
        current = { ...command.points[1] };
      } else if (command.type === "A" && command.arcParams) {
        // Arcs are preserved as first-class A commands with their real geometry
        // in arcParams (pathDataIO); flattening them via arcToBeziers keeps
        // circles/ellipses round instead of degenerating toward a bare chord.
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
          polygon.push(...sampleCubic(arcStart, segment.cp1, segment.cp2, segment.to, steps));
          arcStart = segment.to;
        }
        current = { ...end };
      } else if (command.type !== "Z") {
        current = { ...end };
        polygon.push({ ...current });
      }
    }
    if (polygon.length >= 3) polygons.push(polygon);
  }
  return polygons;
}

export type BooleanOp = "union" | "subtract" | "intersect" | "exclude";
export interface BooleanOptions {
  firstMatrix?: AffineMatrix;
  secondMatrix?: AffineMatrix;
  firstFillType?: FillType;
  secondFillType?: FillType;
}
export const BOOLEAN_OPERATIONS_ENABLED = true;

/** Load the curve kernel only when an explicit authoring operation needs it. */
export async function booleanCombine(
  operation: BooleanOp,
  first: PathData,
  second: PathData,
  options: BooleanOptions = {},
): Promise<PathData> {
  if (!["union", "subtract", "intersect", "exclude"].includes(operation))
    throw new Error("Choose a valid combine operation.");
  const { combineCurveAreasAsync } = await import("./curveBooleanClient");
  return combineCurveAreasAsync(operation, first, second, options);
}

export function isPointInFillRegion(point: Point, path: PathData): boolean {
  if (!path.subPaths.length) return false;
  return pathToPolygons(path).filter((polygon) => pointInPolygon(point, polygon)).length % 2 === 1;
}

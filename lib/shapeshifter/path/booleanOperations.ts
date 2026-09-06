import type { Command, PathData, Point } from "../types";
import { generateId } from "../ids";
import { arcToBeziers } from "../geometry";

const clonePath = (path: PathData): PathData => structuredClone(path);

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

function polygonsToPathData(polygons: Point[][]): PathData {
  return {
    subPaths: polygons
      .filter((polygon) => polygon.length >= 3)
      .map((polygon) => {
        const commands: Command[] = [
          { id: generateId(), type: "M", points: [{ ...polygon[0] }] },
          ...polygon
            .slice(1)
            .map((point): Command => ({ id: generateId(), type: "L", points: [{ ...point }] })),
          { id: generateId(), type: "Z", points: [] },
        ];
        return { commands };
      }),
  };
}

export type BooleanOp = "union" | "subtract" | "intersect" | "exclude";

/** Destructive Boolean commands stay off until a curve-capable clipper exists. */
export const BOOLEAN_OPERATIONS_ENABLED = false;

/**
 * Containment-aware boolean operations for closed paths. Disjoint paths are exact; partially
 * intersecting boundaries intentionally use conservative fallbacks until a full clipping kernel
 * is introduced.
 */
export function booleanCombine(operation: BooleanOp, first: PathData, second: PathData): PathData {
  const firstPolygons = pathToPolygons(first);
  const secondPolygons = pathToPolygons(second);
  if (firstPolygons.length === 0) return clonePath(second);
  if (secondPolygons.length === 0) return clonePath(first);

  const firstPolygon = firstPolygons[0];
  const secondPolygon = secondPolygons[0];
  const firstInsideSecond = firstPolygon.every((point) => pointInPolygon(point, secondPolygon));
  const secondInsideFirst = secondPolygon.every((point) => pointInPolygon(point, firstPolygon));
  let result: Point[][];

  if (operation === "union") {
    result = firstInsideSecond
      ? [secondPolygon]
      : secondInsideFirst
        ? [firstPolygon]
        : [...firstPolygons, ...secondPolygons];
  } else if (operation === "subtract") {
    result = secondInsideFirst
      ? [firstPolygon, secondPolygon.slice().reverse()]
      : firstInsideSecond
        ? []
        : [firstPolygon];
  } else if (operation === "intersect") {
    // Unsupported partial overlap must not impersonate the first operand.
    result = firstInsideSecond ? [firstPolygon] : secondInsideFirst ? [secondPolygon] : [];
  } else {
    result =
      firstInsideSecond || secondInsideFirst
        ? [firstPolygon, secondPolygon.slice().reverse()]
        : [...firstPolygons, ...secondPolygons];
  }

  // Empty is a valid result (disjoint intersect, contained subtract). Never
  // substitute the first operand — that silently damages artwork.
  return polygonsToPathData(result);
}

export function isPointInFillRegion(point: Point, path: PathData): boolean {
  if (!path.subPaths.length) return false;
  return pathToPolygons(path).filter((polygon) => pointInPolygon(point, polygon)).length % 2 === 1;
}

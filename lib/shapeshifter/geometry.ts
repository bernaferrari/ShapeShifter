/**
 * ShapeShifter 2026 — Bezier-Aware Geometry & Centroid Algorithms
 *
 * Standalone mathematical engine for path properties.
 * Implements Green's Theorem for signed area/winding (isClockwise)
 * and a quadtree-based Polylabel grid search for poles of inaccessibility.
 */

import type { Command, SubPath, Point } from "./types";

/**
 * Gets the starting point of a command in a subpath.
 * If cmdIdx is 0, it falls back to the first point of the M command.
 */
export function getCommandStart(subPath: SubPath, cmdIdx: number): Point {
  if (cmdIdx > 0) {
    const prev = subPath.commands[cmdIdx - 1];
    return prev?.points.at(-1) || { x: 0, y: 0 };
  }
  const first = subPath.commands[0];
  return first?.points[0] || { x: 0, y: 0 };
}

/**
 * Calculates the signed area term of an individual command using Green's Theorem.
 * Matches original ShapeShifter (y3 - y0) signed area scaling formula.
 */
export function getCommandArea(cmd: Command, start: Point): number {
  if (cmd.type === "M") return 0;
  const x0 = start.x;
  const y0 = start.y;
  const end = cmd.points.at(-1) || { x: 0, y: 0 };
  const x3 = end.x;
  const y3 = end.y;

  let area = 0;
  switch (cmd.type) {
    case "L":
    case "Z":
      area = (x0 + x3) * (y3 - y0);
      break;
    case "Q":
    case "C":
      let x1 = 0;
      let y1 = 0;
      let x2 = 0;
      let y2 = 0;
      if (cmd.type === "Q") {
        const cp = cmd.points[0] || start;
        x1 = x0 + (2 / 3) * (cp.x - x0);
        y1 = y0 + (2 / 3) * (cp.y - y0);
        x2 = x3 + (2 / 3) * (cp.x - x3);
        y2 = y3 + (2 / 3) * (cp.y - y3);
      } else {
        x1 = cmd.points[0]?.x ?? x0;
        y1 = cmd.points[0]?.y ?? y0;
        x2 = cmd.points[1]?.x ?? x3;
        y2 = cmd.points[1]?.y ?? y3;
      }
      area =
        (3 *
          ((y3 - y0) * (x1 + x2) -
            (x3 - x0) * (y1 + y2) +
            y1 * (x0 - x2) -
            x1 * (y0 - y2) +
            y3 * (x2 + x0 / 3) -
            x3 * (y2 + y0 / 3))) /
        20;
      break;
  }
  return area;
}

/**
 * Checks if a subpath has a clockwise winding order using Green's Theorem area sum.
 */
export function isSubPathClockwise(subPath: SubPath): boolean {
  let sum = 0;
  let current = { x: 0, y: 0 };
  subPath.commands.forEach((cmd, idx) => {
    const start = idx === 0 ? cmd.points[0] || { x: 0, y: 0 } : current;
    sum += getCommandArea(cmd, start);
    current = cmd.points.at(-1) || current;
  });
  return sum >= 0;
}

// ─── BEZIER SAMPLING FOR POLYLABEL ───────────────────────────────────────

function sampleCubicBezier(p0: Point, cp1: Point, cp2: Point, p3: Point, steps = 8): Point[] {
  const points: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const w0 = mt * mt * mt;
    const w1 = 3 * mt * mt * t;
    const w2 = 3 * mt * t * t;
    const w3 = t * t * t;
    points.push({
      x: w0 * p0.x + w1 * cp1.x + w2 * cp2.x + w3 * p3.x,
      y: w0 * p0.y + w1 * cp1.y + w2 * cp2.y + w3 * p3.y,
    });
  }
  return points;
}

function sampleQuadBezier(p0: Point, p1: Point, p2: Point, steps = 8): Point[] {
  const points: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const w0 = mt * mt;
    const w1 = 2 * mt * t;
    const w2 = t * t;
    points.push({
      x: w0 * p0.x + w1 * p1.x + w2 * p2.x,
      y: w0 * p0.y + w1 * p1.y + w2 * p2.y,
    });
  }
  return points;
}

// ─── POLYLABEL QUAD-TREE SEARCH ──────────────────────────────────────────

function getPointToSegmentDistanceSq(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return (x - x1) ** 2 + (y - y1) ** 2;
  }
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy);
  if (t < 0) {
    return (x - x1) ** 2 + (y - y1) ** 2;
  }
  if (t > 1) {
    return (x - x2) ** 2 + (y - y2) ** 2;
  }
  return (x - (x1 + t * dx)) ** 2 + (y - (y1 + t * dy)) ** 2;
}

function getPointToPolygonDistance(x: number, y: number, polygon: Point[]): number {
  let minDistanceSq = Infinity;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;

    const distSq = getPointToSegmentDistanceSq(x, y, xi, yi, xj, yj);
    if (distSq < minDistanceSq) {
      minDistanceSq = distSq;
    }
  }

  return (inside ? 1 : -1) * Math.sqrt(minDistanceSq);
}

interface Cell {
  x: number;
  y: number;
  h: number;
  d: number;
  max: number;
}

/**
 * Finds the Pole of Inaccessibility (optimal internal centroid) for a closed path.
 * Uses a fast quadtree priority search (Polylabel algorithm) with Bezier segment sampling.
 */
export function getPoleOfInaccessibility(subPath: SubPath, precision = 0.5): Point {
  const polygon: Point[] = [];
  let current = { x: 0, y: 0 };

  subPath.commands.forEach((cmd, idx) => {
    const start = idx === 0 ? cmd.points[0] || { x: 0, y: 0 } : current;
    if (idx === 0) polygon.push(start);

    if (cmd.type === "L" || cmd.type === "Z") {
      const end = cmd.points.at(-1) || start;
      polygon.push(end);
    } else if (cmd.type === "C" && cmd.points.length === 3) {
      const p0 = start;
      const cp1 = cmd.points[0];
      const cp2 = cmd.points[1];
      const p3 = cmd.points[2];
      polygon.push(...sampleCubicBezier(p0, cp1, cp2, p3));
    } else if (cmd.type === "Q" && cmd.points.length === 2) {
      const p0 = start;
      const cp = cmd.points[0];
      const p2 = cmd.points[1];
      polygon.push(...sampleQuadBezier(p0, cp, p2));
    } else {
      const end = cmd.points.at(-1) || start;
      polygon.push(end);
    }
    current = cmd.points.at(-1) || current;
  });

  if (polygon.length === 0) return { x: 12, y: 12 };
  if (polygon.length === 1) return polygon[0];

  // 2. Compute bounding box
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  polygon.forEach((p) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });

  const width = maxX - minX;
  const height = maxY - minY;
  const cellSize = Math.min(width, height);
  const h = cellSize / 2;

  if (cellSize === 0) return { x: minX, y: minY };

  // 3. Grid-based priority search
  const cells: Cell[] = [];

  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      const cx = x + h;
      const cy = y + h;
      const d = getPointToPolygonDistance(cx, cy, polygon);
      cells.push({ x: cx, y: cy, h, d, max: d + h * Math.sqrt(2) });
    }
  }

  let bestCell = {
    x: minX + width / 2,
    y: minY + height / 2,
    h: 0,
    d: getPointToPolygonDistance(minX + width / 2, minY + height / 2, polygon),
    max: 0,
  };
  cells.forEach((cell) => {
    if (cell.d > bestCell.d) bestCell = cell;
  });

  cells.sort((a, b) => b.max - a.max);

  while (cells.length > 0) {
    const cell = cells.shift()!;

    if (cell.max - bestCell.d <= precision) continue;

    const newH = cell.h / 2;
    const subCells = [
      { x: cell.x - newH, y: cell.y - newH },
      { x: cell.x + newH, y: cell.y - newH },
      { x: cell.x - newH, y: cell.y + newH },
      { x: cell.x + newH, y: cell.y + newH },
    ];

    subCells.forEach(({ x, y }) => {
      const d = getPointToPolygonDistance(x, y, polygon);
      if (d > bestCell.d) {
        bestCell = { x, y, h: newH, d, max: d + newH * Math.sqrt(2) };
      }
      const max = d + newH * Math.sqrt(2);
      if (max - bestCell.d > precision) {
        cells.push({ x, y, h: newH, d, max });
      }
    });

    cells.sort((a, b) => b.max - a.max);
  }

  return { x: bestCell.x, y: bestCell.y };
}

/**
 * Port of SvgUtil.arcToBeziers (W1-T1).
 * Converts an elliptical arc (rx, ry, xAxisRotation, largeArc, sweep, x2, y2)
 * starting at (x1, y1) into a sequence of cubic Bezier curve segments.
 */
export function arcToBeziers(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  xAxisRotation: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): { cp1: Point; cp2: Point; to: Point }[] {
  if (x1 === x2 && y1 === y2) return [];

  if (rx === 0 || ry === 0) {
    return [
      {
        cp1: { x: x1 + (x2 - x1) / 3, y: y1 + (y2 - y1) / 3 },
        cp2: { x: x1 + (2 * (x2 - x1)) / 3, y: y1 + (2 * (y2 - y1)) / 3 },
        to: { x: x2, y: y2 },
      },
    ];
  }

  rx = Math.abs(rx);
  ry = Math.abs(ry);

  const phi = (xAxisRotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  let rxSq = rx * rx;
  let rySq = ry * ry;
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;

  const radiiCheck = x1pSq / rxSq + y1pSq / rySq;
  if (radiiCheck > 1) {
    rx *= Math.sqrt(radiiCheck);
    ry *= Math.sqrt(radiiCheck);
    rxSq = rx * rx;
    rySq = ry * ry;
  }

  const sign = largeArc === sweep ? -1 : 1;
  const num = rxSq * rySq - rxSq * y1pSq - rySq * x1pSq;
  const den = rxSq * y1pSq + rySq * x1pSq;
  let sq = den === 0 ? 0 : num / den;
  if (sq < 0) sq = 0;
  const coef = sign * Math.sqrt(sq);
  const cxp = coef * ((rx * y1p) / ry);
  const cyp = coef * -((ry * x1p) / rx);

  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;

  const angleBetween = (ux1: number, uy1: number, ux2: number, uy2: number) => {
    const dot = ux1 * ux2 + uy1 * uy2;
    const len = Math.sqrt(ux1 * ux1 + uy1 * uy1) * Math.sqrt(ux2 * ux2 + uy2 * uy2);
    let ang = dot / len;
    if (ang < -1) ang = -1;
    if (ang > 1) ang = 1;
    const angle = Math.acos(ang);
    const sign = ux1 * uy2 - uy1 * ux2 < 0 ? -1 : 1;
    return sign * angle;
  };

  const startAngle = angleBetween(1, 0, ux, uy);
  let deltaAngle = angleBetween(ux, uy, vx, vy);

  if (!sweep && deltaAngle > 0) {
    deltaAngle -= 2 * Math.PI;
  } else if (sweep && deltaAngle < 0) {
    deltaAngle += 2 * Math.PI;
  }

  const segments = Math.ceil(Math.abs(deltaAngle) / (Math.PI / 2));
  const beziers: { cp1: Point; cp2: Point; to: Point }[] = [];

  for (let i = 0; i < segments; i++) {
    const a1 = startAngle + (i * deltaAngle) / segments;
    const a2 = startAngle + ((i + 1) * deltaAngle) / segments;

    const theta = a2 - a1;
    const t = Math.tan(theta / 4);
    const alpha = (Math.sin(theta) * (Math.sqrt(4 + 3 * t * t) - 1)) / 3;

    const cosA1 = Math.cos(a1);
    const sinA1 = Math.sin(a1);
    const cosA2 = Math.cos(a2);
    const sinA2 = Math.sin(a2);

    const ex1 = cosA1;
    const ey1 = sinA1;
    const tx1 = -sinA1;
    const ty1 = cosA1;

    const ecp1x = ex1 + alpha * tx1;
    const ecp1y = ey1 + alpha * ty1;

    const ex2 = cosA2;
    const ey2 = sinA2;
    const tx2 = -sinA2;
    const ty2 = cosA2;

    const ecp2x = ex2 - alpha * tx2;
    const ecp2y = ey2 - alpha * ty2;

    const transformPoint = (ex: number, ey: number): Point => {
      const x = rx * ex;
      const y = ry * ey;
      return {
        x: cosPhi * x - sinPhi * y + cx,
        y: sinPhi * x + cosPhi * y + cy,
      };
    };

    const cp1 = transformPoint(ecp1x, ecp1y);
    const cp2 = transformPoint(ecp2x, ecp2y);
    const pEnd = i === segments - 1 ? { x: x2, y: y2 } : transformPoint(ex2, ey2);

    beziers.push({ cp1, cp2, to: pEnd });
  }

  return beziers;
}

/**
 * ShapeShifter 2026 - Path Utilities
 * Parser, serializer, and basic manipulation for SVG paths.
 * Focused on morphing compatibility.
 */

import type { Command, CommandType, PathData, Point, SubPath } from "./types";

let idCounter = 0;
function generateId(): string {
  return `cmd_${Date.now()}_${idCounter++}`;
}

const COMMAND_POINT_COUNTS: Partial<Record<CommandType, number>> = {
  M: 1,
  L: 1,
  H: 1,
  V: 1,
  C: 3,
  S: 2,
  Q: 2,
  T: 1,
  A: 1,
};

const clonePath = (pathData: PathData): PathData => structuredClone(pathData);

const round = (value: number) => Number(value.toFixed(3));

function ensureSubPath(subPaths: SubPath[]): SubPath {
  const current = subPaths.at(-1);
  if (current) return current;
  const created = { commands: [] };
  subPaths.push(created);
  return created;
}

/**
 * Parse an SVG path 'd' string into structured PathData.
 * Supports absolute and relative M/L/H/V/C/S/Q/T/Z. Arcs are kept as endpoint
 * commands so imported icon paths remain editable instead of being dropped.
 */
export function parsePath(d: string): PathData {
  if (!d || !d.trim()) {
    return { subPaths: [{ commands: [] }] };
  }

  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const subPaths: SubPath[] = [];
  let index = 0;
  let commandToken = "";
  let current: Point = { x: 0, y: 0 };
  let subPathStart: Point = { x: 0, y: 0 };

  const isCommand = (token: string | undefined) => !!token && /^[a-zA-Z]$/.test(token);
  const readNumber = () => Number(tokens[index++]);
  const readPoint = (relative: boolean): Point => {
    const x = readNumber();
    const y = readNumber();
    return relative ? { x: current.x + x, y: current.y + y } : { x, y };
  };

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      commandToken = tokens[index++];
    }
    if (!commandToken) break;

    const rawType = commandToken;
    const type = rawType.toUpperCase() as CommandType;
    const relative = rawType !== rawType.toUpperCase();
    const subPath = ensureSubPath(subPaths);

    if (type === "Z") {
      subPath.commands.push({ id: generateId(), type: "Z", points: [] });
      current = { ...subPathStart };
      continue;
    }

    if (type === "M") {
      const point = readPoint(relative);
      current = point;
      subPathStart = point;
      subPaths.push({ commands: [{ id: generateId(), type: "M", points: [point] }] });

      while (index < tokens.length && !isCommand(tokens[index])) {
        const linePoint = readPoint(relative);
        current = linePoint;
        ensureSubPath(subPaths).commands.push({ id: generateId(), type: "L", points: [linePoint] });
      }
      continue;
    }

    while (index < tokens.length && !isCommand(tokens[index])) {
      if (type === "H") {
        const x = readNumber();
        current = { x: relative ? current.x + x : x, y: current.y };
        subPath.commands.push({ id: generateId(), type: "L", points: [{ ...current }] });
        continue;
      }

      if (type === "V") {
        const y = readNumber();
        current = { x: current.x, y: relative ? current.y + y : y };
        subPath.commands.push({ id: generateId(), type: "L", points: [{ ...current }] });
        continue;
      }

      if (type === "A") {
        // Preserve arc data (rx, ry, xRotation, largeArc, sweep, endpoint)
        // Full arc-to-bezier conversion will be done in Wave 1 (W1-T1).
        // For now we at least stop silent data loss so roundtrips and later
        // conversion are possible.
        if (index + 7 > tokens.length) break;
        const rx = readNumber();
        const ry = readNumber();
        const xRotation = readNumber();
        const largeArc = readNumber() !== 0;
        const sweep = readNumber() !== 0;
        const end = readPoint(relative);
        current = end;
        subPath.commands.push({
          id: generateId(),
          type: "A",
          points: [end],
          arcParams: { rx, ry, xRotation, largeArc, sweep },
        });
        continue;
      }

      const pointCount = COMMAND_POINT_COUNTS[type];
      if (!pointCount || index + pointCount * 2 > tokens.length) break;

      const points = Array.from({ length: pointCount }, () => readPoint(relative));
      current = points.at(-1) ?? current;
      subPath.commands.push({ id: generateId(), type, points });
    }
  }

  return { subPaths: subPaths.filter((subPath) => subPath.commands.length > 0) };
}

/**
 * Convert structured PathData back to SVG 'd' string.
 */
export function pathToString(pathData: PathData): string {
  let d = "";

  for (const subPath of pathData.subPaths) {
    for (const cmd of subPath.commands) {
      d += cmd.type;

      if (cmd.type === "Z") {
        continue;
      }

      cmd.points.forEach((p, index) => {
        d += `${round(p.x)} ${round(p.y)}`;
        if (index < cmd.points.length - 1) d += " ";
      });
      d += " ";
    }
  }

  return d.trim();
}

/**
 * Get all commands flattened (for the current simple model).
 */
export function getAllCommands(pathData: PathData): Command[] {
  return pathData.subPaths.flatMap((sp) => sp.commands);
}

/**
 * Simple point update helper.
 */
export function updatePoint(
  pathData: PathData,
  subIdx: number,
  cmdIdx: number,
  pointIdx: number,
  newPoint: Point,
): PathData {
  const newData = clonePath(pathData);
  const cmd = newData.subPaths[subIdx].commands[cmdIdx];
  if (cmd && cmd.points[pointIdx]) {
    cmd.points[pointIdx] = newPoint;
  }
  return newData;
}

/**
 * Add a new point after a specific command (very basic for MVP).
 */
export function addPointAfter(
  pathData: PathData,
  subIdx: number,
  cmdIdx: number,
  newPoint: Point,
): PathData {
  const newData = clonePath(pathData);
  const sub = newData.subPaths[subIdx];

  const newCmd: Command = {
    id: generateId(),
    type: "L", // default to line for simplicity
    points: [newPoint],
  };

  sub.commands.splice(cmdIdx + 1, 0, newCmd);
  return newData;
}

/**
 * Delete a command (point).
 */
export function deleteCommand(pathData: PathData, subIdx: number, cmdIdx: number): PathData {
  const newData = clonePath(pathData);
  newData.subPaths[subIdx].commands.splice(cmdIdx, 1);
  return newData;
}
/**
 * Find the best place to insert a new point near a clicked location.
 * Uses simple sampling for now (good enough for 2026 MVP, upgradeable).
 */
export function insertPointNear(
  pathData: PathData,
  click: Point,
  sampleCount = 50,
): { subIdx: number; cmdIdx: number; newPoint: Point } | null {
  let bestDist = Infinity;
  let bestResult: any = null;

  pathData.subPaths.forEach((sub, subIdx) => {
    sub.commands.forEach((cmd, cmdIdx) => {
      if (cmd.type === "Z" || cmd.points.length === 0) return;

      const prevPoint = (cmdIdx > 0 ? sub.commands[cmdIdx - 1].points.at(-1) : undefined) ?? {
        x: 0,
        y: 0,
      };

      const endPoint = cmd.points.at(-1)!;

      for (let t = 0; t <= 1; t += 1 / sampleCount) {
        const x = prevPoint.x + (endPoint.x - prevPoint.x) * t;
        const y = prevPoint.y + (endPoint.y - prevPoint.y) * t;

        const dx = x - click.x;
        const dy = y - click.y;
        const dist = dx * dx + dy * dy;

        if (dist < bestDist) {
          bestDist = dist;
          bestResult = {
            subIdx,
            cmdIdx,
            newPoint: { x, y },
          };
        }
      }
    });
  });

  return bestResult;
}

/**
 * Interpolate between two PathData objects at a given progress (0-1).
 * Assumes the paths have compatible structure (same number of subpaths/commands/points).
 * This is the heart of the morphing animation.
 */
export function getInterpolatedPath(from: PathData, to: PathData, t: number): string {
  // Clamp t
  t = Math.max(0, Math.min(1, t));

  let result = "";

  const maxSub = Math.max(from.subPaths.length, to.subPaths.length);

  for (let s = 0; s < maxSub; s++) {
    const fromSub = from.subPaths[s] || { commands: [] };
    const toSub = to.subPaths[s] || { commands: [] };

    const maxCmd = Math.max(fromSub.commands.length, toSub.commands.length);

    for (let c = 0; c < maxCmd; c++) {
      const fromCmd = fromSub.commands[c];
      const toCmd = toSub.commands[c];

      if (!fromCmd) {
        // If no from command, just use to (degenerate case)
        if (toCmd) {
          result += toCmd.type;
          toCmd.points.forEach((p) => {
            result += `${round(p.x)} ${round(p.y)} `;
          });
        }
        continue;
      }

      if (!toCmd) {
        // Similar fallback
        result += fromCmd.type;
        fromCmd.points.forEach((p) => {
          result += `${round(p.x)} ${round(p.y)} `;
        });
        continue;
      }

      // Interpolate command type (prefer from for now)
      result += fromCmd.type;

      const maxPts = Math.max(fromCmd.points.length, toCmd.points.length);
      if (maxPts === 0) {
        continue;
      }

      for (let p = 0; p < maxPts; p++) {
        const fp = fromCmd.points[p] || fromCmd.points[fromCmd.points.length - 1];
        const tp = toCmd.points[p] || toCmd.points[toCmd.points.length - 1];
        if (!fp || !tp) continue;

        const x = fp.x + (tp.x - fp.x) * t;
        const y = fp.y + (tp.y - fp.y) * t;

        result += `${round(x)} ${round(y)} `;
      }
    }
  }

  return result.trim();
}

/**
 * Reverse a path's direction.
 * Useful for making morphs work when one shape is drawn in the opposite winding order.
 * Reverses the order of commands in each subpath and the points within each command.
 */
export function reversePath(path: PathData): PathData {
  return {
    subPaths: path.subPaths.map((subPath) => ({
      commands: [...subPath.commands].reverse().map((cmd) => ({
        ...cmd,
        points: [...cmd.points].reverse(),
      })),
    })),
  };
}

/**
 * Shift the points in a path by a given number of steps (useful for morph compatibility).
 */
export function shiftPath(path: PathData, steps: number): PathData {
  if (steps === 0) return path;
  return {
    subPaths: path.subPaths.map((subPath) => {
      let allPoints: Point[] = [];
      subPath.commands.forEach((cmd) => {
        allPoints = allPoints.concat(cmd.points);
      });
      if (allPoints.length === 0) return subPath;

      const shift = ((steps % allPoints.length) + allPoints.length) % allPoints.length;
      const shiftedPoints = allPoints.slice(shift).concat(allPoints.slice(0, shift));

      // Rebuild commands (simplified - keeps command types but redistributes points)
      let newCommands: Command[] = [];
      let pointIdx = 0;
      subPath.commands.forEach((cmd) => {
        const cmdPoints = shiftedPoints.slice(pointIdx, pointIdx + cmd.points.length);
        newCommands.push({ ...cmd, points: cmdPoints });
        pointIdx += cmd.points.length;
      });
      return { commands: newCommands };
    }),
  };
}

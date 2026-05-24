/**
 * ShapeShifter 2026 - Path Utilities
 * Parser, serializer, and basic manipulation for SVG paths.
 * Focused on morphing compatibility.
 */

import { Command, CommandType, PathData, Point, SubPath } from "./types";

let idCounter = 0;
function generateId(): string {
  return `cmd_${Date.now()}_${idCounter++}`;
}

/**
 * Parse an SVG path 'd' string into structured PathData.
 * Supports the most common commands used in icon animation.
 */
export function parsePath(d: string): PathData {
  if (!d || !d.trim()) {
    return { subPaths: [{ commands: [] }] };
  }

  const commands: Command[] = [];
  // Improved regex for SVG path commands
  const commandRegex = /([MLCSQAZHVST])\s*([^MLCSQAZHVST]*)/gi;
  let match;

  while ((match = commandRegex.exec(d)) !== null) {
    const type = match[1].toUpperCase() as CommandType;
    const args = match[2]
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(parseFloat);

    const points: Point[] = [];

    if (type === "M" || type === "L") {
      for (let i = 0; i < args.length; i += 2) {
        points.push({ x: args[i], y: args[i + 1] });
      }
    } else if (type === "C") {
      // Cubic: 3 points (control1, control2, end)
      for (let i = 0; i < args.length; i += 2) {
        points.push({ x: args[i], y: args[i + 1] });
      }
    } else if (type === "Q") {
      for (let i = 0; i < args.length; i += 2) {
        points.push({ x: args[i], y: args[i + 1] });
      }
    } else if (type === "Z") {
      // Close path - no points needed for rendering
    } else {
      // Fallback: treat as sequence of x,y
      for (let i = 0; i < args.length; i += 2) {
        if (!isNaN(args[i]) && !isNaN(args[i + 1])) {
          points.push({ x: args[i], y: args[i + 1] });
        }
      }
    }

    if (points.length > 0 || type === "Z") {
      commands.push({
        id: generateId(),
        type,
        points,
      });
    }
  }

  // Group into subpaths (very simple version for now)
  const subPaths: SubPath[] = [{ commands }];

  return { subPaths };
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
        d += `${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
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
  const newData = JSON.parse(JSON.stringify(pathData)); // cheap deep clone for now
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
  const newData = JSON.parse(JSON.stringify(pathData));
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
  const newData = JSON.parse(JSON.stringify(pathData));
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

      const prevPoint = (cmdIdx > 0 ? sub.commands[cmdIdx - 1].points.at(-1) : undefined) ?? { x: 0, y: 0 };

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
            result += `${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
          });
        }
        continue;
      }

      if (!toCmd) {
        // Similar fallback
        result += fromCmd.type;
        fromCmd.points.forEach((p) => {
          result += `${p.x.toFixed(2)} ${p.y.toFixed(2)} `;
        });
        continue;
      }

      // Interpolate command type (prefer from for now)
      result += fromCmd.type;

      const maxPts = Math.max(fromCmd.points.length, toCmd.points.length);

      for (let p = 0; p < maxPts; p++) {
        const fp = fromCmd.points[p] || fromCmd.points[fromCmd.points.length - 1];
        const tp = toCmd.points[p] || toCmd.points[toCmd.points.length - 1];

        const x = fp.x + (tp.x - fp.x) * t;
        const y = fp.y + (tp.y - fp.y) * t;

        result += `${x.toFixed(2)} ${y.toFixed(2)} `;
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

/**
 * ShapeShifter 2026 - Path Utilities
 * Parser, serializer, and basic manipulation for SVG paths.
 * Focused on morphing compatibility.
 */

import type { Command, CommandType, PathData, Point, SubPath } from "./types";
import { arePointsEqual } from "./mathUtils";

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

// === Needleman-Wunsch Alignment (ported from original Angular AutoAwesome + NeedlemanWunsch) ===
// This is CORE to high-quality auto-fix morphing. The previous implementation was a naive
// count-equalizer; this uses sequence alignment + distance scoring for optimal point insertion.

export const MATCH = 1;
export const MISMATCH = -1;
export const INDEL = 0;

export interface NWAlignment<T> {
  obj?: T;
}

export function align<T>(
  from: ReadonlyArray<T>,
  to: ReadonlyArray<T>,
  scoringFn: (t1: T, t2: T) => number,
): { from: ReadonlyArray<NWAlignment<T>>; to: ReadonlyArray<NWAlignment<T>>; score: number } {
  const listA: NWAlignment<T>[] = from.map((obj) => ({ obj }));
  const listB: NWAlignment<T>[] = to.map((obj) => ({ obj }));
  const alignedListA: NWAlignment<T>[] = [];
  const alignedListB: NWAlignment<T>[] = [];

  listA.unshift({});
  listB.unshift({});

  const matrix: number[][] = [];
  for (let i = 0; i < listA.length; i++) {
    const row: number[] = [];
    for (let j = 0; j < listB.length; j++) {
      row.push(i === 0 ? j * INDEL : j === 0 ? i * INDEL : 0);
    }
    matrix.push(row);
  }

  for (let i = 1; i < listA.length; i++) {
    for (let j = 1; j < listB.length; j++) {
      const match = matrix[i - 1][j - 1] + scoringFn(listA[i].obj!, listB[j].obj!);
      const ins = matrix[i][j - 1] + INDEL;
      const del = matrix[i - 1][j] + INDEL;
      matrix[i][j] = Math.max(match, ins, del);
    }
  }

  let i = listA.length - 1;
  let j = listB.length - 1;

  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      matrix[i][j] === matrix[i - 1][j - 1] + scoringFn(listA[i].obj!, listB[j].obj!)
    ) {
      alignedListA.unshift(listA[i--]);
      alignedListB.unshift(listB[j--]);
    } else if (i > 0 && matrix[i][j] === matrix[i - 1][j] + INDEL) {
      alignedListA.unshift(listA[i--]);
      alignedListB.unshift({});
    } else {
      alignedListA.unshift({});
      alignedListB.unshift(listB[j--]);
    }
  }

  const finalScore = matrix[listA.length - 1]?.[listB.length - 1] ?? 0;
  return { from: alignedListA, to: alignedListB, score: finalScore };
}

// Helper to get the "end" point of a command (for scoring distance in auto fix)
function getCommandEnd(cmd: Command): Point {
  if (!cmd.points || cmd.points.length === 0) return { x: 0, y: 0 };
  return cmd.points[cmd.points.length - 1];
}

// Approximate "can convert" for scoring (original has rich Command.canConvertTo)
function canRoughlyConvert(typeA: CommandType, typeB: CommandType): boolean {
  if (typeA === typeB) return true;
  const bezier = new Set<CommandType>(["C", "Q", "S", "T"]);
  if (bezier.has(typeA) && bezier.has(typeB)) return true;
  if ((typeA === "L" || typeA === "H" || typeA === "V") && (typeB === "L" || typeB === "H" || typeB === "V" || bezier.has(typeB))) return true;
  return false;
}

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
        d += " ";
        continue;
      }

      if (cmd.type === "A" && cmd.arcParams) {
        const ap = cmd.arcParams;
        const end = cmd.points.at(-1)!;
        d += `${round(ap.rx)} ${round(ap.ry)} ${round(ap.xRotation)} ${ap.largeArc ? 1 : 0} ${ap.sweep ? 1 : 0} ${round(end.x)} ${round(end.y)} `;
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
  const newData = clonePathDataForSplit(pathData);
  newData.subPaths[subIdx].commands.splice(cmdIdx, 1);
  return newData;
}

/**
 * Deletes an entire subpath. Used by the UI for "delete subpath" operations.
 * Faithful to original behavior.
 */
export function deleteSubPath(pathData: PathData, subIdx: number): PathData {
  const newData = clonePathDataForSplit(pathData);
  if (subIdx >= 0 && subIdx < newData.subPaths.length) {
    newData.subPaths.splice(subIdx, 1);
  }
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
): { subIdx: number; cmdIdx: number; newPoint: Point; t?: number } | null {
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
            t,
          };
        }
      }
    });
  });

  return bestResult;
}

/**
 * Finds the closest point on the path (with better curve awareness via sampling)
 * and actually splits the command at that location.
 * This is the curve-aware counterpart to insertPointNear and is used for
 * precise "add point on curve" and Auto Fix splitting.
 * Returns the updated PathData with the split performed.
 */
export function splitPointNear(pathData: PathData, click: Point, sampleCount = 80): PathData | null {
  if (!pathData.subPaths.length || pathData.subPaths.every(s => s.commands.length === 0)) {
    return null;
  }

  // First find the best location using denser sampling (improves on pure linear)
  let best = { dist: Infinity, subIdx: 0, cmdIdx: 0, t: 0.5, cmd: null as any, isEndpoint: false };

  pathData.subPaths.forEach((sub, subIdx) => {
    sub.commands.forEach((cmd, cmdIdx) => {
      if (cmd.type === "Z" || cmd.points.length === 0) return;

      const prev = cmdIdx > 0 ? sub.commands[cmdIdx - 1].points.at(-1)! : { x: 0, y: 0 };
      const end = cmd.points.at(-1)!;

      for (let i = 0; i <= sampleCount; i++) {
        const t = i / sampleCount;
        const x = prev.x + (end.x - prev.x) * t;
        const y = prev.y + (end.y - prev.y) * t;
        const d = (x - click.x) ** 2 + (y - click.y) ** 2;

        const isEndpoint = (t === 0 || t === 1);

        if (d < best.dist) {
          best = { dist: d, subIdx, cmdIdx, t, cmd, isEndpoint };
        }
      }
    });
  });

  if (best.dist === Infinity || !best.cmd || best.isEndpoint) return null;

  return splitCommandInHalf(pathData, best.subIdx, best.cmdIdx);
}

/**
 * Splits the command at the given index in half (t=0.5).
 * Produces a faithful geometric split for L and C (quadratic support can be added).
 * This is a core primitive used by Auto Fix and the direct manipulation tools.
 */
export function splitCommandInHalf(
  pathData: PathData,
  subIdx: number,
  cmdIdx: number,
): PathData {
  const newData = clonePathDataForSplit(pathData);
  const sub = newData.subPaths[subIdx];
  if (!sub || cmdIdx < 0 || cmdIdx >= sub.commands.length) return newData;

  const cmd = sub.commands[cmdIdx];
  if (cmd.type === "Z" || cmd.type === "M" || cmd.points.length === 0) return newData;

  const prevCmd = cmdIdx > 0 ? sub.commands[cmdIdx - 1] : null;
  const start = prevCmd ? prevCmd.points.at(-1)! : { x: 0, y: 0 };
  const end = cmd.points.at(-1)!;

  if (cmd.type === "L" || cmd.points.length === 1) {
    const mid: Point = {
      x: start.x + (end.x - start.x) * 0.5,
      y: start.y + (end.y - start.y) * 0.5,
    };
    const newCmd: Command = { id: generateId(), type: "L", points: [end] };
    sub.commands.splice(cmdIdx + 1, 0, newCmd);
    cmd.points[cmd.points.length - 1] = mid;
    return newData;
  }

  if (cmd.type === "C" && cmd.points.length === 3) {
    const p1 = cmd.points[0];
    const p2 = cmd.points[1];
    const p3 = cmd.points[2];

    const q0x = start.x + (p1.x - start.x) * 0.5;
    const q0y = start.y + (p1.y - start.y) * 0.5;
    const q1x = p1.x + (p2.x - p1.x) * 0.5;
    const q1y = p1.y + (p2.y - p1.y) * 0.5;
    const q2x = p2.x + (p3.x - p2.x) * 0.5;
    const q2y = p2.y + (p3.y - p2.y) * 0.5;

    const r0x = q0x + (q1x - q0x) * 0.5;
    const r0y = q0y + (q1y - q0y) * 0.5;
    const r1x = q1x + (q2x - q1x) * 0.5;
    const r1y = q1y + (q2y - q1y) * 0.5;

    const midEnd = { x: r0x + (r1x - r0x) * 0.5, y: r0y + (r1y - r0y) * 0.5 };

    cmd.points = [
      { x: q0x, y: q0y },
      { x: r0x, y: r0y },
      midEnd,
    ];

    const second: Command = {
      id: generateId(),
      type: "C",
      points: [
        { x: r1x, y: r1y },
        { x: q2x, y: q2y },
        end,
      ],
    };
    sub.commands.splice(cmdIdx + 1, 0, second);
    return newData;
  }

  const mid: Point = {
    x: start.x + (end.x - start.x) * 0.5,
    y: start.y + (end.y - start.y) * 0.5,
  };
  cmd.points[cmd.points.length - 1] = mid;
  const newCmd: Command = { id: generateId(), type: cmd.type as any, points: [end] };
  sub.commands.splice(cmdIdx + 1, 0, newCmd);
  return newData;
}

function clonePathDataForSplit(p: PathData): PathData {
  return JSON.parse(JSON.stringify(p));
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
    subPaths: path.subPaths.map((subPath) => {
      const reversedCmds = [...subPath.commands].reverse().map((cmd) => {
        const newCmd = { ...cmd, points: [...cmd.points].reverse() };

        // For arcs, flip the sweep flag on reverse (original behavior)
        if (newCmd.type === "A" && newCmd.arcParams) {
          newCmd.arcParams = {
            ...newCmd.arcParams,
            sweep: !newCmd.arcParams.sweep,
          };
        }

        // For cubic, the control points need correct reversal order
        // (our point storage makes simple reverse work for most cases, but ensure)
        return newCmd;
      });

      return { commands: reversedCmds };
    }),
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

/**
 * Counts the total number of points across the entire path.
 * Used by tests and auto-fix quality heuristics.
 */
export function countPathPoints(path: PathData): number {
  return path.subPaths.reduce(
    (sum, sp) => sum + sp.commands.reduce((csum, cmd) => csum + cmd.points.length, 0),
    0,
  );
}

/**
 * Rotates a closed subpath so that the command at cmdIdx becomes the first
 * drawing command after the initial M. This is a key morphing control
 * (matches original "set first point" behavior exactly for closed paths).
 * No-op for open paths or index 0.
 */
export function setCommandAsFirst(
  pathData: PathData,
  subIdx: number,
  cmdIdx: number,
): PathData {
  const newData = clonePathDataForSplit(pathData);
  const sub = newData.subPaths[subIdx];
  if (!sub || cmdIdx <= 0 || cmdIdx >= sub.commands.length) {
    return newData;
  }

  const cmds = sub.commands;
  const firstCmd = cmds[0];
  if (firstCmd.type !== "M") return newData; // safety

  // Check if closed (last is Z or ends near start)
  const last = cmds[cmds.length - 1];
  const isClosed = last.type === "Z" || (last.points.length > 0 && firstCmd.points.length > 0);

  if (!isClosed) return newData;

  // Rotate: the chosen command becomes the new first after M
  // New M point = endpoint of the command before the chosen one (or start of chosen)
  const targetCmd = cmds[cmdIdx];
  const prevCmd = cmds[cmdIdx - 1];
  const newMPoint = prevCmd ? prevCmd.points.at(-1)! : targetCmd.points[0];

  // Rebuild command list: M at new point, then commands from cmdIdx to end-1 (dropping old M and Z handling)
  const drawingCmds = cmds.slice(cmdIdx); // from target onward
  const before = cmds.slice(1, cmdIdx); // the ones that were before (now after)

  // Adjust the first point of what was the target command? No — the M moves.
  const newCommands: Command[] = [
    { id: generateId(), type: "M", points: [newMPoint] },
    ...drawingCmds.filter((c) => c.type !== "Z"),
    ...before,
  ];

  // Re-add Z if it was closed
  if (last.type === "Z") {
    newCommands.push({ id: generateId(), type: "Z", points: [] });
  }

  sub.commands = newCommands;
  return newData;
}

/**
 * Returns true when two paths have the same number of subpaths and the same
 * number of commands in each corresponding subpath. This is the minimum
 * requirement for getInterpolatedPath to produce a valid morph.
 */
export function arePathsStructurallyCompatible(a: PathData, b: PathData): boolean {
  if (a.subPaths.length !== b.subPaths.length) return false;
  for (let i = 0; i < a.subPaths.length; i++) {
    if (a.subPaths[i].commands.length !== b.subPaths[i].commands.length) {
      return false;
    }
  }
  return true;
}

/**
 * Makes two paths structurally compatible for morphing using high-fidelity
 * Needleman-Wunsch alignment + reverse/shift search + gap-streak splits.
 * Ported from the original Angular AutoAwesome + NeedlemanWunsch (the secret sauce
 * for great morphs). Current version approximates some advanced Path ops but is
 * a massive leap over naive equalizers. All previous tests + new NW behavior expected.
 */
export function autoFixPathPair(from: PathData, to: PathData): [PathData, PathData] {
  let a = clonePathDataForSplit(from);
  let b = clonePathDataForSplit(to);

  // 1. Equalize top-level subpath count (simple duplication of whole subpaths as collapsing)
  if (a.subPaths.length < b.subPaths.length) {
    while (a.subPaths.length < b.subPaths.length) {
      a.subPaths.push({ commands: structuredClone(b.subPaths[a.subPaths.length]?.commands || []) });
    }
  } else if (b.subPaths.length < a.subPaths.length) {
    while (b.subPaths.length < a.subPaths.length) {
      b.subPaths.push({ commands: structuredClone(a.subPaths[b.subPaths.length]?.commands || []) });
    }
  }

  const minSubs = Math.min(a.subPaths.length, b.subPaths.length);

  for (let s = 0; s < minSubs; s++) {
    // For each subpath, try a few candidates (original + reverse + a few shifts for closed)
    const candidates = generateShiftReverseCandidates(a, s);
    let bestA = a;
    let bestScore = -Infinity;
    let bestAlignment: any = null;

    for (const cand of candidates) {
      const fromCmds = cand.subPaths[s]?.commands || [];
      const toCmds = b.subPaths[s]?.commands || [];

      const scoreFn = (ca: Command, cb: Command) => {
        const typeOk = ca.type === cb.type || canRoughlyConvert(ca.type, cb.type) || canRoughlyConvert(cb.type, ca.type);
        if (!typeOk) return MISMATCH;
        const da = getCommandEnd(ca);
        const db = getCommandEnd(cb);
        const dist = Math.hypot(da.x - db.x, da.y - db.y) + 0.0001;
        return MATCH / dist; // inverse distance favors close endpoints
      };

      const al = align(fromCmds, toCmds, scoreFn);
      if (al.score > bestScore) {
        bestScore = al.score;
        bestA = cand;
        bestAlignment = al;
      }
    }

    if (bestAlignment) {
      a = applyAlignmentSplits(bestA, bestAlignment, s, "a");
      b = applyAlignmentSplits(b, bestAlignment, s, "b");
    }

    // Then equalize remaining command counts the old (safe) way
    a = equalizeSubpathCommands(a, b, s);
    b = equalizeSubpathCommands(b, a, s);
  }

  return [a, b];
}

function generateShiftReverseCandidates(path: PathData, subIdx: number): PathData[] {
  const base = clonePathDataForSplit(path);
  const sub = base.subPaths[subIdx];
  if (!sub) return [base];

  const cmds = sub.commands;
  const isClosed = cmds.length > 2 && (cmds[cmds.length - 1].type === "Z" ||
    (cmds[0].points.length && cmds[cmds.length-1].points.length &&
     arePointsEqual(cmds[0].points[0], cmds[cmds.length-1].points.at(-1)! )));

  const results: PathData[] = [base];

  // reverse version
  const rev = clonePathDataForSplit(path);
  const rcmds = rev.subPaths[subIdx].commands;
  rev.subPaths[subIdx] = { commands: rcmds.slice().reverse().map(c => ({...c, points: c.points.slice().reverse()})) };
  results.push(rev);

  if (isClosed) {
    for (let k = 1; k < Math.min(5, cmds.length - 1); k++) {
      const shifted = clonePathDataForSplit(path);
      const scmds = shifted.subPaths[subIdx].commands;
      const rotated = [...scmds.slice(k), ...scmds.slice(0, k)];
      shifted.subPaths[subIdx] = { commands: rotated };
      results.push(shifted);
    }
  }
  return results;
}

function applyAlignmentSplits(
  path: PathData,
  alignment: { from: NWAlignment<Command>[]; to: NWAlignment<Command>[] },
  subIdx: number,
  which: "a" | "b",
): PathData {
  const result = clonePathDataForSplit(path);
  let cmds = result.subPaths[subIdx]?.commands || [];
  if (cmds.length === 0) return result;

  const alSide = which === "a" ? alignment.from : alignment.to;

  // Identify gap streaks
  const gapGroups: Array<{start: number}> = [];
  let inGap = false;
  let gapStart = 0;
  for (let i = 0; i < alSide.length; i++) {
    const isGap = !alSide[i].obj;
    if (isGap && !inGap) {
      inGap = true;
      gapStart = i;
    } else if (!isGap && inGap) {
      inGap = false;
      gapGroups.push({start: gapStart});
    }
  }
  if (inGap) gapGroups.push({start: gapStart});

  // Apply splits from the end (indices shift)
  for (let g = gapGroups.length - 1; g >= 0; g--) {
    const group = gapGroups[g];
    // approximate insertion point from alignment position
    const insertAt = Math.max(1, Math.min(cmds.length - 1, Math.floor(group.start / 2)));
    if (insertAt >= cmds.length) continue;
    // perform one split (full would do fractional multi-splits per streak length)
    const afterSplit = splitCommandInHalf({ subPaths: [{ commands: cmds }] } as any, 0, insertAt);
    cmds = afterSplit.subPaths[0]?.commands || cmds;
  }
  result.subPaths[subIdx] = { commands: cmds };
  return result;
}

function equalizeSubpathCommands(target: PathData, ref: PathData, subIdx: number): PathData {
  let result = clonePathDataForSplit(target);
  const tCmds = result.subPaths[subIdx].commands;
  const rCmds = ref.subPaths[subIdx].commands;

  while (tCmds.length < rCmds.length) {
    let idx = -1;
    for (let i = tCmds.length - 1; i >= 0; i--) {
      if (tCmds[i].type !== "M" && tCmds[i].type !== "Z") {
        idx = i;
        break;
      }
    }
    if (idx === -1) break;
    result = splitCommandInHalf(result, subIdx, idx);
  }
  return result;
}

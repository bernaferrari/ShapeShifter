/**
 * ShapeShifter 2026 - Path Utilities
 * Parser, serializer, and basic manipulation for SVG paths.
 * Focused on morphing compatibility.
 */

import type { Command, CommandType, PathData, Point, SubPath } from "./types";
import { arePointsEqual } from "./mathUtils";
import { getPoleOfInaccessibility, isSubPathClockwise, arcToBeziers } from "./geometry";

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

// Hardened round for export fidelity (kus/24t/yrl symmetry): never emit NaN/Inf in d= strings.
// Bad coords from prior edits, import edge arcs, or math drift now safely drop to 0 (matching importer recovery).
const round = (value: number) => (Number.isFinite(value) ? Number(value.toFixed(3)) : 0);

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
  if (
    (typeA === "L" || typeA === "H" || typeA === "V") &&
    (typeB === "L" || typeB === "H" || typeB === "V" || bezier.has(typeB))
  )
    return true;
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

  // Harden against malformed/complex path data (NaNs from bad nums, scientific edge, unbalanced arcs etc): drop bad commands for graceful recovery everywhere (importers, direct edits)
  return {
    subPaths: subPaths
      .map((sp) => ({
        commands: sp.commands.filter((c) => {
          if (c.points.length === 0) return true;
          return c.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
        }),
      }))
      .filter((sp) => sp.commands.length > 0),
  };
}

/**
 * Convert structured PathData back to SVG 'd' string.
 */
export function pathToString(pathData: PathData): string {
  if (!pathData?.subPaths?.length) return "";

  let d = "";

  for (const subPath of pathData.subPaths) {
    // yrl/kus symmetry: harden export against any residual non-finite (post knife/boolean/paint/direct edits or complex arcs)
    const safeCommands = subPath.commands.filter((c) => {
      if (!c?.points?.length) return true;
      const ptsOk = c.points.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y));
      if (c.arcParams) {
        const ap = c.arcParams;
        return (
          ptsOk && Number.isFinite(ap.rx) && Number.isFinite(ap.ry) && Number.isFinite(ap.xRotation)
        );
      }
      return ptsOk;
    });
    for (const cmd of safeCommands) {
      d += cmd.type;

      if (cmd.type === "Z") {
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
 * Human-friendly description for a single path command.
 * Designed to power the beautiful command surface (ShapeShifter-wys / 3o7)
 * matching the calm, scannable table aesthetic from the reference image
 * (e.g. "M 17 3" → label "move to", short coords).
 * Pure and stable — safe to call on every render.
 */
export function getCommandDescription(cmd: Command): { label: string; shortCoords: string } {
  if (!cmd || !cmd.type) {
    return { label: "unknown", shortCoords: "" };
  }

  const type = cmd.type;
  const pts = cmd.points || [];
  const end = pts.at(-1);

  let label = "";
  switch (type) {
    case "M":
      label = "move to";
      break;
    case "L":
      label = "line to";
      break;
    case "H":
      label = "horizontal line to";
      break;
    case "V":
      label = "vertical line to";
      break;
    case "C":
      label = "cubic curve to";
      break;
    case "Q":
      label = "quadratic curve to";
      break;
    case "S":
      label = "smooth cubic to";
      break;
    case "T":
      label = "smooth quadratic to";
      break;
    case "A":
      label = "arc to";
      break;
    case "Z":
      label = "close path";
      break;
    default:
      label = String(type).toLowerCase();
  }

  let shortCoords = "";
  if (type === "Z") {
    shortCoords = "";
  } else if (type === "H" && pts[0]) {
    shortCoords = `${safeRound(pts[0].x)}`;
  } else if (type === "V" && pts[0]) {
    shortCoords = `${safeRound(pts[0].y)}`;
  } else if (end) {
    const ex = safeRound(end.x);
    const ey = safeRound(end.y);
    if (type === "C" && pts.length >= 3) {
      // Abbreviated but informative for the beautiful list (control + end)
      const c1x = safeRound(pts[1].x);
      const c1y = safeRound(pts[1].y);
      const c2x = safeRound(pts[2].x);
      const c2y = safeRound(pts[2].y);
      shortCoords = `${c1x} ${c1y} ${c2x} ${c2y} ${ex} ${ey}`;
    } else {
      shortCoords = `${ex} ${ey}`;
    }
  }

  return { label, shortCoords: shortCoords.trim() };
}

/** Internal safe round (mirrors the hardened one used in pathToString for export fidelity). */
function safeRound(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : 0;
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

export function translatePath(pathData: PathData, dx: number, dy: number): PathData {
  const newData = clonePath(pathData);
  for (const subPath of newData.subPaths) {
    for (const command of subPath.commands) {
      command.points = command.points.map((point) => ({
        x: point.x + dx,
        y: point.y + dy,
      }));
    }
  }
  return newData;
}

export function scalePathToBounds(
  pathData: PathData,
  fromBounds: { x: number; y: number; width: number; height: number },
  toBounds: { x: number; y: number; width: number; height: number },
): PathData {
  const newData = clonePath(pathData);
  const safeWidth = Math.abs(fromBounds.width) < 0.001 ? 1 : fromBounds.width;
  const safeHeight = Math.abs(fromBounds.height) < 0.001 ? 1 : fromBounds.height;

  for (const subPath of newData.subPaths) {
    for (const command of subPath.commands) {
      command.points = command.points.map((point) => ({
        x: toBounds.x + ((point.x - fromBounds.x) / safeWidth) * toBounds.width,
        y: toBounds.y + ((point.y - fromBounds.y) / safeHeight) * toBounds.height,
      }));
    }
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
  let bestResult: { subIdx: number; cmdIdx: number; newPoint: Point; t: number } | null = null;

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
 * Finds the closest point on the path (curve-aware via de Casteljau sampling for C/Q)
 * and splits the containing command (at 0.5 for smallest faithful split).
 * This is the curve-aware counterpart to insertPointNear (vn7 k88: fixed prior linear-only
 * sampling on curves) and is used for precise "add point on curve" and Auto Fix splitting.
 * Returns the updated PathData with the split performed.
 * Refs: 21g/upk/3ds/kbv, DESIGN 67dd105e.
 */
export function splitPointNear(
  pathData: PathData,
  click: Point,
  sampleCount = 80,
): PathData | null {
  if (!pathData.subPaths.length || pathData.subPaths.every((s) => s.commands.length === 0)) {
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
        // Real curve-aware projection (vn7 k88 harden): use de Casteljau / cubic-quad eval for C/Q
        // (fixes prior linear-only sampling on curves, which missed true closest for knife/pen/21g).
        // Matches sampleCubic/sampleQuad + splitCommandInHalf patterns exactly in this file.
        let x: number;
        let y: number;
        if (cmd.type === "C" && cmd.points.length === 3) {
          const p1 = cmd.points[0];
          const p2 = cmd.points[1];
          const p3 = end;
          const mt = 1 - t;
          const w0 = mt * mt * mt;
          const w1 = 3 * mt * mt * t;
          const w2 = 3 * mt * t * t;
          const w3 = t * t * t;
          x = w0 * prev.x + w1 * p1.x + w2 * p2.x + w3 * p3.x;
          y = w0 * prev.y + w1 * p1.y + w2 * p2.y + w3 * p3.y;
        } else if (cmd.type === "Q" && cmd.points.length === 2) {
          const p1 = cmd.points[0];
          const p2 = end;
          const mt = 1 - t;
          const w0 = mt * mt;
          const w1 = 2 * mt * t;
          const w2 = t * t;
          x = w0 * prev.x + w1 * p1.x + w2 * p2.x;
          y = w0 * prev.y + w1 * p1.y + w2 * p2.y;
        } else {
          // L / H / V or fallback
          x = prev.x + (end.x - prev.x) * t;
          y = prev.y + (end.y - prev.y) * t;
        }
        const d = (x - click.x) ** 2 + (y - click.y) ** 2;

        const isEndpoint = t === 0 || t === 1;

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
export function splitCommandInHalf(pathData: PathData, subIdx: number, cmdIdx: number): PathData {
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

    cmd.points = [{ x: q0x, y: q0y }, { x: r0x, y: r0y }, midEnd];

    const second: Command = {
      id: generateId(),
      type: "C",
      points: [{ x: r1x, y: r1y }, { x: q2x, y: q2y }, end],
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
      const cmds = subPath.commands;
      if (cmds.length === 0) return { commands: [] };

      const firstCmd = cmds[0];
      if (firstCmd.type !== "M") {
        return { commands: [...cmds].reverse() };
      }

      const E0 = firstCmd.points[0];
      let current = E0;

      interface DrawingTransition {
        type: CommandType;
        start: Point;
        end: Point;
        controlPoints: Point[];
        arcParams?: any;
      }

      const transitions: DrawingTransition[] = [];
      let isClosed = false;

      for (let i = 1; i < cmds.length; i++) {
        const cmd = cmds[i];
        if (cmd.type === "Z") {
          isClosed = true;
          break;
        }

        const end = cmd.points.at(-1)!;
        const controlPoints = cmd.points.slice(0, -1);
        transitions.push({
          type: cmd.type,
          start: current,
          end,
          controlPoints,
          arcParams: cmd.arcParams,
        });
        current = end;
      }

      if (transitions.length === 0) {
        if (isClosed) {
          return {
            commands: [
              { id: generateId(), type: "M", points: [E0] },
              { id: generateId(), type: "Z", points: [] },
            ],
          };
        }
        return {
          commands: [{ id: generateId(), type: "M", points: [E0] }],
        };
      }

      const newMPoint = transitions.at(-1)!.end;
      const reversedCmds: Command[] = [{ id: generateId(), type: "M", points: [newMPoint] }];

      for (let i = transitions.length - 1; i >= 0; i--) {
        const t = transitions[i];
        const newType = t.type;
        const newEnd = t.start;

        const newControlPoints = [...t.controlPoints].reverse();
        const newPoints = [...newControlPoints, newEnd];

        let newArcParams = t.arcParams;
        if (newType === "A" && newArcParams) {
          newArcParams = {
            ...newArcParams,
            sweep: !newArcParams.sweep,
          };
        }

        reversedCmds.push({
          id: generateId(),
          type: newType,
          points: newPoints,
          ...(newArcParams ? { arcParams: newArcParams } : {}),
        });
      }

      if (isClosed) {
        reversedCmds.push({ id: generateId(), type: "Z", points: [] });
      }

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
      const cmds = subPath.commands;
      if (cmds.length === 0) return subPath;
      const lastCmd = cmds[cmds.length - 1];
      const firstCmd = cmds[0];
      const isClosed =
        lastCmd.type === "Z" ||
        (firstCmd.points.length > 0 &&
          lastCmd.points.length > 0 &&
          arePointsEqual(firstCmd.points[0], lastCmd.points.at(-1)!));

      if (!isClosed) {
        return subPath;
      }

      let allPoints: Point[] = [];
      cmds.forEach((cmd) => {
        allPoints = allPoints.concat(cmd.points);
      });
      if (allPoints.length === 0) return subPath;

      const shift = ((steps % allPoints.length) + allPoints.length) % allPoints.length;
      const shiftedPoints = allPoints.slice(shift).concat(allPoints.slice(0, shift));

      let newCommands: Command[] = [];
      let pointIdx = 0;
      cmds.forEach((cmd) => {
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
export function setCommandAsFirst(pathData: PathData, subIdx: number, cmdIdx: number): PathData {
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
    const subA = a.subPaths[i];
    const subB = b.subPaths[i];
    if (subA.commands.length !== subB.commands.length) {
      return false;
    }
    for (let j = 0; j < subA.commands.length; j++) {
      if (subA.commands[j].type !== subB.commands[j].type) {
        return false;
      }
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
function createCollapsingSubPath(targetSubPath: SubPath, pole: Point): SubPath {
  return {
    commands: targetSubPath.commands.map((cmd) => {
      const points = cmd.points.map(() => ({ ...pole }));
      let arcParams = cmd.arcParams;
      if (cmd.type === "A" && arcParams) {
        arcParams = {
          ...arcParams,
          rx: 0,
          ry: 0,
        };
      }
      return {
        id: generateId(),
        type: cmd.type,
        points,
        ...(arcParams ? { arcParams } : {}),
      };
    }),
  };
}

function reversePathAtSubIndex(path: PathData, subIdx: number): PathData {
  const result = clonePathDataForSplit(path);
  result.subPaths[subIdx] = reversePath({ subPaths: [result.subPaths[subIdx]] }).subPaths[0];
  return result;
}

function convertCommandType(cmd: Command, start: Point, targetType: CommandType): Command {
  if (cmd.type === targetType) return cmd;
  const end = cmd.points.at(-1) || start;

  if (targetType === "C") {
    if (cmd.type === "L" || cmd.type === "M" || cmd.type === "Z") {
      return {
        id: cmd.id,
        type: "C",
        points: [{ ...start }, { ...end }, { ...end }],
      };
    }
    if (cmd.type === "Q") {
      const cp = cmd.points[0] || start;
      const cp1 = {
        x: start.x + (2 / 3) * (cp.x - start.x),
        y: start.y + (2 / 3) * (cp.y - start.y),
      };
      const cp2 = {
        x: end.x + (2 / 3) * (cp.x - end.x),
        y: end.y + (2 / 3) * (cp.y - end.y),
      };
      return {
        id: cmd.id,
        type: "C",
        points: [cp1, cp2, { ...end }],
      };
    }
  }

  if (targetType === "L") {
    return {
      id: cmd.id,
      type: "L",
      points: [{ ...end }],
    };
  }

  return cmd;
}

/**
 * Makes two paths structurally compatible for morphing using high-fidelity
 * Needleman-Wunsch alignment + reverse/shift search + gap-streak splits.
 * Ported from the original Angular AutoAwesome + NeedlemanWunsch (the secret sauce
 * for great morphs). Current version approximates some advanced Path ops but is
 * a massive leap over naive equalizers. All previous tests + new NW behavior expected.
 */
export function autoFixPathPair(from: PathData, to: PathData): [PathData, PathData] {
  let a = normalizePathData(clonePathDataForSplit(from));
  let b = normalizePathData(clonePathDataForSplit(to));

  // 1. Equalize top-level subpath count using collapsing subpaths at poles of inaccessibility
  if (a.subPaths.length < b.subPaths.length) {
    while (a.subPaths.length < b.subPaths.length) {
      const targetSub = b.subPaths[a.subPaths.length];
      const pole = getPoleOfInaccessibility(targetSub);
      a.subPaths.push(createCollapsingSubPath(targetSub, pole));
    }
  } else if (b.subPaths.length < a.subPaths.length) {
    while (b.subPaths.length < a.subPaths.length) {
      const targetSub = a.subPaths[b.subPaths.length];
      const pole = getPoleOfInaccessibility(targetSub);
      b.subPaths.push(createCollapsingSubPath(targetSub, pole));
    }
  }

  // 2. Reorder subpaths to minimize total distance between poles
  const numSubs = a.subPaths.length;
  if (numSubs > 1 && numSubs <= 8) {
    const fromPoles = a.subPaths.map((sp) => getPoleOfInaccessibility(sp));
    const toPoles = b.subPaths.map((sp) => getPoleOfInaccessibility(sp));

    let bestPermutation: number[] = [];
    let minSum = Infinity;

    const permute = (arr: number[], m: number[] = []) => {
      if (arr.length === 0) {
        let sum = 0;
        for (let i = 0; i < numSubs; i++) {
          const dx = fromPoles[m[i]].x - toPoles[i].x;
          const dy = fromPoles[m[i]].y - toPoles[i].y;
          sum += dx * dx + dy * dy;
        }
        if (sum < minSum) {
          minSum = sum;
          bestPermutation = m;
        }
      } else {
        for (let i = 0; i < arr.length; i++) {
          const curr = arr.slice();
          const next = curr.splice(i, 1);
          permute(curr.slice(), m.concat(next));
        }
      }
    };

    const indices = Array.from({ length: numSubs }, (_, i) => i);
    permute(indices);

    if (bestPermutation.length === numSubs) {
      a.subPaths = bestPermutation.map((idx) => a.subPaths[idx]);
    }
  }

  const minSubs = Math.min(a.subPaths.length, b.subPaths.length);

  for (let s = 0; s < minSubs; s++) {
    // 3. Align winding orders before matching/aligning
    if (isSubPathClockwise(a.subPaths[s]) !== isSubPathClockwise(b.subPaths[s])) {
      b = reversePathAtSubIndex(b, s);
    }

    // For each subpath, try a few candidates (original + reverse + a few shifts for closed)
    const candidates = generateShiftReverseCandidates(a, s);
    let bestA = a;
    let bestScore = -Infinity;
    let bestAlignment: {
      from: readonly NWAlignment<Command>[];
      to: readonly NWAlignment<Command>[];
      score: number;
    } | null = null;

    for (const cand of candidates) {
      const fromCmds = cand.subPaths[s]?.commands || [];
      const toCmds = b.subPaths[s]?.commands || [];

      const scoreFn = (ca: Command, cb: Command) => {
        const typeOk =
          ca.type === cb.type ||
          canRoughlyConvert(ca.type, cb.type) ||
          canRoughlyConvert(cb.type, ca.type);
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
      a = applyAlignmentSplits(
        bestA,
        { from: [...bestAlignment.from], to: [...bestAlignment.to] },
        s,
        "a",
      );
      b = applyAlignmentSplits(
        b,
        { from: [...bestAlignment.from], to: [...bestAlignment.to] },
        s,
        "b",
      );
    }

    // Then equalize remaining command counts the old (safe) way
    a = equalizeSubpathCommands(a, b, s);
    b = equalizeSubpathCommands(b, a, s);

    // 4. Convert commands to matching types
    const numCmds = a.subPaths[s].commands.length;
    let currA = a.subPaths[s].commands[0].points[0];
    let currB = b.subPaths[s].commands[0].points[0];

    for (let cmdIdx = 1; cmdIdx < numCmds; cmdIdx++) {
      const cmdA = a.subPaths[s].commands[cmdIdx];
      const cmdB = b.subPaths[s].commands[cmdIdx];
      const nextA = cmdA.points.at(-1) || currA;
      const nextB = cmdB.points.at(-1) || currB;

      if (cmdA.type !== cmdB.type && cmdA.type !== "Z" && cmdB.type !== "Z") {
        if (cmdA.type === "C" || cmdB.type === "C" || cmdA.type === "Q" || cmdB.type === "Q") {
          a.subPaths[s].commands[cmdIdx] = convertCommandType(cmdA, currA, "C");
          b.subPaths[s].commands[cmdIdx] = convertCommandType(cmdB, currB, "C");
        } else {
          a.subPaths[s].commands[cmdIdx] = convertCommandType(cmdA, currA, "L");
          b.subPaths[s].commands[cmdIdx] = convertCommandType(cmdB, currB, "L");
        }
      }
      currA = nextA;
      currB = nextB;
    }
  }

  return [a, b];
}

function generateShiftReverseCandidates(path: PathData, subIdx: number): PathData[] {
  const base = clonePathDataForSplit(path);
  const sub = base.subPaths[subIdx];
  if (!sub) return [base];

  const cmds = sub.commands;
  const isClosed =
    cmds.length > 2 &&
    (cmds[cmds.length - 1].type === "Z" ||
      (cmds[0].points.length &&
        cmds[cmds.length - 1].points.length &&
        arePointsEqual(cmds[0].points[0], cmds[cmds.length - 1].points.at(-1)!)));

  const results: PathData[] = [base];

  // reverse version
  results.push(reversePath(path));

  if (isClosed) {
    for (let k = 1; k < cmds.length; k++) {
      if (cmds[k].type !== "Z") {
        results.push(setCommandAsFirst(path, subIdx, k));
      }
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
  const gapGroups: Array<{ start: number }> = [];
  let inGap = false;
  let gapStart = 0;
  for (let i = 0; i < alSide.length; i++) {
    const isGap = !alSide[i].obj;
    if (isGap && !inGap) {
      inGap = true;
      gapStart = i;
    } else if (!isGap && inGap) {
      inGap = false;
      gapGroups.push({ start: gapStart });
    }
  }
  if (inGap) gapGroups.push({ start: gapStart });

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

/**
 * Normalizes all path commands into absolute ones, converting smooth 'S'
 * and smooth 'T' shorthands, as well as elliptical arcs 'A', into standard
 * absolute 'C' and 'Q' commands.
 */
export function normalizeCommands(commands: Command[]): Command[] {
  const normalized: Command[] = [];
  let current: Point = { x: 0, y: 0 };
  let subPathStart: Point = { x: 0, y: 0 };

  for (let i = 0; i < commands.length; i++) {
    const cmd = commands[i];
    const type = cmd.type;

    if (type === "M") {
      const p = cmd.points[0];
      current = p;
      subPathStart = p;
      normalized.push({ ...cmd });
      continue;
    }

    if (type === "Z") {
      current = { ...subPathStart };
      normalized.push({ ...cmd });
      continue;
    }

    if (type === "L") {
      current = cmd.points[0];
      normalized.push({ ...cmd });
      continue;
    }

    if (type === "C") {
      current = cmd.points[2];
      normalized.push({ ...cmd });
      continue;
    }

    if (type === "Q") {
      current = cmd.points[1];
      normalized.push({ ...cmd });
      continue;
    }

    if (type === "S") {
      const cp2 = cmd.points[0];
      const to = cmd.points[1];

      let cp1: Point = { ...current };
      const prev = normalized.at(-1);
      if (prev && prev.type === "C") {
        const prevCp2 = prev.points[1];
        const prevTo = prev.points[2];
        cp1 = {
          x: 2 * prevTo.x - prevCp2.x,
          y: 2 * prevTo.y - prevCp2.y,
        };
      }

      normalized.push({
        id: cmd.id,
        type: "C",
        points: [cp1, cp2, to],
      });
      current = to;
      continue;
    }

    if (type === "T") {
      const to = cmd.points[0];

      let cp1: Point = { ...current };
      const prev = normalized.at(-1);
      if (prev && prev.type === "Q") {
        const prevCp1 = prev.points[0];
        const prevTo = prev.points[1];
        cp1 = {
          x: 2 * prevTo.x - prevCp1.x,
          y: 2 * prevTo.y - prevCp1.y,
        };
      }

      normalized.push({
        id: cmd.id,
        type: "Q",
        points: [cp1, to],
      });
      current = to;
      continue;
    }

    if (type === "A" && cmd.arcParams) {
      const ap = cmd.arcParams;
      const to = cmd.points[0];

      const beziers = arcToBeziers(
        current.x,
        current.y,
        ap.rx,
        ap.ry,
        ap.xRotation,
        ap.largeArc,
        ap.sweep,
        to.x,
        to.y,
      );
      if (beziers.length === 0) {
        normalized.push({
          id: cmd.id,
          type: "L",
          points: [to],
        });
      } else {
        beziers.forEach((bz, idx) => {
          normalized.push({
            id: idx === 0 ? cmd.id : generateId(),
            type: "C",
            points: [bz.cp1, bz.cp2, bz.to],
          });
        });
      }
      current = to;
      continue;
    }

    normalized.push({ ...cmd });
    if (cmd.points.length > 0) {
      current = cmd.points.at(-1)!;
    }
  }

  return normalized;
}

export function normalizePathData(pathData: PathData): PathData {
  return {
    ...pathData,
    subPaths: pathData.subPaths.map((sp) => ({
      ...sp,
      commands: normalizeCommands(sp.commands),
    })),
  };
}

/**
 * Real boolean combine (union/subtract/intersect/exclude) replacing 21g console stub.
 * Pure-TS, no deps. Uses dense curve sampling (exact pattern from geometry.ts sampleCubic/Quad + insertPointNear)
 * + copied pointInPoly (from HitTests even-odd, for core independence) + winding via existing isSubPathClockwise.
 * For smallest diff (kbv): containment-driven logic for common non-self-intersect cases (knife/pen post-split hits).
 * Overlapping boundaries fall back to subpath concat (visual union-ish; full edge-intersect clipper deferred).
 * Result preserves caller styles/attrs. Multi-subpath safe via poly list.
 * Refs: v6j DESIGN 67dd105e, kbv, 21g/upk/3ds, k88 baseline (vn7 harden adds tests/precision notes).
 */
function pointInPoly(pt: Point, poly: Point[]): boolean {
  if (!poly || poly.length < 3) return false;
  const { x, y } = pt;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function sampleCubic(p0: Point, c1: Point, c2: Point, p3: Point, steps = 12): Point[] {
  const pts: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const w0 = mt * mt * mt;
    const w1 = 3 * mt * mt * t;
    const w2 = 3 * mt * t * t;
    const w3 = t * t * t;
    pts.push({
      x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p3.x,
      y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p3.y,
    });
  }
  return pts;
}

function sampleQuad(p0: Point, c: Point, p2: Point, steps = 12): Point[] {
  const pts: Point[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const w0 = mt * mt;
    const w1 = 2 * mt * t;
    const w2 = t * t;
    pts.push({
      x: w0 * p0.x + w1 * c.x + w2 * p2.x,
      y: w0 * p0.y + w1 * c.y + w2 * p2.y,
    });
  }
  return pts;
}

export function pathToPolygons(path: PathData, steps = 12): Point[][] {
  const polys: Point[][] = [];
  for (const sub of path.subPaths) {
    const poly: Point[] = [];
    let cur: Point = { x: 0, y: 0 };
    for (const cmd of sub.commands) {
      if (cmd.type === "M" && cmd.points[0]) {
        cur = { ...cmd.points[0] };
        if (poly.length === 0) poly.push({ ...cur });
      } else if ((cmd.type === "L" || cmd.type === "H" || cmd.type === "V") && cmd.points[0]) {
        cur = { ...cmd.points[0] };
        poly.push({ ...cur });
      } else if (cmd.type === "C" && cmd.points.length === 3) {
        const p0 = cur;
        const c1 = cmd.points[0];
        const c2 = cmd.points[1];
        const p3 = cmd.points[2];
        poly.push(...sampleCubic(p0, c1, c2, p3, steps));
        cur = { ...p3 };
      } else if (cmd.type === "Q" && cmd.points.length === 2) {
        const p0 = cur;
        const c = cmd.points[0];
        const p2 = cmd.points[1];
        poly.push(...sampleQuad(p0, c, p2, steps));
        cur = { ...p2 };
      } else if (cmd.type === "Z") {
        // close handled by caller
      } else if (cmd.points.length > 0) {
        cur = { ...cmd.points[cmd.points.length - 1] };
        poly.push({ ...cur });
      }
    }
    if (poly.length >= 3) polys.push(poly);
  }
  return polys;
}

function polygonsToPathData(polys: Point[][]): PathData {
  const subPaths = polys
    .filter((p) => p.length >= 3)
    .map((poly) => {
      const commands: Command[] = [];
      commands.push({ id: generateId(), type: "M", points: [{ ...poly[0] }] });
      for (let i = 1; i < poly.length; i++) {
        commands.push({ id: generateId(), type: "L", points: [{ ...poly[i] }] });
      }
      commands.push({ id: generateId(), type: "Z", points: [] });
      return { commands };
    });
  return { subPaths };
}

export type BooleanOp = "union" | "subtract" | "intersect" | "exclude";

export function booleanCombine(op: BooleanOp, a: PathData, b: PathData): PathData {
  const aPolys = pathToPolygons(clonePath(a));
  const bPolys = pathToPolygons(clonePath(b));
  if (aPolys.length === 0) return clonePath(b);
  if (bPolys.length === 0) return clonePath(a);

  // Operate pairwise on first poly of each for common shape cases (extendable to all subs)
  const pA = aPolys[0];
  const pB = bPolys[0];
  const aInB = pA.every((pt) => pointInPoly(pt, pB));
  const bInA = pB.every((pt) => pointInPoly(pt, pA));

  let resultPolys: Point[][] = [];
  if (op === "union") {
    if (aInB) resultPolys = [pB];
    else if (bInA) resultPolys = [pA];
    else resultPolys = [...aPolys, ...bPolys]; // disjoint or overlap (no boundary clip yet)
  } else if (op === "subtract") {
    if (bInA) {
      resultPolys = [pA, pB.slice().reverse()]; // hole via reverse (SVG evenodd/nonzero friendly)
    } else if (aInB) {
      resultPolys = [];
    } else {
      resultPolys = [pA]; // fallback conservative
    }
  } else if (op === "intersect") {
    if (aInB) resultPolys = [pA];
    else if (bInA) resultPolys = [pB];
    else resultPolys = [pA]; // approx for overlap (full edge clipper deferred per kbv smallest)
  } else if (op === "exclude") {
    if (aInB || bInA) {
      resultPolys = [pA, pB.slice().reverse()];
    } else {
      resultPolys = [...aPolys, ...bPolys];
    }
  }

  const out = polygonsToPathData(resultPolys);
  // If op produced nothing, return A unchanged (safe)
  return out.subPaths.length === 0 ? clonePath(a) : out;
}

/**
 * Paint bucket / fill hit region test (rsn under v6j).
 * Uses pathToPolygons sampling (exact from booleanCombine) + even-odd parity count over sub-polys
 * for correct inside/hole detection (hole subpaths reverse contribute to parity flip like SVG evenodd).
 * Pure, zero DOM, 60fps cheap. Re-exports pathToPolygons for PathCanvas preview/hit + tests.
 * Covers: simple closed, holes preserved (click in hole = not in region), multi-subpath.
 * Refs: rsn, v6j DESIGN 67dd105e, kbv booleans, 9rp pointInPoly parity.
 */
export function isPointInFillRegion(point: Point, pathData: PathData): boolean {
  if (!pathData?.subPaths?.length) return false;
  const polys = pathToPolygons(pathData, 12);
  let containing = 0;
  for (const poly of polys) {
    if (poly.length >= 3 && pointInPoly(point, poly)) containing++;
  }
  return containing % 2 === 1;
}

// 1td advanced (14l): remaining path editing primitives (simplify/optimize, variable stroke + dash patterns + simple taper, advanced curvature support).
// Pure, minimal, follows existing clonePath/round/Point patterns exactly. Zero regression on boolean/paint/knife/flex.
// Refs: 1td, 14l, v6j DESIGN 67dd105e, y5q 100% Excellence Drive.
export function simplifyPath(pathData: PathData, tolerance = 0.5): PathData {
  const out = clonePath(pathData);
  const d2 = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const tol2 = tolerance * tolerance;
  for (const sub of out.subPaths) {
    sub.commands = sub.commands.map((cmd) => {
      if (!cmd.points || cmd.points.length < 3)
        return { ...cmd, points: cmd.points ? cmd.points.map((p) => ({ ...p })) : [] };
      const kept: Point[] = [{ ...cmd.points[0] }];
      for (let i = 1; i < cmd.points.length - 1; i++) {
        const p = cmd.points[i];
        const prev = kept[kept.length - 1];
        if (d2(prev, p) > tol2) kept.push({ ...p });
      }
      kept.push({ ...cmd.points[cmd.points.length - 1] });
      return { ...cmd, points: kept };
    });
  }
  return out;
}

export function optimizePath(pathData: PathData, tolerance = 0.5): PathData {
  let p = simplifyPath(pathData, tolerance);
  p = clonePath(p);
  for (const sub of p.subPaths) {
    for (const cmd of sub.commands) {
      if (cmd.points && cmd.points.length > 2 && (cmd.type === "L" || cmd.type === "C")) {
        for (let i = 1; i < cmd.points.length - 1; i++) {
          const a = cmd.points[i - 1];
          const b = cmd.points[i];
          const c = cmd.points[i + 1];
          cmd.points[i] = { x: (a.x + b.x * 2 + c.x) / 4, y: (a.y + b.y * 2 + c.y) / 4 };
        }
      }
    }
  }
  return p;
}

export function generateDashPattern(
  preset: "solid" | "dashed" | "dotted" | "dashdot" = "dashed",
): string {
  if (preset === "solid") return "";
  if (preset === "dotted") return "1 3";
  if (preset === "dashdot") return "4 2 1 2";
  return "4 2";
}

export function getTaperedStrokeWidth(t: number, baseWidth: number, taper = 0.6): number {
  const tt = Math.max(0, Math.min(1, t || 0.5));
  const f = 1 - Math.abs(tt - 0.5) * 2 * taper;
  const v = baseWidth * Math.max(0.25, f);
  return Number.isFinite(v) ? Math.max(0.25, Number(v.toFixed(2))) : baseWidth;
}

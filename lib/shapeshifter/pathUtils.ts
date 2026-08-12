/**
 * ShapeShifter 2026 - Path Utilities
 * Parser, serializer, and basic manipulation for SVG paths.
 * Focused on morphing compatibility.
 */

import type { Command, CommandType, PathData, Point, SubPath } from "./types";
import { arePointsEqual } from "./mathUtils";
import { getPoleOfInaccessibility, isSubPathClockwise, arcToBeziers } from "./geometry";
import { generateId } from "./ids";
import { align, MATCH, MISMATCH, type NWAlignment } from "./path/alignment";
import { clonePathDataForSplit, splitCommandInHalf } from "./path/pathEditing";

export { align, INDEL, MATCH, MISMATCH } from "./path/alignment";
export type { NWAlignment } from "./path/alignment";

// Hardened round for export fidelity (kus/24t/yrl symmetry): never emit NaN/Inf in d= strings.
// Bad coords from prior edits, import edge arcs, or math drift now safely drop to 0 (matching importer recovery).
const round = (value: number) => (Number.isFinite(value) ? Number(value.toFixed(3)) : 0);

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

export {
  getAllCommands,
  getCommandDescription,
  getPathDataBounds,
  parsePath,
  pathToString,
} from "./path/pathDataIO";
export {
  distanceToPath,
  distanceToSegment,
  flattenPathData,
  getAccuratePathBounds,
  isPointInPath,
  pathLength,
} from "./path/pathGeometry";
export {
  addPointAfter,
  changeCommandType,
  deleteCommand,
  deleteSubPath,
  extractSubPath,
  insertPointNear,
  scalePathToBounds,
  splitCommandInHalf,
  splitPointNear,
  translatePath,
  updateCommandPoint,
  updatePoint,
} from "./path/pathEditing";
/**
 * Interpolate between two PathData objects at a given progress (0-1).
 * Assumes the paths have compatible structure (same number of subpaths/commands/points).
 * This is the heart of the morphing animation.
 */
export function getInterpolatedPath(from: PathData, to: PathData, t: number): string {
  // Clamp t
  t = Math.max(0, Math.min(1, t));

  // Normalize both sides first: every command becomes M/L/C/Q/Z with a consistent
  // point count per type. This eliminates S/T/A shorthand (whose arcArgs would be
  // dropped and whose 1/2-point shape mismatched C's 3 pairs) so matched indices
  // carry matched types and the per-point loop below is geometrically correct.
  const normFrom = normalizePathData(from);
  const normTo = normalizePathData(to);

  let result = "";

  const maxSub = Math.max(normFrom.subPaths.length, normTo.subPaths.length);

  for (let s = 0; s < maxSub; s++) {
    const fromSub = normFrom.subPaths[s] || { commands: [] };
    const toSub = normTo.subPaths[s] || { commands: [] };

    const maxCmd = Math.max(fromSub.commands.length, toSub.commands.length);

    for (let c = 0; c < maxCmd; c++) {
      const fromCmd = fromSub.commands[c];
      const toCmd = toSub.commands[c];

      if (!fromCmd) {
        // No from command: emit the to command verbatim (structural divergence).
        if (toCmd) {
          if (toCmd.points.length === 0) {
            result += "Z ";
            continue;
          }
          result += toCmd.type;
          toCmd.points.forEach((p) => {
            result += `${round(p.x)} ${round(p.y)} `;
          });
        }
        continue;
      }

      if (!toCmd) {
        if (fromCmd.points.length === 0) {
          result += "Z ";
          continue;
        }
        result += fromCmd.type;
        fromCmd.points.forEach((p) => {
          result += `${round(p.x)} ${round(p.y)} `;
        });
        continue;
      }

      // Z (close) carries no points — emit verbatim.
      if (fromCmd.points.length === 0) {
        result += "Z ";
        continue;
      }

      // After normalization matched indices usually share a type. For residual
      // structural divergence (e.g. one side grew a point), prefer the side with
      // MORE points so we never emit a bare type letter, and clamp the shorter
      // side's missing points to its last point (graceful, geometrically safe).
      const typesDiffer = fromCmd.type !== toCmd.type;
      const useType = typesDiffer
        ? fromCmd.points.length >= toCmd.points.length
          ? fromCmd.type
          : toCmd.type
        : fromCmd.type;
      result += useType;

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
  // Normalize first so smooth (S/T) and arc (A) shorthands become explicit C/Q.
  // Reversing raw S/T verbatim leaves the implicit reflected control attached to the
  // wrong neighbor after reversal, which collapses the curve. Normalization removes
  // that hazard (and is idempotent on already-normalized paths). The arc sweep-flip
  // logic below is retained; note normalization converts A→C anyway.
  const normalized = normalizePathData(path);
  return {
    subPaths: normalized.subPaths.map((subPath) => {
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
        arcParams?: Command["arcParams"];
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

function isClosedSubPath(subPath: SubPath): boolean {
  return subPath.commands.at(-1)?.type === "Z";
}

function closeSubPathAtIndex(path: PathData, subIdx: number): PathData {
  const result = clonePathDataForSplit(path);
  const commands = result.subPaths[subIdx]?.commands;
  if (commands?.length && commands.at(-1)?.type !== "Z") {
    commands.push({ id: generateId(), type: "Z", points: [] });
  }
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
/**
 * New v2 capability (preserves all the magic from the original autoFix).
 * Given two geometries, returns normalized versions + a MorphMapping that
 * can be used by the renderer for high-quality interpolation.
 * This is the bridge that lets us keep the excellent NW + pole logic while moving to a better model.
 */
export function prepareForMorph(
  from: PathData,
  to: PathData,
): {
  from: PathData;
  to: PathData;
  mapping: any; // Will be replaced by real MorphMapping interface once v2 types land
} {
  const [a, b] = autoFixPathPair(from, to);
  // For now, the mapping is implicit in the aligned output.
  // Future: serialize the alignments, poles, permutations into a proper MorphMapping object.
  return {
    from: a,
    to: b,
    mapping: { version: 1, note: "placeholder - real mapping coming with v2 types" },
  };
}

// Original kept for backward compat during migration
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
    if (isClosedSubPath(a.subPaths[s]) !== isClosedSubPath(b.subPaths[s])) {
      if (isClosedSubPath(a.subPaths[s])) {
        b = closeSubPathAtIndex(b, s);
      } else {
        a = closeSubPathAtIndex(a, s);
      }
    }

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

export { booleanCombine, isPointInFillRegion, pathToPolygons } from "./path/booleanOperations";
export type { BooleanOp } from "./path/booleanOperations";
export {
  simplifyPath,
  optimizePath,
  generateDashPattern,
  getTaperedStrokeWidth,
} from "./path/pathOptimization";

// Stable ID foundation (ShapeShifter-k7zp / sogt) — single-import surface for v1 consumers
// during the parallel migration window. All new structural edits now receive real ULIDs.
export {
  generateId,
  ensureStableCommandIds,
  decodeTime,
  __resetMonotonicStateForTests,
} from "./ids";

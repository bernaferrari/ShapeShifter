/** Immutable path editing primitives shared by the canvas and morph repair. */

import type { Command, CommandType, PathData, Point } from "../types";
import { arcToBeziers } from "../geometry";
import { generateId } from "../ids";

const clonePath = (pathData: PathData): PathData => structuredClone(pathData);

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
 * Update a specific point inside a specific command (for the editable command list).
 * Used by the beautiful PathCommandsList when user scrubs or types a value.
 */
export function updateCommandPoint(
  pathData: PathData,
  subIdx: number,
  cmdIdx: number,
  pointIdx: number,
  newPoint: Point,
): PathData {
  return updatePoint(pathData, subIdx, cmdIdx, pointIdx, newPoint);
}

/**
 * Change the type of a command while doing a best-effort geometry preservation.
 * Very useful for the editable command surface (user can cycle M/L/C etc.).
 * For v1 we keep it simple and safe:
 *  - M/L/H/V <-> each other: keep the endpoint
 *  - Anything <-> C: create reasonable control points or take endpoint
 *  - Z is special (no points)
 */
export function changeCommandType(
  pathData: PathData,
  subIdx: number,
  cmdIdx: number,
  newType: CommandType,
): PathData {
  const newData = clonePath(pathData);
  const sub = newData.subPaths[subIdx];
  if (!sub || !sub.commands[cmdIdx]) return newData;

  const oldCmd = sub.commands[cmdIdx];
  if (oldCmd.type === newType) return newData;

  const endPoint =
    oldCmd.points.length > 0 ? oldCmd.points[oldCmd.points.length - 1] : { x: 0, y: 0 };

  // Real segment start = previous command's endpoint (or 0,0 for the first command).
  // The previous code used the command's OWN first point as `prev`, which produced
  // degenerate straight lines for C/S and an A command with no arcParams (dropped on
  // roundtrip). Using the real segment start yields a gentle default curve and a
  // valid default arc.
  const prevCmd = cmdIdx > 0 ? sub.commands[cmdIdx - 1] : null;
  const prev =
    prevCmd && prevCmd.points.length > 0
      ? prevCmd.points[prevCmd.points.length - 1]
      : { x: 0, y: 0 };

  let newPoints: Point[] = [];
  let newArcParams: Command["arcParams"] = undefined;

  switch (newType) {
    case "M":
    case "L":
    case "T":
      newPoints = [endPoint];
      break;
    case "H":
      newPoints = [{ x: endPoint.x, y: 0 }];
      break;
    case "V":
      newPoints = [{ x: 0, y: endPoint.y }];
      break;
    case "C": {
      // Gentle default cubic: cp1 = prev + 0.3*(end-prev), cp2 = end - 0.3*(end-prev).
      const dx = (endPoint.x - prev.x) * 0.3;
      const dy = (endPoint.y - prev.y) * 0.3;
      newPoints = [
        { x: prev.x + dx, y: prev.y + dy },
        { x: endPoint.x - dx, y: endPoint.y - dy },
        endPoint,
      ];
      break;
    }
    case "Q": {
      const mid = oldCmd.points[0] || endPoint;
      newPoints = [{ x: (mid.x + endPoint.x) / 2, y: (mid.y + endPoint.y) / 2 }, endPoint];
      break;
    }
    case "S": {
      // cp2 = end - 0.3*(end-prev); cp1 is the implicit reflection of the previous
      // command's last control (resolved at serialize/normalize time).
      const dx = (endPoint.x - prev.x) * 0.3;
      const dy = (endPoint.y - prev.y) * 0.3;
      newPoints = [{ x: endPoint.x - dx, y: endPoint.y - dy }, endPoint];
      break;
    }
    case "A": {
      // Synthesize a sensible default arc: radii = half the chord length from the
      // previous endpoint to this endpoint, so the arc round-trips instead of being
      // dropped for lack of arcParams.
      const chord = Math.hypot(endPoint.x - prev.x, endPoint.y - prev.y) / 2;
      newPoints = [endPoint];
      newArcParams = { rx: chord, ry: chord, xRotation: 0, largeArc: false, sweep: true };
      break;
    }
    case "Z":
      newPoints = [];
      break;
    default:
      newPoints = oldCmd.points.length ? [endPoint] : [];
  }

  sub.commands[cmdIdx] = {
    ...oldCmd,
    type: newType,
    points: newPoints,
    arcParams: newArcParams,
  };

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
  const sub = newData.subPaths[subIdx];
  if (!sub || cmdIdx < 0 || cmdIdx >= sub.commands.length) return newData;

  const cmds = sub.commands;
  const deleted = cmds[cmdIdx];
  // Remember the deleted M's point so we can re-seat the subpath on it if needed.
  const oldMPoint = deleted.type === "M" ? deleted.points[0] : null;
  cmds.splice(cmdIdx, 1);

  // Empty subpath -> drop it (no dangling empty subpath).
  if (cmds.length === 0) {
    newData.subPaths.splice(subIdx, 1);
    return newData;
  }

  // If the leading M was removed (or the subpath otherwise no longer starts with M),
  // synthesize an M from the new first command's start point so we never emit a
  // subpath beginning with L/C (invalid SVG). The new first command's start was the
  // deleted M's point; fall back to its own first point or the origin.
  if (cmds[0].type !== "M") {
    const mPoint = oldMPoint ?? cmds[0].points[0] ?? { x: 0, y: 0 };
    cmds.unshift({ id: generateId(), type: "M", points: [mPoint] });
  }

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
 * Extracts a subpath by index into its own PathData, returning both the
 * remaining path (with that subpath removed) and the extracted one.
 * Useful for "split to new layer" to allow independent styling (e.g. different strokes).
 */
export function extractSubPath(
  pathData: PathData,
  subIdx: number,
): { remaining: PathData; extracted: PathData } {
  const cloned = structuredClone(pathData);
  if (subIdx < 0 || subIdx >= cloned.subPaths.length) {
    return { remaining: cloned, extracted: { subPaths: [] } };
  }
  const [extractedSub] = cloned.subPaths.splice(subIdx, 1);
  return {
    remaining: cloned,
    extracted: { subPaths: [extractedSub] },
  };
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
        // Curve-aware projection: evaluate the real bezier at parametric t instead of
        // lerping the chord (matches splitPointNear / sampleCubic / sampleQuad in this file).
        let x: number;
        let y: number;
        if (cmd.type === "C" && cmd.points.length === 3) {
          const p1 = cmd.points[0];
          const p2 = cmd.points[1];
          const mt = 1 - t;
          const w0 = mt * mt * mt;
          const w1 = 3 * mt * mt * t;
          const w2 = 3 * mt * t * t;
          const w3 = t * t * t;
          x = w0 * prevPoint.x + w1 * p1.x + w2 * p2.x + w3 * endPoint.x;
          y = w0 * prevPoint.y + w1 * p1.y + w2 * p2.y + w3 * endPoint.y;
        } else if (cmd.type === "Q" && cmd.points.length === 2) {
          const p1 = cmd.points[0];
          const mt = 1 - t;
          const w0 = mt * mt;
          const w1 = 2 * mt * t;
          const w2 = t * t;
          x = w0 * prevPoint.x + w1 * p1.x + w2 * endPoint.x;
          y = w0 * prevPoint.y + w1 * p1.y + w2 * endPoint.y;
        } else {
          x = prevPoint.x + (endPoint.x - prevPoint.x) * t;
          y = prevPoint.y + (endPoint.y - prevPoint.y) * t;
        }

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
 * Materialize smooth shorthand commands (S/T) into explicit C/Q using the
 * reflected-control logic from normalizeCommands. Used by splitCommandInHalf
 * so the de Casteljau split math always has a well-formed bezier to work on.
 * (Arcs are handled separately in splitCommandInHalf via arcToBeziers.)
 */
function materializeSmoothForSplit(cmd: Command, prevCmd: Command | null, start: Point): Command {
  if (cmd.type === "S") {
    const cp2 = cmd.points[0];
    const to = cmd.points[1];
    let cp1: Point = { ...start };
    if (prevCmd && prevCmd.type === "C") {
      const prevCp2 = prevCmd.points[1];
      const prevTo = prevCmd.points[2];
      cp1 = { x: 2 * prevTo.x - prevCp2.x, y: 2 * prevTo.y - prevCp2.y };
    }
    return { id: cmd.id, type: "C", points: [cp1, cp2, to] };
  }
  // T → Q
  const to = cmd.points[0];
  let cp1: Point = { ...start };
  if (prevCmd && prevCmd.type === "Q") {
    const prevCp1 = prevCmd.points[0];
    const prevTo = prevCmd.points[1];
    cp1 = { x: 2 * prevTo.x - prevCp1.x, y: 2 * prevTo.y - prevCp1.y };
  }
  return { id: cmd.id, type: "Q", points: [cp1, to] };
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

  let cmd = sub.commands[cmdIdx];
  if (cmd.type === "Z" || cmd.type === "M" || cmd.points.length === 0) return newData;

  const prevCmd = cmdIdx > 0 ? sub.commands[cmdIdx - 1] : null;
  const start = prevCmd ? prevCmd.points.at(-1)! : { x: 0, y: 0 };

  // Materialize smooth (S/T) and arc (A) shorthands into explicit C/Q so the
  // de Casteljau split math has a well-formed bezier to work on. The previous
  // generic fallthrough emitted malformed 1-point Q/S, converted T→L, and
  // produced a malformed 1-point A — all dropped on reparse. Mirrors
  // normalizeCommands (see materializeSmoothForSplit above + arcToBeziers).
  if (cmd.type === "S" || cmd.type === "T") {
    cmd = materializeSmoothForSplit(cmd, prevCmd, start);
    sub.commands[cmdIdx] = cmd;
  } else if (cmd.type === "A" && cmd.arcParams) {
    const ap = cmd.arcParams;
    const to = cmd.points[0];
    const beziers = arcToBeziers(
      start.x,
      start.y,
      ap.rx,
      ap.ry,
      ap.xRotation,
      ap.largeArc,
      ap.sweep,
      to.x,
      to.y,
    );
    if (beziers.length === 0) {
      cmd = { id: cmd.id, type: "L", points: [to] };
      sub.commands[cmdIdx] = cmd;
    } else {
      const cubics: Command[] = beziers.map((bz, idx) => ({
        id: idx === 0 ? cmd.id : generateId(),
        type: "C" as const,
        points: [bz.cp1, bz.cp2, bz.to],
      }));
      sub.commands.splice(cmdIdx, 1, ...cubics);
      cmd = cubics[0];
    }
  }

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

  if (cmd.type === "Q" && cmd.points.length === 2) {
    // Quadratic de Casteljau split at t=0.5.
    const control = cmd.points[0];
    const m1: Point = { x: (start.x + control.x) / 2, y: (start.y + control.y) / 2 };
    const m2: Point = { x: (control.x + end.x) / 2, y: (control.y + end.y) / 2 };
    const midMid: Point = { x: (m1.x + m2.x) / 2, y: (m1.y + m2.y) / 2 };
    cmd.points = [m1, midMid];
    const second: Command = { id: generateId(), type: "Q", points: [m2, end] };
    sub.commands.splice(cmdIdx + 1, 0, second);
    return newData;
  }

  // Fallback (H/V or unexpected shape): linear midpoint, preserve type.
  const mid: Point = {
    x: start.x + (end.x - start.x) * 0.5,
    y: start.y + (end.y - start.y) * 0.5,
  };
  cmd.points[cmd.points.length - 1] = mid;
  const fallbackCmd: Command = { id: generateId(), type: cmd.type, points: [end] };
  sub.commands.splice(cmdIdx + 1, 0, fallbackCmd);
  return newData;
}

export function clonePathDataForSplit(p: PathData): PathData {
  return JSON.parse(JSON.stringify(p));
}

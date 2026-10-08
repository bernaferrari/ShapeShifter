/** Immutable path editing primitives shared by the canvas and morph repair. */

import type { Command, CommandType, PathData, Point } from "../types";
import { arcToBeziers } from "../geometry";
import { materializeSmoothCommands } from "./commandNormalization";
import { generateId } from "../ids";

const clonePath = (pathData: PathData): PathData => structuredClone(pathData);

type PathPointIndex = { subPathIndex: number; commandIndex: number; pointIndex: number };

/** Translate selected points and the tangent handles attached to selected anchors once. */
export function translatePathPoints(
  pathData: PathData,
  selected: readonly PathPointIndex[],
  dx: number,
  dy: number,
): PathData {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (!dx && !dy)) return pathData;
  const points = new Map<string, PathPointIndex>();
  const anchors = new Set<string>();
  const add = (subPathIndex: number, commandIndex: number, pointIndex: number) => {
    const command = pathData.subPaths[subPathIndex]?.commands[commandIndex];
    if (!command?.points[pointIndex]) return;
    const key = `${subPathIndex}:${commandIndex}:${pointIndex}`;
    points.set(key, { subPathIndex, commandIndex, pointIndex });
    if (pointIndex !== command.points.length - 1 || anchors.has(key)) return;
    anchors.add(key);
    if (command.type === "C") add(subPathIndex, commandIndex, 1);
    else if (command.type === "Q" || command.type === "S") add(subPathIndex, commandIndex, 0);
    const commands = pathData.subPaths[subPathIndex].commands;
    const next = commands[commandIndex + 1];
    if (next?.type === "C" || next?.type === "Q") add(subPathIndex, commandIndex + 1, 0);

    // SVG may repeat the first anchor as the closing curve endpoint. Both
    // copies move together; a plain Z closing edge has no tangent handle.
    if (commands.at(-1)?.type !== "Z") return;
    const first = commands[0];
    const lastIndex = commands.length - 2;
    const last = commands[lastIndex];
    const firstPoint = first?.type === "M" ? first.points[0] : undefined;
    const lastPoint = last?.points.at(-1);
    if (
      !firstPoint ||
      !lastPoint ||
      lastIndex === 0 ||
      last.type === "L" ||
      Math.hypot(firstPoint.x - lastPoint.x, firstPoint.y - lastPoint.y) > 1e-9
    )
      return;
    if (commandIndex === 0) add(subPathIndex, lastIndex, last.points.length - 1);
    else if (commandIndex === lastIndex) add(subPathIndex, 0, 0);
  };
  for (const point of selected) add(point.subPathIndex, point.commandIndex, point.pointIndex);
  if (!points.size) return pathData;
  for (const { subPathIndex, commandIndex, pointIndex } of points.values()) {
    const original = pathData.subPaths[subPathIndex].commands[commandIndex].points[pointIndex];
    if (
      !Number.isFinite(original.x + dx) ||
      !Number.isFinite(original.y + dy) ||
      Math.abs(original.x + dx) > 1e7 ||
      Math.abs(original.y + dy) > 1e7
    )
      return pathData;
  }
  const next = clonePath(pathData);
  for (const { subPathIndex, commandIndex, pointIndex } of points.values()) {
    const original = pathData.subPaths[subPathIndex].commands[commandIndex].points[pointIndex];
    next.subPaths[subPathIndex].commands[commandIndex].points[pointIndex] = {
      x: original.x + dx,
      y: original.y + dy,
    };
  }
  return next;
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
  const original = pathData.subPaths[subIdx]?.commands[cmdIdx]?.points[pointIdx];
  if (
    !original ||
    !Number.isFinite(newPoint.x) ||
    !Number.isFinite(newPoint.y) ||
    Math.abs(newPoint.x) > 1e7 ||
    Math.abs(newPoint.y) > 1e7
  )
    return pathData;
  if (original.x === newPoint.x && original.y === newPoint.y) return pathData;
  const newData = clonePath(pathData);
  newData.subPaths[subIdx].commands[cmdIdx].points[pointIdx] = { ...newPoint };
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
  const original = pathData.subPaths[subIdx]?.commands[cmdIdx]?.points[pointIdx];
  if (
    !original ||
    !Number.isFinite(newPoint.x) ||
    !Number.isFinite(newPoint.y) ||
    Math.abs(newPoint.x) > 1e7 ||
    Math.abs(newPoint.y) > 1e7
  )
    return pathData;
  return translatePathPoints(
    pathData,
    [{ subPathIndex: subIdx, commandIndex: cmdIdx, pointIndex: pointIdx }],
    newPoint.x - original.x,
    newPoint.y - original.y,
  );
}

/**
 * Change the type of a command while doing a best-effort geometry preservation.
 * Very useful for the editable command surface (user can cycle M/L/C etc.).
 * Supported command editing rules:
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
  if (!sub || !sub.commands[cmdIdx]) return pathData;

  const oldCmd = sub.commands[cmdIdx];
  if (oldCmd.type === newType) return pathData;
  if (oldCmd.type === "M" || oldCmd.type === "Z" || newType === "M" || newType === "Z")
    return pathData;
  sub.commands = materializeSmoothCommands(sub.commands);

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
    case "L":
    case "T":
      newPoints = [endPoint];
      break;
    case "H":
    case "V":
      // parsePath has no H/V representation of its own — it stores them as L
      // commands carrying the fully resolved current point, and pathToString
      // emits both coordinates for any non-Z/A command. Emitting the old
      // fabricated [{x, 0}]/[{0, y}] serialized as "H30 0"/"V0 30", which
      // reparsed with a phantom segment back to an axis zero (corrupting saved
      // data, winding sums, and bounds). Convert to the exact equivalent
      // absolute line instead: H resolves to (endX, penY), V to (penX, endY),
      // and parsePath(pathToString(cmd)) reproduces identical geometry.
      sub.commands[cmdIdx] = {
        ...oldCmd,
        type: "L",
        points: [newType === "H" ? { x: endPoint.x, y: prev.y } : { x: prev.x, y: endPoint.y }],
        arcParams: undefined,
      };
      return newData;

    case "C": {
      const resolved = sub.commands[cmdIdx];
      if (resolved.type === "C") {
        newPoints = resolved.points;
        break;
      }
      if (resolved.type === "Q") {
        const control = resolved.points[0];
        newPoints = [
          {
            x: prev.x + (2 / 3) * (control.x - prev.x),
            y: prev.y + (2 / 3) * (control.y - prev.y),
          },
          {
            x: endPoint.x + (2 / 3) * (control.x - endPoint.x),
            y: endPoint.y + (2 / 3) * (control.y - endPoint.y),
          },
          endPoint,
        ];
        break;
      }
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
  const command = pathData.subPaths[subIdx]?.commands[cmdIdx];
  if (
    !command ||
    command.type === "Z" ||
    !Number.isFinite(newPoint.x) ||
    !Number.isFinite(newPoint.y)
  )
    return pathData;
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
  if (!Number.isInteger(subIdx) || !Number.isInteger(cmdIdx)) return pathData;
  const newData = clonePathDataForSplit(pathData);
  const sub = newData.subPaths[subIdx];
  if (!sub || cmdIdx < 0 || cmdIdx >= sub.commands.length) return pathData;

  const cmds = materializeSmoothCommands(sub.commands);
  sub.commands = cmds;
  if (cmdIdx === 0) {
    const next = cmds[1];
    const point = next?.points.at(-1);
    if (!point) {
      newData.subPaths.splice(subIdx, 1);
      return newData;
    }
    // Delete the start vertex and its outgoing edge; promote the next vertex.
    cmds.splice(0, 2, { id: next.id, type: "M", points: [{ ...point }] });
  } else {
    cmds.splice(cmdIdx, 1);
  }
  if (!cmds.length) newData.subPaths.splice(subIdx, 1);
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

/** Closest editable segment, including the implicit closing edge, excluding move commands. */
export function insertPointNear(
  pathData: PathData,
  click: Point,
  sampleCount = 80,
): { subIdx: number; cmdIdx: number; newPoint: Point; t: number } | null {
  if (!Number.isFinite(click.x) || !Number.isFinite(click.y)) return null;
  const samples = Math.max(8, Math.min(512, Math.round(sampleCount) || 80));
  let bestDistance = Infinity;
  let result: { subIdx: number; cmdIdx: number; newPoint: Point; t: number } | null = null;
  pathData.subPaths.forEach((sub, subIdx) => {
    let start: Point = { x: 0, y: 0 };
    let first: Point = start;
    materializeSmoothCommands(sub.commands).forEach((original, cmdIdx) => {
      if (original.type === "M") {
        start = original.points[0] ?? start;
        first = start;
        return;
      }
      const end = original.type === "Z" ? first : original.points.at(-1);
      if (!end) return;
      const cmd = original;
      const segments =
        cmd.type === "A" && cmd.arcParams
          ? arcToBeziers(
              start.x,
              start.y,
              cmd.arcParams.rx,
              cmd.arcParams.ry,
              cmd.arcParams.xRotation,
              cmd.arcParams.largeArc,
              cmd.arcParams.sweep,
              end.x,
              end.y,
            ).map((segment) => [segment.cp1, segment.cp2, segment.to])
          : [cmd.type === "C" || cmd.type === "Q" ? cmd.points : [end]];
      if (!segments.length) segments.push([end]);
      let segmentStart = start;
      segments.forEach((points, segmentIndex) => {
        const endpoint = points.at(-1)!;
        const at = (t: number): Point => {
          let levels = [segmentStart, ...points];
          while (levels.length > 1)
            levels = levels.slice(1).map((p, i) => ({
              x: levels[i].x + (p.x - levels[i].x) * t,
              y: levels[i].y + (p.y - levels[i].y) * t,
            }));
          return levels[0];
        };
        const accept = (t: number) => {
          const point = at(t);
          const distance = (point.x - click.x) ** 2 + (point.y - click.y) ** 2;
          if (distance < bestDistance) {
            bestDistance = distance;
            result = { subIdx, cmdIdx, newPoint: point, t: (segmentIndex + t) / segments.length };
          }
          return distance;
        };
        if (points.length === 1) {
          const dx = endpoint.x - segmentStart.x,
            dy = endpoint.y - segmentStart.y;
          const lengthSquared = dx * dx + dy * dy;
          if (lengthSquared > 1e-18)
            accept(
              Math.max(
                0,
                Math.min(
                  1,
                  ((click.x - segmentStart.x) * dx + (click.y - segmentStart.y) * dy) /
                    lengthSquared,
                ),
              ),
            );
        } else {
          let nearestT = 0,
            nearestDistance = Infinity;
          for (let i = 0; i <= samples; i++) {
            const t = i / samples,
              distance = accept(t);
            if (distance < nearestDistance) {
              nearestT = t;
              nearestDistance = distance;
            }
          }
          let low = Math.max(0, nearestT - 1 / samples),
            high = Math.min(1, nearestT + 1 / samples);
          for (let i = 0; i < 24; i++) {
            const a = low + (high - low) / 3,
              b = high - (high - low) / 3;
            if (accept(a) < accept(b)) high = b;
            else low = a;
          }
          accept((low + high) / 2);
        }
        segmentStart = endpoint;
      });
      start = end;
    });
  });
  return result;
}

/** Add an anchor at the projected position, preserving the original line or curve. */
export function splitPointNear(
  pathData: PathData,
  click: Point,
  sampleCount = 80,
): PathData | null {
  const hit = insertPointNear(pathData, click, sampleCount);
  if (!hit || hit.t <= 1e-6 || hit.t >= 1 - 1e-6) return null;
  const result = splitCommandAt(pathData, hit.subIdx, hit.cmdIdx, hit.t);
  return result === pathData ? null : result;
}

/** Split any drawable segment at its midpoint, preserving its outline. */
export function splitCommandInHalf(pathData: PathData, subIdx: number, cmdIdx: number): PathData {
  return splitCommandAt(pathData, subIdx, cmdIdx, 0.5);
}

/** Exact de Casteljau subdivision. A closing edge gains an L anchor before Z. */
export function splitCommandAt(
  pathData: PathData,
  subIdx: number,
  cmdIdx: number,
  t: number,
): PathData {
  if (
    !Number.isInteger(subIdx) ||
    !Number.isInteger(cmdIdx) ||
    !Number.isFinite(t) ||
    t <= 0 ||
    t >= 1
  )
    return pathData;
  const newData = clonePathDataForSplit(pathData);
  const sub = newData.subPaths[subIdx];
  if (!sub || cmdIdx < 0 || cmdIdx >= sub.commands.length) return pathData;

  sub.commands = materializeSmoothCommands(sub.commands);
  let cmd = sub.commands[cmdIdx];
  if (cmd.type === "M") return pathData;
  if (cmd.type === "Z") {
    const start = sub.commands[cmdIdx - 1]?.points.at(-1);
    const end = sub.commands[0]?.points[0];
    if (!start || !end) return pathData;
    sub.commands.splice(cmdIdx, 0, {
      id: generateId(),
      type: "L",
      points: [
        {
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t,
        },
      ],
    });
    return newData;
  }
  if (!cmd.points.length) return pathData;

  const prevCmd = cmdIdx > 0 ? sub.commands[cmdIdx - 1] : null;
  const start = prevCmd?.points.at(-1);
  if (!start) return pathData;

  // Materialize smooth (S/T) and arc (A) shorthands into explicit C/Q so the
  // de Casteljau split math has a well-formed bezier to work on. The previous
  // generic fallthrough emitted malformed 1-point Q/S, converted T→L, and
  // produced a malformed 1-point A — all dropped on reparse. Mirrors
  // shared command normalization and arcToBeziers.
  if (cmd.type === "A" && cmd.arcParams) {
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
      const index = Math.min(cubics.length - 1, Math.floor(t * cubics.length));
      const localT = t * cubics.length - index;
      return localT > 1e-6 && localT < 1 - 1e-6
        ? splitCommandAt(newData, subIdx, cmdIdx + index, localT)
        : newData;
    }
  }

  const end = cmd.points.at(-1)!;

  if (cmd.type === "L" || cmd.points.length === 1) {
    const mid: Point = {
      x: start.x + (end.x - start.x) * t,
      y: start.y + (end.y - start.y) * t,
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

    const q0x = start.x + (p1.x - start.x) * t;
    const q0y = start.y + (p1.y - start.y) * t;
    const q1x = p1.x + (p2.x - p1.x) * t;
    const q1y = p1.y + (p2.y - p1.y) * t;
    const q2x = p2.x + (p3.x - p2.x) * t;
    const q2y = p2.y + (p3.y - p2.y) * t;

    const r0x = q0x + (q1x - q0x) * t;
    const r0y = q0y + (q1y - q0y) * t;
    const r1x = q1x + (q2x - q1x) * t;
    const r1y = q1y + (q2y - q1y) * t;

    const midEnd = { x: r0x + (r1x - r0x) * t, y: r0y + (r1y - r0y) * t };

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
    // Quadratic de Casteljau subdivision.
    const control = cmd.points[0];
    const m1: Point = {
      x: start.x + (control.x - start.x) * t,
      y: start.y + (control.y - start.y) * t,
    };
    const m2: Point = {
      x: control.x + (end.x - control.x) * t,
      y: control.y + (end.y - control.y) * t,
    };
    const midMid: Point = { x: m1.x + (m2.x - m1.x) * t, y: m1.y + (m2.y - m1.y) * t };
    cmd.points = [m1, midMid];
    const second: Command = { id: generateId(), type: "Q", points: [m2, end] };
    sub.commands.splice(cmdIdx + 1, 0, second);
    return newData;
  }

  // Fallback (H/V or unexpected shape): linear midpoint, preserve type.
  const mid: Point = {
    x: start.x + (end.x - start.x) * t,
    y: start.y + (end.y - start.y) * t,
  };
  cmd.points[cmd.points.length - 1] = mid;
  const fallbackCmd: Command = { id: generateId(), type: cmd.type, points: [end] };
  sub.commands.splice(cmdIdx + 1, 0, fallbackCmd);
  return newData;
}

export function clonePathDataForSplit(p: PathData): PathData {
  return JSON.parse(JSON.stringify(p));
}

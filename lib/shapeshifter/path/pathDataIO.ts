/** SVG path parsing, serialization, and read-only path queries. */

import type { Command, CommandType, PathData, Point, SubPath } from "../types";
import { generateId } from "../ids";
import { getAccuratePathBounds } from "./pathGeometry";

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

const round = (value: number) => (Number.isFinite(value) ? Number(value.toFixed(3)) : 0);

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
  const canReadNumbers = (count: number) => {
    for (let offset = 0; offset < count; offset++) {
      const token = tokens[index + offset];
      if (!token || isCommand(token)) return false;
    }
    return true;
  };
  const skipMalformedArgs = () => {
    while (index < tokens.length && !isCommand(tokens[index])) index++;
  };
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
      commandToken = "";
      continue;
    }

    if (type === "M") {
      if (!canReadNumbers(2)) {
        skipMalformedArgs();
        continue;
      }
      const point = readPoint(relative);
      current = point;
      subPathStart = point;
      subPaths.push({ commands: [{ id: generateId(), type: "M", points: [point] }] });

      while (index < tokens.length && !isCommand(tokens[index])) {
        if (!canReadNumbers(2)) {
          skipMalformedArgs();
          break;
        }
        const linePoint = readPoint(relative);
        current = linePoint;
        ensureSubPath(subPaths).commands.push({ id: generateId(), type: "L", points: [linePoint] });
      }
      continue;
    }

    while (index < tokens.length && !isCommand(tokens[index])) {
      if (type === "H") {
        if (!canReadNumbers(1)) {
          skipMalformedArgs();
          break;
        }
        const x = readNumber();
        current = { x: relative ? current.x + x : x, y: current.y };
        subPath.commands.push({ id: generateId(), type: "L", points: [{ ...current }] });
        continue;
      }

      if (type === "V") {
        if (!canReadNumbers(1)) {
          skipMalformedArgs();
          break;
        }
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
        if (!canReadNumbers(7)) {
          skipMalformedArgs();
          break;
        }
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
      if (!pointCount || !canReadNumbers(pointCount * 2)) {
        skipMalformedArgs();
        break;
      }

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

/** Axis-aligned bounds of path command points (object-selection / resize AABB). */
export function getPathDataBounds(
  pathData: PathData | null | undefined,
): { x: number; y: number; w: number; h: number } | null {
  return getAccuratePathBounds(pathData);
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

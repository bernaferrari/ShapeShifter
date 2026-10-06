import type { Command, PathData, Point } from "../types";
import { arcToBeziers } from "../geometry";
import { generateId } from "../ids";

/** Resolve reflected handles against SVG source commands, not expanded arc cubics. */
function resolveCommands(commands: Command[], expandArcs: boolean): Command[] {
  if (!expandArcs && !commands.some((cmd) => cmd.type === "S" || cmd.type === "T")) return commands;
  const result: Command[] = [];
  let current: Point = { x: 0, y: 0 };
  let start = current;
  let previousType = "";
  let previousControl: Point | null = null;
  for (const command of commands) {
    const end = command.points.at(-1);
    let resolved = command;
    let control: Point | null = null;
    if (command.type === "M" && end) start = end;
    if (command.type === "Z") current = start;
    if (command.type === "S" && command.points.length === 2) {
      const reflected =
        previousControl && (previousType === "C" || previousType === "S")
          ? { x: 2 * current.x - previousControl.x, y: 2 * current.y - previousControl.y }
          : { ...current };
      resolved = { ...command, type: "C", points: [reflected, ...command.points] };
      control = command.points[0];
    } else if (command.type === "T" && end) {
      control =
        previousControl && (previousType === "Q" || previousType === "T")
          ? { x: 2 * current.x - previousControl.x, y: 2 * current.y - previousControl.y }
          : { ...current };
      resolved = { ...command, type: "Q", points: [control, end] };
    } else if (command.type === "C") control = command.points[1];
    else if (command.type === "Q") control = command.points[0];
    if (expandArcs && command.type === "A" && command.arcParams && end) {
      const arc = command.arcParams;
      const segments = arcToBeziers(
        current.x,
        current.y,
        arc.rx,
        arc.ry,
        arc.xRotation,
        arc.largeArc,
        arc.sweep,
        end.x,
        end.y,
      );
      if (!segments.length) result.push({ id: command.id, type: "L", points: [end] });
      else
        segments.forEach((segment, index) =>
          result.push({
            id: index === 0 ? command.id : generateId(),
            type: "C",
            points: [segment.cp1, segment.cp2, segment.to],
          }),
        );
    } else result.push(resolved);
    if (end) current = end;
    previousType = command.type;
    previousControl = control;
  }
  return result;
}

/** Keep arc command indices intact while making neighboring smooth handles explicit. */
export function materializeSmoothCommands(commands: Command[]): Command[] {
  return resolveCommands(commands, false);
}

export function normalizeCommands(commands: Command[]): Command[] {
  return resolveCommands(commands, true);
}

export function normalizePathData(path: PathData): PathData {
  return {
    ...path,
    subPaths: path.subPaths.map((sub) => ({ ...sub, commands: normalizeCommands(sub.commands) })),
  };
}

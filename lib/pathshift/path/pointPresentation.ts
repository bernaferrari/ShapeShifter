import type { PathData } from "../types";

export interface PointAddress {
  subPathIndex: number;
  commandIndex: number;
  pointIndex: number;
}
export interface PathAnchor extends PointAddress {
  number: number;
  controls: Array<PointAddress & { label: string }>;
}

/** Anchors own their incoming/outgoing tangents, independently of SVG command ordering. */
export function pathAnchors(path: PathData, subPathIndex: number): PathAnchor[] {
  const commands = path.subPaths[subPathIndex]?.commands ?? [];
  const anchors = commands.flatMap((cmd, commandIndex) =>
    cmd.points.length
      ? [
          {
            subPathIndex,
            commandIndex,
            pointIndex: cmd.points.length - 1,
            number: 0,
            controls: [] as PathAnchor["controls"],
          },
        ]
      : [],
  );
  anchors.forEach((anchor, index) => {
    anchor.number = index + 1;
    const command = commands[anchor.commandIndex];
    const next = commands[anchor.commandIndex + 1];
    const add = (commandIndex: number, pointIndex: number, label: string) =>
      anchor.controls.push({ subPathIndex, commandIndex, pointIndex, label });
    if (command.type === "C") add(anchor.commandIndex, 1, "Incoming");
    else if (command.type === "S") add(anchor.commandIndex, 0, "Incoming");
    else if (command.type === "Q") add(anchor.commandIndex, 0, "Shared control");
    if (next?.type === "C") add(anchor.commandIndex + 1, 0, "Outgoing");
    else if (next?.type === "Q") add(anchor.commandIndex + 1, 0, "Shared control");
  });
  return anchors;
}

export function pointPresentation(path: PathData, address: PointAddress) {
  const anchors = pathAnchors(path, address.subPathIndex);
  for (const anchor of anchors) {
    if (anchor.commandIndex === address.commandIndex && anchor.pointIndex === address.pointIndex)
      return { anchor, label: `Point ${anchor.number}` };
    const control = anchor.controls.find(
      (item) =>
        item.commandIndex === address.commandIndex && item.pointIndex === address.pointIndex,
    );
    if (control)
      return { anchor, label: `Point ${anchor.number} · ${control.label.toLowerCase()}` };
  }
  return null;
}

export function edgePresentation(path: PathData, subPathIndex: number, commandIndex: number) {
  const anchors = pathAnchors(path, subPathIndex);
  const end = anchors.find((anchor) => anchor.commandIndex === commandIndex);
  const start = anchors.find((anchor) => anchor.commandIndex === commandIndex - 1);
  if (path.subPaths[subPathIndex]?.commands[commandIndex]?.type === "Z")
    return anchors.length > 1
      ? { start: anchors.at(-1)!, end: anchors[0], label: `Points ${anchors.at(-1)!.number} → 1` }
      : null;
  return start && end ? { start, end, label: `Points ${start.number} → ${end.number}` } : null;
}

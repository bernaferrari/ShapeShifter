/**
 * ShapeShifter 2026 - Core Path Types
 * Modern, clean TypeScript representation of SVG paths for morphing.
 */

export type CommandType = "M" | "L" | "C" | "Q" | "A" | "Z" | "H" | "V" | "S" | "T";

export interface Point {
  x: number;
  y: number;
}

export interface Command {
  id: string; // stable id for React keys and selection
  type: CommandType;
  points: Point[]; // control + end points depending on command
  // For future: arc params, etc.
  originalString?: string; // for debugging
}

export interface SubPath {
  commands: Command[];
}

export interface PathData {
  subPaths: SubPath[];
  // cached string for performance
  _string?: string;
}

/**
 * A single editable layer in the animation.
 */
export interface Layer {
  id: number | string;
  name: string;
  from: PathData;
  to: PathData;
  visible: boolean;
  locked: boolean;
  duration?: number; // per-layer duration override
}

/**
 * Selection state for the canvas.
 */
export interface Selection {
  layerId: string | number;
  side: "from" | "to";
  subPathIndex: number;
  commandIndex: number;
  pointIndex: number; // within the command's points array
}

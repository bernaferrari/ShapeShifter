/**
 * ShapeShifter 2026 - Core Path Types
 * Modern, clean TypeScript representation of SVG paths for morphing.
 */

export type CommandType = "M" | "L" | "C" | "Q" | "A" | "Z" | "H" | "V" | "S" | "T";

export type InterpolatorName =
  | "FAST_OUT_SLOW_IN"
  | "FAST_OUT_LINEAR_IN"
  | "LINEAR_OUT_SLOW_IN"
  | "ACCELERATE_DECELERATE"
  | "LINEAR";

export interface Point {
  x: number;
  y: number;
}

export interface Command {
  id: string;
  type: CommandType;
  points: Point[];
  /** Present for preserved elliptical arcs (rx, ry, xRotation, largeArc, sweep). */
  arcParams?: {
    rx: number;
    ry: number;
    xRotation: number;
    largeArc: boolean;
    sweep: boolean;
  };
}


export interface SubPath {
  commands: Command[];
}

export interface PathData {
  subPaths: SubPath[];
  // cached string for performance
  _string?: string;
}

export type LayerType = "path" | "clipPath" | "group" | "vector";
export type StrokeLineCap = "butt" | "square" | "round";
export type StrokeLineJoin = "miter" | "round" | "bevel";
export type FillType = "nonZero" | "evenOdd";

export interface PathStyle {
  pathData?: PathData;
  fillColor?: string;
  fillAlpha?: number;
  strokeColor?: string;
  strokeAlpha?: number;
  strokeWidth?: number;
  strokeLinecap?: StrokeLineCap;
  strokeLinejoin?: StrokeLineJoin;
  strokeMiterLimit?: number;
  trimPathStart?: number;
  trimPathEnd?: number;
  trimPathOffset?: number;
  fillType?: FillType;
  strokeDasharray?: string;
}

export interface TimelineBlock {
  id: string;
  layerId: string | number;
  propertyName: string;
  fromValue: string | number;
  toValue: string | number;
  startTime: number;
  endTime: number;
  interpolator?: string;
  type?: "path" | "color" | "number";
}

export interface AnimationState {
  id: string;
  name: string;
  duration: number;
  blocks: TimelineBlock[];
}

export interface VectorMetadata {
  id: string | number;
  name: string;
  width: number;
  height: number;
  alpha: number;
}

/**
 * A single editable layer in the animation.
 */
export interface Layer extends PathStyle {
  id: number | string;
  name: string;
  type: LayerType;
  from: PathData;
  to: PathData;
  visible: boolean;
  locked: boolean;
  expanded?: boolean;
  parentId?: string | number | null;
  children?: Layer[];
  alpha?: number;
  translateX?: number;
  translateY?: number;
  scaleX?: number;
  scaleY?: number;
  rotation?: number;
  pivotX?: number;
  pivotY?: number;
  duration?: number; // per-layer duration override
  timeline?: TimelineBlock[];
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

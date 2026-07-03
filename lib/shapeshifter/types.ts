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
export type GradientType = "linear" | "radial";

/** A single gradient color stop. `offset` is 0..1, `opacity` (0..1) defaults to 1. */
export interface GradientStop {
  offset: number;
  color: string;
  opacity?: number;
}

/**
 * Optional gradient fill for a path layer. When present on a Layer it takes
 * precedence over the solid `fillColor` for both rendering and export.
 * All spatial values are expressed in the path's bounding box (objectBoundingBox),
 * so a gradient maps correctly regardless of the layer's transform or frame.
 */
export interface Gradient {
  type: GradientType;
  /** >= 2 stops, kept sorted by offset. */
  stops: GradientStop[];
  /** Linear only: direction in degrees. 0 = left→right, 90 = top→bottom. */
  angle?: number;
  /** Radial only: center as a fraction of the bounds (default 0.5/0.5). */
  cx?: number;
  cy?: number;
  /** Radial only: radius as a fraction of the bounds (default 0.5). */
  r?: number;
}

export interface PathStyle {
  pathData?: PathData;
  fillColor?: string;
  fillAlpha?: number;
  fillGradient?: Gradient;
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
  /** Start geometry. Always present. */
  from: PathData;
  /**
   * Optional end geometry. When absent the layer is a STATIC shape (no morph).
   * Morphing is opt-in: a layer becomes a morph only when `to` is set (e.g. the demo
   * clips, or when the user adds an end state). This keeps plain shapes simple and
   * makes the document CRDT/yjs-friendly (static shape = trivial data).
   */
  to?: PathData;
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
 * Resolve a layer's end geometry, falling back to its start when the layer is static
 * (no `to`). Use this for every read so missing-`to` layers render/edit as plain shapes.
 */
export function getTo(layer: Pick<Layer, "from" | "to">): PathData {
  return layer.to ?? layer.from;
}

/**
 * =============================================
 * SHAPESHIFTER 2.0 - FIRST-PRINCIPLES MODEL (vdeq / sogt)
 * Parallel to v1 during migration. Do not break existing behavior.
 * =============================================
 */

export type NodeId = string;
export type GeometryVersionId = string;
export type MorphMappingId = string;
export type TrackId = string;
export type KeyframeId = string;
export type FrameId = string;
export type ComponentId = string;

/** Immutable versioned geometry. Commands keep stable IDs. */
export interface GeometryVersion {
  id: GeometryVersionId;
  pathData: PathData;
  sourceHash?: string;
  createdAt: number;
}

/** Explicit morph correspondence (output of prepareForMorph). */
export interface MorphMapping {
  id: MorphMappingId;
  fromGeometryId: GeometryVersionId;
  toGeometryId: GeometryVersionId;
  // Serialized result of NW + pole collapse, winding fixes, etc.
  alignments: any;
  polePositions: Point[];
  createdAt: number;
}

/** Scene graph node (replaces much of the old Layer role). */
export interface Node {
  id: NodeId;
  name: string;
  type: 'group' | 'path' | 'boolean' | 'componentInstance';
  parentId?: NodeId;
  childrenIds?: NodeId[];
  visible: boolean;
  locked: boolean;
  transform: any; // matrix or decomposed
  style: PathStyle;
  alpha: number;
  geometryVersionId?: GeometryVersionId; // for path nodes
}

/** Frame = positioned container on the infinite canvas (evolution of CanvasFrame). */
export interface Frame {
  id: FrameId;
  name: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  childrenNodeIds: NodeId[];
}

/** Unified animation primitive. */
export interface Track {
  id: TrackId;
  target: { nodeId: NodeId; property: string };
  keyframeIds: KeyframeId[];
}

export interface Keyframe {
  id: KeyframeId;
  time: number;
  value: any;
  interpolator?: InterpolatorName;
  morphMappingId?: MorphMappingId; // only for geometry tracks
}

export interface AnimationClip {
  id: string;
  name: string;
  duration: number;
  trackIds: TrackId[];
}

/** Top level v2 document (future replacement for current project + frames). */
export interface DocumentV2 {
  id: string;
  name: string;
  version: 2;
  frameIds: FrameId[];
  nodeIds: NodeId[]; // root nodes
  geometryVersions: Record<GeometryVersionId, GeometryVersion>;
  morphMappings: Record<MorphMappingId, MorphMapping>;
  clips: Record<string, AnimationClip>;
  tracks: Record<TrackId, Track>;
  keyframes: Record<KeyframeId, Keyframe>;
  components?: any; // future
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

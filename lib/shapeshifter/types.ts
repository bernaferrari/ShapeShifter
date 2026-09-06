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
/**
 * The coordinate system used by a gradient's spatial values.
 *
 * Existing documents omit this value and therefore retain the original
 * object-bounding-box behavior. Android VectorDrawable imports use
 * `userSpace` because Android's gradient endpoints live in viewport space.
 */
export type GradientCoordinateSpace = "objectBoundingBox" | "userSpace";

/** A single gradient color stop. `offset` is 0..1, `opacity` (0..1) defaults to 1. */
export interface GradientStop {
  offset: number;
  color: string;
  opacity?: number;
}

/**
 * Optional gradient fill for a path layer. When present on a Layer it takes
 * precedence over the solid `fillColor` for both rendering and export.
 * Existing gradients express their spatial values in the path's bounding box
 * (`objectBoundingBox`). A `userSpace` gradient instead uses the artboard / Android
 * viewport coordinate system, which preserves imported Android endpoints exactly.
 */
export interface Gradient {
  type: GradientType;
  /** >= 2 stops, kept sorted by offset. */
  stops: GradientStop[];
  /** Defaults to `objectBoundingBox` for backward compatibility. */
  coordinateSpace?: GradientCoordinateSpace;
  /**
   * Linear-only exact endpoints. When all four are present they take precedence
   * over `angle`; their units are determined by `coordinateSpace`.
   */
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  /** Linear only: direction in degrees. 0 = left→right, 90 = top→bottom. */
  angle?: number;
  /** Radial only: center in `coordinateSpace` units (default 0.5/0.5). */
  cx?: number;
  cy?: number;
  /** Radial only: radius in `coordinateSpace` units (default 0.5). */
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
  /** Intrinsic Android drawable width. Existing documents use this as their editor size. */
  width: number;
  /** Intrinsic Android drawable height. Existing documents use this as their editor size. */
  height: number;
  /** Android viewport coordinates can intentionally differ from intrinsic dp dimensions. */
  viewportWidth?: number;
  viewportHeight?: number;
  widthUnit?: "dp" | "px" | "sp" | string;
  heightUnit?: "dp" | "px" | "sp" | string;
  alpha: number;
  tint?: string;
  tintMode?: string;
  autoMirrored?: boolean;
  /** Minimum Android API implied by imported drawable capabilities. */
  minSdk?: number;
}

/**
 * A single editable layer in the animation.
 */
export interface Layer extends PathStyle {
  id: number | string;
  name: string;
  /** Stable Android target name, separate from the editor-facing display label. */
  androidName?: string;
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
  /** Last inspectable prepare-for-morph correspondence for this layer. */
  morphMapping?: MorphMapping;
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

export interface NodeTransform {
  translateX: number;
  translateY: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
  pivotX: number;
  pivotY: number;
}

export type AnimatableProperty =
  | "pathData"
  | "alpha"
  | "fillColor"
  | "fillAlpha"
  | "strokeColor"
  | "strokeAlpha"
  | "strokeWidth"
  | "trimPathStart"
  | "trimPathEnd"
  | "trimPathOffset"
  | "translateX"
  | "translateY"
  | "scaleX"
  | "scaleY"
  | "rotation"
  | "pivotX"
  | "pivotY";

export type AnimationValue = number | string;
export type TrackValueType = "number" | "color" | "path";

/** Immutable versioned geometry. Commands keep stable IDs. */
export interface GeometryVersion {
  id: GeometryVersionId;
  pathData: PathData;
  sourceHash?: string;
  createdAt: number;
}

export type MorphAlignment =
  | {
      kind: "prepared";
      fromSignature: string;
      toSignature: string;
      compatible: boolean;
    }
  | { kind: "legacy-aligned-endpoints" };

/** Explicit morph correspondence (output of prepareForMorph). */
export interface MorphMapping {
  id: MorphMappingId;
  fromGeometryId?: GeometryVersionId;
  toGeometryId?: GeometryVersionId;
  alignments: MorphAlignment;
  polePositions: Point[];
  createdAt: number;
}

/** Scene graph node (replaces much of the old Layer role). */
export interface Node {
  id: NodeId;
  name: string;
  type: "group" | "path" | "clipPath" | "boolean" | "componentInstance";
  parentId?: NodeId;
  childrenIds?: NodeId[];
  visible: boolean;
  locked: boolean;
  transform: NodeTransform;
  style: PathStyle;
  alpha: number;
  /** Editable/base path geometry for path and clip-path nodes. */
  geometryVersionId?: GeometryVersionId;
  /** Preserved legacy endpoint geometry; these prevent a project round trip from erasing morphs. */
  fromGeometryVersionId?: GeometryVersionId;
  toGeometryVersionId?: GeometryVersionId;
  /** Android's target name. Kept stable independently from the display name. */
  androidName?: string;
  /** Inspectable prepare-for-morph result for this path node. */
  morphMappingId?: MorphMappingId;
}

/** Frame = positioned container on the infinite canvas (evolution of CanvasFrame). */
export interface Frame {
  id: FrameId;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  alpha: number;
  viewportWidth?: number;
  viewportHeight?: number;
  widthUnit?: string;
  heightUnit?: string;
  tint?: string;
  tintMode?: string;
  autoMirrored?: boolean;
  minSdk?: number;
  childrenNodeIds: NodeId[];
  clipIds: string[];
}

export interface PageMetadata {
  name: string;
  width: number;
  height: number;
  alpha: number;
  viewportWidth?: number;
  viewportHeight?: number;
  widthUnit?: string;
  heightUnit?: string;
  tint?: string;
  tintMode?: string;
  autoMirrored?: boolean;
  minSdk?: number;
}

/** Unified animation primitive. */
export interface Track {
  id: TrackId;
  target: { nodeId: NodeId; property: AnimatableProperty };
  valueType: TrackValueType;
  keyframeIds: KeyframeId[];
}

export interface Keyframe {
  id: KeyframeId;
  time: number;
  value: AnimationValue;
  /** Named Android interpolator or a lossless custom cubic/path value. */
  interpolator?: string;
  morphMappingId?: MorphMappingId; // only for geometry tracks
  /** Immutable path geometry when this is a pathData keyframe. */
  geometryVersionId?: GeometryVersionId;
  /** Temporary migration marker so disjoint v1 timeline blocks round-trip losslessly. */
  legacyBlockId?: string;
}

export interface AnimationClip {
  id: string;
  name: string;
  duration: number;
  frameId: FrameId | null;
  trackIds: TrackId[];
}

/** Top level v2 document (future replacement for current project + frames). */
export interface DocumentV2 {
  id: string;
  name: string;
  version: 2;
  frameIds: FrameId[];
  frames: Record<FrameId, Frame>;
  page: PageMetadata;
  /** Nodes that live on the infinite page instead of inside an artboard. */
  rootNodeIds: NodeId[];
  rootClipIds: string[];
  nodes: Record<NodeId, Node>;
  geometryVersions: Record<GeometryVersionId, GeometryVersion>;
  morphMappings: Record<MorphMappingId, MorphMapping>;
  clips: Record<string, AnimationClip>;
  tracks: Record<TrackId, Track>;
  keyframes: Record<KeyframeId, Keyframe>;
  components?: Record<ComponentId, unknown>;
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

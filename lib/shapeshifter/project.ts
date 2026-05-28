import { parsePath, ensureStableCommandIds } from "./pathUtils";
import type {
  AnimationState,
  FillType,
  Layer,
  LayerType,
  StrokeLineCap,
  StrokeLineJoin,
  TimelineBlock,
  VectorMetadata,
} from "./types";

export interface ShapeShifterProjectLayer {
  id: string;
  name: string;
  type: "vector" | "group" | "path" | "clipPath";
  children?: ShapeShifterProjectLayer[];
  pathData?: string;
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
  alpha?: number;
  width?: number;
  height?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  pivotX?: number;
  pivotY?: number;
  translateX?: number;
  translateY?: number;
}

export interface ShapeShifterAnimation {
  id: string;
  name: string;
  duration: number;
  blocks: TimelineBlock[];
}

export interface ShapeShifterProject {
  version: number;
  layers: {
    vectorLayer: ShapeShifterProjectLayer;
    hiddenLayerIds: string[];
  };
  timeline: {
    animation: ShapeShifterAnimation;
  };
}

export interface FlattenedShapeShifterProject {
  layers: Layer[];
  hiddenLayerIds: string[];
  animation: AnimationState;
  vector: VectorMetadata;
}

function isLayerType(type: string): type is LayerType {
  return type === "path" || type === "clipPath" || type === "group" || type === "vector";
}

export function isOriginalShapeShifterProject(value: unknown): value is ShapeShifterProject {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ShapeShifterProject>;
  return Boolean(
    candidate.layers?.vectorLayer &&
      candidate.timeline?.animation &&
      Array.isArray(candidate.timeline.animation.blocks),
  );
}

export function flattenOriginalProject(project: ShapeShifterProject): FlattenedShapeShifterProject {
  const pathBlocksByLayerId = new Map<string, TimelineBlock>();
  for (const block of project.timeline.animation.blocks) {
    if (block.propertyName === "pathData" && block.type === "path") {
      pathBlocksByLayerId.set(String(block.layerId), block);
    }
  }

  const hiddenIds = new Set(project.layers.hiddenLayerIds.map(String));
  const result: Layer[] = [];

  const walk = (layer: ShapeShifterProjectLayer, parentId: string | null) => {
    const children = layer.children ?? [];
    if (layer.type === "group") {
      const emptyPath = ensureStableCommandIds(parsePath(""));
      result.push({
        id: layer.id,
        name: layer.name,
        type: "group",
        from: emptyPath,
        to: emptyPath,
        pathData: emptyPath,
        parentId,
        visible: !hiddenIds.has(layer.id),
        locked: false,
        expanded: true,
        children: [],
        alpha: layer.alpha ?? 1,
        rotation: layer.rotation ?? 0,
        scaleX: layer.scaleX ?? 1,
        scaleY: layer.scaleY ?? 1,
        pivotX: layer.pivotX ?? 0,
        pivotY: layer.pivotY ?? 0,
        translateX: layer.translateX ?? 0,
        translateY: layer.translateY ?? 0,
        timeline: project.timeline.animation.blocks.filter((block) => String(block.layerId) === layer.id),
      });
    }

    if ((layer.type === "path" || layer.type === "clipPath") && layer.pathData) {
      const pathBlock = pathBlocksByLayerId.get(layer.id);
      const from = String(pathBlock?.fromValue ?? layer.pathData);
      const to = String(pathBlock?.toValue ?? layer.pathData);
      result.push({
        id: layer.id,
        name: layer.name,
        type: isLayerType(layer.type) ? layer.type : "path",
        from: ensureStableCommandIds(parsePath(from)),
        to: ensureStableCommandIds(parsePath(to)),
        pathData: ensureStableCommandIds(parsePath(layer.pathData)),
        parentId,
        visible: !hiddenIds.has(layer.id),
        locked: false,
        expanded: true,
        fillColor: layer.fillColor ?? "",
        fillAlpha: layer.fillAlpha ?? 1,
        strokeColor: layer.strokeColor ?? "",
        strokeAlpha: layer.strokeAlpha ?? 1,
        strokeWidth: layer.strokeWidth ?? 0,
        strokeLinecap: layer.strokeLinecap ?? "butt",
        strokeLinejoin: layer.strokeLinejoin ?? "miter",
        strokeMiterLimit: layer.strokeMiterLimit ?? 4,
        trimPathStart: layer.trimPathStart ?? 0,
        trimPathEnd: layer.trimPathEnd ?? 1,
        trimPathOffset: layer.trimPathOffset ?? 0,
        fillType: layer.fillType ?? "nonZero",
        alpha: layer.alpha ?? 1,
        rotation: layer.rotation ?? 0,
        scaleX: layer.scaleX ?? 1,
        scaleY: layer.scaleY ?? 1,
        pivotX: layer.pivotX ?? 0,
        pivotY: layer.pivotY ?? 0,
        translateX: layer.translateX ?? 0,
        translateY: layer.translateY ?? 0,
        timeline: project.timeline.animation.blocks.filter((block) => String(block.layerId) === layer.id),
      });
    }

    for (const child of children) {
      walk(child, layer.id);
    }
  };

  const vectorLayer = project.layers.vectorLayer;
  walk(vectorLayer, null);
  return {
    layers: result,
    hiddenLayerIds: project.layers.hiddenLayerIds.map(String),
    animation: {
      id: project.timeline.animation.id,
      name: project.timeline.animation.name,
      duration: project.timeline.animation.duration,
      blocks: project.timeline.animation.blocks,
    },
    vector: {
      id: vectorLayer.id,
      name: vectorLayer.name,
      width: vectorLayer.width ?? 24,
      height: vectorLayer.height ?? 24,
      alpha: vectorLayer.alpha ?? 1,
    },
  };
}

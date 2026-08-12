import { colorAtTime, numberAtTime, pathDAtTime } from "../playheadResolve";
import { parsePath } from "../pathUtils";
import type { AnimationState, Layer, PathData } from "../types";
import {
  IDENTITY_AFFINE,
  layerTransformToMatrix,
  multiplyAffine,
  type AffineMatrix,
} from "./layerTransform";

export interface EvaluatedTransform {
  translateX: number;
  translateY: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  pivotX: number;
  pivotY: number;
}

export interface EvaluatedSceneNode {
  id: string | number;
  layer: Layer;
  parentId: string | number | null;
  type: "group" | "path" | "clipPath";
  childIds: Array<string | number>;
  transform: EvaluatedTransform;
  worldMatrix: AffineMatrix;
  visible: boolean;
  locked: boolean;
  alpha: number;
  d: string;
  path: PathData | null;
  fill: string | null;
  fillOpacity: number;
  fillGradient: Layer["fillGradient"];
  fillType: Layer["fillType"];
  stroke: string | null;
  strokeOpacity: number;
  strokeWidth: number;
  strokeLinecap: Layer["strokeLinecap"];
  strokeLinejoin: Layer["strokeLinejoin"];
  strokeMiterLimit: number;
  strokeDasharray: string | undefined;
  trimPathStart: number;
  trimPathEnd: number;
  trimPathOffset: number;
  /** Active clips in Android sibling order, expressed as node IDs. */
  clipNodeIds: Array<string | number>;
}

export interface EvaluatedScene {
  roots: Array<string | number>;
  nodes: EvaluatedSceneNode[];
  nodesById: Map<string, EvaluatedSceneNode>;
}

interface LayerEntry {
  layer: Layer;
  parentId: string | number | null;
}

function collectLayerEntries(layers: Layer[]): LayerEntry[] {
  const entries = new Map<string, LayerEntry>();
  const visit = (layer: Layer, nestedParent: string | number | null) => {
    const key = String(layer.id);
    const parentId = layer.parentId ?? nestedParent;
    if (!entries.has(key)) entries.set(key, { layer, parentId });
    for (const child of layer.children ?? []) visit(child, layer.id);
  };
  for (const layer of layers) visit(layer, null);
  return [...entries.values()];
}

function asNumber(value: number | undefined, fallback: number) {
  return Number.isFinite(value) ? Number(value) : fallback;
}

function evaluateTransform(
  layer: Layer,
  animation: AnimationState,
  ms: number,
  usePlayhead: boolean,
): EvaluatedTransform {
  const value = (property: string, fallback: number) =>
    usePlayhead
      ? numberAtTime(layer, animation.blocks, property, ms, animation.duration, fallback)
      : asNumber((layer as unknown as Record<string, unknown>)[property] as number | undefined, fallback);
  return {
    translateX: value("translateX", 0),
    translateY: value("translateY", 0),
    rotation: value("rotation", 0),
    scaleX: value("scaleX", 1),
    scaleY: value("scaleY", 1),
    pivotX: value("pivotX", 0),
    pivotY: value("pivotY", 0),
  };
}

/**
 * Evaluate the ordered Android vector tree once. This function deliberately has
 * no React/store dependency so browser rendering, selection, and serialization
 * can share the same hierarchy and property semantics.
 */
export function evaluateAndroidScene(
  layers: Layer[],
  animation: AnimationState,
  progress: number,
  usePlayhead = true,
): EvaluatedScene {
  const entries = collectLayerEntries(layers);
  const byId = new Map(entries.map((entry) => [String(entry.layer.id), entry]));
  const children = new Map<string | null, Array<string | number>>();
  for (const entry of entries) {
    const parentId = entry.parentId != null && byId.has(String(entry.parentId)) ? entry.parentId : null;
    children.set(parentId == null ? null : String(parentId), [
      ...(children.get(parentId == null ? null : String(parentId)) ?? []),
      entry.layer.id,
    ]);
  }
  const roots = children.get(null) ?? [];
  const nodes: EvaluatedSceneNode[] = [];
  const nodesById = new Map<string, EvaluatedSceneNode>();
  const ms = Math.max(0, Math.min(1, progress)) * Math.max(1, animation.duration);

  const visit = (
    id: string | number,
    parentId: string | number | null,
    parentMatrix: AffineMatrix,
    parentVisible: boolean,
    inheritedAlpha: number,
    inheritedClips: Array<string | number>,
  ) => {
    const entry = byId.get(String(id));
    if (!entry) return;
    const layer = entry.layer;
    const transform = evaluateTransform(layer, animation, ms, usePlayhead);
    const worldMatrix = multiplyAffine(parentMatrix, layerTransformToMatrix(transform));
    const visible = parentVisible && layer.visible !== false;
    const alpha = inheritedAlpha * (usePlayhead
      ? numberAtTime(layer, animation.blocks, "alpha", ms, animation.duration, layer.alpha ?? 1)
      : (layer.alpha ?? 1));
    const type = layer.type === "vector" ? "group" : layer.type;
    const isPath = type === "path" || type === "clipPath";
    const d = isPath
      ? usePlayhead
        ? pathDAtTime(layer, animation.blocks, ms, animation.duration, progress)
        : pathDAtTime(layer, [], 0, animation.duration, 0)
      : "";
    let path: PathData | null = null;
    if (isPath) {
      try {
        path = usePlayhead ? parsePath(d) : (layer.pathData ?? layer.from);
      } catch {
        path = layer.pathData ?? layer.from;
      }
    }
    const fillColor = usePlayhead
      ? colorAtTime(layer, animation.blocks, "fillColor", ms, animation.duration, layer.fillColor ?? "")
      : layer.fillColor;
    const strokeColor = usePlayhead
      ? colorAtTime(layer, animation.blocks, "strokeColor", ms, animation.duration, layer.strokeColor ?? "")
      : layer.strokeColor;
    const value = (property: string, fallback: number) =>
      usePlayhead
        ? numberAtTime(layer, animation.blocks, property, ms, animation.duration, fallback)
        : asNumber((layer as unknown as Record<string, unknown>)[property] as number | undefined, fallback);
    const childIds = children.get(String(id)) ?? [];
    const node: EvaluatedSceneNode = {
      id: layer.id,
      layer,
      parentId,
      type,
      childIds,
      transform,
      worldMatrix,
      visible,
      locked: Boolean(layer.locked),
      alpha,
      d,
      path,
      fill: fillColor && fillColor !== "none" ? fillColor : null,
      fillOpacity: value("fillAlpha", 1) * alpha,
      fillGradient: layer.fillGradient,
      fillType: layer.fillType,
      stroke: strokeColor && strokeColor !== "none" ? strokeColor : null,
      strokeOpacity: value("strokeAlpha", 1) * alpha,
      strokeWidth: value("strokeWidth", 0),
      strokeLinecap: layer.strokeLinecap ?? "butt",
      strokeLinejoin: layer.strokeLinejoin ?? "miter",
      strokeMiterLimit: value("strokeMiterLimit", 4),
      strokeDasharray: layer.strokeDasharray,
      trimPathStart: value("trimPathStart", 0),
      trimPathEnd: value("trimPathEnd", 1),
      trimPathOffset: value("trimPathOffset", 0),
      clipNodeIds: [...inheritedClips],
    };
    nodes.push(node);
    nodesById.set(String(id), node);

    if (type === "clipPath") return node;
    const localClips = [...inheritedClips];
    for (const childId of childIds) {
      const child = byId.get(String(childId))?.layer;
      if (child?.type === "clipPath") {
        visit(childId, layer.id, worldMatrix, visible, alpha, localClips);
        localClips.push(childId);
      } else {
        visit(childId, layer.id, worldMatrix, visible, alpha, localClips);
      }
    }
    return node;
  };

  for (const rootId of roots) visit(rootId, null, IDENTITY_AFFINE, true, 1, []);
  return { roots, nodes, nodesById };
}

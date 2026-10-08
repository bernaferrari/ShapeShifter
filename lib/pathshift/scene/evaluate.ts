import { blocksFor, colorAtTime, numberAtTime, pathDAtTime } from "../playheadResolve";
import { parsePath, pathToString } from "../pathUtils";
import { trimPathData } from "../path/pathTrim";
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
      : asNumber(
          (layer as unknown as Record<string, unknown>)[property] as number | undefined,
          fallback,
        );
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
const evaluatedSceneCache = new WeakMap<
  Layer[],
  { animation: AnimationState; progress: number; usePlayhead: boolean; scene: EvaluatedScene }
>();

export function evaluateAndroidScene(
  layers: Layer[],
  animation: AnimationState,
  progress: number,
  usePlayhead = true,
): EvaluatedScene {
  const cached = evaluatedSceneCache.get(layers);
  // Blocks are replaced immutably everywhere (no in-place mutation of a cached AnimationState),
  // so comparing the animation object identity is a sufficient cache key — no per-call
  // O(blocks) fingerprint string needed during 60fps playback.
  if (
    cached &&
    cached.animation === animation &&
    cached.progress === progress &&
    cached.usePlayhead === usePlayhead
  ) {
    return cached.scene;
  }
  const scene = evaluateAndroidSceneUncached(layers, animation, progress, usePlayhead);
  evaluatedSceneCache.set(layers, { animation, progress, usePlayhead, scene });
  return scene;
}

function evaluateAndroidSceneUncached(
  layers: Layer[],
  animation: AnimationState,
  progress: number,
  usePlayhead = true,
): EvaluatedScene {
  const entries = collectLayerEntries(layers);
  const byId = new Map(entries.map((entry) => [String(entry.layer.id), entry]));
  const children = new Map<string | null, Array<string | number>>();
  const cyclicIds = new Set<string>();
  for (const entry of entries) {
    let parentId =
      entry.parentId != null && byId.has(String(entry.parentId)) ? entry.parentId : null;
    // Deterministic cycle handling: walk the parent chain with a visited set.
    // If the chain loops back on itself, this entry would never attach to roots
    // and its whole subtree would vanish from the scene — promote it to a root.
    if (parentId != null) {
      const seen = new Set<string>([String(entry.layer.id)]);
      let cursor: string | number | null | undefined = parentId;
      while (cursor != null) {
        const cursorKey: string = String(cursor);
        if (seen.has(cursorKey)) {
          cyclicIds.add(cursorKey);
          parentId = null;
          break;
        }
        seen.add(cursorKey);
        cursor = byId.get(cursorKey)?.parentId ?? null;
      }
    }
    const parentKey = parentId == null ? null : String(parentId);
    const siblings = children.get(parentKey);
    if (siblings) siblings.push(entry.layer.id);
    else children.set(parentKey, [entry.layer.id]);
  }
  if (cyclicIds.size > 0 && process.env.NODE_ENV !== "production") {
    console.warn(
      `[evaluateAndroidScene] layer hierarchy cycle detected involving: ${[...cyclicIds].join(", ")}; promoting affected children to roots.`,
    );
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
  ): EvaluatedSceneNode | undefined => {
    const entry = byId.get(String(id));
    if (!entry) return;
    const layer = entry.layer;
    const transform = evaluateTransform(layer, animation, ms, usePlayhead);
    const worldMatrix = multiplyAffine(parentMatrix, layerTransformToMatrix(transform));
    const visible = parentVisible && layer.visible !== false;
    const alpha =
      inheritedAlpha *
      (usePlayhead
        ? numberAtTime(layer, animation.blocks, "alpha", ms, animation.duration, layer.alpha ?? 1)
        : (layer.alpha ?? 1));
    const type = layer.type === "vector" ? "group" : layer.type;
    const isPath = type === "path" || type === "clipPath";
    let d = isPath
      ? usePlayhead
        ? pathDAtTime(layer, animation.blocks, ms, animation.duration, progress)
        : pathDAtTime(layer, [], 0, animation.duration, 0)
      : "";
    let path: PathData | null = null;
    if (isPath) {
      try {
        // Transform/style animation does not change local geometry. Reuse its
        // authored command identities instead of reparsing SVG and minting new
        // IDs on every playback frame.
        const hasPathTrack =
          usePlayhead && blocksFor(animation.blocks, layer.id, "pathData").length > 0;
        path =
          !usePlayhead || (!hasPathTrack && (!layer.to || progress <= 0))
            ? (layer.pathData ?? layer.from)
            : parsePath(d);
      } catch {
        path = layer.pathData ?? layer.from;
      }
    }
    const fillColor = usePlayhead
      ? colorAtTime(
          layer,
          animation.blocks,
          "fillColor",
          ms,
          animation.duration,
          layer.fillColor ?? "",
        )
      : layer.fillColor;
    const strokeColor = usePlayhead
      ? colorAtTime(
          layer,
          animation.blocks,
          "strokeColor",
          ms,
          animation.duration,
          layer.strokeColor ?? "",
        )
      : layer.strokeColor;
    const value = (property: string, fallback: number) =>
      usePlayhead
        ? numberAtTime(layer, animation.blocks, property, ms, animation.duration, fallback)
        : asNumber(
            (layer as unknown as Record<string, unknown>)[property] as number | undefined,
            fallback,
          );
    const trimPathStart = value("trimPathStart", 0);
    const trimPathEnd = value("trimPathEnd", 1);
    const trimPathOffset = value("trimPathOffset", 0);
    if (type === "path" && path) {
      const painted = trimPathData(path, trimPathStart, trimPathEnd, trimPathOffset);
      if (painted !== path) {
        path = painted;
        d = pathToString(path);
      }
    }
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
      locked: Boolean(
        layer.locked || (parentId != null && nodesById.get(String(parentId))?.locked),
      ),
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
      trimPathStart,
      trimPathEnd,
      trimPathOffset,
      clipNodeIds: [...inheritedClips],
    };
    nodes.push(node);
    nodesById.set(String(id), node);

    if (type === "clipPath") return node;
    const localClips = [...inheritedClips];
    for (const childId of childIds) {
      const child = visit(childId, layer.id, worldMatrix, visible, alpha, localClips);
      if (child?.type === "clipPath" && child.visible) localClips.push(childId);
    }
    return node;
  };

  const rootClips: Array<string | number> = [];
  for (const rootId of roots) {
    const root = visit(rootId, null, IDENTITY_AFFINE, true, 1, rootClips);
    if (root?.type === "clipPath" && root.visible) rootClips.push(rootId);
  }
  return { roots, nodes, nodesById };
}

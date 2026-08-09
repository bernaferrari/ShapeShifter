import { createDocumentV2FromLegacy } from "../documentModel";
import { pathToString } from "../pathUtils";
import type { AnimationState, Layer, VectorMetadata } from "../types";

export function exportProjectJSON(
  layers: Layer[],
  vector: VectorMetadata = {
    id: "vector",
    name: "ShapeShifter",
    width: 24,
    height: 24,
    alpha: 1,
  },
  animation: AnimationState = {
    id: "anim",
    name: "anim",
    duration: 1000,
    blocks: [],
  },
  hiddenLayerIds: string[] = [],
  frames?: Array<{
    id: string;
    name: string;
    x: number;
    y: number;
    layers?: Layer[];
    vector?: VectorMetadata;
    animation?: AnimationState;
    hiddenLayerIds?: string[];
  }>,
  pageRoot?: {
    layers: Layer[];
    animation: AnimationState;
    hiddenLayerIds?: string[];
  },
) {
  const byParent = new Map<string, Layer[]>();
  for (const layer of layers) {
    const parentKey = layer.parentId == null ? "__root__" : String(layer.parentId);
    byParent.set(parentKey, [...(byParent.get(parentKey) ?? []), layer]);
  }

  const serializeLayer = (layer: Layer): Record<string, unknown> => {
    const base = {
      id: String(layer.id),
      name: layer.name,
      type: layer.type === "clipPath" ? "clipPath" : layer.type === "group" ? "group" : "path",
    };

    if (layer.type === "group") {
      return {
        ...base,
        rotation: layer.rotation ?? 0,
        scaleX: layer.scaleX ?? 1,
        scaleY: layer.scaleY ?? 1,
        pivotX: layer.pivotX ?? 0,
        pivotY: layer.pivotY ?? 0,
        translateX: layer.translateX ?? 0,
        translateY: layer.translateY ?? 0,
        children: (byParent.get(String(layer.id)) ?? []).map(serializeLayer),
      };
    }

    return {
      ...base,
      pathData: pathToString(layer.pathData ?? layer.from),
      fillColor: layer.fillColor ?? "",
      fillAlpha: layer.fillAlpha ?? 1,
      ...(layer.fillGradient ? { fillGradient: layer.fillGradient } : {}),
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
    };
  };

  const children = (byParent.get("__root__") ?? []).map(serializeLayer);

  const result: Record<string, unknown> = {
    version: 1,
    layers: {
      vectorLayer: {
        id: String(vector.id),
        name: vector.name,
        type: "vector",
        width: vector.width,
        height: vector.height,
        alpha: vector.alpha,
        children,
      },
      hiddenLayerIds,
    },
    timeline: {
      animation,
    },
  };

  // Freeform frames fidelity (kus/24t/37a): optional full spatial layout + per-frame snapshots for roundtrips
  if (frames && frames.length > 0) {
    result.frames = frames.map((f) => ({
      id: f.id,
      name: f.name,
      x: f.x ?? 0,
      y: f.y ?? 0,
      vector: f.vector,
      animation: f.animation,
      hiddenLayerIds: f.hiddenLayerIds ?? [],
      // serialize frame's layers if provided (for complete multi-artboard export)
      layers: f.layers
        ? (f.layers as Layer[]).map((l) => {
            // lightweight per-frame layer (reuse logic would duplicate; minimal: basic fields + pathData)
            return {
              id: String(l.id),
              name: l.name,
              type: l.type,
              pathData: pathToString(l.pathData ?? l.from),
              from: undefined, // prefer pathData in frame snapshots
              to: undefined,
              visible: l.visible,
              locked: l.locked,
              parentId: l.parentId,
              // transforms etc for fidelity
              translateX: l.translateX,
              translateY: l.translateY,
              scaleX: l.scaleX,
              scaleY: l.scaleY,
              rotation: l.rotation,
            };
          })
        : undefined,
    }));
  }

  if (pageRoot) {
    result.pageRoot = {
      animation: pageRoot.animation,
      hiddenLayerIds: pageRoot.hiddenLayerIds ?? [],
      layers: pageRoot.layers.map((layer) => ({
        ...layer,
        from: pathToString(layer.from),
        to: layer.to ? pathToString(layer.to) : undefined,
        pathData: pathToString(layer.pathData ?? layer.from),
      })),
    };
  }

  const root = pageRoot ?? { layers, animation, hiddenLayerIds };
  result.documentV2 = createDocumentV2FromLegacy({
    id: String(vector.id),
    name: vector.name || "ShapeShifter",
    rootLayers: root.layers,
    rootVector: vector,
    rootAnimation: root.animation,
    rootHiddenLayerIds: root.hiddenLayerIds ?? [],
    frames: (frames ?? []).map((frame) => ({
      id: frame.id,
      name: frame.name,
      x: frame.x,
      y: frame.y,
      layers: frame.layers ?? [],
      vector: frame.vector ?? {
        id: frame.id,
        name: frame.name,
        width: vector.width,
        height: vector.height,
        alpha: 1,
      },
      animation: frame.animation ?? {
        id: `${frame.id}-motion`,
        name: "Motion",
        duration: animation.duration,
        blocks: [],
      },
      hiddenLayerIds: frame.hiddenLayerIds ?? [],
    })),
  });

  return result as any; // preserve loose contract for existing tests + importers roundtrips (pre-existing unknown accesses)
}

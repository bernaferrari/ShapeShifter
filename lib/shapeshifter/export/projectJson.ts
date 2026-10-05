import { buildEditorDocument } from "../documentModel";
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
    vector?: VectorMetadata;
    animation: AnimationState;
    hiddenLayerIds?: string[];
  },
) {
  const root = pageRoot ?? { layers, vector, animation, hiddenLayerIds };
  const document = buildEditorDocument({
    id: String(vector.id),
    name: vector.name || "ShapeShifter",
    rootLayers: root.layers,
    rootVector: root.vector ?? vector,
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

  return { format: "shapeshifter" as const, document };
}

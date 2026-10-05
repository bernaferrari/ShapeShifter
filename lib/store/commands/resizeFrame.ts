import type { Rect } from "../../shapeshifter/camera";
import { createLayerTreeModel } from "../../shapeshifter/scene/layerHierarchy";
import {
  vectorCoordinateResizePatch,
  vectorCoordinateResizePolicy,
  type VectorCoordinateResizePolicy,
} from "../../shapeshifter/vectorSpace";
import type { CanvasFrame } from "../defaultWorkspace";

/** Change a frame's boundary while keeping its artwork in world space at every time. */
export function resizeFramePreservingArtwork(
  frame: CanvasFrame,
  bounds: Rect,
  policy: VectorCoordinateResizePolicy = vectorCoordinateResizePolicy(frame.vector),
): CanvasFrame {
  const dx = frame.x - bounds.x;
  const dy = frame.y - bounds.y;
  const roots = new Set(createLayerTreeModel(frame.layers).roots.map((layer) => String(layer.id)));
  const offset = dx !== 0 || dy !== 0;
  return {
    ...frame,
    x: bounds.x,
    y: bounds.y,
    vector: { ...frame.vector, ...vectorCoordinateResizePatch(bounds.w, bounds.h, policy) },
    layers: offset
      ? frame.layers.map((layer) =>
          roots.has(String(layer.id))
            ? {
                ...layer,
                translateX: (layer.translateX ?? 0) + dx,
                translateY: (layer.translateY ?? 0) + dy,
              }
            : layer,
        )
      : frame.layers,
    animation: offset
      ? {
          ...frame.animation,
          blocks: frame.animation.blocks.map((block) => {
            if (!roots.has(String(block.layerId))) return block;
            const delta =
              block.propertyName === "translateX"
                ? dx
                : block.propertyName === "translateY"
                  ? dy
                  : 0;
            if (!delta) return block;
            return {
              ...block,
              fromValue:
                typeof block.fromValue === "number" ? block.fromValue + delta : block.fromValue,
              toValue: typeof block.toValue === "number" ? block.toValue + delta : block.toValue,
            };
          }),
        }
      : frame.animation,
  };
}

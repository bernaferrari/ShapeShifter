import { createLayerTreeModel } from "../scene/layerHierarchy";
import { evaluateAndroidScene } from "../scene/evaluate";
import { resolveWorldLayerDraws } from "../scene/render";
import { getEvaluatedNodeBounds, unionRects } from "../scene/selection";
import type { AnimationState, Layer } from "../types";
import { KEYFRAME_TIME_EPSILON } from "./timelineKeyframes";

/** The next authored pose of selected objects, including inherited motion and animated clips. */
export function resolveNextPose(
  layers: Layer[],
  animation: AnimationState,
  selectedIds: Array<string | number>,
  time: number,
) {
  if (
    !Number.isFinite(time) ||
    !Number.isFinite(animation.duration) ||
    animation.duration <= 0 ||
    !selectedIds.length
  )
    return null;
  const tree = createLayerTreeModel(layers);
  const selected = new Set<string>();
  const visit = (layer: Layer) => {
    const id = String(layer.id);
    if (selected.has(id)) return;
    selected.add(id);
    tree.childrenOf(layer).forEach(visit);
  };
  for (const id of selectedIds) {
    const layer = tree.allLayers.find((item) => String(item.id) === String(id));
    if (layer) visit(layer);
  }
  if (!selected.size) return null;
  const dependencies = new Set(selected);
  const current = evaluateAndroidScene(layers, animation, time / animation.duration, true);
  for (const id of dependencies) {
    for (const ancestor of tree.ancestorsOf(id)) dependencies.add(String(ancestor.id));
    for (const clipId of current.nodesById.get(id)?.clipNodeIds ?? [])
      dependencies.add(String(clipId));
  }
  let next = Infinity;
  for (const block of animation.blocks) {
    if (!dependencies.has(String(block.layerId))) continue;
    for (const stop of [block.startTime, block.endTime]) {
      if (
        Number.isFinite(stop) &&
        stop > time + KEYFRAME_TIME_EPSILON &&
        stop <= animation.duration &&
        stop < next
      )
        next = stop;
    }
  }
  if (!Number.isFinite(next)) return null;
  const progress = next / animation.duration;
  const scene = evaluateAndroidScene(layers, animation, progress, true);
  const draws = resolveWorldLayerDraws(layers, animation, progress, true).filter(
    (draw) => draw.isClipPath || selected.has(String(draw.id)),
  );
  if (!draws.some((draw) => !draw.isClipPath && draw.d)) return null;
  const bounds = unionRects(
    selectedIds.flatMap((id) => {
      const rect = getEvaluatedNodeBounds(scene, id);
      return rect ? [rect] : [];
    }),
  );
  return { time: next, draws, bounds };
}

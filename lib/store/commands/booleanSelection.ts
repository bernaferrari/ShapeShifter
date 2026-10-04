import type { EditorState } from "../editorStore";
import type { BooleanOp } from "../../shapeshifter/path/booleanOperations";
import { booleanCombine } from "../../shapeshifter/path/booleanOperations";
import { createLayerTreeModel } from "../../shapeshifter/scene/layerHierarchy";
import { evaluateAndroidScene } from "../../shapeshifter/scene/evaluate";
import { inverseAffine, multiplyAffine } from "../../shapeshifter/scene/layerTransform";
import type { Layer } from "../../shapeshifter/types";

type BooleanSelectionState = Pick<
  EditorState,
  | "layers"
  | "animation"
  | "selectedLayerIds"
  | "selectedLayerRefs"
  | "selectedFrameId"
  | "hiddenLayerIds"
  | "isPlaying"
  | "historyGestureActive"
  | "dragState"
  | "isActionMode"
>;
function operands(state: BooleanSelectionState) {
  const refs = state.selectedLayerRefs.length
    ? state.selectedLayerRefs
    : state.selectedLayerIds.map((layerId) => ({ ownerId: state.selectedFrameId, layerId }));
  const ids = new Set(refs.map((ref) => String(ref.layerId)));
  const tree = createLayerTreeModel(state.layers);
  // Android sibling order is back-to-front. Subtraction always removes the
  // selected front paths from the selected back path, independent of click order.
  const layers = tree.allLayers.filter((layer) => ids.has(String(layer.id)));
  return { refs, ids, tree, layers };
}
export function booleanSelectionIssue(state: BooleanSelectionState): string | null {
  if (state.historyGestureActive || state.dragState || state.isPlaying || state.isActionMode)
    return "Finish the current edit and pause playback before combining paths.";
  const { refs, ids, tree, layers } = operands(state);
  if (ids.size < 2) return "Select at least two closed paths to combine.";
  if (refs.some((ref) => ref.ownerId !== state.selectedFrameId))
    return "Select paths in one frame to combine them.";
  if (layers.length !== ids.size) return "Select paths that are still in this frame.";
  const scene = evaluateAndroidScene(state.layers, state.animation, 0, false);
  let commands = 0;
  for (const layer of layers) {
    const ancestry = [layer, ...tree.ancestorsOf(layer.id)];
    if (layer.type !== "path") return "Choose path layers rather than groups or masks.";
    if ((layer.trimPathStart ?? 0) !== 0 || (layer.trimPathEnd ?? 1) !== 1)
      return "Reset the selected paths' trim before combining their filled areas.";
    if (ancestry.some((parent) => parent.locked))
      return "Unlock the selected paths and their containing groups.";
    if (
      ancestry.some(
        (parent) => parent.visible === false || state.hiddenLayerIds.includes(String(parent.id)),
      )
    )
      return "Show the selected paths and their containing groups.";
    if (
      ancestry.some(
        (parent) =>
          (parent.timeline?.length ?? 0) > 0 ||
          state.animation.blocks.some((block) => String(block.layerId) === String(parent.id)),
      ) ||
      layer.to
    )
      return "Choose static paths. Combining animated paths would replace their motion.";
    const node = scene.nodesById.get(String(layer.id))!;
    if (!inverseAffine(node.worldMatrix))
      return "Increase the selected paths' scale before combining them.";
    const parents = tree.ancestorsOf(layer.id).reverse();
    const inheritedMask = [null, ...parents].some((parent, index) => {
      const child = parents[index] ?? layer;
      const siblings = parent ? tree.childrenOf(parent) : tree.roots;
      return siblings
        .slice(
          0,
          siblings.findIndex((sibling) => String(sibling.id) === String(child.id)),
        )
        .some(
          (sibling) =>
            sibling.type === "clipPath" &&
            sibling.visible !== false &&
            !state.hiddenLayerIds.includes(String(sibling.id)),
        );
    });
    if (node.clipNodeIds.length || inheritedMask)
      return "Move paths out of masks before combining them.";
    if ((!node.fill && !node.fillGradient) || node.fillOpacity <= 0 || node.alpha <= 0)
      return "Choose closed paths with a visible fill. Stroke outlines are not combined.";
    const path = layer.pathData ?? layer.from;
    if (
      !path.subPaths.length ||
      path.subPaths.some(
        (contour) =>
          !contour.commands.some((command) => command.type !== "M" && command.type !== "Z") ||
          contour.commands.at(-1)?.type !== "Z",
      )
    )
      return "Close the selected paths before combining them.";
    const hasArea = path.subPaths.some((contour) => {
      if (
        contour.commands.some(
          (command) =>
            command.type === "A" &&
            command.arcParams &&
            command.arcParams.rx > 0 &&
            command.arcParams.ry > 0,
        )
      )
        return true;
      const points = contour.commands.flatMap((command) => command.points);
      const start = points[0]!;
      const end = points.find((point) => point.x !== start.x || point.y !== start.y);
      return (
        end &&
        points.some(
          (point) =>
            (end.x - start.x) * (point.y - start.y) - (end.y - start.y) * (point.x - start.x) !== 0,
        )
      );
    });
    if (!hasArea) return "A selected path has no filled area to combine.";
    commands += path.subPaths.reduce((sum, contour) => sum + contour.commands.length, 0);
  }
  if (commands > 5000) return "Select fewer paths, or simplify them before combining.";
  return null;
}

/** Capture filled areas in the retained back path's coordinate space. */
export async function combineBooleanSelection(
  state: BooleanSelectionState,
  operation: BooleanOp,
): Promise<{ layers: Layer[]; result: Layer; empty: boolean }> {
  const issue = booleanSelectionIssue(state);
  if (issue) throw new Error(issue);
  const { layers, tree } = operands(state);
  const scene = evaluateAndroidScene(state.layers, state.animation, 0, false);
  const base = layers[0]!;
  const inverseBase = inverseAffine(scene.nodesById.get(String(base.id))!.worldMatrix)!;
  let combined = structuredClone(base.pathData ?? base.from);
  let fillType = base.fillType ?? "nonZero";
  for (const layer of layers.slice(1)) {
    combined = await booleanCombine(operation, combined, layer.pathData ?? layer.from, {
      firstFillType: fillType,
      secondFillType: layer.fillType ?? "nonZero",
      secondMatrix: multiplyAffine(inverseBase, scene.nodesById.get(String(layer.id))!.worldMatrix),
    });
    fillType = "nonZero";
  }
  const result: Layer = {
    ...base,
    from: combined,
    pathData: combined,
    to: undefined,
    fillType: "nonZero",
    name: `${base.name} ${operation}`,
  };
  const consumedIds = new Set(layers.slice(1).map((layer) => String(layer.id)));
  const nextLayers = tree.allLayers
    .filter((layer) => !consumedIds.has(String(layer.id)))
    .map(({ children: _children, ...layer }) => ({
      ...(String(layer.id) === String(base.id) ? result : layer),
      parentId: tree.ancestorsOf(layer.id)[0]?.id ?? null,
    }));
  return { layers: nextLayers, result, empty: combined.subPaths.length === 0 };
}

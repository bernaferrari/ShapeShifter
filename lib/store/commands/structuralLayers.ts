import type { AnimationState, Layer } from "../../pathshift/types";
import { createLayerTreeModel } from "../../pathshift/scene/layerHierarchy";
import {
  IDENTITY_AFFINE,
  layerTransformToMatrix,
  multiplyAffine,
  type AffineMatrix,
} from "../../pathshift/scene/layerTransform";
import { generateId } from "../../pathshift/ids";

export type StructuralResult =
  | { ok: true; layers: Layer[]; selectedIds: Array<string | number> }
  | { ok: false; message: string };
export function flatHierarchy(layers: Layer[]): Layer[] {
  const tree = createLayerTreeModel(layers);
  return tree.allLayers.map(({ children: _children, ...layer }) => ({
    ...layer,
    parentId: tree.ancestorsOf(layer.id)[0]?.id ?? null,
  }));
}
export function structuralLockIssue(
  layers: Layer[],
  ids: Iterable<string | number>,
  descendants = true,
): string | null {
  const tree = createLayerTreeModel(layers);
  const selected = new Set([...ids].map(String));
  for (const layer of tree.allLayers) {
    const ancestors = tree.ancestorsOf(layer.id);
    if (selected.has(String(layer.id)) && (layer.locked || ancestors.some((a) => a.locked)))
      return "Unlock the selected layers and their containing groups first.";
    if (descendants && layer.locked && ancestors.some((a) => selected.has(String(a.id))))
      return "Unlock the locked contents of the selected group first.";
  }
  return null;
}
export function groupLayers(layers: Layer[], ids: Array<string | number>): StructuralResult {
  const tree = createLayerTreeModel(layers);
  const selected = new Set(ids.map(String));
  const roots = tree.allLayers.filter(
    (l) =>
      selected.has(String(l.id)) && !tree.ancestorsOf(l.id).some((a) => selected.has(String(a.id))),
  );
  if (!roots.length) return { ok: false, message: "Select layers to group." };
  const issue = structuralLockIssue(
    layers,
    roots.map((l) => l.id),
  );
  if (issue) return { ok: false, message: issue };
  const parentId = tree.ancestorsOf(roots[0]!.id)[0]?.id ?? null;
  if (roots.some((l) => (tree.ancestorsOf(l.id)[0]?.id ?? null) !== parentId))
    return {
      ok: false,
      message: "Select layers in the same group or artboard to preserve their appearance.",
    };
  const siblings =
    parentId == null ? tree.roots : tree.childrenOf(tree.allLayers.find((l) => l.id === parentId)!);
  const indices = roots.map((l) => siblings.indexOf(l));
  if (Math.max(...indices) - Math.min(...indices) + 1 !== roots.length)
    return {
      ok: false,
      message: "Select neighboring layers to group without changing stacking order.",
    };
  if (roots.some((l) => l.type === "clipPath"))
    return { ok: false, message: "Keep masks in their current container to preserve clipping." };
  const id = generateId();
  const rootIds = new Set(roots.map((l) => String(l.id)));
  const flat = flatHierarchy(layers);
  const group: Layer = {
    id,
    name: "Group",
    type: "group",
    from: { subPaths: [] },
    parentId,
    visible: true,
    locked: false,
    expanded: true,
  };
  const next = flat.map((l) => (rootIds.has(String(l.id)) ? { ...l, parentId: id } : l));
  next.splice(
    next.findIndex((l) => rootIds.has(String(l.id))),
    0,
    group,
  );
  return { ok: true, layers: next, selectedIds: [id] };
}
function identity(matrix: AffineMatrix) {
  return (Object.keys(matrix) as Array<keyof AffineMatrix>).every(
    (k) => Math.abs(matrix[k] - IDENTITY_AFFINE[k]) < 1e-9,
  );
}
function decompose(matrix: AffineMatrix): Partial<Layer> | null {
  const sx = Math.hypot(matrix.a, matrix.b);
  if (sx < 1e-9) return null;
  const sy = (matrix.a * matrix.d - matrix.b * matrix.c) / sx;
  if (
    Math.abs(matrix.a * matrix.c + matrix.b * matrix.d) >
    1e-8 * Math.max(1, sx * Math.hypot(matrix.c, matrix.d))
  )
    return null;
  return {
    translateX: matrix.e,
    translateY: matrix.f,
    rotation: (Math.atan2(matrix.b, matrix.a) * 180) / Math.PI,
    scaleX: sx,
    scaleY: sy,
    pivotX: 0,
    pivotY: 0,
  };
}
export function ungroupLayer(
  layers: Layer[],
  animation: AnimationState,
  hiddenIds: string[],
  id: string | number,
): StructuralResult {
  const tree = createLayerTreeModel(layers);
  const group = tree.allLayers.find((l) => String(l.id) === String(id));
  if (!group || group.type !== "group") return { ok: false, message: "Select a group to ungroup." };
  const issue = structuralLockIssue(layers, [id]);
  if (issue) return { ok: false, message: issue };
  const animated = (l: Layer) => animation.blocks.some((b) => String(b.layerId) === String(l.id));
  if (animated(group))
    return {
      ok: false,
      message: "This group is animated. Keep it grouped to preserve its motion.",
    };
  if ((group.alpha ?? 1) !== 1)
    return {
      ok: false,
      message: "This group uses shared opacity. Set group opacity to 100% before ungrouping.",
    };
  const children = tree.childrenOf(group);
  if (
    children.some(
      (l) => l.type === "clipPath" && l.visible !== false && !hiddenIds.includes(String(l.id)),
    )
  )
    return {
      ok: false,
      message: "This group contains a mask. Keep it grouped to preserve clipping.",
    };
  const matrix = layerTransformToMatrix(group);
  if (!identity(matrix) && children.some(animated))
    return {
      ok: false,
      message:
        "This transformed group has animated children. Keep it grouped to preserve every pose.",
    };
  const patches = new Map<string, Partial<Layer>>();
  for (const child of children) {
    const patch = identity(matrix)
      ? {}
      : decompose(multiplyAffine(matrix, layerTransformToMatrix(child)));
    if (!patch)
      return {
        ok: false,
        message:
          "Ungrouping would introduce an unsupported skew or collapsed transform. Keep this group to preserve the artwork.",
      };
    patches.set(String(child.id), {
      ...patch,
      parentId: tree.ancestorsOf(id)[0]?.id ?? null,
      ...(group.visible === false || hiddenIds.includes(String(id)) ? { visible: false } : {}),
    });
  }
  return {
    ok: true,
    layers: flatHierarchy(layers)
      .filter((l) => String(l.id) !== String(id))
      .map((l) => (patches.has(String(l.id)) ? { ...l, ...patches.get(String(l.id)) } : l)),
    selectedIds: children.map((l) => l.id),
  };
}

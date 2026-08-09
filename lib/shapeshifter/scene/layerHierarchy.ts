import type { Layer } from "../types";

export interface LayerPlacement {
  parentId: string | number | null;
  beforeId?: string | number;
  afterId?: string | number;
}

export interface LayerTreeModel {
  roots: Layer[];
  allLayers: Layer[];
  childrenOf: (layer: Layer) => Layer[];
  ancestorsOf: (id: string | number) => Layer[];
}

/**
 * Normalizes both supported hierarchy representations: flat parentId links and
 * embedded group children. Consumers should use this model rather than each
 * rebuilding a subtly different tree.
 */
export function createLayerTreeModel(layers: Layer[]): LayerTreeModel {
  const allLayers: Layer[] = [];
  const byId = new Map<string, Layer>();
  const parentById = new Map<string, string>();
  const childrenByParent = new Map<string, Layer[]>();

  const visit = (layer: Layer, embeddedParentId?: string) => {
    const id = String(layer.id);
    if (!byId.has(id)) {
      byId.set(id, layer);
      allLayers.push(layer);
    }
    const parentId =
      layer.parentId != null && layer.parentId !== "" ? String(layer.parentId) : embeddedParentId;
    if (parentId) parentById.set(id, parentId);
    for (const child of layer.children ?? []) visit(child, id);
  };
  for (const layer of layers) visit(layer);

  // Malformed imports must remain editable. Promote orphans and one member of
  // each parent cycle to the root instead of making the whole branch vanish.
  for (const [id, directParentId] of parentById) {
    if (!byId.has(directParentId) || directParentId === id) {
      parentById.delete(id);
      continue;
    }
    const seen = new Set([id]);
    let parentId: string | undefined = directParentId;
    while (parentId) {
      if (seen.has(parentId)) {
        parentById.delete(id);
        break;
      }
      seen.add(parentId);
      parentId = parentById.get(parentId);
    }
  }

  for (const layer of allLayers) {
    const parentId = parentById.get(String(layer.id));
    if (!parentId) continue;
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), layer]);
  }

  const childrenOf = (layer: Layer) => childrenByParent.get(String(layer.id)) ?? [];
  const roots = allLayers.filter((layer) => !parentById.has(String(layer.id)));
  const ancestorsOf = (id: string | number) => {
    const ancestors: Layer[] = [];
    const seen = new Set<string>();
    let parentId = parentById.get(String(id));
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      ancestors.push(parent);
      parentId = parentById.get(parentId);
    }
    return ancestors;
  };

  return { roots, allLayers, childrenOf, ancestorsOf };
}

export function collectLayerSubtreeIds(layers: Layer[], rootId: string | number) {
  const ids = new Set([String(rootId)]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const layer of layers) {
      if (layer.parentId != null && ids.has(String(layer.parentId)) && !ids.has(String(layer.id))) {
        ids.add(String(layer.id));
        changed = true;
      }
    }
  }
  return ids;
}

function lastSubtreeIndex(layers: Layer[], rootId: string | number) {
  const ids = collectLayerSubtreeIds(layers, rootId);
  return layers.reduce((last, layer, index) => (ids.has(String(layer.id)) ? index : last), -1);
}

/**
 * Reorder or reparent one flat layer subtree without losing its descendants.
 * Returns null for invalid cycles, locked sources, missing layers, and no-ops.
 */
export function placeLayerSubtree(
  layers: Layer[],
  id: string | number,
  placement: LayerPlacement,
): Layer[] | null {
  const movingRoot = layers.find((layer) => String(layer.id) === String(id));
  if (!movingRoot || movingRoot.locked) return null;

  const movingIds = collectLayerSubtreeIds(layers, id);
  if (placement.parentId != null && movingIds.has(String(placement.parentId))) return null;
  if (placement.beforeId != null && movingIds.has(String(placement.beforeId))) return null;
  if (placement.afterId != null && movingIds.has(String(placement.afterId))) return null;

  const moving = layers.filter((layer) => movingIds.has(String(layer.id)));
  const remaining = layers.filter((layer) => !movingIds.has(String(layer.id)));
  let insertionIndex = remaining.length;
  if (placement.beforeId != null) {
    const index = remaining.findIndex((layer) => String(layer.id) === String(placement.beforeId));
    if (index >= 0) insertionIndex = index;
  } else if (placement.afterId != null) {
    const index = lastSubtreeIndex(remaining, placement.afterId);
    if (index >= 0) insertionIndex = index + 1;
  } else if (placement.parentId != null) {
    const index = lastSubtreeIndex(remaining, placement.parentId);
    if (index >= 0) insertionIndex = index + 1;
  }

  const nextMoving = moving.map((layer) =>
    String(layer.id) === String(id) ? { ...layer, parentId: placement.parentId ?? null } : layer,
  );
  const next = [...remaining];
  next.splice(insertionIndex, 0, ...nextMoving);
  const unchanged = next.every(
    (layer, index) =>
      String(layer.id) === String(layers[index]?.id) &&
      (layer.parentId ?? null) === (layers[index]?.parentId ?? null),
  );
  return unchanged ? null : next;
}

import type { Layer } from "../types";
import type { OwnedLayerRef, SceneOwner, SceneRect } from "./selection";
import { unionOwnedLayerBounds } from "./selection";

export interface SharedValue<T> {
  value: T;
  mixed: boolean;
}

export interface InspectorSelectionBounds extends SceneRect {
  coordinateSpace: "owner" | "world";
}

export function resolveOwnedLayers(owners: SceneOwner[], refs: OwnedLayerRef[]): Layer[] {
  const ownersById = new Map(owners.map((owner) => [owner.ownerId, owner.layers]));
  const result: Layer[] = [];
  for (const ref of refs) {
    const layer = ownersById
      .get(ref.ownerId)
      ?.find((candidate) => String(candidate.id) === String(ref.layerId));
    if (layer) result.push(layer);
  }
  return result;
}

export function sharedValue<T>(
  layers: Layer[],
  read: (layer: Layer) => T,
  fallback: T,
): SharedValue<T> {
  if (layers.length === 0) return { value: fallback, mixed: false };
  const value = read(layers[0]!);
  return {
    value,
    mixed: layers.slice(1).some((layer) => !Object.is(read(layer), value)),
  };
}

export function getInspectorSelectionBounds(
  owners: SceneOwner[],
  refs: OwnedLayerRef[],
): InspectorSelectionBounds | null {
  const bounds = unionOwnedLayerBounds(owners, refs);
  if (!bounds) return null;
  const ownerIds = new Set(refs.map((ref) => ref.ownerId));
  if (ownerIds.size !== 1) return { ...bounds, coordinateSpace: "world" };
  const owner = owners.find((candidate) => candidate.ownerId === refs[0]?.ownerId);
  if (!owner) return { ...bounds, coordinateSpace: "world" };
  return {
    ...bounds,
    x: bounds.x - owner.origin.x,
    y: bounds.y - owner.origin.y,
    coordinateSpace: "owner",
  };
}

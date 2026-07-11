import type { Layer } from "../types";
import { getPathDataBounds } from "../pathUtils";

export interface SceneRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SceneOwner {
  ownerId: string;
  origin: { x: number; y: number };
  layers: Layer[];
}

export interface OwnedLayerRef {
  ownerId: string;
  layerId: string | number;
}

export interface OwnedLayerBounds extends OwnedLayerRef {
  bounds: SceneRect;
}

export function getOwnedLayerBounds(owner: SceneOwner): OwnedLayerBounds[] {
  const result: OwnedLayerBounds[] = [];
  for (const layer of owner.layers) {
    if (layer.visible === false || layer.locked || layer.type === "group") continue;
    const path = layer.pathData ?? layer.from;
    if (!path) continue;
    const bounds = getPathDataBounds(path);
    if (!bounds) continue;
    result.push({
      ownerId: owner.ownerId,
      layerId: layer.id,
      bounds: {
        x: owner.origin.x + bounds.x + (Number(layer.translateX) || 0),
        y: owner.origin.y + bounds.y + (Number(layer.translateY) || 0),
        w: bounds.w,
        h: bounds.h,
      },
    });
  }
  return result;
}

export function collectOwnedLayersInRect(
  owners: SceneOwner[],
  rect: SceneRect,
): OwnedLayerRef[] {
  const right = rect.x + rect.w;
  const bottom = rect.y + rect.h;
  const hits: OwnedLayerRef[] = [];
  for (const owner of owners) {
    for (const item of getOwnedLayerBounds(owner)) {
      const bounds = item.bounds;
      if (
        bounds.x + bounds.w < rect.x ||
        bounds.x > right ||
        bounds.y + bounds.h < rect.y ||
        bounds.y > bottom
      ) {
        continue;
      }
      hits.push({ ownerId: item.ownerId, layerId: item.layerId });
    }
  }
  return hits;
}

export function unionOwnedLayerBounds(
  owners: SceneOwner[],
  refs: OwnedLayerRef[],
): SceneRect | null {
  const selected = new Set(refs.map((ref) => `${ref.ownerId}:${String(ref.layerId)}`));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const owner of owners) {
    for (const item of getOwnedLayerBounds(owner)) {
      if (!selected.has(`${item.ownerId}:${String(item.layerId)}`)) continue;
      minX = Math.min(minX, item.bounds.x);
      minY = Math.min(minY, item.bounds.y);
      maxX = Math.max(maxX, item.bounds.x + item.bounds.w);
      maxY = Math.max(maxY, item.bounds.y + item.bounds.h);
    }
  }
  return Number.isFinite(minX)
    ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
    : null;
}

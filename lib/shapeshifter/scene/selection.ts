import { getAccuratePathBounds } from "../pathUtils";
import type { AnimationState, Layer } from "../types";
import { evaluateAndroidScene } from "./evaluate";
import { transformPointWithMatrix } from "./layerTransform";

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
  animation?: AnimationState;
  progress?: number;
  usePlayhead?: boolean;
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
  const animation = owner.animation ?? { id: "static", name: "Static", duration: 1, blocks: [] };
  const scene = evaluateAndroidScene(
    owner.layers,
    animation,
    owner.progress ?? 0,
    owner.usePlayhead ?? false,
  );
  for (const node of scene.nodes) {
    if (!node.visible || node.locked || node.type !== "path" || !node.path) continue;
    const local = getAccuratePathBounds(node.path);
    if (!local) continue;
    // Transform the local AABB corners: an axis-aligned box under a rotated/skewed
    // world matrix is only bounded by the transformed corners, not by any single edge.
    const corners = [
      { x: local.x, y: local.y },
      { x: local.x + local.w, y: local.y },
      { x: local.x + local.w, y: local.y + local.h },
      { x: local.x, y: local.y + local.h },
    ].map((point) => transformPointWithMatrix(point, node.worldMatrix));
    const xs = corners.map((point) => point.x);
    const ys = corners.map((point) => point.y);
    const maxScale = Math.max(
      Math.hypot(node.worldMatrix.a, node.worldMatrix.b),
      Math.hypot(node.worldMatrix.c, node.worldMatrix.d),
    );
    const strokeInset = node.stroke && node.strokeWidth > 0 ? (node.strokeWidth * maxScale) / 2 : 0;
    result.push({
      ownerId: owner.ownerId,
      layerId: node.id,
      bounds: {
        x: owner.origin.x + Math.min(...xs) - strokeInset,
        y: owner.origin.y + Math.min(...ys) - strokeInset,
        w: Math.max(0.01, Math.max(...xs) - Math.min(...xs) + strokeInset * 2),
        h: Math.max(0.01, Math.max(...ys) - Math.min(...ys) + strokeInset * 2),
      },
    });
  }
  return result;
}

export function collectOwnedLayersInRect(owners: SceneOwner[], rect: SceneRect): OwnedLayerRef[] {
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
  const ownerIdsWithSelection = new Set(refs.map((ref) => ref.ownerId));
  for (const owner of owners) {
    // Evaluating an owner's scene is expensive (full tree walk + bounds); owners that
    // cannot contribute a selected layer are skipped entirely rather than evaluated
    // and filtered per node.
    if (!ownerIdsWithSelection.has(owner.ownerId)) continue;
    for (const item of getOwnedLayerBounds(owner)) {
      if (!selected.has(`${item.ownerId}:${String(item.layerId)}`)) continue;
      minX = Math.min(minX, item.bounds.x);
      minY = Math.min(minY, item.bounds.y);
      maxX = Math.max(maxX, item.bounds.x + item.bounds.w);
      maxY = Math.max(maxY, item.bounds.y + item.bounds.h);
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}

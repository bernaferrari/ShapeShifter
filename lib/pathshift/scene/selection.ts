import { getAccuratePathBounds } from "../pathUtils";
import type { AnimationState, Layer } from "../types";
import { evaluateAndroidScene, type EvaluatedScene } from "./evaluate";
import {
  IDENTITY_AFFINE,
  multiplyAffine,
  transformPointWithMatrix,
  type AffineMatrix,
} from "./layerTransform";

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

/** Visible geometry for one node (including group descendants), in the requested space. */
export function getEvaluatedNodeBounds(
  scene: EvaluatedScene,
  id: string | number,
  ownerToSpace: AffineMatrix = IDENTITY_AFFINE,
): SceneRect | null {
  const node = scene.nodesById.get(String(id));
  if (!node?.visible) return null;
  if (node.type === "group") {
    const bounds = node.childIds.flatMap((childId) => {
      const child = scene.nodesById.get(String(childId));
      if (child?.type === "clipPath") return [];
      const rect = getEvaluatedNodeBounds(scene, childId, ownerToSpace);
      return rect ? [rect] : [];
    });
    return unionRects(bounds);
  }
  if (!node.path) return null;
  const local = getAccuratePathBounds(node.path);
  if (!local) return null;
  const matrix = multiplyAffine(ownerToSpace, node.worldMatrix);
  const corners = [
    { x: local.x, y: local.y },
    { x: local.x + local.w, y: local.y },
    { x: local.x + local.w, y: local.y + local.h },
    { x: local.x, y: local.y + local.h },
  ].map((point) => transformPointWithMatrix(point, matrix));
  const xs = corners.map((point) => point.x);
  const ys = corners.map((point) => point.y);
  const strokeRadius = node.stroke && node.strokeWidth > 0 ? node.strokeWidth / 2 : 0;
  // A native stroke becomes an ellipse under an anisotropic parent. Each
  // matrix row gives its extent on that axis, including inherited shear.
  const insetX = strokeRadius * Math.hypot(matrix.a, matrix.c);
  const insetY = strokeRadius * Math.hypot(matrix.b, matrix.d);
  return {
    x: Math.min(...xs) - insetX,
    y: Math.min(...ys) - insetY,
    w: Math.max(0.01, Math.max(...xs) - Math.min(...xs) + insetX * 2),
    h: Math.max(0.01, Math.max(...ys) - Math.min(...ys) + insetY * 2),
  };
}

export function unionRects(rects: SceneRect[]): SceneRect | null {
  if (!rects.length) return null;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    x,
    y,
    w: Math.max(...rects.map((rect) => rect.x + rect.w)) - x,
    h: Math.max(...rects.map((rect) => rect.y + rect.h)) - y,
  };
}

export function getOwnedLayerBounds(
  owner: SceneOwner,
  { includeGroups = false, includeLocked = false } = {},
): OwnedLayerBounds[] {
  const result: OwnedLayerBounds[] = [];
  const animation = owner.animation ?? { id: "static", name: "Static", duration: 1, blocks: [] };
  const scene = evaluateAndroidScene(
    owner.layers,
    animation,
    owner.progress ?? 0,
    owner.usePlayhead ?? false,
  );
  const lockedById = new Map<string, boolean>();
  const isLocked = (id: string | number): boolean => {
    const cached = lockedById.get(String(id));
    if (cached !== undefined) return cached;
    const node = scene.nodesById.get(String(id));
    const locked = Boolean(node?.locked || (node?.parentId != null && isLocked(node.parentId)));
    lockedById.set(String(id), locked);
    return locked;
  };
  for (const node of scene.nodes) {
    if (
      !node.visible ||
      (!includeLocked && isLocked(node.id)) ||
      (node.type !== "path" && !(includeGroups && node.type === "group"))
    )
      continue;
    const bounds = getEvaluatedNodeBounds(scene, node.id);
    if (!bounds) continue;
    result.push({
      ownerId: owner.ownerId,
      layerId: node.id,
      bounds: {
        ...bounds,
        x: owner.origin.x + bounds.x,
        y: owner.origin.y + bounds.y,
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
    const selected = new Set(
      refs.filter((ref) => ref.ownerId === owner.ownerId).map((ref) => String(ref.layerId)),
    );
    const scene = evaluateAndroidScene(
      owner.layers,
      owner.animation ?? { id: "static", name: "Static", duration: 1, blocks: [] },
      owner.progress ?? 0,
      owner.usePlayhead ?? false,
    );
    for (const id of selected) {
      const node = scene.nodesById.get(id);
      if (!node || node.type === "clipPath") continue;
      // A selected ancestor already covers this branch. Bound only selected
      // roots so a deep group tree stays linear during drag/playhead updates.
      let parentId = node.parentId;
      let selectedAncestor = false;
      while (parentId != null) {
        if (selected.has(String(parentId))) {
          selectedAncestor = true;
          break;
        }
        parentId = scene.nodesById.get(String(parentId))?.parentId ?? null;
      }
      if (selectedAncestor) continue;
      const bounds = getEvaluatedNodeBounds(scene, id);
      if (!bounds) continue;
      const x = owner.origin.x + bounds.x;
      const y = owner.origin.y + bounds.y;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + bounds.w);
      maxY = Math.max(maxY, y + bounds.h);
    }
  }
  return Number.isFinite(minX) ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
}

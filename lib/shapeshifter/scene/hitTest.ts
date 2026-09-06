import { distanceToPath, isPointInPath } from "../pathUtils";
import type { AnimationState } from "../types";
import { evaluateAndroidScene } from "./evaluate";
import { inverseAffine, transformPointWithMatrix } from "./layerTransform";
import type { OwnedLayerRef, SceneOwner } from "./selection";

function staticAnimation(): AnimationState {
  return { id: "static", name: "Static", duration: 1, blocks: [] };
}

function minimumScale(matrix: { a: number; b: number; c: number; d: number }) {
  return Math.max(1e-6, Math.min(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)));
}

/** Hit the visible, evaluated Android scene in explicit topmost-first owner order. */
export function hitTestOwnedLayers(
  ownersTopmostFirst: SceneOwner[],
  point: { x: number; y: number },
  strokeTolerance: number,
): OwnedLayerRef | null {
  for (const owner of ownersTopmostFirst) {
    const ownerPoint = { x: point.x - owner.origin.x, y: point.y - owner.origin.y };
    const scene = evaluateAndroidScene(
      owner.layers,
      owner.animation ?? staticAnimation(),
      owner.progress ?? 0,
      owner.usePlayhead ?? false,
    );
    for (const node of [...scene.nodes].reverse()) {
      if (!node.visible || node.locked || node.alpha <= 0 || node.type !== "path" || !node.path)
        continue;

      let clipped = false;
      for (const clipId of node.clipNodeIds) {
        const clip = scene.nodesById.get(String(clipId));
        const inverseClip = clip ? inverseAffine(clip.worldMatrix) : null;
        if (
          !clip?.path ||
          !inverseClip ||
          !isPointInPath(transformPointWithMatrix(ownerPoint, inverseClip), clip.path)
        ) {
          clipped = true;
          break;
        }
      }
      if (clipped) continue;

      const inverse = inverseAffine(node.worldMatrix);
      if (!inverse) continue;
      const local = transformPointWithMatrix(ownerPoint, inverse);
      const hasFill = Boolean(node.fill || node.fillGradient);
      if (hasFill && isPointInPath(local, node.path, node.fillType ?? "nonZero")) {
        return { ownerId: owner.ownerId, layerId: node.id };
      }
      if (node.stroke && node.strokeWidth > 0) {
        const tolerance = (strokeTolerance + node.strokeWidth / 2) / minimumScale(node.worldMatrix);
        if (distanceToPath(local, node.path) <= tolerance) {
          return { ownerId: owner.ownerId, layerId: node.id };
        }
      }
    }
  }
  return null;
}

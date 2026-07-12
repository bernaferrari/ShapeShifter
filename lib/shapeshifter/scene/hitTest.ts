import { isPointInFillRegion } from "../pathUtils";
import type { PathData } from "../types";
import type { OwnedLayerRef, SceneOwner } from "./selection";
import { inverseTransformLayerPoint } from "./layerTransform";

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSquared = abx * abx + aby * aby;
  if (lengthSquared < 1e-12) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSquared));
  return Math.hypot(px - (ax + t * abx), py - (ay + t * aby));
}

/**
 * Hit the first owner/layer in explicit topmost-first order.
 * Fill and open-stroke paths share the same world-to-owner transform policy.
 */
export function hitTestOwnedLayers(
  ownersTopmostFirst: SceneOwner[],
  point: { x: number; y: number },
  strokeTolerance: number,
): OwnedLayerRef | null {
  for (const owner of ownersTopmostFirst) {
    const ownerPoint = {
      x: point.x - owner.origin.x,
      y: point.y - owner.origin.y,
    };
    const layers = [...owner.layers].reverse();
    for (const layer of layers) {
      if (
        layer.visible === false ||
        layer.locked ||
        (layer.type !== "path" && layer.type !== "clipPath" && !layer.from && !layer.pathData)
      ) {
        continue;
      }
      const path: PathData = layer.pathData ?? layer.from;
      if (!path?.subPaths?.length) continue;
      const local = inverseTransformLayerPoint(ownerPoint, layer);
      if (!local) continue;
      const minScale = Math.max(
        1e-6,
        Math.min(Math.abs(layer.scaleX ?? 1), Math.abs(layer.scaleY ?? 1)),
      );
      const localStrokeTolerance = strokeTolerance / minScale;
      const hasFill = Boolean(
        layer.fillColor && layer.fillColor !== "none" && layer.fillColor !== "",
      );
      if (hasFill && isPointInFillRegion(local, path)) {
        return { ownerId: owner.ownerId, layerId: layer.id };
      }

      let nearStroke = false;
      for (const subPath of path.subPaths) {
        let previous: { x: number; y: number } | null = null;
        for (const command of subPath.commands) {
          const points = command.points ?? [];
          if (points.length === 0) continue;
          const end = points[points.length - 1];
          for (const candidate of points) {
            if (Math.hypot(local.x - candidate.x, local.y - candidate.y) <= localStrokeTolerance) {
              nearStroke = true;
              break;
            }
          }
          if (nearStroke) break;
          if (
            previous &&
            distanceToSegment(local.x, local.y, previous.x, previous.y, end.x, end.y) <=
              localStrokeTolerance
          ) {
            nearStroke = true;
            break;
          }
          if (points.length >= 3 && previous) {
            for (let index = 0; index < points.length - 1; index++) {
              if (
                distanceToSegment(
                  local.x,
                  local.y,
                  points[index].x,
                  points[index].y,
                  points[index + 1].x,
                  points[index + 1].y,
                ) <= localStrokeTolerance
              ) {
                nearStroke = true;
                break;
              }
            }
          }
          if (nearStroke) break;
          previous = end;
        }
        if (nearStroke) break;
      }
      if (nearStroke) return { ownerId: owner.ownerId, layerId: layer.id };
      if (!hasFill && isPointInFillRegion(local, path)) {
        return { ownerId: owner.ownerId, layerId: layer.id };
      }
    }
  }
  return null;
}

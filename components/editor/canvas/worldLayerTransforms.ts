import { snapValueToStep } from "@/lib/shapeshifter/camera";
import type { Layer, Point } from "@/lib/shapeshifter/types";
import type { LayerResizeSession, LayerRotateSession } from "./WorldSelectionOverlay";

export interface ResizeModifiers {
  preserveAspect: boolean;
  snapStep?: number;
  minSize: number;
}

export interface ResizeTarget {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function rotationDelta(
  session: LayerRotateSession,
  pointer: Point,
  constrainTo15Degrees: boolean,
): number {
  const angle =
    (Math.atan2(pointer.y - session.center.y, pointer.x - session.center.x) * 180) / Math.PI;
  const delta = angle - session.startAngle;
  return constrainTo15Degrees ? Math.round(delta / 15) * 15 : delta;
}

export function applyLayerRotation(
  layers: Layer[],
  session: LayerRotateSession,
  delta: number,
): Layer[] {
  const baseTransforms = new Map(
    session.baseTransforms.map((candidate) => [String(candidate.id), candidate]),
  );
  const center = {
    x: session.center.x - session.ownerOrigin.x,
    y: session.center.y - session.ownerOrigin.y,
  };
  const radians = (delta * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const rotateAroundSelection = (point: Point) => ({
    x: center.x + (point.x - center.x) * cos - (point.y - center.y) * sin,
    y: center.y + (point.x - center.x) * sin + (point.y - center.y) * cos,
  });
  return layers.map((layer) => {
    const base = baseTransforms.get(String(layer.id));
    if (!base || layer.locked) return layer;
    // M = T(translate) T(pivot) R T(-pivot). Rotate the complete frozen
    // matrix around the displayed selection center, then solve its translation
    // back against the existing pivot. This keeps multi-selection spacing intact.
    const priorTranslation = {
      x: base.translateX + base.pivotX - rotatePoint(base.pivotX, base.pivotY, base.rotation).x,
      y: base.translateY + base.pivotY - rotatePoint(base.pivotX, base.pivotY, base.rotation).y,
    };
    const desiredTranslation = rotateAroundSelection(priorTranslation);
    const nextRotation = base.rotation + delta;
    const nextPivotRotation = rotatePoint(base.pivotX, base.pivotY, nextRotation);
    return {
      ...layer,
      rotation: nextRotation,
      translateX: desiredTranslation.x - base.pivotX + nextPivotRotation.x,
      translateY: desiredTranslation.y - base.pivotY + nextPivotRotation.y,
    };
  });
}

function rotatePoint(x: number, y: number, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

export function computeLayerResizeTarget(
  session: LayerResizeSession,
  pointer: Point,
  ownerOrigin: Point,
  { preserveAspect, snapStep, minSize }: ResizeModifiers,
): ResizeTarget {
  const original = session.origin;
  const localX = pointer.x - ownerOrigin.x - session.grabOffset.x;
  const localY = pointer.y - ownerOrigin.y - session.grabOffset.y;
  const originalRight = original.x + original.w;
  const originalBottom = original.y + original.h;
  const handle = session.handle;
  let x = original.x;
  let y = original.y;
  let width = original.w;
  let height = original.h;

  if (handle.includes("e")) width = Math.max(minSize, localX - original.x);
  if (handle.includes("s")) height = Math.max(minSize, localY - original.y);
  if (handle.includes("w")) {
    x = Math.min(localX, originalRight - minSize);
    width = originalRight - x;
  }
  if (handle.includes("n")) {
    y = Math.min(localY, originalBottom - minSize);
    height = originalBottom - y;
  }

  if (preserveAspect && original.w > 1e-6 && original.h > 1e-6) {
    const aspect = original.w / original.h;
    const corner = handle === "nw" || handle === "ne" || handle === "sw" || handle === "se";
    if (corner) {
      if (width / Math.max(height, minSize) > aspect) height = width / aspect;
      else width = height * aspect;
      if (handle.includes("w")) x = originalRight - width;
      if (handle.includes("n")) y = originalBottom - height;
    } else if (handle === "e" || handle === "w") {
      height = width / aspect;
      y = original.y + (original.h - height) / 2;
    } else {
      width = height * aspect;
      x = original.x + (original.w - width) / 2;
    }
  }

  if (snapStep != null) {
    x = snapValueToStep(x, snapStep);
    y = snapValueToStep(y, snapStep);
    width = Math.max(minSize, snapValueToStep(width, snapStep));
    height = Math.max(minSize, snapValueToStep(height, snapStep));
    if (handle.includes("w")) x = originalRight - width;
    if (handle.includes("n")) y = originalBottom - height;
  }

  return { x, y, width, height };
}

export function applyLayerResize(
  layers: Layer[],
  session: LayerResizeSession,
  target: ResizeTarget,
): Layer[] {
  const original = session.origin;
  const scaleX = target.width / Math.max(0.001, original.w);
  const scaleY = target.height / Math.max(0.001, original.h);

  return layers.map((layer) => {
    const item = session.items.find((candidate) => String(candidate.id) === String(layer.id));
    if (!item) return layer;
    const pathBounds = item.origin;
    const frameBounds = item.frameOrigin ?? {
      x: pathBounds.x + (item.baseTranslate?.x ?? 0),
      y: pathBounds.y + (item.baseTranslate?.y ?? 0),
      w: pathBounds.w,
      h: pathBounds.h,
    };
    const nextFrameX = target.x + (frameBounds.x - original.x) * scaleX;
    const nextFrameY = target.y + (frameBounds.y - original.y) * scaleY;
    // AVD supports group scale natively. Keeping path endpoints untouched makes
    // a resize reversible, preserves morph compatibility, and lets it be keyed
    // at the playhead just like a translation or rotation.
    return {
      ...layer,
      scaleX,
      scaleY,
      pivotX: pathBounds.x,
      pivotY: pathBounds.y,
      translateX: nextFrameX - pathBounds.x,
      translateY: nextFrameY - pathBounds.y,
    };
  });
}

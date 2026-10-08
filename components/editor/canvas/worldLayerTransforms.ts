import { snapValueToStep } from "@/lib/pathshift/camera";
import type { AnimationState, Layer, Point } from "@/lib/pathshift/types";
import { evaluateAndroidScene, type EvaluatedTransform } from "@/lib/pathshift/scene/evaluate";
import { getEvaluatedNodeBounds, unionRects } from "@/lib/pathshift/scene/selection";
import { createLayerTreeModel } from "@/lib/pathshift/scene/layerHierarchy";
import {
  recordTranslationAtProgress,
  type NumericLayerProperty,
} from "@/lib/pathshift/motion/recordTranslation";
import {
  IDENTITY_AFFINE,
  inverseAffine,
  multiplyAffine,
  rotateAffine,
  scaleAffine,
  transformPointWithMatrix,
  translateAffine,
  type AffineMatrix,
} from "@/lib/pathshift/scene/layerTransform";
import type {
  FrozenLayerTransform,
  LayerResizeSession,
  LayerRotateSession,
} from "./WorldSelectionOverlay";

const STATIC_ANIMATION: AnimationState = { id: "static", name: "Static", duration: 1, blocks: [] };
const EPSILON = 1e-8;
type WorldTransformProperty = Extract<NumericLayerProperty, keyof EvaluatedTransform>;

/** Frozen evaluated roots: selecting a group and its child never transforms the child twice. */
export function buildWorldTransformSelection(
  layers: Layer[],
  ids: Array<string | number>,
  animation = STATIC_ANIMATION,
  progress = 0,
) {
  const scene = evaluateAndroidScene(layers, animation, progress, true);
  const selected = new Set(ids.map(String));
  const ancestors = (id: string | number) => {
    const result = [];
    let parentId = scene.nodesById.get(String(id))?.parentId;
    while (parentId != null) {
      const parent = scene.nodesById.get(String(parentId));
      if (!parent) break;
      result.push(parent);
      parentId = parent.parentId;
    }
    return result;
  };
  const roots = scene.nodes.filter(
    (node) =>
      selected.has(String(node.id)) &&
      node.visible &&
      !ancestors(node.id).some((parent) => selected.has(String(parent.id))) &&
      getEvaluatedNodeBounds(scene, node.id),
  );
  if (!roots.length) return null;
  const parentMatrix = (id: string | number | null) =>
    id == null
      ? IDENTITY_AFFINE
      : (scene.nodesById.get(String(id))?.worldMatrix ?? IDENTITY_AFFINE);
  const commonParent = roots.every((node) => String(node.parentId) === String(roots[0]!.parentId));
  let coordinateMatrix =
    roots.length === 1 && inverseAffine(roots[0]!.worldMatrix)
      ? roots[0]!.worldMatrix
      : commonParent
        ? multiplyAffine(
            parentMatrix(roots[0]!.parentId),
            rotateAffine(roots[0]!.transform.rotation),
          )
        : IDENTITY_AFFINE;
  if (!inverseAffine(coordinateMatrix)) coordinateMatrix = IDENTITY_AFFINE;
  const inverse = inverseAffine(coordinateMatrix)!;
  const bounds = unionRects(
    roots.flatMap((node) => {
      const rect = getEvaluatedNodeBounds(scene, node.id, inverse);
      return rect ? [rect] : [];
    }),
  );
  if (!bounds) return null;
  const items = roots.flatMap((node) => {
    const parent = parentMatrix(node.parentId);
    const nodeInverse = inverseAffine(node.worldMatrix);
    const localBounds = nodeInverse && getEvaluatedNodeBounds(scene, node.id, nodeInverse);
    if (
      node.locked ||
      ancestors(node.id).some((ancestor) => ancestor.locked) ||
      !localBounds ||
      !inverseAffine(parent)
    )
      return [];
    const evaluated: FrozenLayerTransform = {
      id: node.id,
      transform: node.transform,
      worldMatrix: node.worldMatrix,
      parentMatrix: parent,
    };
    return [{ node, localBounds, evaluated }];
  });
  // R/S/T cannot encode shear. Mixed rotations or different parent spaces
  // therefore resize proportionally instead of silently distorting their matrices.
  const preserveAspect =
    roots.length > 1 &&
    (!commonParent ||
      roots.some(
        (node) =>
          Math.abs(
            Math.sin(((node.transform.rotation - roots[0]!.transform.rotation) * Math.PI) / 90),
          ) > 1e-7,
      ));
  const rotationMatrix = commonParent ? parentMatrix(roots[0]!.parentId) : IDENTITY_AFFINE;
  const canRotate =
    items.length > 0 &&
    (commonParent || items.every(({ evaluated }) => isConformal(evaluated.parentMatrix)));
  return { bounds, coordinateMatrix, rotationMatrix, preserveAspect, canRotate, items };
}

function isConformal(matrix: AffineMatrix) {
  const x = Math.hypot(matrix.a, matrix.b);
  const y = Math.hypot(matrix.c, matrix.d);
  return (
    x > EPSILON &&
    Math.abs(x - y) < 1e-7 * Math.max(x, y) &&
    Math.abs(matrix.a * matrix.c + matrix.b * matrix.d) < 1e-7 * x * y
  );
}

function matrixPatch(matrix: AffineMatrix, base: EvaluatedTransform): Partial<Layer> | null {
  const length = Math.hypot(matrix.a, matrix.b);
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (length < EPSILON || Math.abs(determinant) < EPSILON) return null;
  const scaleX = length * (base.scaleX < 0 ? -1 : 1);
  const scaleY = determinant / scaleX;
  if (Math.abs(matrix.a * matrix.c + matrix.b * matrix.d) > 1e-6 * Math.abs(scaleX * scaleY))
    return null;
  const angle = (Math.atan2(matrix.b / scaleX, matrix.a / scaleX) * 180) / Math.PI;
  const rotation = base.rotation + normalizedAngle(angle - base.rotation);
  return {
    rotation,
    scaleX,
    scaleY,
    pivotX: base.pivotX,
    pivotY: base.pivotY,
    translateX: matrix.e - base.pivotX + matrix.a * base.pivotX + matrix.c * base.pivotY,
    translateY: matrix.f - base.pivotY + matrix.b * base.pivotX + matrix.d * base.pivotY,
  };
}

function mapLayerPatches(layers: Layer[], patches: Map<string, Partial<Layer>>): Layer[] {
  if (!patches.size) return layers;
  const result = layers.map((layer) => {
    const patch = layer.locked ? undefined : patches.get(String(layer.id));
    const children = layer.children?.length
      ? mapLayerPatches(layer.children, patches)
      : layer.children;
    return patch || children !== layer.children
      ? { ...layer, ...patch, ...(children ? { children } : {}) }
      : layer;
  });
  return result.some((layer, index) => layer !== layers[index]) ? result : layers;
}

/** Includes drawable descendants of movable selected roots, without moving a child twice. */
export function selectedWorldSubtreeIds(layers: Layer[], ids: Array<string | number>) {
  if (!ids.length) return new Set<string>();
  const tree = createLayerTreeModel(layers);
  const selected = new Set(ids.map(String));
  const roots = new Set(
    tree.allLayers
      .filter(
        (layer) =>
          selected.has(String(layer.id)) &&
          !layer.locked &&
          !tree
            .ancestorsOf(layer.id)
            .some((parent) => parent.locked || selected.has(String(parent.id))),
      )
      .map((layer) => String(layer.id)),
  );
  if (!roots.size) return roots;
  return new Set(
    tree.allLayers
      .filter(
        (layer) =>
          roots.has(String(layer.id)) ||
          tree.ancestorsOf(layer.id).some((parent) => roots.has(String(parent.id))),
      )
      .map((layer) => String(layer.id)),
  );
}

export function applyWorldLayerTranslation(
  layers: Layer[],
  items: FrozenLayerTransform[],
  delta: Point,
) {
  const change = translateAffine(delta.x, delta.y);
  const patches = new Map<string, Partial<Layer>>();
  for (const item of items) {
    const patch = evaluatedPatch(item, change);
    if (patch) patches.set(String(item.id), patch);
  }
  return mapLayerPatches(layers, patches);
}

/** Keep the resting pose and morph geometry intact while previewing a keyed gesture. */
export function recordWorldTransformChange(
  originalLayers: Layer[],
  transformedLayers: Layer[],
  originalAnimation: AnimationState,
  progress: number,
  ids: Array<string | number>,
  properties: WorldTransformProperty[],
  idSeed: number,
) {
  const scene = evaluateAndroidScene(originalLayers, originalAnimation, progress, true);
  const transformed = new Map(
    createLayerTreeModel(transformedLayers).allLayers.map((layer) => [String(layer.id), layer]),
  );
  let animation = originalAnimation;
  const patches = new Map<string, Partial<Layer>>();
  for (const id of ids) {
    const node = scene.nodesById.get(String(id));
    const changed = transformed.get(String(id));
    if (!node || !changed) continue;
    const channels = properties.filter((property) => {
      const value = changed[property];
      return typeof value === "number" && Math.abs(value - node.transform[property]) > 1e-7;
    });
    if (!channels.length) continue;
    const patch: Partial<Layer> = {};
    if (progress <= 0) {
      for (const property of channels) Object.assign(patch, { [property]: changed[property] });
    }
    const keyedChannels =
      progress > 0
        ? channels
        : channels.filter((property) =>
            animation.blocks.some(
              (block) => String(block.layerId) === String(id) && block.propertyName === property,
            ),
          );
    if (keyedChannels.length) {
      for (const property of keyedChannels) {
        if (
          animation.blocks.some(
            (block) => String(block.layerId) === String(id) && block.propertyName === property,
          )
        )
          continue;
        const value =
          node.layer[property] ?? (property === "scaleX" || property === "scaleY" ? 1 : 0);
        animation = {
          ...animation,
          blocks: [
            ...animation.blocks,
            {
              id: `transform-${idSeed}-${id}-${property}-baseline`,
              layerId: id,
              propertyName: property,
              type: "number",
              fromValue: value,
              toValue: value,
              startTime: 0,
              endTime: Math.max(1, animation.duration),
              interpolator: "FAST_OUT_SLOW_IN",
            },
          ],
        };
      }
      animation = recordTranslationAtProgress(
        [changed],
        animation,
        [id],
        progress,
        idSeed,
        keyedChannels,
        { exactPlayhead: true },
      ).animation;
      patch.expanded = true;
    }
    patches.set(String(id), patch);
  }
  return { layers: mapLayerPatches(originalLayers, patches), animation };
}

function normalizedAngle(degrees: number) {
  return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

function changeInSpace(matrix: AffineMatrix, change: AffineMatrix) {
  const inverse = inverseAffine(matrix);
  return inverse ? multiplyAffine(multiplyAffine(matrix, change), inverse) : null;
}

function evaluatedPatch(
  item: FrozenLayerTransform,
  ownerChange: AffineMatrix,
  rotation = item.transform.rotation,
) {
  const inverse = inverseAffine(item.parentMatrix);
  return inverse
    ? matrixPatch(multiplyAffine(multiplyAffine(inverse, ownerChange), item.worldMatrix), {
        ...item.transform,
        rotation,
      })
    : null;
}

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
  const inverse = inverseAffine(session.coordinateMatrix ?? IDENTITY_AFFINE) ?? IDENTITY_AFFINE;
  const point = transformPointWithMatrix(
    { x: pointer.x - session.ownerOrigin.x, y: pointer.y - session.ownerOrigin.y },
    inverse,
  );
  const center = transformPointWithMatrix(
    { x: session.center.x - session.ownerOrigin.x, y: session.center.y - session.ownerOrigin.y },
    inverse,
  );
  const angle = (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
  const delta = normalizedAngle(angle - session.startAngle);
  return constrainTo15Degrees ? Math.round(delta / 15) * 15 : delta;
}

export function applyLayerRotation(
  layers: Layer[],
  session: LayerRotateSession,
  delta: number,
): Layer[] {
  if (session.baseTransforms.some((base) => base.evaluated)) {
    const space = session.coordinateMatrix ?? IDENTITY_AFFINE;
    const inverse = inverseAffine(space);
    if (!inverse) return layers;
    const center = transformPointWithMatrix(
      { x: session.center.x - session.ownerOrigin.x, y: session.center.y - session.ownerOrigin.y },
      inverse,
    );
    const change = [
      translateAffine(center.x, center.y),
      rotateAffine(delta),
      translateAffine(-center.x, -center.y),
    ].reduce(multiplyAffine, IDENTITY_AFFINE);
    const ownerChange = changeInSpace(space, change);
    if (!ownerChange) return layers;
    const patches = new Map<string, Partial<Layer>>();
    for (const base of session.baseTransforms) {
      if (!base.evaluated) continue;
      const parent = base.evaluated.parentMatrix;
      const sameSpace = Object.keys(space).every(
        (key) =>
          Math.abs(space[key as keyof AffineMatrix] - parent[key as keyof AffineMatrix]) < 1e-7,
      );
      const direction = sameSpace || parent.a * parent.d - parent.b * parent.c >= 0 ? 1 : -1;
      const patch = evaluatedPatch(
        base.evaluated,
        ownerChange,
        base.evaluated.transform.rotation + delta * direction,
      );
      if (patch) patches.set(String(base.id), patch);
    }
    return mapLayerPatches(layers, patches);
  }
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
  const inverse = inverseAffine(session.coordinateMatrix ?? IDENTITY_AFFINE) ?? IDENTITY_AFFINE;
  const origin = session.ownerOrigin ?? ownerOrigin;
  const local = transformPointWithMatrix(
    { x: pointer.x - origin.x, y: pointer.y - origin.y },
    inverse,
  );
  const rawX = local.x - session.grabOffset.x;
  const rawY = local.y - session.grabOffset.y;
  const localX = snapStep != null ? snapValueToStep(rawX, snapStep) : rawX;
  const localY = snapStep != null ? snapValueToStep(rawY, snapStep) : rawY;
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

  if ((preserveAspect || session.preserveAspect) && original.w > 1e-6 && original.h > 1e-6) {
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

  if (session.items.some((item) => item.evaluated)) {
    const change = [
      translateAffine(target.x, target.y),
      scaleAffine(scaleX, scaleY),
      translateAffine(-original.x, -original.y),
    ].reduce(multiplyAffine, IDENTITY_AFFINE);
    const ownerChange = changeInSpace(session.coordinateMatrix ?? IDENTITY_AFFINE, change);
    if (!ownerChange) return layers;
    const patches = new Map<string, Partial<Layer>>();
    for (const item of session.items) {
      if (!item.evaluated) continue;
      const patch = evaluatedPatch(item.evaluated, ownerChange);
      if (patch) patches.set(String(item.id), patch);
    }
    return mapLayerPatches(layers, patches);
  }

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

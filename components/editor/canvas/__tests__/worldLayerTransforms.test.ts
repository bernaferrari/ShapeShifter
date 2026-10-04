import { describe, expect, it } from "vitest";
import { getPathDataBounds, parsePath } from "@/lib/shapeshifter/pathUtils";
import type { AnimationState, Layer } from "@/lib/shapeshifter/types";
import { evaluateAndroidScene } from "@/lib/shapeshifter/scene/evaluate";
import {
  IDENTITY_AFFINE,
  inverseAffine,
  multiplyAffine,
  scaleAffine,
  transformPointWithMatrix,
  translateAffine,
  type AffineMatrix,
} from "@/lib/shapeshifter/scene/layerTransform";
import type { LayerResizeSession, LayerRotateSession } from "../WorldSelectionOverlay";
import {
  applyLayerResize,
  applyLayerRotation,
  computeLayerResizeTarget,
  rotationDelta,
  buildWorldTransformSelection,
  recordWorldTransformChange,
} from "../worldLayerTransforms";

const path = parsePath("M 0 0 L 10 0 L 10 10 L 0 10 Z");
const layer: Layer = {
  id: "shape",
  name: "Shape",
  type: "path",
  visible: true,
  locked: false,
  from: path,
  pathData: path,
};

describe("world layer transforms", () => {
  it("computes constrained rotation and applies it from the frozen baseline", () => {
    const session: LayerRotateSession = {
      center: { x: 0, y: 0 },
      ownerOrigin: { x: 0, y: 0 },
      startAngle: 0,
      baseTransforms: [
        { id: layer.id, rotation: 10, translateX: 0, translateY: 0, pivotX: 0, pivotY: 0 },
      ],
      moved: false,
    };

    const delta = rotationDelta(session, { x: 10, y: 8 }, true);
    expect(delta).toBe(45);
    expect(applyLayerRotation([layer], session, delta)[0].rotation).toBe(55);
  });

  it("orbits a translated selection around the displayed rotate center", () => {
    const translated = { ...layer, translateX: 20, translateY: 0 };
    const session: LayerRotateSession = {
      center: { x: 10, y: 0 },
      ownerOrigin: { x: 0, y: 0 },
      startAngle: 0,
      baseTransforms: [
        { id: translated.id, rotation: 0, translateX: 20, translateY: 0, pivotX: 0, pivotY: 0 },
      ],
      moved: false,
    };
    const rotated = applyLayerRotation([translated], session, 180)[0];
    expect(rotated.rotation).toBe(180);
    expect(rotated.translateX).toBeCloseTo(0);
    expect(rotated.translateY).toBeCloseTo(0);
  });

  it("preserves aspect ratio for corner resizing", () => {
    const session: LayerResizeSession = {
      handle: "se",
      origin: { x: 0, y: 0, w: 10, h: 10 },
      grabOffset: { x: 0, y: 0 },
      items: [],
      moved: false,
    };

    const target = computeLayerResizeTarget(
      session,
      { x: 20, y: 14 },
      { x: 0, y: 0 },
      {
        preserveAspect: true,
        minSize: 0.5,
      },
    );

    expect(target.width).toBe(20);
    expect(target.height).toBe(20);
  });

  it("resizes through Android-native transforms without rewriting geometry", () => {
    const session: LayerResizeSession = {
      handle: "se",
      origin: { x: 5, y: 7, w: 10, h: 10 },
      grabOffset: { x: 0, y: 0 },
      items: [
        {
          id: layer.id,
          origFrom: structuredClone(path),
          origTo: null,
          origin: { x: 0, y: 0, w: 10, h: 10 },
          frameOrigin: { x: 5, y: 7, w: 10, h: 10 },
          baseTranslate: { x: 5, y: 7 },
        },
      ],
      moved: false,
    };

    const resized = applyLayerResize([layer], session, { x: 5, y: 7, width: 20, height: 20 })[0];
    const bounds = getPathDataBounds(resized.from)!;
    expect(bounds.w).toBeCloseTo(10);
    expect(bounds.h).toBeCloseTo(10);
    expect(resized.scaleX).toBeCloseTo(2);
    expect(resized.scaleY).toBeCloseTo(2);
    expect(resized.translateX).toBeCloseTo(5);
    expect(resized.translateY).toBeCloseTo(7);
  });
});

const animation: AnimationState = { id: "motion", name: "Motion", duration: 1000, blocks: [] };
const group: Layer = {
  ...layer,
  id: "group",
  name: "Group",
  type: "group",
  translateX: 20,
  translateY: 7,
  rotation: 30,
  scaleX: 2,
  scaleY: 1.5,
  from: { subPaths: [] },
  pathData: { subPaths: [] },
};
const nested: Layer = {
  ...layer,
  parentId: group.id,
  rotation: 35,
  scaleX: 1.5,
  scaleY: 0.8,
  pivotX: 3,
  pivotY: 4,
  translateX: 5,
  translateY: 2,
};

function resizeSession(
  layers: Layer[],
  ids = [nested.id],
  motion = animation,
  progress = 0,
): LayerResizeSession {
  const selection = buildWorldTransformSelection(layers, ids, motion, progress)!;
  return {
    handle: "se",
    origin: selection.bounds,
    coordinateMatrix: selection.coordinateMatrix,
    preserveAspect: selection.preserveAspect,
    ownerOrigin: { x: 0, y: 0 },
    grabOffset: { x: 0, y: 0 },
    moved: false,
    items: selection.items.map(({ node, localBounds, evaluated }) => ({
      id: node.id,
      origFrom: node.layer.from,
      origTo: node.layer.to ?? null,
      origin: localBounds,
      evaluated,
    })),
  };
}

function expectMatrix(actual: AffineMatrix, expected: AffineMatrix) {
  for (const key of Object.keys(IDENTITY_AFFINE) as Array<keyof AffineMatrix>)
    expect(actual[key]).toBeCloseTo(expected[key], 6);
}

function scaleExpected(
  session: LayerResizeSession,
  factorX: number,
  factorY: number,
  world: AffineMatrix,
) {
  const space = session.coordinateMatrix!;
  const change = [
    translateAffine(session.origin.x, session.origin.y),
    scaleAffine(factorX, factorY),
    translateAffine(-session.origin.x, -session.origin.y),
  ].reduce(multiplyAffine, IDENTITY_AFFINE);
  return multiplyAffine(
    multiplyAffine(multiplyAffine(space, change), inverseAffine(space)!),
    world,
  );
}

describe("evaluated world transform parity", () => {
  it("resizes a rotated/scaled child through its full parent matrix and preserves geometry and pivots", () => {
    const layers = [group, nested];
    const session = resizeSession(layers);
    const resized = applyLayerResize(layers, session, {
      x: session.origin.x,
      y: session.origin.y,
      width: session.origin.w * 2,
      height: session.origin.h * 1.5,
    });
    expect(resized[0]).toBe(group);
    expect(resized[1]!.from).toBe(nested.from);
    expect(resized[1]!.rotation).toBeCloseTo(35);
    expect(resized[1]!.scaleX).toBeCloseTo(3);
    expect(resized[1]!.scaleY).toBeCloseTo(1.2);
    expect(resized[1]!.pivotX).toBe(3);
    expect(resized[1]!.pivotY).toBe(4);
    const before = evaluateAndroidScene(layers, animation, 0).nodesById.get(
      String(nested.id),
    )!.worldMatrix;
    const after = evaluateAndroidScene(resized, animation, 0).nodesById.get(
      String(nested.id),
    )!.worldMatrix;
    expectMatrix(after, scaleExpected(session, 2, 1.5, before));
  });

  it("uses the selected group's descendants and transforms overlapping selections exactly once", () => {
    const layers = [group, nested];
    const session = resizeSession(layers, [group.id, nested.id]);
    expect(session.items.map((item) => item.id)).toEqual([group.id]);
    expect(session.origin.w).toBeGreaterThan(0);
    const resized = applyLayerResize(layers, session, {
      x: session.origin.x,
      y: session.origin.y,
      width: session.origin.w * 2,
      height: session.origin.h * 2,
    });
    expect(resized[1]).toBe(nested);
    const before = evaluateAndroidScene(layers, animation, 0).nodesById.get(
      String(nested.id),
    )!.worldMatrix;
    expectMatrix(
      evaluateAndroidScene(resized, animation, 0).nodesById.get(String(nested.id))!.worldMatrix,
      scaleExpected(session, 2, 2, before),
    );
  });

  it("updates embedded children as well as flat hierarchies", () => {
    const parent = { ...group, children: [nested] };
    const session = resizeSession([parent]);
    const resized = applyLayerResize([parent], session, {
      x: session.origin.x,
      y: session.origin.y,
      width: session.origin.w * 2,
      height: session.origin.h,
    });
    expect(resized[0]!.children![0]!.scaleX).toBeCloseTo(3);
    expect(resized[0]!.scaleX).toBe(group.scaleX);
    expect(resized[0]!.children![0]!.from).toBe(nested.from);
  });

  it("keeps reflected scales signed and avoids replacing them with a 180-degree rotation", () => {
    const reflected = { ...nested, scaleX: -1.5 };
    const session = resizeSession([group, reflected]);
    const resized = applyLayerResize([group, reflected], session, {
      x: session.origin.x,
      y: session.origin.y,
      width: session.origin.w * 2,
      height: session.origin.h,
    })[1]!;
    expect(resized.scaleX).toBeCloseTo(-3);
    expect(resized.scaleY).toBeCloseTo(0.8);
    expect(resized.rotation).toBeCloseTo(35);
  });

  it("constrains mixed rotations to proportional resizing instead of introducing unsupported shear", () => {
    const sibling = { ...nested, id: "sibling", rotation: -10, translateX: 30 };
    const layers = [group, nested, sibling];
    const session = resizeSession(layers, [nested.id, sibling.id]);
    expect(session.preserveAspect).toBe(true);
    const point = transformPointWithMatrix(
      { x: session.origin.x + session.origin.w * 2, y: session.origin.y + session.origin.h * 1.3 },
      session.coordinateMatrix!,
    );
    const target = computeLayerResizeTarget(
      session,
      point,
      { x: 0, y: 0 },
      { preserveAspect: false, minSize: 0.01 },
    );
    expect(target.width / session.origin.w).toBeCloseTo(target.height / session.origin.h);
    const resized = applyLayerResize(layers, session, target);
    expect(resized[1]!.scaleX).toBeCloseTo(nested.scaleX! * 2);
    expect(resized[2]!.rotation).toBeCloseTo(sibling.rotation!);
  });

  it("maps pointer coordinates into the oriented selection space under a rotated parent", () => {
    const session = resizeSession([group, nested]);
    session.ownerOrigin = { x: 100, y: 50 };
    const point = transformPointWithMatrix(
      { x: session.origin.x + session.origin.w * 3, y: session.origin.y + session.origin.h * 2 },
      session.coordinateMatrix!,
    );
    const target = computeLayerResizeTarget(
      session,
      { x: point.x + 100, y: point.y + 50 },
      { x: 100, y: 50 },
      { preserveAspect: false, minSize: 0.01 },
    );
    expect(target.width).toBeCloseTo(session.origin.w * 3);
    expect(target.height).toBeCloseTo(session.origin.h * 2);
  });

  it("records a resize against evaluated playhead values without changing resting transforms or morph geometry", () => {
    const motion: AnimationState = {
      ...animation,
      blocks: [
        {
          id: "scale",
          layerId: nested.id,
          propertyName: "scaleX",
          type: "number",
          fromValue: 1,
          toValue: 3,
          startTime: 0,
          endTime: 1000,
          interpolator: "LINEAR",
        },
      ],
    };
    const layers = [group, { ...nested, scaleX: 1 }];
    const session = resizeSession(layers, [nested.id], motion, 0.5);
    expect(session.items[0]!.evaluated!.transform.scaleX).toBe(2);
    const changed = applyLayerResize(layers, session, {
      x: session.origin.x,
      y: session.origin.y,
      width: session.origin.w * 2,
      height: session.origin.h,
    });
    const recorded = recordWorldTransformChange(
      layers,
      changed,
      motion,
      0.5,
      [nested.id],
      ["translateX", "translateY", "scaleX", "scaleY"],
      42,
    );
    expect(recorded.layers[1]!.scaleX).toBe(1);
    expect(recorded.layers[1]!.from).toBe(nested.from);
    const at = (progress: number) =>
      evaluateAndroidScene(recorded.layers, recorded.animation, progress).nodesById.get(
        String(nested.id),
      )!;
    expect(at(0).transform.scaleX).toBe(1);
    expect(at(0.5).transform.scaleX).toBeCloseTo(4);
    expect(at(1).transform.scaleX).toBe(3);
    expectMatrix(
      at(0.5).worldMatrix,
      evaluateAndroidScene(changed, { ...motion, blocks: [] }, 0.5).nodesById.get(
        String(nested.id),
      )!.worldMatrix,
    );
  });

  it("seeds newly keyed transforms from their authored resting values", () => {
    const layers = [group, nested];
    const session = resizeSession(layers);
    const changed = applyLayerResize(layers, session, {
      x: session.origin.x,
      y: session.origin.y,
      width: session.origin.w * 2,
      height: session.origin.h,
    });
    const recorded = recordWorldTransformChange(
      layers,
      changed,
      animation,
      0.5,
      [nested.id],
      ["scaleX"],
      42,
    );
    const at = (progress: number) =>
      evaluateAndroidScene(recorded.layers, recorded.animation, progress).nodesById.get(
        String(nested.id),
      )!.transform.scaleX;
    expect(at(0)).toBe(nested.scaleX);
    expect(at(0.5)).toBeCloseTo(nested.scaleX! * 2);
    expect(at(1)).toBe(nested.scaleX);
  });
});

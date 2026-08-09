import { describe, expect, it } from "vitest";
import { getPathDataBounds, parsePath } from "@/lib/shapeshifter/pathUtils";
import type { Layer } from "@/lib/shapeshifter/types";
import type { LayerResizeSession, LayerRotateSession } from "../WorldSelectionOverlay";
import {
  applyLayerResize,
  applyLayerRotation,
  computeLayerResizeTarget,
  rotationDelta,
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
      startAngle: 0,
      baseRotations: [{ id: layer.id, rotation: 10 }],
      moved: false,
    };

    const delta = rotationDelta(session, { x: 10, y: 8 }, true);
    expect(delta).toBe(45);
    expect(applyLayerRotation([layer], session, delta)[0].rotation).toBe(55);
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

  it("resizes geometry without compounding and keeps its frame-local origin", () => {
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
    expect(bounds.w).toBeCloseTo(20);
    expect(bounds.h).toBeCloseTo(20);
    expect(resized.translateX).toBeCloseTo(5);
    expect(resized.translateY).toBeCloseTo(7);
  });
});

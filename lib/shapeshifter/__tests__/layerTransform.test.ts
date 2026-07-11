import { describe, expect, it } from "vitest";
import {
  inverseTransformLayerPoint,
  layerTransformToSvg,
  transformLayerPoint,
  transformLayerRect,
} from "../scene/layerTransform";

describe("layer transforms", () => {
  const transform = {
    translateX: 10,
    translateY: -2,
    pivotX: 5,
    pivotY: 5,
    rotation: 90,
    scaleX: 2,
    scaleY: 1,
  };

  it("uses the same pivoted transform order as the SVG renderer", () => {
    expect(layerTransformToSvg(transform)).toBe(
      "translate(10 -2) translate(5 5) rotate(90) scale(2 1) translate(-5 -5)",
    );
    expect(transformLayerPoint({ x: 6, y: 5 }, transform)).toMatchObject({ x: 15, y: 5 });
  });

  it("round-trips points through the inverse used by hit testing", () => {
    const original = { x: 8.25, y: -3.5 };
    const world = transformLayerPoint(original, transform);
    const restored = inverseTransformLayerPoint(world, transform);
    expect(restored?.x).toBeCloseTo(original.x, 8);
    expect(restored?.y).toBeCloseTo(original.y, 8);
  });

  it("returns the transformed axis-aligned bounds", () => {
    expect(transformLayerRect({ x: 0, y: 0, w: 10, h: 20 }, { scaleX: 2, scaleY: 0.5 }))
      .toEqual({ x: 0, y: 0, w: 20, h: 10 });
  });
});

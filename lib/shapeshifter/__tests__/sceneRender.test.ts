import { describe, expect, it } from "vitest";
import { parsePath } from "../pathUtils";
import { resolveWorldLayerDraws } from "../scene/render";
import type { AnimationState, Layer } from "../types";

const path = parsePath("M0 0 L10 0 L10 10 Z");
const visible: Layer = {
  id: "shape",
  name: "Shape",
  type: "path",
  from: path,
  to: path,
  fillColor: "#123456",
  fillAlpha: 0.8,
  translateX: 2,
  translateY: 3,
} as Layer;
const animation: AnimationState = {
  id: "animation",
  name: "Animation",
  duration: 1000,
  blocks: [
    {
      id: "translate-x",
      layerId: "shape",
      propertyName: "translateX",
      fromValue: 2,
      toValue: 12,
      startTime: 0,
      endTime: 1000,
      type: "number",
    },
  ],
};

describe("world scene rendering", () => {
  it("resolves static owner layers without UI-specific state", () => {
    expect(resolveWorldLayerDraws([visible], animation, 0, false)[0]).toMatchObject({
      id: "shape",
      fill: "#123456",
      fillOpacity: 0.8,
      translateX: 2,
      translateY: 3,
    });
  });

  it("evaluates transforms at the playhead and excludes hidden layers", () => {
    const draws = resolveWorldLayerDraws(
      [visible, { ...visible, id: "hidden", visible: false }],
      animation,
      0.5,
      true,
    );
    expect(draws).toHaveLength(1);
    expect(draws[0].translateX).toBeCloseTo(7);
  });
});

import { describe, expect, it } from "vitest";
import { compileAndroidArtboard } from "../androidCompiler";
import { exportLottieDocument } from "../export/lottie";
import { HOLD_INTERPOLATOR, evaluateInterpolator } from "../interpolators";
import { parsePath } from "../pathUtils";
import type { AnimationState, Layer } from "../types";

const layer: Layer = {
  id: "dot",
  name: "Dot",
  type: "path",
  from: parsePath("M 0 0 L 10 0 L 10 10 Z"),
  pathData: parsePath("M 0 0 L 10 0 L 10 10 Z"),
  visible: true,
  locked: false,
  fillColor: "#000000",
};
const animation: AnimationState = {
  id: "blink",
  name: "Blink",
  duration: 1000,
  blocks: [
    {
      id: "fade",
      layerId: "dot",
      propertyName: "alpha",
      fromValue: 1,
      toValue: 0,
      startTime: 0,
      endTime: 500,
      interpolator: HOLD_INTERPOLATOR,
    },
  ],
};

describe("hold keyframes", () => {
  it("keeps the start value for the whole segment, then lands on the end value", () => {
    expect(evaluateInterpolator(0.25, HOLD_INTERPOLATOR)).toBe(0);
    expect(evaluateInterpolator(0.999, HOLD_INTERPOLATOR)).toBe(0);
    expect(evaluateInterpolator(1, HOLD_INTERPOLATOR)).toBe(1);
  });

  it("exports to Android as a step path interpolator without fallback warnings", () => {
    const bundle = compileAndroidArtboard({
      name: "Blink",
      vector: { id: "vector", name: "Blink", width: 24, height: 24, alpha: 1 },
      hiddenLayerIds: [],
      layers: [layer],
      animation,
    });
    const hold = bundle.files.find((file) => file.path.startsWith("res/interpolator/"));
    expect(hold?.content).toContain('android:pathData="M 0,0 L 0.9999,0 L 1,1"');
    const animator = bundle.files.find((file) => file.content.includes("objectAnimator"));
    expect(animator?.content).toContain(
      `@interpolator/${hold!.path.split("/").at(-1)!.replace(".xml", "")}`,
    );
    expect(bundle.diagnostics.some((item) => item.code.startsWith("INTERPOLATOR"))).toBe(false);
  });

  it("exports to Lottie with its native hold flag", () => {
    const lottie = exportLottieDocument([layer], "doc", { animation });
    const opacity = lottie.layers[0].ks.o;
    expect(opacity.a).toBe(1);
    expect(opacity.k[0]).toMatchObject({ t: 0, h: 1 });
  });
});

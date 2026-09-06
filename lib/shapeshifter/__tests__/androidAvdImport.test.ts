// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { compileAndroidArtboard } from "../androidCompiler";
import { importAnimatedVectorBundle } from "../import/androidAnimatedVector";
import { parsePath } from "../pathUtils";
import { createZip, parseZip } from "../zip";
import type { Layer } from "../types";

function heart(): Layer {
  const from = parsePath("M2 12 L12 22 L22 12 Z");
  return {
    id: "heart",
    name: "Heart",
    androidName: "heart",
    type: "path",
    from,
    pathData: from,
    fillColor: "#ff3366",
    visible: true,
    locked: false,
    translateX: 1,
  };
}

describe("AVD import", () => {
  it("uses Android defaults for omitted animator attributes and the target's base value", () => {
    const imported = importAnimatedVectorBundle([
      {
        path: "res/drawable/fade_vector.xml",
        content: `
          <vector xmlns:android="http://schemas.android.com/apk/res/android"
              android:width="24dp" android:height="24dp"
              android:viewportWidth="24" android:viewportHeight="24">
            <path android:name="shape" android:pathData="M0,0 L24,0 L24,24 Z"
                android:fillColor="#ff3366" android:fillAlpha="0.35" />
          </vector>`,
      },
      {
        path: "res/drawable/fade_animated.xml",
        content: `
          <animated-vector xmlns:android="http://schemas.android.com/apk/res/android"
              android:drawable="@drawable/fade_vector">
            <target android:name="shape" android:animation="@animator/fade" />
          </animated-vector>`,
      },
      {
        path: "res/animator/fade.xml",
        content: `
          <objectAnimator xmlns:android="http://schemas.android.com/apk/res/android"
              android:propertyName="fillAlpha" android:valueTo="1" />`,
      },
    ]);

    expect(imported.animation.duration).toBe(300);
    expect(imported.animation.blocks).toHaveLength(1);
    expect(imported.animation.blocks[0]).toMatchObject({
      propertyName: "fillAlpha",
      fromValue: 0.35,
      toValue: 1,
      startTime: 0,
      endTime: 300,
      interpolator: "ACCELERATE_DECELERATE",
    });
  });

  it("preserves an AVD's short duration instead of extending it to one second", () => {
    const imported = importAnimatedVectorBundle([
      {
        path: "res/drawable/quick_vector.xml",
        content: `
          <vector xmlns:android="http://schemas.android.com/apk/res/android"
              android:width="24dp" android:height="24dp"
              android:viewportWidth="24" android:viewportHeight="24">
            <path android:name="shape" android:pathData="M0,0 L24,0 L24,24 Z"
                android:fillColor="#ff3366" />
          </vector>`,
      },
      {
        path: "res/drawable/quick_animated.xml",
        content: `
          <animated-vector xmlns:android="http://schemas.android.com/apk/res/android"
              android:drawable="@drawable/quick_vector">
            <target android:name="shape" android:animation="@animator/quick_fade" />
          </animated-vector>`,
      },
      {
        path: "res/animator/quick_fade.xml",
        content: `
          <objectAnimator xmlns:android="http://schemas.android.com/apk/res/android"
              android:propertyName="fillAlpha" android:valueFrom="1" android:valueTo="0"
              android:startOffset="20" android:duration="80" />`,
      },
    ]);

    expect(imported.animation.duration).toBe(100);
    expect(imported.animation.blocks[0]).toMatchObject({ startTime: 20, endTime: 100 });
  });

  it("warns when sequential and nested AnimatorSets are flattened into timeline blocks", () => {
    const imported = importAnimatedVectorBundle([
      {
        path: "res/drawable/sequence_vector.xml",
        content: `
          <vector xmlns:android="http://schemas.android.com/apk/res/android"
              android:width="24dp" android:height="24dp"
              android:viewportWidth="24" android:viewportHeight="24">
            <path android:name="shape" android:pathData="M0,0 L24,0 L24,24 Z"
                android:fillColor="#ff3366" />
          </vector>`,
      },
      {
        path: "res/drawable/sequence_animated.xml",
        content: `
          <animated-vector xmlns:android="http://schemas.android.com/apk/res/android"
              android:drawable="@drawable/sequence_vector">
            <target android:name="shape" android:animation="@animator/sequence" />
          </animated-vector>`,
      },
      {
        path: "res/animator/sequence.xml",
        content: `
          <set xmlns:android="http://schemas.android.com/apk/res/android"
              android:ordering="sequentially" android:interpolator="@android:interpolator/linear">
            <objectAnimator android:propertyName="fillAlpha" android:valueFrom="1"
                android:valueTo="0.3" android:duration="120" />
            <set android:ordering="together" android:startOffset="30">
              <objectAnimator android:propertyName="translateX" android:valueFrom="0"
                  android:valueTo="8" android:duration="80" />
            </set>
          </set>`,
      },
    ]);

    expect(imported.animation.blocks).toHaveLength(2);
    expect(imported.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "ANIMATOR_SET_SEQUENTIAL_TIMING",
        }),
        expect.objectContaining({ severity: "warning", code: "NESTED_ANIMATOR_SET" }),
        expect.objectContaining({
          severity: "warning",
          code: "ANIMATOR_SET_TIMING_UNSUPPORTED",
        }),
      ]),
    );
  });

  it("warns about animator timing and keyframe semantics the flat timeline cannot retain", () => {
    const imported = importAnimatedVectorBundle([
      {
        path: "res/drawable/repeat_vector.xml",
        content: `
          <vector xmlns:android="http://schemas.android.com/apk/res/android"
              android:width="24dp" android:height="24dp"
              android:viewportWidth="24" android:viewportHeight="24">
            <path android:name="shape" android:pathData="M0,0 L24,0 L24,24 Z"
                android:fillColor="#ff3366" />
          </vector>`,
      },
      {
        path: "res/drawable/repeat_animated.xml",
        content: `
          <animated-vector xmlns:android="http://schemas.android.com/apk/res/android"
              android:drawable="@drawable/repeat_vector">
            <target android:name="shape" android:animation="@animator/repeat" />
          </animated-vector>`,
      },
      {
        path: "res/animator/repeat.xml",
        content: `
          <objectAnimator xmlns:android="http://schemas.android.com/apk/res/android"
              android:propertyName="fillAlpha" android:valueFrom="1" android:valueTo="0"
              android:duration="100" android:startDelay="50" android:repeatCount="2"
              android:repeatMode="reverse" android:interpolator="@interpolator/accelerate">
            <propertyValuesHolder android:propertyName="fillAlpha">
              <keyframe android:fraction="0" android:value="1" />
              <keyframe android:fraction="1" android:value="0" />
            </propertyValuesHolder>
          </objectAnimator>`,
      },
      {
        path: "res/interpolator/accelerate.xml",
        content: `<accelerateInterpolator xmlns:android="http://schemas.android.com/apk/res/android" android:factor="1.5" />`,
      },
    ]);

    expect(imported.animation.blocks).toHaveLength(1);
    expect(imported.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining([
        "ANIMATOR_REPEAT_UNSUPPORTED",
        "ANIMATOR_START_DELAY_UNSUPPORTED",
        "PROPERTY_VALUES_HOLDER_UNSUPPORTED",
        "INTERPOLATOR_UNSUPPORTED",
      ]),
    );
  });

  it("round-trips compiler ZIP back into timeline blocks", () => {
    const bundle = compileAndroidArtboard({
      name: "Favorite Icon",
      vector: { id: "v", name: "Favorite Icon", width: 24, height: 24, alpha: 1 },
      layers: [heart()],
      animation: {
        id: "motion",
        name: "Pulse",
        duration: 1000,
        blocks: [
          {
            id: "move",
            layerId: "heart",
            propertyName: "translateX",
            fromValue: 1,
            toValue: 4,
            startTime: 100,
            endTime: 600,
            interpolator: "FAST_OUT_SLOW_IN",
          },
        ],
      },
    });
    const zip = createZip(bundle.files);
    const files = parseZip(zip).map((entry) => ({
      path: entry.path,
      content: String(entry.content),
    }));
    const imported = importAnimatedVectorBundle(files);
    expect(imported.layers.some((layer) => layer.androidName === "heart")).toBe(true);
    expect(imported.animation.blocks.some((block) => block.propertyName === "translateX")).toBe(
      true,
    );
    const move = imported.animation.blocks.find((block) => block.propertyName === "translateX")!;
    expect(move.fromValue).toBe(1);
    expect(move.toValue).toBe(4);
    expect(move.startTime).toBe(100);
    expect(move.endTime).toBe(600);
    expect(move.interpolator).toBe("FAST_OUT_SLOW_IN");
    expect(imported.diagnostics).toEqual([]);
  });

  it("restores pathData morph endpoints onto the layer", () => {
    const from = "M0 0 L10 10";
    const to = "M2 2 L8 8";
    const layer: Layer = {
      ...heart(),
      from: parsePath(from),
      to: parsePath(to),
      pathData: parsePath(from),
    };
    const bundle = compileAndroidArtboard({
      name: "Morph",
      vector: { id: "v", name: "Morph", width: 24, height: 24, alpha: 1 },
      layers: [layer],
      animation: {
        id: "motion",
        name: "Morph",
        duration: 800,
        blocks: [
          {
            id: "morph",
            layerId: "heart",
            propertyName: "pathData",
            fromValue: from,
            toValue: to,
            startTime: 0,
            endTime: 800,
          },
        ],
      },
    });
    const imported = importAnimatedVectorBundle(bundle.files);
    const path = imported.layers.find((item) => item.androidName === "heart")!;
    expect(path.to).toBeDefined();
    expect(imported.animation.blocks.some((block) => block.propertyName === "pathData")).toBe(true);
  });

  it("imports a missing or empty valueTo as the target's current value instead of numeric zero", () => {
    const imported = importAnimatedVectorBundle([
      {
        path: "res/drawable/blank_vector.xml",
        content: `
          <vector xmlns:android="http://schemas.android.com/apk/res/android"
              android:width="24dp" android:height="24dp"
              android:viewportWidth="24" android:viewportHeight="24">
            <path android:name="shape" android:pathData="M0,0 L24,0 L24,24 Z"
                android:fillColor="#ff3366" android:fillAlpha="0.5" />
          </vector>`,
      },
      {
        path: "res/drawable/blank_animated.xml",
        content: `
          <animated-vector xmlns:android="http://schemas.android.com/apk/res/android"
              android:drawable="@drawable/blank_vector">
            <target android:name="shape" android:animation="@animator/no_to" />
          </animated-vector>`,
      },
      {
        path: "res/animator/no_to.xml",
        content: `
          <objectAnimator xmlns:android="http://schemas.android.com/apk/res/android"
              android:propertyName="scaleX" android:valueFrom="2" />`,
      },
    ]);

    expect(imported.animation.blocks).toHaveLength(1);
    // Number("") === 0 previously slipped through as a real target value.
    expect(imported.animation.blocks[0].toValue).toBe(1); // DEFAULT_PROPERTY_VALUES.scaleX
    expect(imported.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "warning", code: "ANIMATOR_VALUE_TO_MISSING" }),
    );
  });
});

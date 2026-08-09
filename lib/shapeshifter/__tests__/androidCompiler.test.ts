import { describe, expect, it } from "vitest";
import { compileAndroidArtboard } from "../androidCompiler";
import { parsePath } from "../pathUtils";
import type { AndroidArtboardInput } from "../androidCompiler";

const input = (): AndroidArtboardInput => ({
  name: "Favorite Icon",
  vector: { id: "vector", name: "Favorite Icon", width: 24, height: 24, alpha: 1 },
  hiddenLayerIds: [],
  layers: [
    {
      id: "group",
      name: "Content",
      type: "group",
      from: parsePath(""),
      visible: true,
      locked: false,
    },
    {
      id: "heart",
      name: "Heart",
      type: "path",
      parentId: "group",
      from: parsePath("M2 12 L12 22 L22 12 Z"),
      pathData: parsePath("M2 12 L12 22 L22 12 Z"),
      visible: true,
      locked: false,
      fillColor: "#ff3366",
      translateX: 1,
    },
  ],
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
      {
        id: "color",
        layerId: "heart",
        propertyName: "fillColor",
        fromValue: "#ff3366",
        toValue: "#6633ff",
        startTime: 0,
        endTime: 1000,
      },
    ],
  },
});

describe("Android artboard compiler", () => {
  it("compiles a complete hierarchy into VectorDrawable and AVD resources", () => {
    const bundle = compileAndroidArtboard(input());
    const vector = bundle.files.find((file) => file.path.endsWith("_vector.xml"))?.content;
    const avd = bundle.files.find((file) => file.path.endsWith("_animated.xml"))?.content;

    expect(bundle.resourceName).toBe("favorite_icon");
    expect(vector).toContain('android:width="24dp"');
    expect(vector).toContain('android:name="content"');
    expect(vector).toContain('android:name="heart_transform"');
    expect(vector).toContain('android:name="heart"');
    expect(avd).toContain('android:name="heart_transform"');
    expect(avd).toContain('android:name="heart"');
    expect(bundle.files.filter((file) => file.path.startsWith("res/animator/"))).toHaveLength(2);
    expect(bundle.diagnostics.some((diagnostic) => diagnostic.severity === "error")).toBe(false);
  });

  it("emits a blocking diagnostic for incompatible path morphs", () => {
    const source = input();
    source.animation.blocks = [
      {
        id: "morph",
        layerId: "heart",
        propertyName: "pathData",
        fromValue: "M0 0 L10 10",
        toValue: "M0 0 C2 2 8 8 10 10",
        startTime: 0,
        endTime: 1000,
      },
    ];

    const bundle = compileAndroidArtboard(source);
    expect(bundle.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", code: "INCOMPATIBLE_PATH_MORPH" }),
      ]),
    );
    expect(bundle.files.some((file) => file.path.endsWith("_animated.xml"))).toBe(false);
  });

  it("excludes hidden targets and explains skipped animation tracks", () => {
    const source = input();
    source.hiddenLayerIds = ["group"];
    const bundle = compileAndroidArtboard(source);

    expect(bundle.files[0]?.content).not.toContain('android:name="heart"');
    expect(bundle.diagnostics.some((diagnostic) => diagnostic.code === "TARGET_NOT_EXPORTED")).toBe(
      true,
    );
  });
});

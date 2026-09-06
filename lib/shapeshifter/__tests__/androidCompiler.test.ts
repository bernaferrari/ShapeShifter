import { describe, expect, it } from "vitest";
import { compileAndroidArtboard } from "../androidCompiler";
import { parsePath, pathToString } from "../pathUtils";
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

  it("keeps Android root metadata, target names, colors, and custom cubic easing", () => {
    const source = input();
    source.vector = {
      ...source.vector,
      width: 32,
      height: 20,
      widthUnit: "px",
      viewportWidth: 48,
      viewportHeight: 30,
      tint: "#33669980",
      tintMode: "src_in",
      autoMirrored: true,
    };
    source.layers[1] = {
      ...source.layers[1]!,
      androidName: "favorite_heart",
      fillColor: "#ff000080",
    };
    source.animation.blocks[1] = {
      ...source.animation.blocks[1]!,
      interpolator: "cubic-bezier(0.2, 0, 0.8, 1)",
    };

    const bundle = compileAndroidArtboard(source);
    const vector = bundle.files.find((file) => file.path.endsWith("_vector.xml"))?.content ?? "";
    const animator = bundle.files.find((file) => file.path.includes("fillcolor"))?.content ?? "";
    expect(vector).toContain('android:width="32px"');
    expect(vector).toContain('android:viewportWidth="48"');
    expect(vector).toContain('android:tint="#80336699"');
    expect(vector).toContain('android:autoMirrored="true"');
    expect(vector).toContain('android:name="favorite_heart"');
    expect(vector).toContain('android:fillColor="#80ff0000"');
    expect(animator).toContain('android:valueFrom="#ff3366"');
    expect(bundle.files.some((file) => file.path.startsWith("res/interpolator/"))).toBe(true);
  });

  it("bakes inherited static alpha into Android path appearance", () => {
    const source = input();
    source.layers[0] = { ...source.layers[0]!, alpha: 0.5 };
    source.layers[1] = { ...source.layers[1]!, fillAlpha: 0.5, strokeAlpha: 0.8 };
    const vector = compileAndroidArtboard(source).files[0]!.content;
    expect(vector).toContain('android:fillAlpha="0.25"');
    expect(vector).toContain('android:strokeAlpha="0.4"');
  });

  it("keeps animated alpha under static parent alpha in preview/export parity", () => {
    const source = input();
    source.layers[0] = { ...source.layers[0]!, alpha: 0.5 };
    source.layers[1] = { ...source.layers[1]!, alpha: 0.8, fillAlpha: 0.5 };
    source.animation.blocks = [
      {
        id: "fade",
        layerId: "heart",
        propertyName: "alpha",
        fromValue: 0,
        toValue: 1,
        startTime: 0,
        endTime: 1000,
      },
    ];

    const animator = compileAndroidArtboard(source).files.find((file) =>
      file.path.includes("fillalpha"),
    )?.content;
    // Editor: parent .5 × static fillAlpha .5 × animated alpha (0 → 1).
    expect(animator).toContain('android:valueFrom="0"');
    expect(animator).toContain('android:valueTo="0.25"');
  });

  it("scales direct fill-alpha tracks by the effective layer alpha", () => {
    const source = input();
    source.layers[0] = { ...source.layers[0]!, alpha: 0.5 };
    source.layers[1] = { ...source.layers[1]!, alpha: 0.8, fillAlpha: 0.2 };
    source.animation.blocks = [
      {
        id: "fill-fade",
        layerId: "heart",
        propertyName: "fillAlpha",
        fromValue: 0,
        toValue: 1,
        startTime: 0,
        endTime: 1000,
      },
    ];

    const animator = compileAndroidArtboard(source).files.find((file) =>
      file.path.includes("fillalpha"),
    )?.content;
    // Editor: parent .5 × path alpha .8 × animated fillAlpha (0 → 1).
    expect(animator).toContain('android:valueTo="0.4"');
  });

  it("keeps gradient stop alpha separate from static and animated fill alpha", () => {
    const source = input();
    source.layers[0] = { ...source.layers[0]!, alpha: 0.5 };
    source.layers[1] = {
      ...source.layers[1]!,
      alpha: 0.8,
      fillAlpha: 0.5,
      fillGradient: {
        type: "linear",
        angle: 0,
        stops: [
          { offset: 0, color: "#ff0000", opacity: 1 },
          { offset: 1, color: "#0000ff", opacity: 0.5 },
        ],
      },
    };
    source.animation.blocks = [
      {
        id: "gradient-fade",
        layerId: "heart",
        propertyName: "fillAlpha",
        fromValue: 0,
        toValue: 1,
        startTime: 0,
        endTime: 1000,
      },
    ];

    const bundle = compileAndroidArtboard(source);
    const vector = bundle.files.find((file) => file.path.endsWith("_vector.xml"))?.content ?? "";
    const animator = bundle.files.find((file) => file.path.includes("fillalpha"))?.content ?? "";
    // Static path alpha = group .5 × path .8 × fill .5; stop alpha contains
    // only its own color/opacity and is never multiplied again by the animator.
    expect(vector).toContain('android:fillAlpha="0.2"');
    expect(vector).toContain('android:color="#ffff0000"');
    expect(vector).toContain('android:color="#800000ff"');
    expect(animator).toContain('android:valueFrom="0"');
    expect(animator).toContain('android:valueTo="0.4"');
  });

  it("blocks alpha plus fill-alpha tracks that Android cannot multiply faithfully", () => {
    const source = input();
    source.animation.blocks = [
      {
        id: "fade-layer",
        layerId: "heart",
        propertyName: "alpha",
        fromValue: 0,
        toValue: 1,
        startTime: 0,
        endTime: 1000,
      },
      {
        id: "fade-fill",
        layerId: "heart",
        propertyName: "fillAlpha",
        fromValue: 1,
        toValue: 0.5,
        startTime: 0,
        endTime: 1000,
      },
    ];

    expect(compileAndroidArtboard(source).diagnostics).toContainEqual(
      expect.objectContaining({ code: "ALPHA_TRACK_COMBINATION_UNSUPPORTED", severity: "error" }),
    );
  });

  it("reserves generated transform target names against authored layer names", () => {
    const source = input();
    source.layers = [
      {
        ...source.layers[1]!,
        id: "foo",
        name: "foo",
        parentId: undefined,
        translateX: 1,
      },
      {
        ...source.layers[1]!,
        id: "authored-wrapper-name",
        name: "foo_transform",
        parentId: undefined,
        translateX: 0,
      },
    ];
    source.animation.blocks = [
      {
        id: "move-foo",
        layerId: "foo",
        propertyName: "translateX",
        fromValue: 1,
        toValue: 3,
        startTime: 0,
        endTime: 1000,
      },
      {
        id: "fade-authored",
        layerId: "authored-wrapper-name",
        propertyName: "fillAlpha",
        fromValue: 0,
        toValue: 1,
        startTime: 0,
        endTime: 1000,
      },
    ];

    const bundle = compileAndroidArtboard(source);
    const vector = bundle.files.find((file) => file.path.endsWith("_vector.xml"))?.content ?? "";
    const names = [
      ...vector.matchAll(/<(?:(?:group)|(?:path))\s+[^>]*android:name="([^"]+)"/g),
    ].map((match) => match[1]);
    expect(names).toContain("foo_transform");
    expect(names).toContain("foo_transform_2");
    expect(new Set(names).size).toBe(names.length);
    const avd = bundle.files.find((file) => file.path.endsWith("_animated.xml"))?.content ?? "";
    expect(avd).toContain('android:name="foo_transform"');
    expect(avd).toContain('android:name="foo_transform_2"');
  });

  it("rejects unsupported clip animation properties instead of silently changing output", () => {
    const source = input();
    source.layers[1] = { ...source.layers[1]!, id: "clip", type: "clipPath" };
    source.animation.blocks = [
      {
        id: "clip-color",
        layerId: "clip",
        propertyName: "fillColor",
        fromValue: "#000000",
        toValue: "#ffffff",
        startTime: 0,
        endTime: 1000,
      },
    ];

    const bundle = compileAndroidArtboard(source);
    expect(bundle.diagnostics).toContainEqual(
      expect.objectContaining({ code: "CLIP_PROPERTY_UNSUPPORTED", layerId: "clip" }),
    );
  });

  it("bakes clip transforms without ending their sibling scope and preserves evenOdd clips", () => {
    const source = input();
    const clipPath = parsePath("M0 0 L10 0 L10 10 L0 10 Z");
    source.layers = [
      source.layers[0]!,
      {
        id: "clip",
        name: "Clip",
        type: "clipPath",
        parentId: "group",
        from: clipPath,
        pathData: clipPath,
        visible: true,
        locked: false,
        translateX: 4,
        scaleX: 2,
        fillType: "evenOdd",
      },
      {
        ...source.layers[1]!,
        id: "art",
        name: "Art",
        parentId: "group",
        translateX: 0,
      },
    ];
    source.animation.blocks = [
      {
        id: "clip-morph",
        layerId: "clip",
        propertyName: "pathData",
        fromValue: "M0 0 L10 0 L10 10 L0 10 Z",
        toValue: "M1 0 L11 0 L11 10 L1 10 Z",
        startTime: 0,
        endTime: 1000,
      },
    ];

    const bundle = compileAndroidArtboard(source);
    const vector = bundle.files.find((file) => file.path.endsWith("_vector.xml"))?.content ?? "";
    const animator =
      bundle.files.find((file) => file.path.includes("clip_pathdata"))?.content ?? "";
    const transformedFrom = pathToString(parsePath("M4 0 L24 0 L24 10 L4 10 Z"));
    const transformedTo = pathToString(parsePath("M6 0 L26 0 L26 10 L6 10 Z"));

    expect(vector).toContain(
      `<clip-path android:name="clip" android:pathData="${transformedFrom}" android:fillType="evenOdd" />`,
    );
    expect(vector).not.toContain('android:name="clip_transform"');
    expect(vector).toMatch(
      /<clip-path[^>]*android:name="clip"[^>]*\/>\s*<path\s+[\s\S]*android:name="art"/,
    );
    expect(animator).toContain(`android:valueFrom="${transformedFrom}"`);
    expect(animator).toContain(`android:valueTo="${transformedTo}"`);
  });

  it("uses Android's default accelerate-decelerate timing when no interpolator is stored", () => {
    const source = input();
    source.animation.blocks = [
      {
        id: "move-default",
        layerId: "heart",
        propertyName: "translateX",
        fromValue: 0,
        toValue: 4,
        startTime: 0,
        endTime: 1000,
      },
    ];

    const bundle = compileAndroidArtboard(source);
    expect(
      bundle.files.some((file) => file.content.includes("accelerate_decelerate_interpolator")),
    ).toBe(true);
    expect(
      bundle.diagnostics.some((diagnostic) => diagnostic.code === "INTERPOLATOR_FALLBACK"),
    ).toBe(false);
  });

  it("only emits API-24 path attributes when needed and reports unsupported dashes", () => {
    const source = input();
    source.layers[1] = {
      ...source.layers[1]!,
      fillType: "evenOdd",
      strokeDasharray: "2 1",
    };

    const bundle = compileAndroidArtboard(source);
    const vector = bundle.files[0]!.content;
    expect(vector).toContain('android:fillType="evenOdd"');
    expect(bundle.diagnostics).toContainEqual(
      expect.objectContaining({ code: "STROKE_DASHARRAY_UNSUPPORTED", layerId: "heart" }),
    );
    expect(bundle.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "ANDROID_MIN_SDK",
        message: expect.stringContaining("API 24"),
      }),
    );
  });
});

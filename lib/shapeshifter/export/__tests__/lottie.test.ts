import { describe, expect, it, vi } from "vitest";
import { exportLottie, exportLottieDocument, exportLottieDocumentWithDiagnostics } from "../lottie";
import { parsePath } from "../../pathUtils";
import type { AnimationState, Layer, PathData } from "../../types";

function makePath(d: string): PathData {
  return parsePath(d);
}

function makeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: "shape",
    name: "test-layer",
    type: "path",
    from: makePath("M 0 0 L 10 0 L 10 10 L 0 10 Z"),
    to: makePath("M 2 2 L 12 2 L 12 12 L 2 12 Z"),
    visible: true,
    locked: false,
    ...overrides,
  };
}

const shapeItems = (layer: {
  shapes: Array<{ it?: Array<{ ty?: string; ks?: { k?: unknown } }> }>;
}) => layer.shapes[0].it!.filter((item) => item.ty === "sh");

describe("exportLottie extra contour padding", () => {
  it("pads extra contours so every keyframe pair has equal vertex counts", () => {
    // First subpaths match; the SECOND pair diverges in vertex count
    // (triangle vs square) — previously exported unpadded, which is invalid
    // Lottie because v/i/o arrays must have equal length across keyframes.
    const from = makePath(
      "M 0 0 L 4 0 L 4 4 Z M 10 10 L 14 10 L 14 14 Z M 20 20 L 26 20 L 26 26 L 20 26 Z",
    );
    const to = makePath(
      "M 1 1 L 5 1 L 5 5 Z M 11 11 L 15 11 L 15 12 L 11 16 Z M 21 21 L 27 21 L 27 24 L 21 24 Z",
    );
    const lottie = exportLottie(from, to, "multi");
    const items = shapeItems(lottie.layers[0]);
    expect(items).toHaveLength(3);

    for (const item of items) {
      const keys = item.ks!.k as Array<{
        s: Array<{ v: number[][]; i: number[][]; o: number[][] }>;
      }>;
      const startShape = keys[0].s[0];
      const endShape = keys[1].s[0];
      expect(startShape.v.length).toBe(endShape.v.length);
      expect(startShape.i.length).toBe(endShape.i.length);
      for (const arr of [startShape.i, startShape.o, endShape.i, endShape.o]) {
        expect(arr.length).toBe(startShape.v.length);
      }
    }
  });

  it("pairs a missing target contour with the padded fallback square", () => {
    const from = makePath("M 0 0 L 4 0 L 4 4 Z M 10 10 L 40 10 L 40 40 L 10 40 Z");
    const to = makePath("M 1 1 L 5 1 L 5 5 Z");
    const lottie = exportLottie(from, to, "missing-target");
    const items = shapeItems(lottie.layers[0]);
    expect(items).toHaveLength(2);
    const secondKeys = items[1].ks!.k as Array<{
      t: number;
      s: Array<{ v: number[][]; c: boolean }>;
    }>;
    // The target contour is absent → fallback contour at the final keyframe.
    expect(secondKeys[1].s[0].v.length).toBe(4);
    expect(secondKeys[1].t).toBe(lottie.op);
    // And both keyframes still agree on vertex count after padding.
    expect(secondKeys[1].s[0].v.length).toBe(secondKeys[0].s[0].v.length);
  });
});

describe("exportLottieDocument animated scale and alpha tracks", () => {
  it("emits an animated scale track from scaleX/scaleY timeline blocks", () => {
    const animation: AnimationState = {
      id: "anim",
      name: "Anim",
      duration: 1000,
      blocks: [
        {
          id: "grow",
          layerId: "shape",
          propertyName: "scaleX",
          type: "number",
          fromValue: 1,
          toValue: 2,
          startTime: 0,
          endTime: 1000,
        },
        {
          id: "shrink",
          layerId: "shape",
          propertyName: "scaleY",
          type: "number",
          fromValue: 1,
          toValue: 0.5,
          startTime: 0,
          endTime: 1000,
        },
      ],
    };
    const lottie = exportLottieDocument([makeLayer()], "doc", { animation });
    const s = lottie.layers[0].ks.s;
    expect(s.a).toBe(1);
    // Keyframe values are percent-scaled 2D: [scaleX, scaleY].
    // X animates 100→200; Y animates 100→50 across the same span.
    expect(s.k[0]).toMatchObject({ t: 0, s: [100, 100], e: [200, 50] });
    expect(s.k.at(-1)).toMatchObject({ s: [200, 50] });
    expect(s.k.at(-1).t).toBe(30);
  });

  it("keeps static scale when no scale blocks exist", () => {
    const lottie = exportLottieDocument([makeLayer({ scaleX: 1.5, scaleY: 0.75 })], "doc", 1);
    const s = lottie.layers[0].ks.s;
    expect(s.a).toBe(0);
    expect(s.k).toEqual([150, 75]);
  });

  it("emits animated fill/stroke alpha from style alpha blocks", () => {
    const animation: AnimationState = {
      id: "anim",
      name: "Anim",
      duration: 1000,
      blocks: [
        {
          id: "fade-fill",
          layerId: "shape",
          propertyName: "fillAlpha",
          type: "number",
          fromValue: 1,
          toValue: 0.25,
          startTime: 100,
          endTime: 900,
        },
        {
          id: "fade-stroke",
          layerId: "shape",
          propertyName: "strokeAlpha",
          type: "number",
          fromValue: 0.9,
          toValue: 0.1,
          startTime: 100,
          endTime: 900,
        },
      ],
    };
    const layer = makeLayer({ fillColor: "#ff0000", strokeColor: "#0000ff" });
    const lottie = exportLottieDocument([layer], "doc", { animation });
    const fill = lottie.layers[0].shapes[0].it.find((item: { ty: string }) => item.ty === "fl")!;
    const stroke = lottie.layers[0].shapes[0].it.find((item: { ty: string }) => item.ty === "st")!;
    expect(fill.o.a).toBe(1);
    expect(fill.o.k[0].s).toEqual([100]);
    expect(fill.o.k.at(-1).s).toEqual([25]);
    expect(stroke.o.a).toBe(1);
    expect(stroke.o.k[0].s).toEqual([90]);
    expect(stroke.o.k.at(-1).s).toEqual([10]);
  });

  it("keeps static style alpha when only translation is animated", () => {
    const animation: AnimationState = {
      id: "anim",
      name: "Anim",
      duration: 1000,
      blocks: [
        {
          id: "move",
          layerId: "shape",
          propertyName: "translateX",
          type: "number",
          fromValue: 0,
          toValue: 10,
          startTime: 0,
          endTime: 1000,
        },
      ],
    };
    const layer = makeLayer({ fillColor: "#ff0000" });
    const lottie = exportLottieDocument([layer], "doc", { animation });
    const fill = lottie.layers[0].shapes[0].it.find((item: { ty: string }) => item.ty === "fl")!;
    expect(fill.c.a).toBe(0); // color static…
    expect(fill.o.a).toBe(0); // …and opacity static
  });

  it("still animates the group-level alpha channel on ks.o", () => {
    const animation: AnimationState = {
      id: "anim",
      name: "Anim",
      duration: 1000,
      blocks: [
        {
          id: "fade",
          layerId: "shape",
          propertyName: "alpha",
          type: "number",
          fromValue: 1,
          toValue: 0,
          startTime: 0,
          endTime: 1000,
        },
      ],
    };
    const lottie = exportLottieDocument([makeLayer()], "doc", { animation });
    const o = lottie.layers[0].ks.o;
    expect(o.a).toBe(1);
    expect(o.k[0].s).toEqual([100]);
    expect(o.k.at(-1).s).toEqual([0]);
  });
});

describe("exportLottieDocument clip-path handling", () => {
  it("warns that a clipPath layer was skipped instead of dropping it silently", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const lottie = exportLottieDocument(
        [
          { ...makeLayer({ id: "clip", name: "Clip" }), type: "clipPath" },
          makeLayer({ id: "art", name: "Art" }),
        ],
        "doc",
      );
      expect(lottie.layers.map((layer: { nm: string }) => layer.nm)).toEqual(["Art"]);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Clip path "Clip" was skipped'));
    } finally {
      warn.mockRestore();
    }
  });
});

describe("exportLottieDocument scene fidelity", () => {
  it("keeps inner group scale at 100 percent and paints Android's last sibling on top", () => {
    const lottie = exportLottieDocument(
      [makeLayer({ id: "bottom", name: "Bottom" }), makeLayer({ id: "top", name: "Top" })],
      "doc",
    );
    expect(lottie.layers.map((layer: { nm: string }) => layer.nm)).toEqual(["Top", "Bottom"]);
    expect(
      lottie.layers.every(
        (layer: { ip: number; op: number; st: number }) =>
          layer.ip === 0 && layer.op === lottie.op && layer.st === 0,
      ),
    ).toBe(true);
    expect(
      lottie.layers[0].shapes[0].it.find((item: { ty: string }) => item.ty === "tr").s.k,
    ).toEqual([100, 100]);
  });

  it("preserves pivot-based translation and inherited group and drawable alpha", () => {
    const group = makeLayer({ id: "group", type: "group", alpha: 0.5 });
    const child = makeLayer({
      parentId: "group",
      pivotX: 4,
      pivotY: 5,
      translateX: 2,
      translateY: 3,
      rotation: 90,
      alpha: 0.8,
    });
    const lottie = exportLottieDocument([group, child], "doc", {
      vector: { id: "v", name: "v", width: 24, height: 24, alpha: 0.5 },
    });
    const shape = lottie.layers.find((layer: { ty: number }) => layer.ty === 4)!;
    const scale = 512 / 24;
    expect(shape.ks.a.k).toEqual([4 * scale, 5 * scale]);
    expect(shape.ks.p.k).toEqual([6 * scale, 8 * scale]);
    expect(shape.ks.o.k).toBe(20);
    expect(shape.parent).toBe(lottie.layers.find((layer: { ty: number }) => layer.ty === 3)!.ind);
  });

  it("keeps a gradient's representative stop and opacity when the solid fill is none", () => {
    const layer = makeLayer({
      fillColor: "none",
      fillAlpha: 0.5,
      fillType: "evenOdd",
      fillGradient: {
        type: "linear",
        stops: [
          { offset: 0, color: "#f00", opacity: 0.2 },
          { offset: 1, color: "#00f", opacity: 0.6 },
        ],
      },
    });
    const result = exportLottieDocumentWithDiagnostics([layer], "doc", {
      animation: {
        id: "a",
        name: "a",
        duration: 1000,
        blocks: [
          {
            id: "color",
            layerId: "shape",
            propertyName: "fillColor",
            startTime: 0,
            endTime: 1000,
            fromValue: "#0f0",
            toValue: "#000",
            interpolator: "LINEAR",
          },
        ],
      },
    });
    const fill = result.lottie.layers[0].shapes[0].it.find(
      (item: { ty: string }) => item.ty === "fl",
    );
    expect(fill.c.k).toEqual([0, 0, 1, 1]);
    expect(fill.o.k).toBe(30);
    expect(fill.r).toBe(2);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "GRADIENT_APPROXIMATED", layerId: "shape" }),
    );
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: "TRACK_UNSUPPORTED", propertyName: "fillColor" }),
    );
  });

  it("parses CSS paint colors and puts embedded color alpha on paint opacity", () => {
    const lottie = exportLottieDocument(
      [
        makeLayer({
          fillColor: "#f008",
          fillAlpha: 0.5,
          strokeColor: "rgba(0,0,255,0.25)",
          strokeAlpha: 0.8,
        }),
      ],
      "doc",
    );
    const items = lottie.layers[0].shapes[0].it;
    const fill = items.find((item: { ty: string }) => item.ty === "fl");
    const stroke = items.find((item: { ty: string }) => item.ty === "st");
    expect(fill.c.k).toEqual([1, 0, 0, 136 / 255]);
    expect(fill.o.k).toBeCloseTo(((0.5 * 136) / 255) * 100);
    expect(stroke.c.k).toEqual([0, 0, 1, 64 / 255]);
    expect(stroke.o.k).toBeCloseTo(((0.8 * 64) / 255) * 100);
  });

  it("does not invent fill or stroke paint, or visible geometry for an empty document", () => {
    const lottie = exportLottieDocument(
      [makeLayer({ fillColor: "none", strokeColor: "none", strokeWidth: 0 })],
      "doc",
    );
    expect(
      lottie.layers[0].shapes[0].it.filter((item: { ty: string }) =>
        ["fl", "st"].includes(item.ty),
      ),
    ).toHaveLength(0);
    expect(exportLottieDocument([], "empty").layers).toEqual([]);
    expect(
      exportLottieDocument(
        [makeLayer({ from: makePath(""), to: undefined, fillColor: "red" })],
        "empty",
      ).layers,
    ).toEqual([]);
  });

  it("uses edited pathData and expands shorthand geometry before exporting", () => {
    const lottie = exportLottieDocument(
      [makeLayer({ pathData: makePath("M0 0 H4 V4 H0 Z"), to: undefined, fillColor: "red" })],
      "doc",
    );
    const shape = lottie.layers[0].shapes[0].it.find((item: { ty: string }) => item.ty === "sh").ks
      .k[0].s[0];
    expect(shape.v).toEqual([
      [0, 0],
      [(4 * 512) / 24, 0],
      [(4 * 512) / 24, (4 * 512) / 24],
      [0, (4 * 512) / 24],
    ]);
  });

  it("preserves path block timing, explicit endpoints, easing, and holds gaps", () => {
    const animation: AnimationState = {
      id: "a",
      name: "a",
      duration: 1000,
      blocks: [
        {
          id: "first",
          layerId: "shape",
          propertyName: "pathData",
          startTime: 100,
          endTime: 300,
          fromValue: "M0 0 L1 0",
          toValue: "M0 0 L2 0",
          interpolator: "LINEAR",
        },
        {
          id: "second",
          layerId: "shape",
          propertyName: "pathData",
          startTime: 700,
          endTime: 900,
          fromValue: "M0 0 L2 0",
          toValue: "M0 0 L3 0",
          interpolator: "FAST_OUT_SLOW_IN",
        },
      ],
    };
    const lottie = exportLottieDocument([makeLayer()], "doc", { animation });
    const keys = lottie.layers[0].shapes[0].it.find((item: { ty: string }) => item.ty === "sh").ks
      .k;
    expect(keys.map((key: { t: number }) => key.t)).toEqual([3, 9, 21, 27]);
    expect(keys[0].s[0].v[1][0]).toBeCloseTo(512 / 24);
    expect(keys[0].e[0].v[1][0]).toBeCloseTo((2 * 512) / 24);
    expect(keys[1].h).toBe(1);
    expect(keys[2].o).toEqual({ x: [0.4], y: [0] });
    expect(keys[3].s[0].v[1][0]).toBeCloseTo((3 * 512) / 24);
    expect(keys[0].e[0]).not.toBe(keys[1].s[0]);
  });

  it("ends each scalar and color block at its own endpoint and holds before the next block", () => {
    const animation: AnimationState = {
      id: "a",
      name: "a",
      duration: 1000,
      blocks: [
        {
          id: "one",
          layerId: "shape",
          propertyName: "rotation",
          startTime: 0,
          endTime: 200,
          fromValue: 0,
          toValue: 90,
          interpolator: "LINEAR",
        },
        {
          id: "two",
          layerId: "shape",
          propertyName: "rotation",
          startTime: 800,
          endTime: 1000,
          fromValue: 90,
          toValue: 180,
          interpolator: "LINEAR",
        },
        {
          id: "color",
          layerId: "shape",
          propertyName: "fillColor",
          startTime: 0,
          endTime: 200,
          fromValue: "red",
          toValue: "blue",
          interpolator: "LINEAR",
        },
        {
          id: "color2",
          layerId: "shape",
          propertyName: "fillColor",
          startTime: 800,
          endTime: 1000,
          fromValue: "blue",
          toValue: "red",
          interpolator: "LINEAR",
        },
      ],
    };
    const lottie = exportLottieDocument([makeLayer({ fillColor: "red" })], "doc", { animation });
    const rotation = lottie.layers[0].ks.r.k;
    expect(rotation.map((key: { t: number }) => key.t)).toEqual([0, 6, 24, 30]);
    expect(rotation[1]).toMatchObject({ s: [90], h: 1 });
    const fill = lottie.layers[0].shapes[0].it.find((item: { ty: string }) => item.ty === "fl");
    expect(fill.c.k.map((key: { t: number }) => key.t)).toEqual([0, 6, 24, 30]);
    expect(fill.c.k[1]).toMatchObject({ s: [0, 0, 1, 1], h: 1 });
  });

  it("animates color alpha in paint opacity even when there is no explicit opacity track", () => {
    const animation: AnimationState = {
      id: "a",
      name: "a",
      duration: 1000,
      blocks: [
        {
          id: "fade",
          layerId: "shape",
          propertyName: "fillColor",
          startTime: 0,
          endTime: 1000,
          fromValue: "#ff000000",
          toValue: "red",
          interpolator: "LINEAR",
        },
      ],
    };
    const lottie = exportLottieDocument([makeLayer({ fillColor: "red", fillAlpha: 0.5 })], "doc", {
      animation,
    });
    const fill = lottie.layers[0].shapes[0].it.find((item: { ty: string }) => item.ty === "fl");
    expect(fill.o.k[0]).toMatchObject({ t: 0, s: [0], e: [50] });
    expect(fill.o.k.at(-1)).toMatchObject({ t: 30, s: [50] });
  });

  it("returns actionable diagnostics only for visible unsupported artwork and tracks", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const result = exportLottieDocumentWithDiagnostics(
        [
          makeLayer({ id: "clip", type: "clipPath" }),
          makeLayer({ trimPathStart: 0.2 }),
          makeLayer({ id: "hidden", visible: false, fillGradient: { type: "linear", stops: [] } }),
        ],
        "doc",
        {
          animation: {
            id: "a",
            name: "a",
            duration: 1000,
            blocks: [
              {
                id: "width",
                layerId: "shape",
                propertyName: "strokeWidth",
                startTime: 0,
                endTime: 1000,
                fromValue: 1,
                toValue: 4,
              },
            ],
          },
        },
      );
      expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
        "CLIPPING_UNSUPPORTED",
        "TRIM_UNSUPPORTED",
        "TRACK_UNSUPPORTED",
      ]);
      expect(result.diagnostics.every((diagnostic) => diagnostic.layerId !== "hidden")).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

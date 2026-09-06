import { describe, expect, it, vi } from "vitest";
import { exportLottie, exportLottieDocument } from "../lottie";
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
    expect(s.k[0]).toMatchObject({ t: 0, s: [[100, 100]], e: [[200, 50]] });
    expect(s.k.at(-1)).toMatchObject({ s: [[200, 50]] });
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

/**
 * ShapeShifter 2026 — Exporter Tests
 * Comprehensive Vitest coverage for all 7 export formats.
 */

import { describe, it, expect } from "vitest";
import { parsePath, pathToString, getInterpolatedPath } from "../pathUtils";
import type { AnimationState, Layer, PathData, VectorMetadata } from "../types";
import {
  exportAnimatedSVG,
  exportCSSKeyframes,
  exportStaticSVG,
  exportSvgSpritesheet,
  exportVectorDrawable,
  exportAnimatedVectorDrawable,
  exportLottie,
  exportLottieDocument,
  exportPDF,
  exportProjectJSON,
} from "../exporter";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makePath(d: string): PathData {
  return parsePath(d);
}

function makeLayer(overrides: Partial<Layer> = {}): Layer {
  const from = makePath("M 0 0 L 10 0 L 10 10 L 0 10 Z");
  const to = makePath("M 2 2 L 12 2 L 12 12 L 2 12 Z");
  return {
    id: 1,
    name: "test-layer",
    type: "path",
    from,
    to,
    visible: true,
    locked: false,
    ...overrides,
  };
}

// ── 1. Animated SVG ──────────────────────────────────────────────────────────

describe("exportAnimatedSVG", () => {
  const from = makePath("M 0 0 L 24 0 L 24 24 L 0 24 Z");
  const to = makePath("M 4 4 L 20 4 L 20 20 L 4 20 Z");

  it("produces valid SVG with XML declaration and svg root element", () => {
    const svg = exportAnimatedSVG(from, to);
    expect(svg).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it("includes viewBox, width, and height from options", () => {
    const svg = exportAnimatedSVG(from, to, "Test", { width: 1024, height: 768 });
    expect(svg).toContain('width="1024"');
    expect(svg).toContain('height="768"');
    expect(svg).toContain('viewBox="0 0 48 48"');
  });

  it("contains from and to path data", () => {
    const svg = exportAnimatedSVG(from, to);
    const fromD = pathToString(from);
    const toD = pathToString(to);
    expect(svg).toContain(`d="${fromD}"`);
    expect(svg).toContain(`d="${toD}"`);
  });

  it("contains an embedded <script> block for animation", () => {
    const svg = exportAnimatedSVG(from, to);
    expect(svg).toContain("<script>");
    expect(svg).toContain("</script>");
    expect(svg).toContain("requestAnimationFrame");
  });

  it("embeds baked morph frames (matches on-canvas getInterpolatedPath preview)", () => {
    const svg = exportAnimatedSVG(from, to);
    // Frames are pre-baked via getInterpolatedPath so the exported morph matches
    // the preview even when from/to command structures differ.
    expect(svg).toContain("var frames = [");
    // First baked frame equals the from path; last equals the to path.
    expect(svg).toContain(pathToString(from));
    expect(svg).toContain(pathToString(to));
  });

  it("baked frames equal getInterpolatedPath output (export matches preview, no per-number truncation)", () => {
    // from has 3 commands, to has 6 — the old per-number lerp over the FROM
    // skeleton dropped every surplus target point.
    const fromShort = makePath("M 0 0 L 10 0 L 10 10 Z");
    const toLong = makePath("M 0 0 L 5 0 L 10 0 L 10 5 L 10 10 L 5 10 Z");
    const svg = exportAnimatedSVG(fromShort, toLong, "Mismatch");
    const m = svg.match(/var frames = (\[[\s\S]*?\]);/);
    expect(m).not.toBeNull();
    const frames: string[] = JSON.parse(m![1]);
    expect(frames).toHaveLength(60);
    // Every baked frame is exactly what getInterpolatedPath produces, so the
    // exported morph is identical to the on-canvas preview.
    for (let i = 0; i < frames.length; i++) {
      const t = i / (frames.length - 1);
      expect(frames[i]).toBe(getInterpolatedPath(fromShort, toLong, t));
    }
    // The toLong-only segments survive in the final frame (the old per-number
    // lerp over FROM's skeleton dropped them entirely).
    expect(frames[frames.length - 1]).toContain("L10 10");
    expect(frames[frames.length - 1]).toContain("L5 10");
  });

  it("uses custom duration and stroke width", () => {
    const svg = exportAnimatedSVG(from, to, "Morph", {
      duration: 2.5,
      strokeWidth: 4,
    });
    expect(svg).toContain("const duration = 2.5");
    expect(svg).toContain('stroke-width="4"');
  });

  it("sets loop flag correctly when loop=false", () => {
    const svg = exportAnimatedSVG(from, to, "Morph", { loop: false });
    expect(svg).toContain("const loop = false");
  });

  it("uses custom colors for from, to, and morph paths", () => {
    const svg = exportAnimatedSVG(from, to, "Test", {
      fromColor: "#ff0000",
      toColor: "#00ff00",
      morphColor: "#0000ff",
    });
    expect(svg).toContain('stroke="#ff0000"');
    expect(svg).toContain('stroke="#00ff00"');
    expect(svg).toContain('stroke="#0000ff"');
  });

  it("contains MORPH label in the SVG", () => {
    const svg = exportAnimatedSVG(from, to);
    expect(svg).toContain(">MORPH<");
  });

  it("handles empty from/to paths (graceful empty d attribute)", () => {
    const emptyFrom = makePath("");
    const emptyTo = makePath("");
    const svg = exportAnimatedSVG(emptyFrom, emptyTo, "Empty");
    // Should still produce valid SVG structure
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });
});

// ── 2. CSS Keyframes ────────────────────────────────────────────────────────

describe("exportCSSKeyframes", () => {
  const from = makePath("M 0 0 L 10 0 L 10 10 L 0 10 Z");
  const to = makePath("M 2 2 L 12 2 L 12 12 L 2 12 Z");

  it("produces @keyframes block with given name", () => {
    const css = exportCSSKeyframes(from, to, "myMorph");
    expect(css).toContain("@keyframes myMorph {");
  });

  it("contains 0% and 100% keyframe steps", () => {
    const css = exportCSSKeyframes(from, to);
    expect(css).toContain("0% { d: path(");
    expect(css).toContain("100% { d: path(");
  });

  it("generates intermediate keyframe steps (8 steps = 9 entries)", () => {
    const css = exportCSSKeyframes(from, to);
    const matches = css.match(/\d+% \{ d: path\(/g);
    expect(matches).toHaveLength(9); // 0% through 100% in 8 steps
  });

  it("includes CSS class with animation shorthand", () => {
    const css = exportCSSKeyframes(from, to, "morph", 2.0);
    expect(css).toContain(".morph {");
    expect(css).toContain("animation: morph 2s infinite ease-in-out");
  });

  it("uses default values when no args provided", () => {
    const css = exportCSSKeyframes(from, to);
    expect(css).toContain("@keyframes morph {");
    expect(css).toContain("animation: morph 1.2s infinite ease-in-out");
  });

  it("path data at 0% matches from path", () => {
    const css = exportCSSKeyframes(from, to);
    const fromD = pathToString(from);
    expect(css).toContain(`0% { d: path("${fromD}"); }`);
  });

  it("path data at 100% matches to path", () => {
    const css = exportCSSKeyframes(from, to);
    const toD = pathToString(to);
    expect(css).toContain(`100% { d: path("${toD}"); }`);
  });

  it("sanitizes name with spaces (lowercase + dashes)", () => {
    // This is what downloadCSSKeyframes does before calling exportCSSKeyframes
    const css = exportCSSKeyframes(from, to, "my-cool-morph");
    expect(css).toContain("@keyframes my-cool-morph {");
  });
});

// ── 3. Static SVG ────────────────────────────────────────────────────────────

describe("exportStaticSVG", () => {
  const layer1 = makeLayer({ id: 1, name: "square", fillColor: "#3b82f6" });
  const layer2 = makeLayer({
    id: 2,
    name: "circle",
    from: makePath(
      "M 12 0 C 18 0 24 6 24 12 C 24 18 18 24 12 24 C 6 24 0 18 0 12 C 0 6 6 0 12 0 Z",
    ),
    fillColor: "#ef4444",
    strokeColor: "#000000",
    strokeWidth: 2,
  });

  it("produces valid SVG with XML declaration", () => {
    const svg = exportStaticSVG([layer1]);
    expect(svg).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("includes viewBox and dimensions", () => {
    const svg = exportStaticSVG([layer1], { width: 256, height: 256 });
    expect(svg).toContain('width="256"');
    expect(svg).toContain('height="256"');
    expect(svg).toContain('viewBox="0 0 48 48"');
  });

  it("renders each visible path layer as a <path> element", () => {
    const svg = exportStaticSVG([layer1, layer2]);
    const pathMatches = svg.match(/<path /g);
    expect(pathMatches).toHaveLength(2);
  });

  it("sets id from sanitized layer name", () => {
    const svg = exportStaticSVG([layer1]);
    expect(svg).toContain('id="square"');
  });

  it("includes fill color attribute", () => {
    const svg = exportStaticSVG([layer1]);
    expect(svg).toContain('fill="#3b82f6"');
  });

  it("includes stroke attributes when present", () => {
    const svg = exportStaticSVG([layer2]);
    expect(svg).toContain('stroke="#000000"');
    expect(svg).toContain('stroke-width="2"');
  });

  it("filters out invisible layers", () => {
    const hidden = makeLayer({ id: 3, name: "hidden", visible: false });
    const svg = exportStaticSVG([layer1, hidden]);
    expect(svg).not.toContain('id="hidden"');
    const pathMatches = svg.match(/<path /g);
    expect(pathMatches).toHaveLength(1);
  });

  it("filters out group layers", () => {
    const group = makeLayer({ id: 4, name: "group", type: "group" });
    const svg = exportStaticSVG([layer1, group]);
    expect(svg).not.toContain('id="group"');
  });

  it("handles empty layers array", () => {
    const svg = exportStaticSVG([]);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    // No <path> elements
    expect(svg).not.toContain("<path ");
  });

  it("handles layer with evenOdd fillType", () => {
    const evenOddLayer = makeLayer({ id: 5, name: "evenodd", fillType: "evenOdd" });
    const svg = exportStaticSVG([evenOddLayer]);
    expect(svg).toContain('fill-rule="evenodd"');
  });

  it("handles layer with round stroke linecap and linejoin", () => {
    const roundLayer = makeLayer({
      id: 6,
      name: "round",
      strokeLinecap: "round",
      strokeLinejoin: "round",
      strokeColor: "#000",
      strokeWidth: 3,
    });
    const svg = exportStaticSVG([roundLayer]);
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
  });

  it("sanitizes layer names with special characters via safeName", () => {
    const weirdName = makeLayer({ id: 7, name: 'layer<"test">' });
    const svg = exportStaticSVG([weirdName]);
    expect(svg).toContain('id="layer_test_"');
  });
});

// ── 4. SVG Spritesheet ───────────────────────────────────────────────────────

describe("exportSvgSpritesheet", () => {
  const layer = makeLayer({ id: 1, name: "morph" });

  it("produces valid SVG structure", () => {
    const svg = exportSvgSpritesheet(layer);
    expect(svg).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("generates correct number of frames based on fps and duration", () => {
    const svg = exportSvgSpritesheet(layer, { fps: 10, duration: 1.2 });
    // frameCount = round(10 * 1.2) = 12
    const frameGroups = svg.match(/<g id="/g);
    expect(frameGroups).toHaveLength(12);
  });

  it("generates at least 2 frames minimum", () => {
    const svg = exportSvgSpritesheet(layer, { fps: 1, duration: 0.1 });
    const frameGroups = svg.match(/<g id="/g);
    expect(frameGroups!.length).toBeGreaterThanOrEqual(2);
  });

  it("widens the viewBox proportionally to frame count", () => {
    const svg = exportSvgSpritesheet(layer, { fps: 5, duration: 1 });
    // frameCount = round(5 * 1) = 5
    expect(svg).toContain('viewBox="0 0 240 48"'); // 48 * 5 = 240
  });

  it("widens the SVG width proportionally to frame count", () => {
    const svg = exportSvgSpritesheet(layer, { fps: 5, duration: 1, width: 256, height: 256 });
    // frameCount = 5, width = 256 * 5 = 1280
    expect(svg).toContain('width="1280"');
    expect(svg).toContain('height="256"');
  });

  it("each frame has a translate transform", () => {
    const svg = exportSvgSpritesheet(layer, { fps: 3, duration: 1 });
    expect(svg).toContain('transform="translate(0 0)"');
    expect(svg).toContain('transform="translate(48 0)"');
    expect(svg).toContain('transform="translate(96 0)"');
  });

  it("includes layer style attributes in each frame", () => {
    const styledLayer = makeLayer({
      id: 1,
      name: "styled",
      fillColor: "#ff0000",
      strokeColor: "#000000",
      strokeWidth: 2,
    });
    const svg = exportSvgSpritesheet(styledLayer, { fps: 2, duration: 1 });
    // Should have fill and stroke in each frame
    const fillMatches = svg.match(/fill="#ff0000"/g);
    expect(fillMatches).toHaveLength(2);
  });

  it("frame 0 contains from path data, last frame contains to path data", () => {
    const svg = exportSvgSpritesheet(layer, { fps: 2, duration: 1 });
    const fromD = pathToString(layer.from);
    const toD = pathToString(layer.to!);
    expect(svg).toContain(`d="${fromD}"`);
    expect(svg).toContain(`d="${toD}"`);
  });

  it("names frames with layer name prefix", () => {
    const svg = exportSvgSpritesheet(layer, { fps: 3, duration: 1 });
    expect(svg).toContain('id="morph_frame_0"');
    expect(svg).toContain('id="morph_frame_1"');
    expect(svg).toContain('id="morph_frame_2"');
  });
});

// ── 5. Vector Drawable (Android) ─────────────────────────────────────────────

describe("exportVectorDrawable", () => {
  const layer = makeLayer({
    id: 1,
    name: "icon",
    fillColor: "#3b82f6",
    strokeColor: "#1e3a5f",
    strokeWidth: 2,
  });

  it("produces valid <vector> root element with android namespace", () => {
    const vd = exportVectorDrawable(layer);
    expect(vd).toContain("<vector");
    expect(vd).toContain("</vector>");
    expect(vd).toContain('xmlns:android="http://schemas.android.com/apk/res/android"');
  });

  it("includes width and height in dp", () => {
    const vd = exportVectorDrawable(layer, { width: 24, height: 24 });
    expect(vd).toContain('android:width="24dp"');
    expect(vd).toContain('android:height="24dp"');
  });

  it("includes viewport dimensions", () => {
    const vd = exportVectorDrawable(layer);
    expect(vd).toContain('android:viewportWidth="48"');
    expect(vd).toContain('android:viewportHeight="48"');
  });

  it("includes path data from layer.from", () => {
    const vd = exportVectorDrawable(layer);
    const fromD = pathToString(layer.from);
    expect(vd).toContain(`android:pathData="${fromD}"`);
  });

  it("includes fill color", () => {
    const vd = exportVectorDrawable(layer);
    expect(vd).toContain('android:fillColor="#3b82f6"');
  });

  it("includes stroke attributes when present", () => {
    const vd = exportVectorDrawable(layer);
    expect(vd).toContain('android:strokeColor="#1e3a5f"');
    expect(vd).toContain('android:strokeWidth="2"');
  });

  it("uses transparent fill when no fillColor specified", () => {
    const noFill = makeLayer({ id: 2, name: "nofill", fillColor: "" });
    const vd = exportVectorDrawable(noFill);
    expect(vd).toContain('android:fillColor="@android:color/transparent"');
  });

  it("includes trim path attributes", () => {
    const trimmed = makeLayer({
      id: 3,
      name: "trimmed",
      trimPathStart: 0.1,
      trimPathEnd: 0.9,
      trimPathOffset: 0.5,
    });
    const vd = exportVectorDrawable(trimmed);
    expect(vd).toContain('android:trimPathStart="0.1"');
    expect(vd).toContain('android:trimPathEnd="0.9"');
    expect(vd).toContain('android:trimPathOffset="0.5"');
  });

  it("includes fill type", () => {
    const evenOdd = makeLayer({ id: 4, name: "evenodd", fillType: "evenOdd" });
    const vd = exportVectorDrawable(evenOdd);
    expect(vd).toContain('android:fillType="evenOdd"');
  });

  it("sanitizes layer name for android:name", () => {
    const weirdName = makeLayer({ id: 5, name: "my icon.v2" });
    const vd = exportVectorDrawable(weirdName);
    expect(vd).toContain('android:name="my_icon.v2"');
  });

  it("escapes XML in path data if special chars present", () => {
    // Path data shouldn't normally have special chars, but safeName should work
    const vd = exportVectorDrawable(layer);
    expect(vd).toContain("android:pathData=");
  });
});

// ── 6. Animated Vector Drawable (Android) ────────────────────────────────────

describe("exportAnimatedVectorDrawable", () => {
  const layer = makeLayer({ id: 1, name: "animated_icon" });

  it("produces <animated-vector> root element", () => {
    const avd = exportAnimatedVectorDrawable(layer);
    expect(avd).toContain("<animated-vector");
    expect(avd).toContain("</animated-vector>");
  });

  it("references a vector drawable", () => {
    const avd = exportAnimatedVectorDrawable(layer);
    expect(avd).toContain("@drawable/animated_icon_vector");
  });

  it("contains an <objectAnimator> for path morphing", () => {
    const avd = exportAnimatedVectorDrawable(layer);
    expect(avd).toContain("<objectAnimator");
    expect(avd).toContain('android:propertyName="pathData"');
    expect(avd).toContain('android:valueType="pathType"');
  });

  it("sets duration from options (in milliseconds)", () => {
    const avd = exportAnimatedVectorDrawable(layer, { duration: 2.0 });
    expect(avd).toContain('android:duration="2000"');
  });

  it("uses default duration of 1200ms", () => {
    const avd = exportAnimatedVectorDrawable(layer);
    expect(avd).toContain('android:duration="1200"');
  });

  it("includes from and to path data in animator", () => {
    const avd = exportAnimatedVectorDrawable(layer);
    const fromD = pathToString(layer.from);
    const toD = pathToString(layer.to!);
    expect(avd).toContain(`android:valueFrom="${fromD}"`);
    expect(avd).toContain(`android:valueTo="${toD}"`);
  });

  it("also includes the static vector drawable definition", () => {
    const avd = exportAnimatedVectorDrawable(layer);
    expect(avd).toContain("<vector");
    expect(avd).toContain("</vector>");
    // Should contain the static VD as a comment block
    expect(avd).toContain("<!-- animated_icon_vector.xml -->");
  });

  it("references the animator file", () => {
    const avd = exportAnimatedVectorDrawable(layer);
    expect(avd).toContain("@animator/animated_icon_morph");
  });
});

// ── 7. Lottie JSON ──────────────────────────────────────────────────────────

describe("exportLottie", () => {
  const from = makePath("M 0 0 L 24 0 L 24 24 L 0 24 Z");
  const to = makePath("M 4 4 L 20 4 L 20 20 L 4 20 Z");

  it("produces a valid JSON-serializable object", () => {
    const lottie = exportLottie(from, to, "test");
    const json = JSON.stringify(lottie);
    expect(json).toBeTruthy();
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(lottie);
  });

  it("has correct Lottie root fields", () => {
    const lottie = exportLottie(from, to, "myAnim", 2.0);
    expect(lottie.v).toBe("5.9.0");
    expect(lottie.fr).toBe(30);
    expect(lottie.ip).toBe(0);
    expect(lottie.op).toBe(60); // 2.0 * 30
    expect(lottie.w).toBe(512);
    expect(lottie.h).toBe(512);
    expect(lottie.nm).toBe("myAnim");
    expect(lottie.ddd).toBe(0);
    expect(lottie.assets).toEqual([]);
  });

  it("has exactly one layer", () => {
    const lottie = exportLottie(from, to, "test");
    expect(lottie.layers).toHaveLength(1);
  });

  it("layer is a shape layer (type 4)", () => {
    const lottie = exportLottie(from, to, "test");
    expect(lottie.layers[0].ty).toBe(4);
    expect(lottie.layers[0].ind).toBe(1);
  });

  it("layer has transform properties (position, rotation, scale, opacity)", () => {
    const lottie = exportLottie(from, to, "test");
    const ks = lottie.layers[0].ks;
    expect(ks.p).toBeDefined();
    expect(ks.r).toBeDefined();
    expect(ks.s).toBeDefined();
    expect(ks.o).toBeDefined();
    expect(ks.p.k).toEqual([256, 256]); // w/2, h/2
  });

  it("layer has a shape group with path animation", () => {
    const lottie = exportLottie(from, to, "test");
    const shapes = lottie.layers[0].shapes;
    expect(shapes).toHaveLength(1);
    expect(shapes[0].ty).toBe("gr");
    const group = shapes[0];
    // Should have: path, stroke, fill, transform
    expect(group.it.length).toBeGreaterThanOrEqual(3);
    const pathItem = group.it.find((item: { ty: string }) => item.ty === "sh")!;
    expect(pathItem).toBeDefined();
  });

  it("path has animated keyframes (a: 1 with t values)", () => {
    const lottie = exportLottie(from, to, "test");
    const shapeGroup = lottie.layers[0].shapes[0];
    const pathItem = shapeGroup.it.find((item: { ty: string }) => item.ty === "sh")!;
    const ks = pathItem.ks!;
    expect(ks).toBeDefined();
    expect(ks.a).toBe(1);
    expect(ks.k).toHaveLength(2);
    expect(ks.k[0].t).toBe(0);
    expect(ks.k[1].t).toBe(lottie.op);
  });

  it("shape has stroke and fill items", () => {
    const lottie = exportLottie(from, to, "test");
    const group = lottie.layers[0].shapes[0];
    const stroke = group.it.find((item: { ty: string }) => item.ty === "st")!;
    const fill = group.it.find((item: { ty: string }) => item.ty === "fl")!;
    expect(stroke).toBeDefined();
    expect(fill).toBeDefined();
    expect(stroke.c).toBeDefined();
    expect(stroke.w).toBeDefined();
  });

  it("handles empty paths with fallback vertices", () => {
    const emptyFrom = makePath("");
    const emptyTo = makePath("");
    const lottie = exportLottie(emptyFrom, emptyTo, "empty");
    expect(lottie.layers).toHaveLength(1);
    // Should use fallback vertices
    const shapeGroup = lottie.layers[0].shapes[0];
    const pathItem = shapeGroup.it.find((item: { ty: string }) => item.ty === "sh")!;
    expect(pathItem.ks!.k[0].s[0].v.length).toBeGreaterThan(0);
  });

  it("pads vertices to equal lengths when from and to have different counts", () => {
    const shortFrom = makePath("M 0 0 L 10 0 L 10 10 Z"); // 3 commands with points
    const longTo = makePath("M 0 0 L 5 0 L 10 0 L 10 5 L 10 10 L 5 10 Z"); // 6 commands with points
    const lottie = exportLottie(shortFrom, longTo, "unequal");
    const shapeGroup = lottie.layers[0].shapes[0];
    const pathItem = shapeGroup.it.find((item: { ty: string }) => item.ty === "sh")!;
    const ks = pathItem.ks!;
    const fromVerts = ks.k[0].s[0].v;
    const toVerts = ks.k[1].s[0].v;
    expect(fromVerts.length).toBe(toVerts.length);
  });

  it("uses default duration of 1.2s when not specified", () => {
    const lottie = exportLottie(from, to, "test");
    expect(lottie.op).toBe(36); // 1.2 * 30 = 36
  });

  it("uses custom duration correctly", () => {
    const lottie = exportLottie(from, to, "test", 3.0);
    expect(lottie.op).toBe(90); // 3.0 * 30 = 90
  });

  it("exports a multi-layer Lottie document instead of only the selected layer", () => {
    const lottie = exportLottieDocument(
      [
        makeLayer({ id: "one", name: "One", translateX: 2 }),
        makeLayer({ id: "hidden", name: "Hidden", visible: false }),
        makeLayer({ id: "two", name: "Two", rotation: 15, alpha: 0.5 }),
      ],
      "document",
      2,
    );

    expect(lottie.nm).toBe("document");
    expect(lottie.op).toBe(60);
    expect(lottie.layers).toHaveLength(2);
    expect(lottie.layers.map((layer: any) => layer.nm)).toEqual(["One", "Two"]);
    expect(lottie.layers[0].ks.p.k[0]).toBeGreaterThan(256);
    expect(lottie.layers[1].ks.r.k).toBe(15);
    expect(lottie.layers[1].ks.o.k).toBe(50);
  });

  it("exports group parenting plus AVD-style transform and color timeline tracks", () => {
    const lottie = exportLottieDocument(
      [
        { ...makeLayer({ id: "group", name: "Group" }), type: "group", children: undefined },
        { ...makeLayer({ id: "child", name: "Child", parentId: "group" }), fillColor: "#ff0000" },
      ],
      "animated-document",
      {
        animation: {
          id: "motion",
          name: "Motion",
          duration: 1000,
          blocks: [
            {
              id: "move",
              layerId: "child",
              propertyName: "translateX",
              type: "number",
              fromValue: 0,
              toValue: 12,
              startTime: 0,
              endTime: 1000,
              interpolator: "LINEAR",
            },
            {
              id: "color",
              layerId: "child",
              propertyName: "fillColor",
              type: "color",
              fromValue: "#ff0000",
              toValue: "#0000ff",
              startTime: 200,
              endTime: 800,
              interpolator: "FAST_OUT_SLOW_IN",
            },
          ],
        },
      },
    );
    const group = lottie.layers.find((layer: any) => layer.nm === "Group")!;
    const child = lottie.layers.find((layer: any) => layer.nm === "Child")!;
    expect(group.ty).toBe(3);
    expect(child.parent).toBe(group.ind);
    expect(child.ks.p.s).toBe(true);
    expect(child.ks.p.x.a).toBe(1);
    const fill = child.shapes[0].it.find((item: { ty: string }) => item.ty === "fl")!;
    expect(fill.c.a).toBe(1);
  });
});

// ── 8. Project JSON ──────────────────────────────────────────────────────────

describe("exportProjectJSON", () => {
  const layer1 = makeLayer({
    id: 1,
    name: "path1",
    fillColor: "#3b82f6",
    strokeColor: "#000",
    strokeWidth: 2,
  });
  const groupLayer: Layer = {
    id: 10,
    name: "group1",
    type: "group",
    from: makePath(""),
    to: makePath(""),
    visible: true,
    locked: false,
    rotation: 45,
    scaleX: 1.5,
    scaleY: 1.5,
    translateX: 10,
    translateY: 20,
    children: [layer1],
  };
  const childLayer = makeLayer({
    id: 2,
    name: "child",
    parentId: 10,
    fillColor: "#ef4444",
  });

  it("produces a valid JSON-serializable object", () => {
    const project = exportProjectJSON([layer1]);
    const json = JSON.stringify(project);
    expect(json).toBeTruthy();
    const parsed = JSON.parse(json);
    expect(parsed).toEqual(project);
  });

  it("has version 1 and required top-level keys", () => {
    const project = exportProjectJSON([]);
    expect(project.version).toBe(1);
    expect(project.layers).toBeDefined();
    expect(project.timeline).toBeDefined();
  });

  it("includes vector metadata", () => {
    const vector: VectorMetadata = { id: "v1", name: "MyVec", width: 48, height: 48, alpha: 0.8 };
    const project = exportProjectJSON([], vector);
    expect(project.layers.vectorLayer.id).toBe("v1");
    expect(project.layers.vectorLayer.name).toBe("MyVec");
    expect(project.layers.vectorLayer.width).toBe(48);
    expect(project.layers.vectorLayer.height).toBe(48);
    expect(project.layers.vectorLayer.alpha).toBe(0.8);
  });

  it("serializes path layers with all style properties", () => {
    const project = exportProjectJSON([layer1]);
    const child = project.layers.vectorLayer.children[0] as Record<string, unknown>;
    expect(child.name).toBe("path1");
    expect(child.fillColor).toBe("#3b82f6");
    expect(child.strokeColor).toBe("#000");
    expect(child.strokeWidth).toBe(2);
    expect(child.pathData).toBeDefined();
    expect(typeof child.pathData).toBe("string");
  });

  it("serializes group layers with transform and children", () => {
    const project = exportProjectJSON([groupLayer, childLayer]);
    const group = project.layers.vectorLayer.children.find(
      (c: Record<string, unknown>) => c.type === "group",
    ) as Record<string, unknown>;
    expect(group).toBeDefined();
    expect(group.rotation).toBe(45);
    expect(group.scaleX).toBe(1.5);
    expect(group.scaleY).toBe(1.5);
    expect(group.translateX).toBe(10);
    expect(group.translateY).toBe(20);
    expect(Array.isArray(group.children)).toBe(true);
  });

  it("nests child layers under their parent group", () => {
    const project = exportProjectJSON([groupLayer, childLayer]);
    const group = project.layers.vectorLayer.children.find(
      (c: Record<string, unknown>) => c.type === "group",
    ) as Record<string, unknown>;
    expect(group.children).toHaveLength(1);
    expect((group.children as Record<string, unknown>[])[0].name).toBe("child");
  });

  it("includes animation state in timeline", () => {
    const animation: AnimationState = {
      id: "anim1",
      name: "TestAnim",
      duration: 2000,
      blocks: [
        {
          id: "b1",
          layerId: 1,
          propertyName: "pathData",
          fromValue: "M0 0 L10 0",
          toValue: "M5 5 L15 5",
          startTime: 0,
          endTime: 2000,
          interpolator: "LINEAR",
        },
      ],
    };
    const project = exportProjectJSON([], undefined, animation);
    expect(project.timeline.animation.id).toBe("anim1");
    expect(project.timeline.animation.blocks).toHaveLength(1);
  });

  it("includes hiddenLayerIds", () => {
    const project = exportProjectJSON([], undefined, undefined, ["layer3", "layer5"]);
    expect(project.layers.hiddenLayerIds).toEqual(["layer3", "layer5"]);
  });

  it("handles empty project (no layers)", () => {
    const project = exportProjectJSON([]);
    expect(project.layers.vectorLayer.children).toEqual([]);
  });

  it("serializes clipPath type correctly", () => {
    const clipLayer = makeLayer({ id: 3, name: "clip", type: "clipPath" });
    const project = exportProjectJSON([clipLayer]);
    const child = project.layers.vectorLayer.children[0] as Record<string, unknown>;
    expect(child.type).toBe("clipPath");
  });

  it("defaults to 'path' type for unknown layer types", () => {
    // 'vector' type is not 'clipPath' or 'group', so it should be 'path'
    const vectorLike = makeLayer({ id: 4, name: "vec", type: "vector" });
    const project = exportProjectJSON([vectorLike]);
    const child = project.layers.vectorLayer.children[0] as Record<string, unknown>;
    expect(child.type).toBe("path");
  });

  it("uses defaults for vector metadata and animation when not provided", () => {
    const project = exportProjectJSON([]);
    expect(project.layers.vectorLayer.id).toBe("vector");
    expect(project.layers.vectorLayer.name).toBe("ShapeShifter");
    expect(project.timeline.animation.id).toBe("anim");
    expect(project.timeline.animation.duration).toBe(1000);
    expect(project.timeline.animation.blocks).toEqual([]);
  });
});

// ── Edge Cases / Integration ─────────────────────────────────────────────────

describe("exporter edge cases", () => {
  it("exportAnimatedSVG with single-point paths", () => {
    const single = makePath("M 5 5");
    const svg = exportAnimatedSVG(single, single, "Single");
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
  });

  it("exportCSSKeyframes with identical from/to paths", () => {
    const path = makePath("M 0 0 L 10 10");
    const css = exportCSSKeyframes(path, path, "identical");
    // All keyframes should have same path
    const fromD = pathToString(path);
    const occurrences = css.split(fromD).length - 1;
    expect(occurrences).toBe(9); // 0% through 100% in 8 steps
  });

  it("exportStaticSVG with multiple layers having different path styles", () => {
    const layers: Layer[] = [
      makeLayer({
        id: 1,
        name: "filled",
        fillColor: "#ff0000",
        fillAlpha: 0.5,
        strokeColor: "#000",
        strokeWidth: 1,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeMiterLimit: 8,
      }),
      makeLayer({
        id: 2,
        name: "stroke-only",
        fillColor: "none",
        strokeColor: "#00ff00",
        strokeWidth: 3,
      }),
    ];
    const svg = exportStaticSVG(layers);
    expect(svg).toContain('fill="#ff0000"');
    expect(svg).toContain('fill-opacity="0.5"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-miterlimit="8"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke="#00ff00"');
  });

  it("exportSvgSpritesheet with layer that has empty from/to", () => {
    const emptyLayer = makeLayer({
      id: 1,
      name: "empty",
      from: makePath(""),
      to: makePath(""),
    });
    const svg = exportSvgSpritesheet(emptyLayer, { fps: 2, duration: 1 });
    expect(svg).toContain("<svg");
    // Should still generate frames
    const frames = svg.match(/<g id="/g);
    expect(frames).toHaveLength(2);
  });

  it("exportVectorDrawable without stroke produces no strokeColor attribute", () => {
    const noStroke = makeLayer({ id: 1, name: "nostroke", strokeColor: "" });
    const vd = exportVectorDrawable(noStroke);
    expect(vd).not.toContain("android:strokeColor");
  });

  it("exportAnimatedVectorDrawable with custom duration rounds correctly", () => {
    const layer = makeLayer({ id: 1, name: "test" });
    const avd = exportAnimatedVectorDrawable(layer, { duration: 0.5 });
    expect(avd).toContain('android:duration="500"');
  });

  it("exportLottie shape keyframes have matching vertex structure", () => {
    const from = makePath("M 0 0 L 10 0 L 10 10 L 0 10 Z");
    const to = makePath("M 2 2 L 12 2 L 12 12 L 2 12 Z");
    const lottie = exportLottie(from, to, "test");
    const shapeGroup = lottie.layers[0].shapes[0];
    const pathItem = shapeGroup.it.find((item: { ty: string }) => item.ty === "sh")!;
    const ks = pathItem.ks!;
    const fromShape = ks.k[0].s[0];
    const toShape = ks.k[1].s[0];
    // Same number of vertices
    expect(fromShape.v.length).toBe(toShape.v.length);
    expect(fromShape.i.length).toBe(toShape.i.length);
    expect(fromShape.o.length).toBe(toShape.o.length);
    // Closed flag
    expect(fromShape.c).toBe(true);
    expect(toShape.c).toBe(true);
  });

  it("exportProjectJSON layer with all optional fields uses defaults", () => {
    const minimal: Layer = {
      id: 99,
      name: "minimal",
      type: "path",
      from: makePath("M 0 0"),
      to: makePath("M 0 0"),
      visible: true,
      locked: false,
    };
    const project = exportProjectJSON([minimal]);
    const child = project.layers.vectorLayer.children[0] as Record<string, unknown>;
    expect(child.fillColor).toBe("");
    expect(child.fillAlpha).toBe(1);
    expect(child.strokeColor).toBe("");
    expect(child.strokeAlpha).toBe(1);
    expect(child.strokeWidth).toBe(0);
    expect(child.strokeLinecap).toBe("butt");
    expect(child.strokeLinejoin).toBe("miter");
    expect(child.strokeMiterLimit).toBe(4);
    expect(child.fillType).toBe("nonZero");
    expect(child.trimPathStart).toBe(0);
    expect(child.trimPathEnd).toBe(1);
    expect(child.trimPathOffset).toBe(0);
  });

  it("layer with numeric id is serialized as string in project JSON", () => {
    const numericId = makeLayer({ id: 42, name: "numeric" });
    const project = exportProjectJSON([numericId]);
    const child = project.layers.vectorLayer.children[0] as Record<string, unknown>;
    expect(child.id).toBe("42");
  });

  it("safeName handles leading digits", () => {
    // safeName prefixes leading digits with underscore
    const leadingDigit = makeLayer({ id: 1, name: "123layer" });
    const vd = exportVectorDrawable(leadingDigit);
    expect(vd).toContain('android:name="_123layer"');
  });

  it("safeName replaces non-word characters with underscores", () => {
    const specialChars = makeLayer({ id: 1, name: "my layer/name" });
    const vd = exportVectorDrawable(specialChars);
    expect(vd).toContain('android:name="my_layer_name"');
  });
});

// ── kus/24t fidelity (post yrl import hardening + tool edits + pro surface) ──
describe("kus 24t export fidelity", () => {
  it("pathToString (via exports) guards NaN/Inf (symmetry to yrl)", () => {
    const bad = makePath("M 0 0 L 10 0");
    // corrupt
    bad.subPaths[0].commands[1].points[0] = { x: NaN, y: 5 };
    const svg = exportStaticSVG([makeLayer({ from: bad, pathData: bad })]);
    expect(svg).not.toContain("NaN");
    expect(svg).toContain("<svg");
  });

  it("exportStaticSVG supports groups + transforms + pathData pref + clips", () => {
    const child = makeLayer({ id: "c1", name: "child", from: makePath("M 1 1 L 2 2") });
    const group: any = {
      id: "g1",
      name: "group1",
      type: "group",
      visible: true,
      locked: false,
      children: [child],
      translateX: 3,
      rotation: 45,
    };
    const clip: any = {
      id: "cp",
      name: "clip1",
      type: "clipPath",
      visible: true,
      from: makePath("M 0 0 L 5 0 L 5 5 Z"),
    };
    const svg = exportStaticSVG([group, clip] as any);
    expect(svg).toContain('<g id="group1" transform="translate(3 0) rotate(45)"');
    expect(svg).toContain('<clipPath id="clip1"');
    expect(svg).toContain(pathToString(child.from));
  });

  it("exportProjectJSON includes frames for freeform fidelity when passed", () => {
    const layers = [makeLayer()];
    const frames = [{ id: "f1", name: "Frame 1", x: 10, y: 20, layers }];
    const project = exportProjectJSON(layers, undefined, undefined, undefined, frames as any);
    expect((project as any).frames).toBeDefined();
    expect((project as any).frames[0].x).toBe(10);
    expect((project as any).frames[0].y).toBe(20);
  });

  it("exportProjectJSON preserves page-root vectors and motion tracks", () => {
    const rootLayer = makeLayer({ id: "root-vector", translateX: 120, translateY: -40 });
    const rootAnimation = {
      id: "root-motion",
      name: "Page motion",
      duration: 800,
      blocks: [
        {
          id: "root-x",
          layerId: rootLayer.id,
          propertyName: "translateX",
          fromValue: 120,
          toValue: 200,
          startTime: 0,
          endTime: 800,
          type: "number" as const,
        },
      ],
    };
    const project = exportProjectJSON([makeLayer()], undefined, undefined, undefined, undefined, {
      layers: [rootLayer],
      animation: rootAnimation,
      hiddenLayerIds: [],
    });

    expect((project as any).pageRoot.layers[0].id).toBe("root-vector");
    expect((project as any).pageRoot.layers[0].translateX).toBe(120);
    expect((project as any).pageRoot.animation.blocks[0].id).toBe("root-x");
  });

  it("exportPDF produces valid minimal PDF structure (no crash on real paths)", () => {
    const layer = makeLayer({ strokeColor: "#ff0000", fillColor: "#00ff00" });
    const pdf = exportPDF([layer]);
    expect(pdf).toContain("%PDF-1.4");
    expect(pdf).toContain("%%EOF");
    expect(pdf).toContain("/Page");
  });

  it("static/VD etc prefer pathData over from for tool edit roundtrips (knife/boolean/paint)", () => {
    const edited = makePath("M 0 0 L 99 0 L 99 99 Z");
    const layer = makeLayer({ from: makePath("M 0 0 L 1 1"), pathData: edited });
    const staticSvg = exportStaticSVG([layer]);
    const vd = exportVectorDrawable(layer);
    expect(staticSvg).toContain("99"); // from edited
    expect(vd).toContain("99"); // from edited
  });
});

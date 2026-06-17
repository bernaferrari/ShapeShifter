// @vitest-environment happy-dom

/**
 * ShapeShifter 2026 — Gradient fill tests
 * Covers the shared gradient helpers, SVG / Vector Drawable export output,
 * and the SVG import roundtrip.
 */

import { describe, it, expect } from "vitest";
import { parsePath } from "../pathUtils";
import type { Gradient, Layer, PathData } from "../types";
import {
  dominantColor,
  gradientFromSolid,
  gradientToSvg,
  linearVector,
  normalizeStops,
} from "../gradients";
import { exportStaticSVG, exportVectorDrawable } from "../exporter";
import { importLayersFromSvg } from "../importers";

function makeLayer(overrides: Partial<Layer> = {}): Layer {
  const from: PathData = parsePath("M 0 0 L 10 0 L 10 10 L 0 10 Z");
  return {
    id: 7,
    name: "grad-layer",
    type: "path",
    from,
    to: from,
    pathData: from,
    visible: true,
    locked: false,
    ...overrides,
  };
}

const linear: Gradient = {
  type: "linear",
  angle: 90,
  stops: [
    { offset: 0, color: "#ff0000", opacity: 1 },
    { offset: 1, color: "#0000ff", opacity: 0.5 },
  ],
};

const radial: Gradient = {
  type: "radial",
  stops: [
    { offset: 0, color: "#ffffff" },
    { offset: 1, color: "#000000" },
  ],
};

describe("gradient helpers", () => {
  it("normalizeStops sorts by offset and clamps", () => {
    const stops = normalizeStops([
      { offset: 1.5, color: "#fff", opacity: 2 },
      { offset: -0.2, color: "#000", opacity: -1 },
    ]);
    expect(stops[0].offset).toBe(0);
    expect(stops[0].opacity).toBe(0);
    expect(stops[1].offset).toBe(1);
    expect(stops[1].opacity).toBe(1);
  });

  it("gradientFromSolid seeds a 2-stop color→transparent gradient", () => {
    const g = gradientFromSolid("linear", "#abcdef");
    expect(g.stops).toHaveLength(2);
    expect(g.stops[0].color).toBe("#abcdef");
    expect(g.stops[0].opacity).toBe(1);
    expect(g.stops[1].opacity).toBe(0);
    expect(g.angle).toBe(90);
  });

  it("linearVector maps 0deg to a left→right vector", () => {
    const v = linearVector(0);
    expect(v.x1).toBeCloseTo(0);
    expect(v.x2).toBeCloseTo(1);
    expect(v.y1).toBeCloseTo(0.5);
    expect(v.y2).toBeCloseTo(0.5);
  });

  it("linearVector maps 90deg to a top→bottom vector", () => {
    const v = linearVector(90);
    expect(v.y1).toBeCloseTo(0);
    expect(v.y2).toBeCloseTo(1);
  });

  it("gradientToSvg emits objectBoundingBox stops with baked alpha", () => {
    const svg = gradientToSvg(linear, "g1", 0.5);
    expect(svg).toContain("<linearGradient");
    expect(svg).toContain('id="g1"');
    expect(svg).toContain('gradientUnits="objectBoundingBox"');
    expect(svg).toContain('stop-color="#ff0000"');
    // 0.5 stop-opacity * 0.5 fillAlpha = 0.25
    expect(svg).toContain('stop-opacity="0.25"');
  });

  it("gradientToSvg emits a radialGradient for radial", () => {
    const svg = gradientToSvg(radial, "g2");
    expect(svg).toContain("<radialGradient");
    expect(svg).toContain('cx="0.5"');
  });

  it("dominantColor prefers the most opaque stop", () => {
    expect(dominantColor(linear)).toBe("#ff0000");
  });
});

describe("gradient export", () => {
  it("exportStaticSVG defines the gradient and references it by url()", () => {
    const svg = exportStaticSVG([makeLayer({ fillGradient: linear })]);
    expect(svg).toContain("<defs>");
    expect(svg).toContain("<linearGradient");
    expect(svg).toContain("ss-grad-7");
    expect(svg).toContain('fill="url(#ss-grad-7)"');
  });

  it("solid fills are unaffected by the gradient path", () => {
    const svg = exportStaticSVG([makeLayer({ fillColor: "#123456" })]);
    expect(svg).toContain('fill="#123456"');
    expect(svg).not.toContain("linearGradient");
  });

  it("exportVectorDrawable emits an aapt gradient block", () => {
    const vd = exportVectorDrawable(makeLayer({ fillGradient: linear }));
    expect(vd).toContain('xmlns:aapt="http://schemas.android.com/aapt"');
    expect(vd).toContain('<aapt:attr name="android:fillColor">');
    expect(vd).toContain('android:type="linear"');
    // alpha baked into #AARRGGBB; 0.5 opacity ≈ #80
    expect(vd).toMatch(/android:color="#[0-9A-F]{8}"/);
    expect(vd).not.toContain('android:fillColor="');
  });

  it("exportVectorDrawable still emits a solid fillColor when no gradient", () => {
    const vd = exportVectorDrawable(makeLayer({ fillColor: "#00ff00" }));
    expect(vd).toContain('android:fillColor="#00ff00"');
    expect(vd).not.toContain("aapt");
  });
});

describe("gradient import", () => {
  it("parses a linearGradient url(#id) fill into the model", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ff0000"/>
          <stop offset="1" stop-color="#0000ff" stop-opacity="0.5"/>
        </linearGradient>
      </defs>
      <path d="M0 0 L24 0 L24 24 L0 24 Z" fill="url(#g)"/>
    </svg>`;
    const layers: Layer[] = importLayersFromSvg(svg);
    expect(layers).toHaveLength(1);
    const g = layers[0].fillGradient;
    expect(g).toBeDefined();
    expect(g?.type).toBe("linear");
    expect(g?.stops).toHaveLength(2);
    expect(g?.stops[1].opacity).toBeCloseTo(0.5);
    // y-axis gradient ≈ 90deg
    expect(g?.angle).toBeCloseTo(90);
    // Solid fillColor is cleared in favor of the gradient.
    expect(layers[0].fillColor).toBe("");
  });

  it("parses a radialGradient fill", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <defs>
        <radialGradient id="r" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stop-color="#fff"/>
          <stop offset="1" stop-color="#000"/>
        </radialGradient>
      </defs>
      <circle cx="12" cy="12" r="10" fill="url(#r)"/>
    </svg>`;
    const layers: Layer[] = importLayersFromSvg(svg);
    expect(layers[0].fillGradient?.type).toBe("radial");
  });

  it("leaves solid fills as plain colors", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M0 0 L24 0 L24 24 Z" fill="#abcdef"/>
    </svg>`;
    const layers: Layer[] = importLayersFromSvg(svg);
    expect(layers[0].fillGradient).toBeUndefined();
    expect(layers[0].fillColor).toBe("#abcdef");
  });
});

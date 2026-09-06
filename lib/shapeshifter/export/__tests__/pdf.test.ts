import { describe, expect, it, vi } from "vitest";
import { exportPDF } from "../pdf";
import { parsePath } from "../../pathUtils";
import type { Layer, PathData } from "../../types";

function makePath(d: string): PathData {
  return parsePath(d);
}

function makeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: 1,
    name: "test-layer",
    type: "path",
    from: makePath("M 0 0 L 10 0 L 10 10 L 0 10 Z"),
    to: makePath("M 2 2 L 12 2 L 12 12 L 2 12 Z"),
    visible: true,
    locked: false,
    ...overrides,
  };
}

/** Extracts the content stream text between `stream\n` and `\nendstream`. */
const contentStream = (pdf: string) => {
  const match = pdf.match(/stream\n([\s\S]*?)\nendstream/);
  if (!match) throw new Error("no content stream found");
  return match[1];
};

// Default export geometry: 512pt page over a 48-unit viewport.
const SCALE = 512 / 48;
const px = (x: number) => (x * SCALE).toFixed(2);
const py = (y: number) => ((48 - y) * SCALE).toFixed(2);

describe("exportPDF page/content scale agreement", () => {
  it("keeps every emitted coordinate inside the MediaBox", () => {
    // Default options (width/height 512, viewBox 48) — the old exporter
    // multiplied coordinates by a fixed 20pt/unit while the page was sized
    // ~213pt, clipping ~80% of the artwork.
    const layer = makeLayer({ from: makePath("M 0 0 L 48 0 L 48 48 L 0 48 Z") });
    const pdf = exportPDF([layer]);
    const mediaBox = pdf.match(/MediaBox\[0 0 (\d+) (\d+)\]/)!;
    const w = Number(mediaBox[1]);
    const h = Number(mediaBox[2]);

    for (const m of contentStream(pdf).matchAll(/(-?[\d.]+) (-?[\d.]+) (?:m|l)/g)) {
      for (const raw of [m[1], m[2]]) {
        const v = parseFloat(raw);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(Math.max(w, h));
      }
    }
  });

  it("honors non-square document viewports instead of defaulting to 48×48", () => {
    // A 120×60 document exported without explicit options previously fell back
    // to the 48-unit default viewport, clipping everything outside 48 units.
    const layer = makeLayer({
      from: makePath("M 0 0 L 120 0 L 120 60 L 0 60 Z"),
      to: makePath("M 0 0 L 120 0 L 120 60 L 0 60 Z"),
    });
    const pdf = exportPDF([layer], { width: 512, height: 256, viewBoxWidth: 120, viewBoxHeight: 60 });
    const mediaBox = pdf.match(/MediaBox\[0 0 (\d+) (\d+)\]/)!;
    expect([Number(mediaBox[1]), Number(mediaBox[2])]).toEqual([512, 256]);

    // Full-viewport rect must fill the page: x scale 512/120, y scale 256/60.
    const stream = contentStream(pdf);
    expect(stream).toContain(`${(120 * (512 / 120)).toFixed(2)} ${((60 - 60) * (256 / 60)).toFixed(2)} l`);
    expect(stream).toContain(`${(0).toFixed(2)} ${(256).toFixed(2)} m`); // (0, 60): x=0, y flips to top
    // And nothing may be emitted outside the page.
    for (const m of stream.matchAll(/(-?[\d.]+) (-?[\d.]+) (?:m|l)/g)) {
      expect(parseFloat(m[1])).toBeLessThanOrEqual(512 + 1e-6);
      expect(parseFloat(m[2])).toBeLessThanOrEqual(256 + 1e-6);
    }
  });

  it("scales geometry with the same factor as the page size", () => {
    // A full-viewport square must span the entire (square) page minus margin
    // rounding — proving content scale and MediaBox share one factor.
    const size = 400;
    const layer = makeLayer({ from: makePath("M 0 0 L 48 0 L 48 48 L 0 48 Z") });
    const pdf = exportPDF([layer], { width: size, height: size });
    const coords = [...contentStream(pdf).matchAll(/(-?[\d.]+) (-?[\d.]+) (?:m|l)/g)].flatMap(
      (m) => [parseFloat(m[1]), parseFloat(m[2])],
    );
    expect(Math.min(...coords)).toBeLessThanOrEqual(size * 0.01);
    expect(Math.max(...coords)).toBeGreaterThanOrEqual(size * 0.99);
  });

  it("derives the stroke width from the same points-per-unit factor", () => {
    const layer = makeLayer({ strokeColor: "#ff0000", strokeWidth: 4 });
    const pdf = exportPDF([layer]);
    const wOp = contentStream(pdf).match(/([\d.]+) w/)!;
    // 4 units × 512/48 ≈ 42.67pt (the old code divided by a magic 12).
    expect(parseFloat(wOp[1])).toBeCloseTo(4 * SCALE, 1);
  });
});

describe("exportPDF command coverage", () => {
  it("flattens arcs into cubic segments instead of dropping them", () => {
    // parsePath preserves this as an A command; previously its arguments were
    // skipped one-by-one as stray numbers, truncating the subpath.
    const layer = makeLayer({
      fillColor: "#00ff00",
      from: makePath("M 0 0 A 24 24 0 0 1 48 48"),
    });
    const stream = contentStream(exportPDF([layer]));
    expect(stream).toMatch(/ c/);
    // The arc's true endpoint (48,48) must appear transformed on the final curve.
    expect(stream).toContain(`${px(48)} ${py(48)} c`);
    // And the subpath gets painted.
    expect(stream).toMatch(/f|S/);
  });

  it("expands S/T smooth shorthands into C/Q operators instead of truncating", () => {
    const layer = makeLayer({
      from: makePath("M 0 0 C 4 4 8 8 12 12 S 20 20 24 24 T 40 40"),
    });
    const stream = contentStream(exportPDF([layer]));
    // The final point of the trailing T command must survive as an operator.
    expect(stream).toContain(`${px(40)} ${py(40)} c`);
  });

  it("paints H/V line commands rather than emitting garbage", () => {
    const layer = makeLayer({ from: makePath("M 4 4 H 20 V 20") });
    const stream = contentStream(exportPDF([layer]));
    // H 20 → line to (20,4); V 20 → line to (20,20).
    expect(stream).toContain(`${px(20)} ${py(4)} l`);
    expect(stream).toContain(`${px(20)} ${py(20)} l`);
  });

  it("anchors quadratic curves at the real current point (exact elevation)", () => {
    // Q whose control point differs from the current point: the old exporter
    // emitted the control point twice from untracked state.
    const layer = makeLayer({ from: makePath("M 0 0 Q 12 40 24 0") });
    const stream = contentStream(exportPDF([layer]));
    // Exact quadratic → cubic elevation of P0=(0,0), C=(12,40), P1=(24,0).
    const c1 = { x: 8, y: 80 / 3 };
    const c2 = { x: 16, y: 80 / 3 };
    expect(stream).toContain(
      `${px(c1.x)} ${py(c1.y)} ${px(c2.x)} ${py(c2.y)} ${px(24)} ${py(0)} c`,
    );
  });
});

describe("exportPDF structure", () => {
  it("still produces valid minimal PDF with accurate xref offsets", () => {
    const layer = makeLayer({ strokeColor: "#ff0000", fillColor: "#00ff00" });
    const pdf = exportPDF([layer]);
    expect(pdf).toContain("%PDF-1.4");
    expect(pdf).toContain("/Page");
    expect(pdf).toContain("%%EOF");
    const startxref = Number(pdf.match(/startxref\n(\d+)/)?.[1]);
    expect(pdf.slice(startxref, startxref + 4)).toBe("xref");
    const entries = (pdf.slice(startxref).match(/^(\d{10}) 00000 n$/gm) ?? []).map((entry) =>
      Number(entry.slice(0, 10)),
    );
    for (let objNum = 1; objNum <= entries.length; objNum++) {
      expect(pdf.slice(entries[objNum - 1])).toMatch(new RegExp(`^${objNum} 0 obj`));
    }
  });

  it("respects viewBox options so non-square viewports letterbox without distortion", () => {
    const layer = makeLayer({ from: makePath("M 0 0 L 96 0 L 96 48 L 0 48 Z") });
    const pdf = exportPDF([layer], {
      width: 512,
      height: 512,
      viewBoxWidth: 96,
      viewBoxHeight: 48,
    });
    const stream = contentStream(pdf);
    // Uniform scale = min(512/96, 512/48) = 5.33; the 96-unit-wide drawing
    // spans the full page width: px(96) = 512, px(0) = 0.
    expect(stream).toContain("512.00");
    expect(stream).toContain("0.00");
  });

  it("skips hidden layers and empty paths gracefully", () => {
    const hidden = makeLayer({ id: 2, visible: false });
    const empty = makeLayer({ id: 3, from: makePath("") });
    const pdf = exportPDF([hidden, empty]);
    expect(pdf).toContain("%%EOF");
    // No path operators were emitted for either.
    expect(contentStream(pdf)).not.toMatch(/\bm\b|\bl\b|\bc\b/);
  });
});

describe("exportPDF colors", () => {
  it("resolves non-hex CSS colors instead of emitting NaN channels", () => {
    const layer = makeLayer({ fillColor: "red", strokeColor: "rgb(0, 128, 255)" });
    const stream = contentStream(exportPDF([layer]));
    // red → 1 0 0; rgb(0,128,255) → 0 0.502 1
    expect(stream).toContain("1.000 0.000 0.000 rg");
    expect(stream).toContain("0.000 0.502 1.000 RG");
    expect(stream).not.toMatch(/NaN/);
  });

  it("falls back to black for unparseable colors", () => {
    const layer = makeLayer({ fillColor: "@not-a-color" });
    const stream = contentStream(exportPDF([layer]));
    expect(stream).toContain("0.000 0.000 0.000 rg");
  });
});

describe("exportPDF group transforms", () => {
  it("applies a group's translation to child path coordinates", () => {
    const group = {
      ...makeLayer({ type: "group", translateX: 10, translateY: 5 }),
      children: [makeLayer({ id: 9 })],
    } as unknown as Layer;
    const stream = contentStream(exportPDF([group]));
    // Child square M 0 0 → translated by (10, 5): px(10), py(5).
    expect(stream).toContain(`${px(10)} ${py(5)} m`);
  });

  it("composes nested group transforms (scale then parent translate)", () => {
    const inner = {
      ...makeLayer({ id: 3, type: "group", scaleX: 2, scaleY: 2 }),
      children: [makeLayer({ id: 4 })],
    } as unknown as Layer;
    const outer = {
      ...makeLayer({ id: 2, type: "group", translateX: 6, translateY: 0 }),
      children: [inner],
    } as unknown as Layer;
    const stream = contentStream(exportPDF([outer]));
    // Child point (10, 0) → scaled ×2 → (20, 0) → +6 x → px(26).
    expect(stream).toContain(`${px(26)} ${py(0)} l`);
  });

  it("scales stroke width by the accumulated transform determinant", () => {
    const group = {
      ...makeLayer({ id: 2, type: "group", scaleX: 2, scaleY: 2, strokeColor: "#000000" }),
      children: [makeLayer({ id: 3, strokeWidth: 1, strokeColor: "#000000" })],
    } as unknown as Layer;
    const stream = contentStream(exportPDF([group]));
    // sqrt(|det|) = 2, so 1 unit stroke → 2 units before the page scale.
    expect(stream).toContain(`${(2 * SCALE).toFixed(2)} w`);
  });

  it("skips children of hidden groups and warns on clip-path layers", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const hiddenGroup = {
        ...makeLayer({ id: 2, type: "group", visible: false }),
        children: [makeLayer({ id: 3 })],
      } as unknown as Layer;
      const clip = makeLayer({ id: 4, type: "clipPath" }) as unknown as Layer;
      const pdf = exportPDF([hiddenGroup, clip]);
      // Only the clip layer was rejected explicitly; nothing drawable remained.
      expect(contentStream(pdf)).not.toMatch(/\bm\b|\bl\b|\bc\b/);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("Clip path"));
    } finally {
      warn.mockRestore();
    }
  });
});

describe("exportPDF flat parentId hierarchy", () => {
  it("applies a flat-parent group's rotation to child path coordinates", () => {
    // Imports produce flat parentId links with no embedded children arrays.
    // The child square's corner (10, 0) must land rotated by the parent's
    // 90° around its pivot (0,0): (x,y) → (-y, x), i.e. (0, 10).
    const group = makeLayer({ id: 2, type: "group", rotation: 90 });
    const child = makeLayer({ id: 3, parentId: 2 });
    const stream = contentStream(exportPDF([group, child]));
    expect(stream).toContain(`${px(0)} ${py(10)} l`);
    // And the unrotated coordinate must be gone (word-boundary so the
    // negated -106.67 rotated corner can't substring-match).
    const unrotated = `${px(10)} ${py(0)} l`;
    for (const m of stream.matchAll(/(-?[\d.]+) (-?[\d.]+) (?:m|l)/g)) {
      if (`${m[1]} ${m[2]} l` === unrotated) throw new Error(`unrotated coord leaked: ${m[0]}`);
    }
  });

  it("skips children whose flat parent is hidden", () => {
    const group = makeLayer({ id: 2, type: "group", visible: false });
    const child = makeLayer({ id: 3, parentId: 2 });
    const stream = contentStream(exportPDF([group, child]));
    expect(stream).not.toMatch(/\bm\b|\bl\b|\bc\b/);
  });
});

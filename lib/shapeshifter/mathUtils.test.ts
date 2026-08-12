import { describe, it, expect } from "vitest";
import {
  floorMod,
  lerp,
  areCollinear,
  transformPoint,
  distance,
  arePointsEqual,
  round,
  snapVectorToAngle,
  isNearZero,
  Matrix,
  distort,
  parseAndroidColor,
  toAndroidString,
  svgToAndroidColor,
  androidToCssHexColor,
  androidToCssRgbaColor,
} from "./mathUtils";
import type { RGBA } from "./mathUtils";

// ─── MathUtil ────────────────────────────────────────────────────────────

describe("floorMod", () => {
  it("returns positive modulo for positive numbers", () => {
    expect(floorMod(7, 5)).toBe(2);
  });

  it("wraps negative numbers to positive", () => {
    expect(floorMod(-1, 5)).toBe(4);
    expect(floorMod(-7, 5)).toBe(3);
  });

  it("returns 0 for exact multiples", () => {
    expect(floorMod(10, 5)).toBe(0);
    expect(floorMod(0, 5)).toBe(0);
  });
});

describe("lerp", () => {
  it("returns a at t=0", () => {
    expect(lerp(10, 20, 0)).toBe(10);
  });

  it("returns b at t=1", () => {
    expect(lerp(10, 20, 1)).toBe(20);
  });

  it("returns midpoint at t=0.5", () => {
    expect(lerp(0, 100, 0.5)).toBe(50);
  });

  it("handles negative values", () => {
    expect(lerp(-10, 10, 0.5)).toBe(0);
  });
});

describe("areCollinear", () => {
  it("returns true for less than 3 points", () => {
    expect(areCollinear({ x: 0, y: 0 })).toBe(true);
    expect(areCollinear({ x: 0, y: 0 }, { x: 1, y: 1 })).toBe(true);
  });

  it("returns true for collinear points", () => {
    expect(areCollinear({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(true);
    expect(areCollinear({ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 })).toBe(true);
  });

  it("returns false for non-collinear points (from original spec)", () => {
    expect(areCollinear({ x: 16, y: 6 }, { x: 14, y: 5 }, { x: 19, y: 20 })).toBe(false);
  });
});

describe("transformPoint", () => {
  it("identity matrix preserves point (from original spec)", () => {
    const point = { x: 1, y: 1 };
    const matrix = Matrix.identity();
    const transformed = transformPoint(point, matrix);
    expect(transformed).toEqual({ x: 1, y: 1 });
  });

  it("translation matrix shifts point", () => {
    const result = transformPoint({ x: 5, y: 3 }, Matrix.translation(10, 20));
    expect(result).toEqual({ x: 15, y: 23 });
  });

  it("scaling matrix scales point", () => {
    const result = transformPoint({ x: 2, y: 3 }, Matrix.scaling(2, 4));
    expect(result).toEqual({ x: 4, y: 12 });
  });

  it("chaining multiple matrices", () => {
    const result = transformPoint({ x: 1, y: 0 }, Matrix.translation(5, 5), Matrix.scaling(2, 2));
    expect(result).toEqual({ x: 12, y: 10 });
  });
});

describe("distance", () => {
  it("returns 0 for same point", () => {
    expect(distance({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
  });

  it("computes Euclidean distance", () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("handles negative coordinates", () => {
    expect(distance({ x: -3, y: 0 }, { x: 0, y: 4 })).toBe(5);
  });
});

describe("arePointsEqual", () => {
  it("returns true for identical points", () => {
    expect(arePointsEqual({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(true);
  });

  it("returns false for different points", () => {
    expect(arePointsEqual({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe(false);
  });

  it("handles undefined inputs", () => {
    expect(arePointsEqual(undefined, { x: 0, y: 0 })).toBe(false);
    expect(arePointsEqual({ x: 0, y: 0 }, undefined)).toBe(false);
    expect(arePointsEqual(undefined, undefined)).toBe(false);
  });

  it("returns true for near-zero distance", () => {
    expect(arePointsEqual({ x: 1, y: 1 }, { x: 1 + 1e-10, y: 1 + 1e-10 })).toBe(true);
  });
});

describe("round", () => {
  it("rounds to 9 decimal places", () => {
    expect(round(1.123456789012)).toBeCloseTo(1.123456789, 12);
  });

  it("preserves integers", () => {
    expect(round(5)).toBe(5);
  });

  it("handles 0", () => {
    expect(round(0)).toBe(0);
  });
});

describe("snapVectorToAngle", () => {
  it("snaps a 45° vector to nearest 45°", () => {
    const result = snapVectorToAngle({ x: 10, y: 10.5 }, 45);
    expect(Math.abs(result.x - result.y)).toBeLessThan(0.01);
  });

  it("preserves a vector already on the snap angle", () => {
    const result = snapVectorToAngle({ x: 10, y: 0 }, 90);
    expect(result.y).toBeCloseTo(0, 5);
    expect(result.x).toBeCloseTo(10, 5);
  });
});

describe("isNearZero", () => {
  it("returns true for 0", () => {
    expect(isNearZero(0)).toBe(true);
  });

  it("returns true for near-zero values", () => {
    expect(isNearZero(1e-10)).toBe(true);
  });

  it("returns false for non-zero values", () => {
    expect(isNearZero(0.1)).toBe(false);
  });
});

// ─── Matrix ──────────────────────────────────────────────────────────────

describe("Matrix", () => {
  it("identity has correct values (from original spec)", () => {
    const m = Matrix.identity();
    expect(m.a).toBe(1);
    expect(m.b).toBe(0);
    expect(m.c).toBe(0);
    expect(m.d).toBe(1);
    expect(m.e).toBe(0);
    expect(m.f).toBe(0);
  });

  it("constructor stores values (from original spec)", () => {
    const m = new Matrix(1, 2, 3, 4, 5, 6);
    expect(m.a).toBe(1);
    expect(m.b).toBe(2);
    expect(m.c).toBe(3);
    expect(m.d).toBe(4);
    expect(m.e).toBe(5);
    expect(m.f).toBe(6);
  });

  it("invert identity (from original spec)", () => {
    const inv = Matrix.identity().invert()!;
    expect(inv.a).toBeCloseTo(1, 5);
    expect(inv.b).toBeCloseTo(0, 5);
    expect(inv.c).toBeCloseTo(0, 5);
    expect(inv.d).toBeCloseTo(1, 5);
    expect(inv.e).toBeCloseTo(0, 5);
    expect(inv.f).toBeCloseTo(0, 5);
  });

  it("invert general matrix (from original spec)", () => {
    const inv = new Matrix(1, 2, 2, 3, 3, 4).invert()!;
    expect(inv.a).toBeCloseTo(-3, 5);
    expect(inv.b).toBeCloseTo(2, 5);
    expect(inv.c).toBeCloseTo(2, 5);
    expect(inv.d).toBeCloseTo(-1, 5);
    expect(inv.e).toBeCloseTo(1, 5);
    expect(inv.f).toBeCloseTo(-2, 5);
  });

  it("invert returns undefined for singular matrix", () => {
    const inv = new Matrix(1, 0, 1, 0, 0, 0).invert();
    expect(inv).toBeUndefined();
  });

  it("dot identity * identity = identity (from original spec)", () => {
    const result = Matrix.identity().dot(Matrix.identity());
    expect(result.equals(Matrix.identity())).toBe(true);
  });

  it("dot general matrices (from original spec)", () => {
    const result = new Matrix(1, 2, 2, 3, 3, 4).dot(new Matrix(2, 1, 3, 2, 4, 3));
    expect(result.a).toBeCloseTo(4, 5);
    expect(result.b).toBeCloseTo(7, 5);
    expect(result.c).toBeCloseTo(7, 5);
    expect(result.d).toBeCloseTo(12, 5);
    expect(result.e).toBeCloseTo(13, 5);
    expect(result.f).toBeCloseTo(21, 5);
  });

  it("flatten combines matrices", () => {
    const result = Matrix.flatten([Matrix.scaling(2, 3), Matrix.translation(5, 7)]);
    expect(result.a).toBeCloseTo(2, 5);
    expect(result.d).toBeCloseTo(3, 5);
    expect(result.e).toBeCloseTo(10, 5);
    expect(result.f).toBeCloseTo(21, 5);
  });

  it("scaling factory", () => {
    const m = Matrix.scaling(3, 4);
    expect(m.a).toBe(3);
    expect(m.d).toBe(4);
  });

  it("rotation factory (90 degrees)", () => {
    const m = Matrix.rotation(90);
    expect(m.a).toBeCloseTo(0, 5);
    expect(m.b).toBeCloseTo(1, 5);
    expect(m.c).toBeCloseTo(-1, 5);
    expect(m.d).toBeCloseTo(0, 5);
  });

  it("translation factory", () => {
    const m = Matrix.translation(10, 20);
    expect(m.e).toBe(10);
    expect(m.f).toBe(20);
  });

  it("getScaling extracts scale factors", () => {
    const m = Matrix.scaling(3, 5);
    const { sx, sy } = m.getScaling();
    expect(sx).toBeCloseTo(3, 5);
    expect(sy).toBeCloseTo(5, 5);
  });

  it("getRotation extracts rotation", () => {
    const m = Matrix.rotation(45);
    expect(m.getRotation()).toBeCloseTo(45, 5);
  });

  it("getTranslation extracts translation", () => {
    const m = Matrix.translation(10, 20);
    const { tx, ty } = m.getTranslation();
    expect(tx).toBe(10);
    expect(ty).toBe(20);
  });

  it("getScaleFactor for uniform scale", () => {
    const m = Matrix.scaling(2, 2);
    expect(m.getScaleFactor()).toBeCloseTo(2, 3);
  });

  it("getScaleFactor for non-uniform scale", () => {
    const m = Matrix.scaling(2, 4);
    expect(m.getScaleFactor()).toBeCloseTo(2, 3);
  });

  it("getScaleFactor for identity", () => {
    expect(Matrix.identity().getScaleFactor()).toBeCloseTo(1, 3);
  });

  it("equals returns true for identical matrices", () => {
    const a = new Matrix(1, 2, 3, 4, 5, 6);
    const b = new Matrix(1, 2, 3, 4, 5, 6);
    expect(a.equals(b)).toBe(true);
  });

  it("equals returns false for different matrices", () => {
    const a = new Matrix(1, 2, 3, 4, 5, 6);
    const b = new Matrix(1, 2, 3, 4, 5, 7);
    expect(a.equals(b)).toBe(false);
  });

  it("round-trip: invert then dot gives identity", () => {
    const m = new Matrix(2, 1, 0.5, 3, 10, -5);
    const inv = m.invert()!;
    const result = m.dot(inv);
    expect(result.a).toBeCloseTo(1, 5);
    expect(result.d).toBeCloseTo(1, 5);
    expect(result.e).toBeCloseTo(0, 5);
    expect(result.f).toBeCloseTo(0, 5);
  });
});

// ─── TransformUtil ───────────────────────────────────────────────────────

describe("distort", () => {
  it("identity mapping for same source and target", () => {
    const src: [number, number][] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    const fn = distort(src, src);
    const [x, y] = fn([0.5, 0.5]);
    expect(x).toBeCloseTo(0.5, 3);
    expect(y).toBeCloseTo(0.5, 3);
  });

  it("maps corners correctly", () => {
    const src: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ];
    const dst: [number, number][] = [
      [0, 0],
      [200, 0],
      [200, 200],
      [0, 200],
    ];
    const fn = distort(src, dst);
    const [x, y] = fn([50, 50]);
    expect(x).toBeCloseTo(100, 1);
    expect(y).toBeCloseTo(100, 1);
  });
});

// ─── ColorUtil ───────────────────────────────────────────────────────────

describe("parseAndroidColor", () => {
  it("parses #RGB format (3-digit)", () => {
    const result = parseAndroidColor("f00")!;
    expect(result.r).toBe(255);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
    expect(result.a).toBe(255);
  });

  it("parses #ARGB format (4-digit)", () => {
    const result = parseAndroidColor("#f000")!;
    expect(result.r).toBe(0);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
    expect(result.a).toBe(255);
  });

  it("parses #RRGGBB format (6-digit)", () => {
    const result = parseAndroidColor("#ff0000")!;
    expect(result.r).toBe(255);
    expect(result.g).toBe(0);
    expect(result.b).toBe(0);
    expect(result.a).toBe(255);
  });

  it("parses #AARRGGBB format (8-digit)", () => {
    const result = parseAndroidColor("#7f00ff00")!;
    expect(result.r).toBe(0);
    expect(result.g).toBe(255);
    expect(result.b).toBe(0);
    expect(result.a).toBe(127);
  });

  it("returns undefined for invalid input", () => {
    expect(parseAndroidColor("an invalid color")).toBeUndefined();
  });

  it("returns undefined for non-string input", () => {
    expect(parseAndroidColor(42 as unknown as string)).toBeUndefined();
  });
});

describe("toAndroidString", () => {
  it("converts opaque color to #RRGGBB", () => {
    expect(toAndroidString({ r: 0, g: 0, b: 0, a: 255 })).toBe("#000000");
  });

  it("converts transparent color to #AARRGGBB", () => {
    const result = toAndroidString({ r: 0, g: 255, b: 0, a: 127 });
    expect(result).toBe("#7f00ff00");
  });

  it("zero-pads single-digit hex values", () => {
    expect(toAndroidString({ r: 1, g: 2, b: 3, a: 255 })).toBe("#010203");
  });
});

describe("svgToAndroidColor", () => {
  it("returns undefined for 'none'", () => {
    expect(svgToAndroidColor("none")).toBeUndefined();
  });

  it("converts CSS hex to Android (alpha=255 omitted)", () => {
    expect(svgToAndroidColor("#ff0000")).toBe("#ff0000");
  });

  it("converts CSS alpha-last hex to Android alpha-first ordering", () => {
    expect(svgToAndroidColor("#ff000080")).toBe("#80ff0000");
  });

  it("converts rgba() to Android", () => {
    const result = svgToAndroidColor("rgba(255, 0, 0, 0.5)");
    expect(result).toBeDefined();
    const parsed = parseAndroidColor(result!);
    expect(parsed!.r).toBe(255);
    expect(parsed!.g).toBe(0);
    expect(parsed!.a).toBeCloseTo(128, -1);
  });
});

describe("androidToCssHexColor", () => {
  it("returns transparent for undefined", () => {
    expect(androidToCssHexColor(undefined)).toBe("transparent");
  });

  it("converts Android color to CSS hex", () => {
    expect(androidToCssHexColor("#ff0000")).toBe("#ff0000");
  });

  it("converts with alpha to CSS hex with alpha", () => {
    expect(androidToCssHexColor("#7f00ff00")).toBe("#00ff007f");
  });

  it("converts transparent black", () => {
    expect(androidToCssHexColor("#00000000")).toBe("#00000000");
  });
});

describe("androidToCssRgbaColor", () => {
  it("returns transparent for undefined", () => {
    expect(androidToCssRgbaColor(undefined)).toBe("transparent");
  });

  it("converts Android color to CSS rgba", () => {
    const result = androidToCssRgbaColor("#ff0000");
    expect(result).toBe("rgba(255,0,0,1.00)");
  });

  it("respects multAlpha parameter", () => {
    const result = androidToCssRgbaColor("#80ff0000", 0.5);
    const parsed = parseAndroidColor("#80ff0000")!;
    const expectedAlpha = ((parsed.a * 0.5) / 255).toFixed(2);
    expect(result).toContain(expectedAlpha);
  });
});

describe("Color round-trip", () => {
  const colors: Array<[string, RGBA]> = [
    ["#f000", { r: 0, g: 0, b: 0, a: 255 }],
    ["f00", { r: 255, g: 0, b: 0, a: 255 }],
    ["#7f00ff00", { r: 0, g: 255, b: 0, a: 127 }],
  ];

  colors.forEach(([input, expected]) => {
    it(`parseAndroidColor('${input}') -> toAndroidString() round-trip`, () => {
      const parsed = parseAndroidColor(input)!;
      const str = toAndroidString(parsed);
      const reParsed = parseAndroidColor(str)!;
      expect(reParsed.r).toBe(expected.r);
      expect(reParsed.g).toBe(expected.g);
      expect(reParsed.b).toBe(expected.b);
      expect(reParsed.a).toBe(expected.a);
    });
  });
});

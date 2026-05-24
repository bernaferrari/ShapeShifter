/**
 * ShapeShifter 2026 — Foundational Math Utilities
 *
 * Port of the original `scripts/common/` module (MathUtil, Matrix, Point, Rect,
 * TransformUtil, ColorUtil). All lodash and bugsnag dependencies have been
 * eliminated. tinycolor2 is replaced by a small inline hex parser.
 *
 * Public API is re-exported from the namespace `MathUtils`.
 */

import type { Point } from "./types";

// ─── Rect ────────────────────────────────────────────────────────────────

/** Axis-aligned rectangle using left/top/right/bottom coordinates. */
export interface Rect {
  readonly l: number;
  readonly t: number;
  readonly r: number;
  readonly b: number;
}

// ─── RGBA ────────────────────────────────────────────────────────────────

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

// ─── MathUtil ────────────────────────────────────────────────────────────

/** Returns the floor modulus of the integer argument. */
export function floorMod(num: number, maxNum: number): number {
  return ((num % maxNum) + maxNum) % maxNum;
}

/** Linearly interpolate between a and b using time t. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Returns true if the points are collinear. */
export function areCollinear(...points: Point[]): boolean {
  if (points.length < 3) return true;
  const { x: a, y: b } = points[0];
  const { x: m, y: n } = points[1];
  return points.every(({ x, y }) => Math.abs(a * (n - y) + m * (y - b) + x * (b - n)) < 1e-9);
}

/** Applies a list of transformation matrices to the specified point. */
export function transformPoint(point: Point, ...matrices: Matrix[]): Point {
  return matrices.reduce(
    (p: Point, m: Matrix) => ({
      x: round(m.a * p.x + m.c * p.y + m.e),
      y: round(m.b * p.x + m.d * p.y + m.f),
    }),
    point,
  );
}

/** Calculates the Euclidean distance between two points. */
export function distance(p1: Point, p2: Point): number {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

/** Returns true if the two points are approximately equal. */
export function arePointsEqual(p1: Point | undefined, p2: Point | undefined): boolean {
  return !!p1 && !!p2 && isNearZero(distance(p1, p2));
}

/** Rounds the number to 9 decimal places (matches original lodash _.round(n, 9)). */
export function round(n: number): number {
  const f = 1e9;
  return Math.round(n * f) / f;
}

/** Snaps a directional vector to the nearest multiple of the specified angle. */
export function snapVectorToAngle(delta: Point, snapAngleDegrees: number): Point {
  const snapAngle = (snapAngleDegrees * Math.PI) / 180;
  const angle = Math.round(Math.atan2(delta.y, delta.x) / snapAngle) * snapAngle;
  const dirx = Math.cos(angle);
  const diry = Math.sin(angle);
  const d = dirx * delta.x + diry * delta.y;
  return { x: dirx * d, y: diry * d };
}

/** Returns true iff the number is near 0 (within 9-decimal rounding). */
export function isNearZero(n: number): boolean {
  return round(n) === 0;
}

// ─── Matrix ──────────────────────────────────────────────────────────────

/**
 * Immutable 2D affine transformation matrix using standard SVG notation:
 *   [a  c  e]
 *   [b  d  f]
 *   [0  0  1]
 */
export class Matrix {
  static identity(): Matrix {
    return new Matrix(1, 0, 0, 1, 0, 0);
  }

  /** Flattens matrices into a single matrix by multiplying left-to-right. */
  static flatten(matrices: readonly Matrix[]): Matrix {
    return matrices.reduce((prev, curr) => prev.dot(curr), Matrix.identity());
  }

  /** Creates a scaling transformation matrix. */
  static scaling(sx: number, sy: number): Matrix {
    return new Matrix(sx, 0, 0, sy, 0, 0);
  }

  /** Creates a counter-clockwise rotation transformation matrix. */
  static rotation(degrees: number): Matrix {
    const cosr = Math.cos((degrees * Math.PI) / 180);
    const sinr = Math.sin((degrees * Math.PI) / 180);
    return new Matrix(cosr, sinr, -sinr, cosr, 0, 0);
  }

  /** Creates a translation transformation matrix. */
  static translation(tx: number, ty: number): Matrix {
    return new Matrix(1, 0, 0, 1, tx, ty);
  }

  constructor(
    public readonly a: number,
    public readonly b: number,
    public readonly c: number,
    public readonly d: number,
    public readonly e: number,
    public readonly f: number,
  ) {}

  /** Returns the dot product (matrix multiplication) of this matrix with m. */
  dot(m: Matrix): Matrix {
    return new Matrix(
      round(this.a * m.a + this.c * m.b),
      round(this.b * m.a + this.d * m.b),
      round(this.a * m.c + this.c * m.d),
      round(this.b * m.c + this.d * m.d),
      round(this.a * m.e + this.c * m.f + this.e),
      round(this.b * m.e + this.d * m.f + this.f),
    );
  }

  /** Returns the inverse of this transformation matrix, or undefined if not invertible. */
  invert(): Matrix | undefined {
    const { a, b, c, d, e, f } = this;
    let det = round(a * d - b * c);
    if (!det) return undefined;
    det = 1 / det;
    return new Matrix(
      round(d * det),
      round(-b * det),
      round(-c * det),
      round(a * det),
      round((c * f - d * e) * det),
      round((b * e - a * f) * det),
    );
  }

  /** Extracts the x/y scaling from the transformation matrix. */
  getScaling(): { sx: number; sy: number } {
    const { a, b, c, d } = this;
    const sx = (a >= 0 ? 1 : -1) * Math.hypot(a, c);
    const sy = (d >= 0 ? 1 : -1) * Math.hypot(b, d);
    return { sx: round(sx), sy: round(sy) };
  }

  /** Extracts the rotation in degrees from the transformation matrix. */
  getRotation(): number {
    return round((180 / Math.PI) * Math.atan2(-this.c, this.a));
  }

  /** Extracts the x/y translation from the transformation matrix. */
  getTranslation(): { tx: number; ty: number } {
    return { tx: round(this.e), ty: round(this.f) };
  }

  /**
   * Returns a single scale factor for things like stroke-width scaling.
   * Handles skew correctly by computing the minimal height of the
   * parallelogram formed by transforming the unit square.
   */
  getScaleFactor(): number {
    const m = new Matrix(this.a, this.b, this.c, this.d, 0, 0);
    const u1 = transformPoint({ x: 0, y: 1 }, m);
    const v1 = transformPoint({ x: 1, y: 0 }, m);
    const sx = Math.hypot(u1.x, u1.y);
    const sy = Math.hypot(v1.x, v1.y);
    const dotProduct = u1.y * v1.x - u1.x * v1.y;
    const maxScale = Math.max(sx, sy);
    return maxScale > 0 ? Math.abs(dotProduct) / maxScale : 0;
  }

  /** Returns true if the matrix is approximately equal to m. */
  equals(m: Matrix): boolean {
    return (
      Math.abs(this.a - m.a) < 1e-9 &&
      Math.abs(this.b - m.b) < 1e-9 &&
      Math.abs(this.c - m.c) < 1e-9 &&
      Math.abs(this.d - m.d) < 1e-9 &&
      Math.abs(this.e - m.e) < 1e-9 &&
      Math.abs(this.f - m.f) < 1e-9
    );
  }
}

// ─── TransformUtil ───────────────────────────────────────────────────────

/**
 * Creates a perspective distortion function that maps source quadrilateral
 * to target quadrilateral using LU decomposition (ported from numeric.js).
 */
export function distort(
  sourcePoints: [number, number][],
  targetPoints: [number, number][],
): (point: [number, number]) => [number, number] {
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0, n = sourcePoints.length; i < n; ++i) {
    const s = sourcePoints[i];
    const t = targetPoints[i];
    a.push([s[0], s[1], 1, 0, 0, 0, -s[0] * t[0], -s[1] * t[0]]);
    b.push(t[0]);
    a.push([0, 0, 0, s[0], s[1], 1, -s[0] * t[1], -s[1] * t[1]]);
    b.push(t[1]);
  }

  const X = luSolve(a, b);

  // prettier-ignore
  const matrix = [
    X[0], X[3], 0, X[6],
    X[1], X[4], 0, X[7],
       0,    0, 1,    0,
    X[2], X[5], 0,    1,
  ].map((x) => Math.round(x * 10e6) / 10e6);

  return (point: [number, number]): [number, number] => {
    const pt = mat4MulVec4(matrix, [point[0], point[1], 0, 1]);
    return [pt[0] / pt[3], pt[1] / pt[3]];
  };
}

/** Post-multiply a 4x4 matrix (column-major) by a 4x1 column vector. */
function mat4MulVec4(m: number[], v: [number, number, number, number]): [number, number, number, number] {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12] * v[3],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13] * v[3],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14] * v[3],
    m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] * v[3],
  ];
}

// ── LU decomposition & solver (from numeric.js) ──────────────────────────

const abs = Math.abs;

function cloneDeep(x: number[] | number[][]): typeof x {
  if (typeof x !== "object") return x;
  if (typeof (x as unknown[])[0] === "object") return (x as number[][]).map((row) => [...row]);
  return [...(x as number[])];
}

function luDecompose(A: number[][], _fast?: boolean): { LU: number[][]; P: number[] } {
  let i: number, j: number, k: number, absAjk: number, Akk: number, Ak: number[], Pk: number, Ai: number[], max: number;
  const n = A.length;
  const n1 = n - 1;
  const P = new Array<number>(n);

  const lu = cloneDeep(A) as number[][];

  for (k = 0; k < n; ++k) {
    Pk = k;
    Ak = lu[k];
    max = abs(Ak[k]);
    for (j = k + 1; j < n; ++j) {
      absAjk = abs(lu[j][k]);
      if (max < absAjk) {
        max = absAjk;
        Pk = j;
      }
    }
    P[k] = Pk;

    if (Pk !== k) {
      lu[k] = lu[Pk];
      lu[Pk] = Ak;
      Ak = lu[k];
    }

    Akk = Ak[k];

    for (i = k + 1; i < n; ++i) {
      lu[i][k] /= Akk;
    }

    for (i = k + 1; i < n; ++i) {
      Ai = lu[i];
      for (j = k + 1; j < n1; ++j) {
        Ai[j] -= Ai[k] * Ak[j];
        ++j;
        Ai[j] -= Ai[k] * Ak[j];
      }
      if (j === n1) {
        Ai[j] -= Ai[k] * Ak[j];
      }
    }
  }

  return { LU: lu, P };
}

function luSolveFromLUP(lup: { LU: number[][]; P: number[] }, b: number[]): number[] {
  const lu = lup.LU;
  const n = lu.length;
  const x = [...b];
  const P = lup.P;
  let tmp: number;

  for (let i = 0; i < n; ++i) {
    const Pi = P[i];
    if (P[i] !== i) {
      tmp = x[i];
      x[i] = x[Pi];
      x[Pi] = tmp;
    }
    const LUi = lu[i];
    for (let j = 0; j < i; ++j) {
      x[i] -= x[j] * LUi[j];
    }
  }

  for (let i = n - 1; i >= 0; --i) {
    const LUi = lu[i];
    for (let j = i + 1; j < n; ++j) {
      x[i] -= x[j] * LUi[j];
    }
    x[i] /= LUi[i];
  }

  return x;
}

function luSolve(A: number[][], b: number[], fast?: boolean): number[] {
  return luSolveFromLUP(luDecompose(A, fast), b);
}

// ─── ColorUtil ───────────────────────────────────────────────────────────

/**
 * Parses an Android color string (#RGB, #ARGB, #RRGGBB, #AARRGGBB)
 * into an RGBA object with 0-255 channels.
 */
export function parseAndroidColor(val: string): RGBA | undefined {
  if (typeof val !== "string") return undefined;
  const v = (val || "").replace(/^\s*#?|\s*$/g, "");
  const dict: RGBA = { a: 0, r: 0, g: 0, b: 0 };

  if (v.length === 3) {
    dict.a = 255;
    dict.r = parseInt(v.substring(0, 1), 16) * 17;
    dict.g = parseInt(v.substring(1, 2), 16) * 17;
    dict.b = parseInt(v.substring(2, 3), 16) * 17;
  } else if (v.length === 4) {
    dict.a = parseInt(v.substring(0, 1), 16) * 17;
    dict.r = parseInt(v.substring(1, 2), 16) * 17;
    dict.g = parseInt(v.substring(2, 3), 16) * 17;
    dict.b = parseInt(v.substring(3, 4), 16) * 17;
  } else if (v.length === 6) {
    dict.a = 255;
    dict.r = parseInt(v.substring(0, 2), 16);
    dict.g = parseInt(v.substring(2, 4), 16);
    dict.b = parseInt(v.substring(4, 6), 16);
  } else if (v.length === 8) {
    dict.a = parseInt(v.substring(0, 2), 16);
    dict.r = parseInt(v.substring(2, 4), 16);
    dict.g = parseInt(v.substring(4, 6), 16);
    dict.b = parseInt(v.substring(6, 8), 16);
  } else {
    return undefined;
  }

  return isNaN(dict.r) || isNaN(dict.g) || isNaN(dict.b) || isNaN(dict.a) ? undefined : dict;
}

/** Converts an RGBA dict to Android color string (#AARRGGBB or #RRGGBB). */
export function toAndroidString(dict: RGBA): string {
  let str = "#";
  if (dict.a !== 255) {
    str += (dict.a < 16 ? "0" : "") + dict.a.toString(16);
  }
  str +=
    (dict.r < 16 ? "0" : "") +
    dict.r.toString(16) +
    (dict.g < 16 ? "0" : "") +
    dict.g.toString(16) +
    (dict.b < 16 ? "0" : "") +
    dict.b.toString(16);
  return str;
}

/**
 * Converts an SVG/CSS color string to Android color format (#AARRGGBB).
 * Replaces the original tinycolor2 dependency with inline parsing.
 */
export function svgToAndroidColor(color: string): string | undefined {
  if (color === "none") return undefined;

  // Handle #RGB, #RRGGBB, #ARGB, #AARRGGBB directly
  if (color.startsWith("#")) {
    const parsed = parseAndroidColor(color);
    if (parsed) return toAndroidString(parsed);
  }

  // Handle rgb()/rgba()
  const rgbaMatch = color.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/,
  );
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1], 10);
    const g = parseInt(rgbaMatch[2], 10);
    const b = parseInt(rgbaMatch[3], 10);
    const a = rgbaMatch[4] !== undefined ? Math.round(parseFloat(rgbaMatch[4]) * 255) : 255;
    return toAndroidString({ r, g, b, a });
  }

  // Handle named colors (common subset)
  const namedColors: Record<string, string> = {
    black: "#000000",
    white: "#ffffff",
    red: "#ff0000",
    green: "#00ff00",
    blue: "#0000ff",
    transparent: "#00000000",
    yellow: "#ffff00",
    cyan: "#00ffff",
    magenta: "#ff00ff",
    gray: "#808080",
    grey: "#808080",
    orange: "#ffa500",
    purple: "#800080",
    pink: "#ffc0cb",
  };
  const lower = color.toLowerCase().trim();
  if (namedColors[lower]) {
    const parsed = parseAndroidColor(namedColors[lower]);
    if (parsed) return toAndroidString(parsed);
  }

  // Fallback: try as hex without #
  const parsed = parseAndroidColor(color);
  return parsed ? toAndroidString(parsed) : undefined;
}

/** Converts an Android color string to CSS hex format (#RRGGBB or #RRGGBBAA). */
export function androidToCssHexColor(androidColor: string | undefined): string {
  if (!androidColor) return "transparent";
  const d = parseAndroidColor(androidColor);
  if (!d) return "transparent";
  let str = "#";
  str +=
    (d.r < 16 ? "0" : "") +
    d.r.toString(16) +
    (d.g < 16 ? "0" : "") +
    d.g.toString(16) +
    (d.b < 16 ? "0" : "") +
    d.b.toString(16);
  if (d.a !== 255) {
    str += (d.a < 16 ? "0" : "") + d.a.toString(16);
  }
  return str;
}

/** Converts an Android color string to CSS rgba() format. */
export function androidToCssRgbaColor(androidColor: string | undefined, multAlpha = 1): string {
  if (!androidColor) return "transparent";
  const d = parseAndroidColor(androidColor);
  if (!d) return "transparent";
  return `rgba(${d.r},${d.g},${d.b},${((d.a * multAlpha) / 255).toFixed(2)})`;
}

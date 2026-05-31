import { describe, expect, it } from "vitest";
import { exportLottie } from "../exporter";
import {
  arePathsStructurallyCompatible,
  autoFixPathPair,
  countPathPoints,
  getInterpolatedPath,
  parsePath,
  pathToString,
} from "../pathUtils";

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function coord(rng: () => number) {
  return Number((rng() * 56 - 16).toFixed(2));
}

function randomPath(seed: number, options: { curves?: boolean } = {}) {
  const rng = mulberry32(seed);
  const commands: string[] = [`M ${coord(rng)} ${coord(rng)}`];
  const commandCount = 2 + Math.floor(rng() * 4);

  for (let i = 0; i < commandCount; i++) {
    const pick = rng();
    if (!options.curves || pick < 0.58) {
      commands.push(`L ${coord(rng)} ${coord(rng)}`);
    } else if (pick < 0.78) {
      commands.push(`Q ${coord(rng)} ${coord(rng)} ${coord(rng)} ${coord(rng)}`);
    } else {
      commands.push(
        `C ${coord(rng)} ${coord(rng)} ${coord(rng)} ${coord(rng)} ${coord(rng)} ${coord(rng)}`,
      );
    }
  }

  return commands.join(" ");
}

function finiteDeep(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteDeep);
  if (value && typeof value === "object") return Object.values(value).every(finiteDeep);
  return true;
}

const morphPairs = [
  ["M 0 0 L 10 0 L 10 10 L 0 10", "M 0 0 L 5 5 L 10 0 L 10 10 L 0 10"],
  ["M 2 2 L 12 2 L 12 12 L 2 12 L 2 2", "M 12 12 L 2 12 L 2 2 L 12 2 L 12 12"],
  ["M 0 0 L 12 0 L 12 12 L 0 12 Z", "M 2 2 L 10 10 L 18 2 Z"],
  ["M 0 0 L 10 10 M 20 20 L 30 30", "M 5 5 L 15 15"],
];

describe("reliability harness", () => {
  it("fuzzes parse -> serialize -> parse as an idempotent recovery boundary", () => {
    for (let seed = 1; seed <= 120; seed++) {
      const path = randomPath(seed, { curves: true });
      const serialized = pathToString(parsePath(path));
      const reparsed = pathToString(parsePath(serialized));

      expect(serialized).not.toMatch(/NaN|Infinity|-Infinity/);
      expect(reparsed).toBe(serialized);
    }
  });

  it("checks morph auto-fix and interpolation invariants on curated hard cases", () => {
    for (const [fromPath, toPath] of morphPairs) {
      const from = parsePath(fromPath);
      const to = parsePath(toPath);
      const [fixedFrom, fixedTo] = autoFixPathPair(from, to);

      expect(arePathsStructurallyCompatible(fixedFrom, fixedTo), fromPath).toBe(true);
      expect(countPathPoints(fixedFrom), fromPath).toBe(countPathPoints(fixedTo));
      expect(finiteDeep(fixedFrom), fromPath).toBe(true);
      expect(finiteDeep(fixedTo), fromPath).toBe(true);

      for (const t of [0, 0.25, 0.5, 0.75, 1]) {
        const interpolated = getInterpolatedPath(fixedFrom, fixedTo, t);
        const normalized = pathToString(parsePath(interpolated));

        expect(interpolated).not.toMatch(/NaN|Infinity|-Infinity/);
        expect(normalized).not.toMatch(/NaN|Infinity|-Infinity/);
      }
    }
  });

  it("keeps generated Lottie shape keyframes finite and structurally aligned", () => {
    for (let seed = 1; seed <= 48; seed++) {
      const lottie = exportLottie(
        parsePath(randomPath(seed + 2000, { curves: true })),
        parsePath(randomPath(seed + 3000, { curves: true })),
        `fuzz-${seed}`,
      );
      const shape = lottie.layers[0]!.shapes[0]!.it[0]!.ks!.k;
      const start = shape[0].s[0];
      const end = shape[1].s[0];

      expect(finiteDeep(lottie)).toBe(true);
      expect(start.v).toHaveLength(end.v.length);
      expect(start.i).toHaveLength(start.v.length);
      expect(start.o).toHaveLength(start.v.length);
      expect(end.i).toHaveLength(end.v.length);
      expect(end.o).toHaveLength(end.v.length);
    }
  });

  it("keeps morph preparation under a generous interactive budget", () => {
    const t0 = performance.now();

    for (let i = 0; i < 60; i++) {
      const [fromPath, toPath] = morphPairs[i % morphPairs.length];
      autoFixPathPair(parsePath(fromPath), parsePath(toPath));
    }

    expect(performance.now() - t0).toBeLessThan(750);
  });
});

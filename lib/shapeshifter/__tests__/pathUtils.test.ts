import { describe, it, expect } from "vitest";
import {
  parsePath,
  pathToString,
  reversePath,
  shiftPath,
  splitCommandInHalf,
  autoFixPathPair,
  getInterpolatedPath,
  arePathsStructurallyCompatible,
  countPathPoints,
  setCommandAsFirst,
  insertPointNear,
  splitPointNear,
} from "../pathUtils";
import { parserSpecs, autoFixTests, mutationTests } from "./testFixtures";

function normalize(d: string): string {
  return pathToString(parsePath(d));
}

function n(s: string): string {
  return pathToString(parsePath(s));
}

describe("pathUtils", () => {
  describe("parse + serialize roundtrip (original PathParser.spec.ts)", () => {
    for (const spec of parserSpecs) {
      describe(spec.description, () => {
        for (const test of spec.tests) {
          it(test.description || spec.description, () => {
            const result = normalize(test.before);
            expect(result).toEqual(test.after);
          });
        }
      });
    }
  });

  describe("reversePath", () => {
    it("reverses an open 3-point path", () => {
      expect(n("M 0 0 L 10 10 L 20 20")).toEqual("M0 0 L10 10 L20 20");
      const result = pathToString(reversePath(parsePath("M 0 0 L 10 10 L 20 20")));
      expect(result).toEqual("M20 20 L10 10 L0 0");
    });

    it("reverses a closed triangle", () => {
      const result = pathToString(reversePath(parsePath("M 0 0 L 10 10 L 20 20 Z")));
      expect(result).toEqual("M20 20 L10 10 L0 0 Z");
    });

    it("reverses a closed rectangle", () => {
      const result = pathToString(reversePath(parsePath("M 19 11 L 5 11 L 5 13 L 19 13 Z")));
      expect(result).toEqual("M19 13 L5 13 L5 11 L19 11 Z");
    });

    it("double reverse returns original", () => {
      const original = "M19 11 L5 11 L5 13 L19 13 Z";
      const once = reversePath(parsePath(original));
      const twice = reversePath(once);
      expect(pathToString(twice)).toEqual(pathToString(parsePath(original)));
    });

    it("reverses cubic bezier control points", () => {
      const result = pathToString(
        reversePath(parsePath("M 19 11 C 19 11 5 11 5 11 C 5 11 5 13 5 13 L 19 13 L 19 11")),
      );
      expect(result).toEqual("M19 11 L19 13 L5 13 C5 13 5 11 5 11 C5 11 19 11 19 11");
    });

    it("reverses arc with flipped sweep flag", () => {
      const path = parsePath("M 0 0 A 5 5 0 1 1 10 0");
      const reversed = reversePath(path);
      const d = pathToString(reversed);
      expect(d).toContain("A5 5 0 1 0");
    });

    it("handles single-command path unchanged", () => {
      const result = pathToString(reversePath(parsePath("M 5 5")));
      expect(result).toEqual("M5 5");
    });

    it("handles empty path", () => {
      const result = reversePath(parsePath(""));
      expect(result.subPaths).toHaveLength(1);
      expect(result.subPaths[0].commands).toHaveLength(0);
    });
  });

  describe("shiftPath", () => {
    it("shifts forward by 1 on closed path", () => {
      const result = pathToString(shiftPath(parsePath("M 19 11 L 5 11 L 5 13 L 19 13 Z"), 1));
      expect(result).toEqual("M5 11 L5 13 L19 13 L5 11 Z");
    });

    it("shift by 0 returns same path data", () => {
      const original = parsePath("M 19 11 L 5 11 L 5 13 L 19 13 Z");
      const result = shiftPath(original, 0);
      expect(result).toBe(original);
    });

    it("does not affect open paths", () => {
      const original = "M 0 0 L 10 10 L 20 20";
      const result = pathToString(shiftPath(parsePath(original), 1));
      expect(result).toEqual(n(original));
    });

    it("full rotation on 2-draw-cmd closed path", () => {
      const original = "M 1 1 L 2 2 Z";
      const result = pathToString(shiftPath(parsePath(original), 2));
      expect(result).toEqual(pathToString(parsePath(original)));
    });
  });

  describe("splitCommandInHalf", () => {
    it("splits a line in half", () => {
      const result = pathToString(
        splitCommandInHalf(parsePath("M 0 0 L 10 10 L 20 20"), 0, 1),
      );
      expect(result).toEqual("M0 0 L5 5 L10 10 L20 20");
    });

    it("splits second line in half", () => {
      const result = pathToString(
        splitCommandInHalf(parsePath("M 0 0 L 5 5 L 10 10 L 20 20"), 0, 2),
      );
      expect(result).toEqual("M0 0 L5 5 L7.5 7.5 L10 10 L20 20");
    });

    it("does not split M command", () => {
      const original = "M0 0 L10 10";
      const result = pathToString(splitCommandInHalf(parsePath("M 0 0 L 10 10"), 0, 0));
      expect(result).toEqual(original);
    });

    it("does not split Z command", () => {
      const original = "M0 0 L10 10 Z";
      const result = pathToString(splitCommandInHalf(parsePath("M 0 0 L 10 10 Z"), 0, 2));
      expect(result).toEqual(original);
    });

    it("splits cubic bezier preserving curve shape", () => {
      const path = parsePath("M 0 0 C 10 0 10 10 20 10");
      const result = splitCommandInHalf(path, 0, 1);
      const cmds = result.subPaths[0].commands;
      expect(cmds.length).toBe(3);
      expect(cmds[1].type).toBe("C");
      expect(cmds[2].type).toBe("C");
    });
  });

  describe("autoFixPathPair", () => {
    it("makes identical closed paths compatible", () => {
      const from = parsePath("M 2 2 L 12 2 L 12 12 L 2 12 L 2 2");
      const to = parsePath("M 12 12 L 2 12 L 2 2 L 12 2 L 12 12");
      const [fixedFrom, fixedTo] = autoFixPathPair(from, to);
      expect(arePathsStructurallyCompatible(fixedFrom, fixedTo)).toBe(true);
    });

    it("preserves shape after autoFix (identical squares)", () => {
      const from = parsePath("M 2 2 L 12 2 L 12 12 L 2 12 L 2 2");
      const to = parsePath("M 2 2 L 12 2 L 12 12 L 2 12 L 2 2");
      const [fixedFrom, fixedTo] = autoFixPathPair(from, to);
      expect(pathToString(fixedFrom)).toEqual(pathToString(fixedTo));
    });

    it("handles paths with different number of commands", () => {
      const from = parsePath("M 0 0 L 10 0 L 10 10 L 0 10 L 0 0");
      const to = parsePath("M 0 0 L 5 5 L 10 0 L 10 10 L 0 10 L 0 0");
      const [fixedFrom, fixedTo] = autoFixPathPair(from, to);
      expect(countPathPoints(fixedFrom)).toEqual(countPathPoints(fixedTo));
    });

    it("handles paths with different subpath counts", () => {
      const from = parsePath("M 0 0 L 10 10 M 20 20 L 30 30");
      const to = parsePath("M 5 5 L 15 15");
      const [fixedFrom, fixedTo] = autoFixPathPair(from, to);
      expect(fixedFrom.subPaths.length).toEqual(fixedTo.subPaths.length);
    });

    it("autoFix from original AutoAwesome.spec.ts: simple square - makes compatible", () => {
      const from = parsePath("M 2 2 L 12 2 L 12 12 L 2 12 L 2 2");
      const to = parsePath("M 12 12 L 2 12 L 2 2 L 12 2 L 12 12");
      const [fixedFrom, fixedTo] = autoFixPathPair(from, to);
      expect(arePathsStructurallyCompatible(fixedFrom, fixedTo)).toBe(true);
    });

    it("autoFix from original AutoAwesome.spec.ts: multi-subpath - makes compatible", () => {
      const from = parsePath(
        "M 2 2 L 6 2 L 6 6 L 2 6 L 2 2 M 10 3 L 20 3 L 20 5 L 10 5 L 10 3 M 4 10 L 1 16 L 7 16 L 7 10 L 4 10 M 20 20 L 20 15 L 18 15 L 18 20 L 20 20",
      );
      const to = parsePath(
        "M 10 3 L 20 3 L 20 5 L 10 5 L 10 3 M 4 10 L 1 16 L 7 16 L 7 10 L 4 10 M 20 20 L 20 15 L 18 15 L 18 20 L 20 20 M 2 2 L 6 2 L 6 6 L 2 6 L 2 2",
      );
      const [fixedFrom, fixedTo] = autoFixPathPair(from, to);
      expect(arePathsStructurallyCompatible(fixedFrom, fixedTo)).toBe(true);
    });
  });

  describe("getInterpolatedPath", () => {
    it("returns from path at t=0", () => {
      const from = parsePath("M 0 0 L 10 10");
      const to = parsePath("M 10 10 L 20 20");
      const result = getInterpolatedPath(from, to, 0);
      expect(result).toContain("0 0");
      expect(result).toContain("10 10");
    });

    it("returns to path at t=1", () => {
      const from = parsePath("M 0 0 L 10 10");
      const to = parsePath("M 10 10 L 20 20");
      const result = getInterpolatedPath(from, to, 1);
      expect(result).toContain("10 10");
      expect(result).toContain("20 20");
    });

    it("interpolates midpoint at t=0.5", () => {
      const from = parsePath("M 0 0 L 10 0");
      const to = parsePath("M 0 10 L 10 10");
      const result = getInterpolatedPath(from, to, 0.5);
      expect(result).toContain("0 5");
      expect(result).toContain("10 5");
    });

    it("clamps t outside [0,1]", () => {
      const from = parsePath("M 0 0 L 10 10");
      const to = parsePath("M 10 10 L 20 20");
      const below = getInterpolatedPath(from, to, -1);
      const atZero = getInterpolatedPath(from, to, 0);
      expect(below).toEqual(atZero);

      const above = getInterpolatedPath(from, to, 2);
      const atOne = getInterpolatedPath(from, to, 1);
      expect(above).toEqual(atOne);
    });

    it("handles paths with different command counts", () => {
      const from = parsePath("M 0 0 L 5 5 L 10 10");
      const to = parsePath("M 0 0 L 10 10");
      const result = getInterpolatedPath(from, to, 0.5);
      expect(typeof result).toBe("string");
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("arePathsStructurallyCompatible", () => {
    it("returns true for identical paths", () => {
      const path = parsePath("M 0 0 L 10 10 L 20 20");
      expect(arePathsStructurallyCompatible(path, path)).toBe(true);
    });

    it("returns false for different subpath counts", () => {
      const a = parsePath("M 0 0 L 10 10");
      const b = parsePath("M 0 0 L 10 10 M 20 20 L 30 30");
      expect(arePathsStructurallyCompatible(a, b)).toBe(false);
    });

    it("returns false for different command counts", () => {
      const a = parsePath("M 0 0 L 10 10");
      const b = parsePath("M 0 0 L 10 10 L 20 20");
      expect(arePathsStructurallyCompatible(a, b)).toBe(false);
    });

    it("returns false for different command types", () => {
      const a = parsePath("M 0 0 L 10 10");
      const b = parsePath("M 0 0 C 5 5 5 5 10 10");
      expect(arePathsStructurallyCompatible(a, b)).toBe(false);
    });

    it("returns true for same structure different points", () => {
      const a = parsePath("M 0 0 L 10 10");
      const b = parsePath("M 5 5 L 20 20");
      expect(arePathsStructurallyCompatible(a, b)).toBe(true);
    });
  });

  describe("setCommandAsFirst", () => {
    it("rotates closed subpath to start at command index", () => {
      const input = "M 4 4 L 4 20 L 20 20 L 20 4 Z";
      const result = pathToString(setCommandAsFirst(parsePath(input), 0, 2));
      expect(result).toEqual("M4 20 L20 20 L20 4 L4 20 Z");
    });

    it("no-op on open subpath", () => {
      const input = "M 0 0 L 10 10 L 20 20";
      const result = pathToString(setCommandAsFirst(parsePath(input), 0, 1));
      expect(result).toEqual(n(input));
    });

    it("no-op on index 0", () => {
      const input = "M 0 0 L 10 10 L 20 20 Z";
      const result = pathToString(setCommandAsFirst(parsePath(input), 0, 0));
      expect(result).toEqual(n(input));
    });
  });

  describe("insertPointNear", () => {
    it("finds closest point on a line segment", () => {
      const path = parsePath("M 0 0 L 10 0");
      const result = insertPointNear(path, { x: 5, y: 2 });
      expect(result).not.toBeNull();
      expect(result!.subIdx).toBe(0);
      expect(result!.cmdIdx).toBe(1);
      expect(result!.newPoint.x).toBeCloseTo(5, 1);
      expect(result!.newPoint.y).toBeCloseTo(0, 1);
      expect(result!.t).toBeCloseTo(0.5, 1);
    });

    it("finds closest point on a cubic bezier", () => {
      const path = parsePath("M 0 0 C 0 10 10 10 10 0");
      const result = insertPointNear(path, { x: 5, y: 10 });
      expect(result).not.toBeNull();
      expect(result!.subIdx).toBe(0);
    });

    it("returns null for empty path", () => {
      const path = parsePath("");
      const result = insertPointNear(path, { x: 5, y: 5 });
      expect(result).toBeNull();
    });
  });

  describe("splitPointNear", () => {
    it("splits line at midpoint", () => {
      const path = parsePath("M 0 0 L 20 0");
      const result = splitPointNear(path, { x: 10, y: 0 });
      expect(result).not.toBeNull();
      if (result) {
        const cmds = result.subPaths[0].commands;
        expect(cmds.length).toBe(3);
      }
    });

    it("returns null when click is at endpoint", () => {
      const path = parsePath("M 0 0 L 20 0");
      const result = splitPointNear(path, { x: 20, y: 0 });
      expect(result).toBeNull();
    });

    it("returns null for empty path", () => {
      const path = parsePath("");
      const result = splitPointNear(path, { x: 5, y: 5 });
      expect(result).toBeNull();
    });
  });

  describe("countPathPoints", () => {
    it("counts points in simple path", () => {
      expect(countPathPoints(parsePath("M 0 0 L 10 10"))).toBe(2);
    });

    it("counts points in cubic bezier", () => {
      expect(countPathPoints(parsePath("M 0 0 C 5 5 10 5 15 0"))).toBe(4);
    });

    it("counts points in multi-subpath", () => {
      expect(countPathPoints(parsePath("M 0 0 L 10 10 M 20 20 L 30 30"))).toBe(4);
    });

    it("Z contributes 0 points", () => {
      expect(countPathPoints(parsePath("M 0 0 L 10 10 Z"))).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("handles empty string", () => {
      const result = parsePath("");
      expect(result.subPaths).toHaveLength(1);
      expect(result.subPaths[0].commands).toHaveLength(0);
    });

    it("handles whitespace-only string", () => {
      const result = parsePath("   ");
      expect(result.subPaths).toHaveLength(1);
      expect(result.subPaths[0].commands).toHaveLength(0);
    });

    it("serializes empty path to empty string", () => {
      expect(pathToString(parsePath(""))).toEqual("");
    });

    it("roundtrips simple path through parse -> serialize", () => {
      expect(normalize("M 0 0 L 10 10 L 20 20")).toEqual("M0 0 L10 10 L20 20");
    });

    it("handles relative commands", () => {
      expect(normalize("m 0 0 l 10 10 l 10 10")).toEqual("M0 0 L10 10 L20 20");
    });

    it("handles H and V commands", () => {
      expect(normalize("M 0 0 H 10 V 10 H 0 V 0")).toEqual("M0 0 L10 0 L10 10 L0 10 L0 0");
    });

    it("handles arc commands", () => {
      const result = parsePath("M 0 0 A 5 5 0 1 0 10 0");
      const cmd = result.subPaths[0].commands[1];
      expect(cmd.type).toBe("A");
      expect(cmd.arcParams).toBeDefined();
      expect(cmd.arcParams!.rx).toBe(5);
      expect(cmd.arcParams!.ry).toBe(5);
      expect(cmd.arcParams!.largeArc).toBe(true);
      expect(cmd.arcParams!.sweep).toBe(false);
    });

    it("handles scientific notation in coordinates", () => {
      const result = parsePath("M 1e1 2e2 L 3e0 4e-1");
      const cmds = result.subPaths[0].commands;
      expect(cmds[0].points[0]).toEqual({ x: 10, y: 200 });
      expect(cmds[1].points[0]).toEqual({ x: 3, y: 0.4 });
    });
  });
});

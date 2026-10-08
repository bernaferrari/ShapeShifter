// @vitest-environment happy-dom

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileAndroidArtboard } from "../androidCompiler";
import { importVectorDrawable } from "../import/androidVectorDrawable";
import { parsePath, prepareForMorph, scoreMorphQuality } from "../pathUtils";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("Android semantic parity fixtures", () => {
  it("imports nested clip + viewport mismatch from the committed corpus", () => {
    const xml = readFileSync(join(fixtureDir, "nested-clip.xml"), "utf8");
    const imported = importVectorDrawable(xml);
    expect(imported.viewportWidth).toBe(48);
    expect(imported.width).toBe(24);
    expect(imported.layers.some((layer) => layer.type === "clipPath")).toBe(true);
    expect(imported.layers.some((layer) => layer.parentId)).toBe(true);
  });

  it("round-trips the fixture through the artboard compiler", () => {
    const xml = readFileSync(join(fixtureDir, "nested-clip.xml"), "utf8");
    const imported = importVectorDrawable(xml);
    const bundle = compileAndroidArtboard({
      name: "nested_clip",
      layers: imported.layers,
      vector: {
        id: "v",
        name: "nested_clip",
        width: imported.width,
        height: imported.height,
        viewportWidth: imported.viewportWidth,
        viewportHeight: imported.viewportHeight,
        alpha: imported.alpha,
      },
      animation: { id: "none", name: "none", duration: 1, blocks: [] },
    });
    const exported = bundle.files.find((file) => file.path.endsWith("_vector.xml"))!.content;
    expect(exported).toContain('android:viewportWidth="48"');
    expect(exported).toContain("clip-path");
    const again = importVectorDrawable(exported);
    expect(again.layers.filter((layer) => layer.type === "path").length).toBeGreaterThan(0);
  });

  it("scores a prepared morph from the heart demo geometry", () => {
    const from = parsePath("M2 12 L12 22 L22 12 Z");
    const to = parsePath("M4 12 L12 20 L20 12 Z");
    const prepared = prepareForMorph(from, to);
    expect(prepared.mapping.alignments.kind).toBe("prepared");
    const score = scoreMorphQuality(from, to);
    expect(score.compatible).toBe(true);
    expect(Number.isFinite(score.areaJump)).toBe(true);
  });
});

describe("aapt2 export gate", () => {
  it("compiles the generated vector when aapt2 is on PATH", () => {
    const xml = readFileSync(join(fixtureDir, "nested-clip.xml"), "utf8");
    const imported = importVectorDrawable(xml);
    const bundle = compileAndroidArtboard({
      name: "nested_clip",
      layers: imported.layers,
      vector: {
        id: "v",
        name: "nested_clip",
        width: imported.width,
        height: imported.height,
        viewportWidth: imported.viewportWidth,
        viewportHeight: imported.viewportHeight,
        alpha: imported.alpha,
      },
      animation: { id: "none", name: "none", duration: 1, blocks: [] },
    });
    const vector = bundle.files.find((file) => file.path.endsWith("_vector.xml"))!.content;
    let aapt2: string | null = null;
    try {
      aapt2 = execFileSync("which", ["aapt2"], { encoding: "utf8" }).trim();
    } catch {
      aapt2 = null;
    }
    if (!aapt2) {
      expect(vector).toContain("<vector");
      return;
    }
    const out = join(fixtureDir, ".generated-nested.xml");
    writeFileSync(out, vector);
    execFileSync(aapt2, ["compile", "-o", join(fixtureDir, ".generated-nested.zip"), out]);
  });
});

/**
 * Tests for playheadResolve.ts
 * Covers numberAtTime, colorAtTime, pathDAtTime, and sampleMotionPath —
 * the functions that drive animation playback/scrubbing by resolving a
 * layer's visual properties at an absolute time (ms) from timeline blocks.
 */

import { describe, it, expect } from "vitest";
import { numberAtTime, colorAtTime, pathDAtTime, sampleMotionPath } from "../playheadResolve";
import { parsePath, pathToString, getInterpolatedPath } from "../pathUtils";
import type { Layer, TimelineBlock } from "../types";

function makeLayer(overrides: Partial<Layer> = {}): Layer {
  return {
    id: "layer1",
    name: "Layer 1",
    type: "path",
    from: parsePath("M0,0 L10,10"),
    visible: true,
    locked: false,
    ...overrides,
  };
}

function makeBlock(overrides: Partial<TimelineBlock> = {}): TimelineBlock {
  return {
    id: "block1",
    layerId: "layer1",
    propertyName: "translateX",
    fromValue: 0,
    toValue: 100,
    startTime: 0,
    endTime: 1000,
    ...overrides,
  };
}

describe("numberAtTime", () => {
  it("returns the layer's own field value when there are zero blocks for the property", () => {
    const layer = makeLayer({ translateX: 42 });
    expect(numberAtTime(layer, [], "translateX", 500, 1000)).toBe(42);
  });

  it("falls back to 0 (base) when there are zero blocks and the field is unset", () => {
    const layer = makeLayer();
    expect(numberAtTime(layer, [], "translateX", 500, 1000)).toBe(0);
  });

  it("returns fromValue when ms is before startTime", () => {
    const layer = makeLayer();
    const block = makeBlock({ startTime: 200, endTime: 800, fromValue: 10, toValue: 90 });
    expect(numberAtTime(layer, [block], "translateX", 100, 1000)).toBe(10);
  });

  it("returns toValue when ms is after endTime", () => {
    const layer = makeLayer();
    const block = makeBlock({ startTime: 200, endTime: 800, fromValue: 10, toValue: 90 });
    expect(numberAtTime(layer, [block], "translateX", 900, 1000)).toBe(90);
  });

  it("returns fromValue exactly at startTime (boundary)", () => {
    const layer = makeLayer();
    const block = makeBlock({
      startTime: 200,
      endTime: 800,
      fromValue: 10,
      toValue: 90,
      interpolator: "LINEAR",
    });
    expect(numberAtTime(layer, [block], "translateX", 200, 1000)).toBe(10);
  });

  it("returns toValue exactly at endTime (boundary)", () => {
    const layer = makeLayer();
    const block = makeBlock({
      startTime: 200,
      endTime: 800,
      fromValue: 10,
      toValue: 90,
      interpolator: "LINEAR",
    });
    expect(numberAtTime(layer, [block], "translateX", 800, 1000)).toBe(90);
  });

  it("interpolates linearly in the middle with interpolator: LINEAR", () => {
    const layer = makeLayer();
    const block = makeBlock({
      startTime: 0,
      endTime: 1000,
      fromValue: 0,
      toValue: 100,
      interpolator: "LINEAR",
    });
    // local t = 0.5 -> 0 + (100-0)*0.5 = 50
    expect(numberAtTime(layer, [block], "translateX", 500, 1000)).toBeCloseTo(50, 5);
  });

  it("interpolates in the middle with no interpolator field set (defaults to linear via evaluateBlock)", () => {
    const layer = makeLayer();
    const block = makeBlock({
      startTime: 0,
      endTime: 1000,
      fromValue: 0,
      toValue: 100,
    });
    expect(block.interpolator).toBeUndefined();
    expect(numberAtTime(layer, [block], "translateX", 500, 1000)).toBeCloseTo(50, 5);
  });

  it("picks the correct block across two non-overlapping sequential blocks (same property)", () => {
    const layer = makeLayer();
    const blockA = makeBlock({
      id: "a",
      startTime: 0,
      endTime: 500,
      fromValue: 0,
      toValue: 50,
      interpolator: "LINEAR",
    });
    const blockB = makeBlock({
      id: "b",
      startTime: 500,
      endTime: 1000,
      fromValue: 200,
      toValue: 400,
      interpolator: "LINEAR",
    });
    const blocks = [blockA, blockB];

    // Within block A range
    expect(numberAtTime(layer, blocks, "translateX", 0, 1000)).toBeCloseTo(0, 5);
    expect(numberAtTime(layer, blocks, "translateX", 250, 1000)).toBeCloseTo(25, 5);

    // At a shared boundary the later-starting animator wins, matching the
    // deterministic overlap rule used by the Android scene evaluator.
    expect(numberAtTime(layer, blocks, "translateX", 500, 1000)).toBeCloseTo(200, 5);

    // Within block B range (strictly past the boundary)
    expect(numberAtTime(layer, blocks, "translateX", 750, 1000)).toBeCloseTo(300, 5);
    expect(numberAtTime(layer, blocks, "translateX", 1000, 1000)).toBeCloseTo(400, 5);
  });

  it("returns toValue for a lone zero-duration block (startTime === endTime)", () => {
    const layer = makeLayer();
    // With a single block, ms=500 hits the early "ms >= last.endTime" guard
    // (500 >= 500) before the loop ever runs evaluateBlock — so this locks in
    // the observable result but does NOT exercise evaluateBlock's span<=0
    // branch. See the next test for that.
    const block = makeBlock({
      startTime: 500,
      endTime: 500,
      fromValue: 10,
      toValue: 99,
    });
    expect(numberAtTime(layer, [block], "translateX", 500, 1000)).toBeCloseTo(99, 5);
  });

  it("resolves a mid-sequence zero-duration block via evaluateBlock's span<=0 branch", () => {
    const layer = makeLayer();
    // blockA ends at 499 (strictly before ms=500, so `ms > block.endTime` skips
    // it), blockC starts after 500 — only blockB (the zero-span block at
    // exactly 500) matches the loop's `ms >= startTime && ms <= endTime` check,
    // and since it isn't the last segment, the early "after last segment"
    // shortcut doesn't apply. This forces numberAtTime to call evaluateBlock on
    // a real span<=0 block and use its `return 1` (eased-to-end) result.
    const blockA = makeBlock({
      id: "a",
      startTime: 0,
      endTime: 499,
      fromValue: 0,
      toValue: 20,
      interpolator: "LINEAR",
    });
    const blockB = makeBlock({
      id: "b",
      startTime: 500,
      endTime: 500,
      fromValue: 10,
      toValue: 77,
    });
    const blockC = makeBlock({
      id: "c",
      startTime: 501,
      endTime: 1000,
      fromValue: 80,
      toValue: 100,
      interpolator: "LINEAR",
    });
    expect(numberAtTime(layer, [blockA, blockB, blockC], "translateX", 500, 1000)).toBeCloseTo(
      77,
      5,
    );
  });
});

describe("colorAtTime", () => {
  it("returns fallback when there are zero blocks", () => {
    const layer = makeLayer();
    expect(colorAtTime(layer, [], "fillColor", 500, 1000, "#000000")).toBe("#000000");
  });

  it("returns the first block's fromValue when ms is before its startTime", () => {
    const layer = makeLayer();
    const block: TimelineBlock = {
      id: "c1",
      layerId: "layer1",
      propertyName: "fillColor",
      fromValue: "#ff0000",
      toValue: "#00ff00",
      startTime: 200,
      endTime: 800,
    };
    expect(colorAtTime(layer, [block], "fillColor", 100, 1000, "#fallback")).toBe("#ff0000");
  });

  it("returns the last block's toValue when ms is after its endTime", () => {
    const layer = makeLayer();
    const block: TimelineBlock = {
      id: "c1",
      layerId: "layer1",
      propertyName: "fillColor",
      fromValue: "#ff0000",
      toValue: "#00ff00",
      startTime: 200,
      endTime: 800,
    };
    expect(colorAtTime(layer, [block], "fillColor", 900, 1000, "#fallback")).toBe("#00ff00");
  });

  it("interpolates color channels continuously through the animator", () => {
    const layer = makeLayer();
    const block: TimelineBlock = {
      id: "c1",
      layerId: "layer1",
      propertyName: "fillColor",
      fromValue: "#ff0000",
      toValue: "#00ff00",
      startTime: 0,
      endTime: 1000,
    };
    expect(colorAtTime(layer, [block], "fillColor", 499, 1000, "#fallback")).toBe("#807f00");
    expect(colorAtTime(layer, [block], "fillColor", 501, 1000, "#fallback")).toBe("#7f8000");
    expect(colorAtTime(layer, [block], "fillColor", 500, 1000, "#fallback")).toBe("#808000");
    expect(colorAtTime(layer, [block], "fillColor", 250, 1000, "#fallback")).toBe("#bf4000");
  });
});

describe("pathDAtTime", () => {
  it("returns pathToString(from) for a static (non-morphing) layer with no pathData blocks", () => {
    const from = parsePath("M0,0 L10,10");
    const layer = makeLayer({ from });
    const result = pathDAtTime(layer, [], 500, 1000, 0.5);
    expect(result).toBe(pathToString(from));
  });

  it("returns pathToString(layer.pathData) when pathData is set and there is no `to` and no blocks", () => {
    const from = parsePath("M0,0 L10,10");
    const pathData = parsePath("M1,1 L20,20");
    const layer = makeLayer({ from, pathData });
    const result = pathDAtTime(layer, [], 500, 1000, 0.5);
    expect(result).toBe(pathToString(pathData));
  });

  it("calls through to getInterpolatedPath for an implicit full-duration morph (to set, progress01 > 0)", () => {
    const from = parsePath("M0,0 L10,10");
    const to = parsePath("M5,5 L20,20");
    const layer = makeLayer({ from, to });
    const result = pathDAtTime(layer, [], 500, 1000, 0.5);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe(getInterpolatedPath(from, to, 0.5));
  });

  it("returns pathToString(from) (not the morph) when to is set but progress01 is 0", () => {
    const from = parsePath("M0,0 L10,10");
    const to = parsePath("M5,5 L20,20");
    const layer = makeLayer({ from, to });
    const result = pathDAtTime(layer, [], 0, 1000, 0);
    expect(result).toBe(pathToString(from));
  });

  it("returns the from path string before an explicit pathData block's startTime", () => {
    const from = parsePath("M0,0 L10,10");
    const to = parsePath("M5,5 L20,20");
    const layer = makeLayer({ from, to });
    const block: TimelineBlock = {
      id: "p1",
      layerId: "layer1",
      propertyName: "pathData",
      fromValue: "",
      toValue: "",
      startTime: 300,
      endTime: 700,
    };
    const result = pathDAtTime(layer, [block], 100, 1000, 0.1);
    expect(result).toBe(pathToString(from));
  });

  it("returns an interpolated path inside an explicit pathData block's range", () => {
    const from = parsePath("M0,0 L10,10");
    const to = parsePath("M5,5 L20,20");
    const layer = makeLayer({ from, to });
    const block: TimelineBlock = {
      id: "p1",
      layerId: "layer1",
      propertyName: "pathData",
      fromValue: "",
      toValue: "",
      startTime: 0,
      endTime: 1000,
      interpolator: "LINEAR",
    };
    const ms = 500;
    const progress01 = ms / 1000;
    const result = pathDAtTime(layer, [block], ms, 1000, progress01);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
    expect(result).toBe(getInterpolatedPath(from, to, progress01));
  });
});

describe("sampleMotionPath", () => {
  it("returns an empty array when the layer has no translateX/translateY blocks (e.g. rotation-only)", () => {
    const layer = makeLayer();
    const block = makeBlock({ propertyName: "rotation", fromValue: 0, toValue: 360 });
    const result = sampleMotionPath(layer, [block], 1000);
    expect(result).toEqual([]);
  });

  it("returns an empty array when there are no blocks at all", () => {
    const layer = makeLayer();
    const result = sampleMotionPath(layer, [], 1000);
    expect(result).toEqual([]);
  });

  it("returns samples + 1 points when translateX/translateY blocks exist, with correct endpoints", () => {
    const layer = makeLayer();
    const blockX = makeBlock({
      id: "tx",
      propertyName: "translateX",
      fromValue: 0,
      toValue: 100,
      startTime: 0,
      endTime: 1000,
      interpolator: "LINEAR",
    });
    const blockY = makeBlock({
      id: "ty",
      propertyName: "translateY",
      fromValue: 10,
      toValue: 200,
      startTime: 0,
      endTime: 1000,
      interpolator: "LINEAR",
    });
    const duration = 1000;
    const samples = 48;
    const result = sampleMotionPath(layer, [blockX, blockY], duration, samples);

    expect(result).toHaveLength(samples + 1);
    // First point (ms=0) -> fromValue of both blocks
    expect(result[0]).toEqual({ x: 0, y: 10 });
    // Last point (ms=duration) -> toValue of both blocks
    expect(result[samples]).toEqual({ x: 100, y: 200 });
  });

  it("defaults samples to 48 (49 points) when not provided", () => {
    const layer = makeLayer();
    const blockX = makeBlock({
      id: "tx",
      propertyName: "translateX",
      fromValue: 0,
      toValue: 100,
      startTime: 0,
      endTime: 1000,
    });
    const result = sampleMotionPath(layer, [blockX], 1000);
    expect(result).toHaveLength(49);
  });
});

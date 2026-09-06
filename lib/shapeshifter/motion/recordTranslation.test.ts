/**
 * Tests for motion/recordTranslation.ts
 * Pins the keyframe-insertion semantics of recordTranslationAtProgress, especially
 * the fresh-track branch: a brand-new track spans the whole timeline, so its start
 * value must resolve to the layer's authored base value — never 0 — or the layer
 * visibly teleports during playback/scrub (consumed via numberAtTime).
 */

import { describe, it, expect } from "vitest";
import { numberAtTime } from "../playheadResolve";
import { parsePath } from "../pathUtils";
import type { AnimationState, Layer } from "../types";
import { recordTranslationAtProgress } from "./recordTranslation";

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

function makeAnimation(duration = 1000): AnimationState {
  return { id: "anim1", name: "Anim 1", duration, blocks: [] };
}

describe("recordTranslationAtProgress", () => {
  it("seeds a fresh whole-timeline track from the layer's current base value, not 0", () => {
    const layer = makeLayer({ translateX: 40 });
    const { animation: next } = recordTranslationAtProgress(
      [layer],
      makeAnimation(),
      [layer.id],
      0.5,
      42,
    );

    const block = next.blocks.find(
      (candidate) =>
        String(candidate.layerId) === String(layer.id) && candidate.propertyName === "translateX",
    )!;
    expect(block.startTime).toBe(0);
    expect(block.endTime).toBe(1000);
    expect(Number(block.fromValue)).toBe(40);
    expect(Number(block.toValue)).toBe(40);
  });

  it("keeps the layer's resolved position identical before and after a mid-timeline record", () => {
    const layer = makeLayer({ translateX: -25 });
    const before = makeAnimation();

    for (const ms of [0, 250, 499]) {
      expect(numberAtTime(layer, before.blocks, "translateX", ms, before.duration)).toBe(-25);
    }

    const { animation: after, layers } = recordTranslationAtProgress(
      [layer],
      before,
      [layer.id],
      0.5,
      42,
    );
    const recorded = layers.find((candidate) => candidate.id === layer.id)!;

    for (const ms of [0, 250, 499, 500, 750, 1000]) {
      expect(numberAtTime(recorded, after.blocks, "translateX", ms, after.duration)).toBeCloseTo(
        -25,
        5,
      );
    }
  });

  it("records the authored value at the start of a fresh track when recording near t=0", () => {
    const layer = makeLayer({ translateY: 7 });
    const { animation: next } = recordTranslationAtProgress(
      [layer],
      makeAnimation(),
      [layer.id],
      0,
      42,
      ["translateY"],
    );

    const block = next.blocks.find(
      (candidate) =>
        String(candidate.layerId) === String(layer.id) && candidate.propertyName === "translateY",
    )!;
    expect(Number(block.fromValue)).toBe(7);
    expect(Number(block.toValue)).toBe(7);
  });

  it("still seeds head/tail extensions from neighboring block values", () => {
    const layer = makeLayer({ translateX: 30 });
    const existing = makeAnimation();
    // A partial track covering only t=[400..600], authored 10 -> 90.
    const withPartialTrack: AnimationState = {
      ...existing,
      blocks: [
        {
          id: "block-partial",
          layerId: layer.id,
          propertyName: "translateX",
          type: "number",
          fromValue: 10,
          toValue: 90,
          startTime: 400,
          endTime: 600,
          interpolator: "FAST_OUT_SLOW_IN",
        },
      ],
    };

    // Record past the end: the tail block must continue from the previous
    // track's end value (90), not jump to 0.
    const tailRecording = recordTranslationAtProgress(
      [layer],
      withPartialTrack,
      [layer.id],
      0.8,
      42,
      ["translateX"],
    ).animation;
    const tailBlocks = tailRecording.blocks.filter(
      (candidate) =>
        String(candidate.layerId) === String(layer.id) &&
        candidate.propertyName === "translateX" &&
        candidate.startTime === 600,
    );
    expect(tailBlocks).toHaveLength(1);
    expect(Number(tailBlocks[0]!.fromValue)).toBe(90);
    expect(Number(tailBlocks[0]!.toValue)).toBe(30);

    // Record before the start: the head block must resolve into the previous
    // track's start value (10), not 0.
    const headRecording = recordTranslationAtProgress(
      [layer],
      withPartialTrack,
      [layer.id],
      0.05,
      43,
      ["translateX"],
    ).animation;
    const headBlocks = headRecording.blocks.filter(
      (candidate) =>
        String(candidate.layerId) === String(layer.id) &&
        candidate.propertyName === "translateX" &&
        candidate.endTime === 400,
    );
    expect(headBlocks).toHaveLength(1);
    expect(Number(headBlocks[0]!.fromValue)).toBe(30);
    expect(Number(headBlocks[0]!.toValue)).toBe(10);
  });

  it("records inside an interior gap without destroying the authored head or tail", () => {
    const layer = makeLayer({ translateX: 99 });
    const existing = makeAnimation();
    // Two authored segments with a gap at t=[300..500].
    const withGap: AnimationState = {
      ...existing,
      blocks: [
        {
          id: "block-head",
          layerId: layer.id,
          propertyName: "translateX",
          type: "number",
          fromValue: 0,
          toValue: 10,
          startTime: 0,
          endTime: 300,
          interpolator: "FAST_OUT_SLOW_IN",
        },
        {
          id: "block-tail",
          layerId: layer.id,
          propertyName: "translateX",
          type: "number",
          fromValue: 20,
          toValue: 30,
          startTime: 500,
          endTime: 1000,
          interpolator: "FAST_OUT_SLOW_IN",
        },
      ],
    };

    const { animation } = recordTranslationAtProgress(
      [layer],
      withGap,
      [layer.id],
      0.4,
      42,
      ["translateX"],
    );
    const blocks = animation.blocks
      .filter(
        (candidate) =>
          String(candidate.layerId) === String(layer.id) &&
          candidate.propertyName === "translateX",
      )
      .sort((a, b) => a.startTime - b.startTime);

    expect(blocks).toHaveLength(3);
    // Authored head preserved but its end truncated to the playhead.
    expect(blocks[0]!.id).toBe("block-head");
    expect(blocks[0]!.startTime).toBe(0);
    expect(blocks[0]!.endTime).toBe(400);
    expect(Number(blocks[0]!.toValue)).toBe(10);
    // New interior block bridges the playhead to the next authored start,
    // seeded from the layer's current base value.
    expect(blocks[1]!.startTime).toBe(400);
    expect(blocks[1]!.endTime).toBe(500);
    expect(Number(blocks[1]!.fromValue)).toBe(99);
    expect(Number(blocks[1]!.toValue)).toBe(20);
    // Authored tail untouched.
    expect(blocks[2]!.id).toBe("block-tail");
    expect(blocks[2]!.startTime).toBe(500);
    expect(blocks[2]!.endTime).toBe(1000);
  });
});

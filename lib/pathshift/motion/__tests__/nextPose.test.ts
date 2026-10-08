import { describe, expect, it } from "vitest";
import { resolveNextPose } from "../nextPose";
import { parsePath } from "../../pathUtils";
import { resolveWorldLayerDraws } from "../../scene/render";
import type { AnimationState, Layer, TimelineBlock } from "../../types";

const shape: Layer = {
  id: "shape",
  name: "Shape",
  type: "path",
  visible: true,
  locked: false,
  from: parsePath("M0 0 L10 0 L10 10 Z"),
  fillColor: "#123456",
};
const block = (layerId: string, startTime = 0, endTime = 1000): TimelineBlock => ({
  id: `${layerId}-${startTime}`,
  layerId,
  propertyName: "translateX",
  type: "number",
  startTime,
  endTime,
  fromValue: 0,
  toValue: 20,
  interpolator: "LINEAR",
});
const animation = (blocks: TimelineBlock[]): AnimationState => ({
  id: "motion",
  name: "Motion",
  duration: 1000,
  blocks,
});
const paths = (pose: NonNullable<ReturnType<typeof resolveNextPose>>) =>
  pose.draws.filter((draw) => !draw.isClipPath);

describe("the next authored pose", () => {
  it("uses the next relevant key, including fractional and delayed starting keys", () => {
    const motion = animation([
      block("unrelated", 0, 200),
      block("shape", 100, 517.25),
      block("shape", 517.25, 1000),
    ]);
    expect(resolveNextPose([shape], motion, [shape.id], 0)?.time).toBe(100);
    expect(resolveNextPose([shape], motion, [shape.id], 100)?.time).toBe(517.25);
    expect(resolveNextPose([shape], motion, [shape.id], 517.25 - 0.0000001)?.time).toBe(1000);
    expect(resolveNextPose([shape], motion, [shape.id], 1000)).toBeNull();
  });

  it("preserves the future world transform of a static child of an animated group", () => {
    const group: Layer = {
      ...shape,
      id: "group",
      type: "group",
      from: { subPaths: [] },
      translateY: 30,
      scaleX: 2,
    };
    const child = { ...shape, parentId: group.id, translateX: 3 };
    const pose = resolveNextPose([group, child], animation([block("group")]), [child.id], 0)!;
    expect(pose.time).toBe(1000);
    expect(paths(pose)[0].worldMatrix).toMatchObject({ a: 2, e: 26, f: 30 });
    expect(pose.bounds).toMatchObject({ x: 26, y: 30, w: 20, h: 10 });
  });

  it("includes every selected group descendant without showing unrelated artwork", () => {
    const group: Layer = { ...shape, id: "group", type: "group", from: { subPaths: [] } };
    const child = { ...shape, parentId: group.id };
    const sibling = { ...child, id: "sibling" };
    const outside = { ...shape, id: "outside" };
    const pose = resolveNextPose(
      [group, child, sibling, outside],
      animation([block("shape", 0, 500), block("outside", 0, 200)]),
      ["group"],
      0,
    )!;
    expect(pose.time).toBe(500);
    expect(paths(pose).map((draw) => draw.id)).toEqual(["shape", "sibling"]);
  });

  it("uses the same morph, trim, paint and transform evaluation as the artwork", () => {
    const layers = [{ ...shape, strokeColor: "#f00", strokeWidth: 2 }];
    const motion = animation([
      block("shape"),
      {
        ...block("shape"),
        id: "morph",
        propertyName: "pathData",
        type: "path",
        fromValue: "M0 0 L10 0 L10 10 Z",
        toValue: "M0 5 L20 5 L20 15 Z",
      },
      { ...block("shape"), id: "trim", propertyName: "trimPathEnd", fromValue: 1, toValue: 0.5 },
    ]);
    expect(resolveNextPose(layers, motion, [shape.id], 0)?.draws).toEqual(
      resolveWorldLayerDraws(layers, motion, 1, true),
    );
  });

  it("finds the next animated clip and retains its evaluated geometry and reference", () => {
    const clip: Layer = { ...shape, id: "clip", type: "clipPath" };
    const layers = [clip, shape];
    const motion = animation([block("clip", 0, 500), block("shape")]);
    const pose = resolveNextPose(layers, motion, [shape.id], 0)!;
    expect(pose.time).toBe(500);
    expect(pose.draws.find((draw) => draw.isClipPath)?.worldMatrix.e).toBe(20);
    expect(paths(pose)[0].clipNodeIds).toEqual(["clip"]);
  });

  it("does not edit the document while evaluating multiple selected objects", () => {
    const layers = [shape, { ...shape, id: "other" }];
    const motion = animation([block("shape"), block("other", 0, 300)]);
    const before = JSON.stringify({ layers, motion });
    const pose = resolveNextPose(layers, motion, ["shape", "other"], 0)!;
    expect(pose.time).toBe(300);
    expect(paths(pose)).toHaveLength(2);
    expect(JSON.stringify({ layers, motion })).toBe(before);
  });

  it("omits missing, hidden, static and invalid selections", () => {
    const motion = animation([block("shape")]);
    expect(resolveNextPose([shape], motion, [], 0)).toBeNull();
    expect(resolveNextPose([shape], motion, ["missing"], 0)).toBeNull();
    expect(resolveNextPose([{ ...shape, visible: false }], motion, [shape.id], 0)).toBeNull();
    expect(resolveNextPose([shape], animation([]), [shape.id], 0)).toBeNull();
    expect(resolveNextPose([shape], motion, [shape.id], NaN)).toBeNull();
    expect(resolveNextPose([shape], { ...motion, duration: NaN }, [shape.id], 0)).toBeNull();
  });
});

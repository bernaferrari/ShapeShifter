import { describe, expect, it } from "vitest";
import { insertTimelineKeyframe, linkedTimelineKeyframe } from "../timelineKeyframes";
import { colorAtTime, numberAtTime, pathDAtTime } from "../../playheadResolve";
import { parsePath } from "../../pathUtils";
import type { Layer, TimelineBlock } from "../../types";

const layer: Layer = {
  id: "layer",
  name: "Path",
  type: "path",
  from: parsePath("M 0 0 L 10 10"),
  visible: true,
  locked: false,
};
const block: TimelineBlock = {
  id: "left",
  layerId: layer.id,
  propertyName: "rotation",
  type: "number",
  startTime: 100,
  endTime: 900,
  fromValue: 0,
  toValue: 180,
  interpolator: "LINEAR",
};

describe("inserting authored timeline keyframes", () => {
  it.each([
    "LINEAR",
    "FAST_OUT_SLOW_IN",
    "LINEAR_OUT_SLOW_IN",
    "FAST_OUT_LINEAR_IN",
    "cubic-bezier(0.3, 1.4, 0.7, 1.4)",
  ])("preserves the numeric motion when splitting %s", (interpolator) => {
    const original = { ...block, interpolator };
    const pair = insertTimelineKeyframe(original, 417.25, "right")!;
    expect(pair[0].endTime).toBe(417.25);
    expect(pair[1].startTime).toBe(417.25);
    expect(pair[0].toValue).toBe(pair[1].fromValue);
    for (const time of [0, 100, 137, 200, 350, 417.25, 450, 670, 800, 900, 1000]) {
      expect(numberAtTime(layer, pair, "rotation", time, 1000)).toBeCloseTo(
        numberAtTime(layer, [original], "rotation", time, 1000),
        4,
      );
    }
  });

  it("samples color and path values at the inserted keyframe", () => {
    const color = {
      ...block,
      propertyName: "fillColor",
      type: "color" as const,
      fromValue: "#ff0000",
      toValue: "#0000ff",
    };
    const colorPair = insertTimelineKeyframe(color, 500, "color-right")!;
    expect(colorPair[0].toValue).toBe(
      colorAtTime(layer, [color], "fillColor", 500, 1000, "#ff0000"),
    );
    expect(colorPair[0].toValue).toBe(colorPair[1].fromValue);
    const path = {
      ...block,
      propertyName: "pathData",
      type: "path" as const,
      fromValue: "M 0 0 L 10 10",
      toValue: "M 10 0 L 20 10",
    };
    const pair = insertTimelineKeyframe(path, 500, "path-right")!;
    expect(pair[1].fromValue).toBe(pathDAtTime(layer, [path], 500, 1000, 0.5));
    expect(parsePath(String(pair[1].fromValue)).subPaths[0].commands[0].points[0]).toMatchObject({
      x: 5,
      y: 0,
    });
  });

  it("rejects boundaries and invalid times, preserving fractional keys", () => {
    expect(insertTimelineKeyframe(block, 100, "right")).toBeNull();
    expect(insertTimelineKeyframe(block, 900, "right")).toBeNull();
    expect(
      insertTimelineKeyframe({ ...block, endTime: 101 }, 100.5, "right")?.map((item) => [
        item.startTime,
        item.endTime,
      ]),
    ).toEqual([
      [100, 100.5],
      [100.5, 101],
    ]);
    expect(insertTimelineKeyframe(block, NaN, "right")).toBeNull();
  });

  it("keeps intentional jumps independent even at the same time", () => {
    const pair = insertTimelineKeyframe(block, 500, "right")!;
    expect(linkedTimelineKeyframe(pair, pair[1], "start")?.id).toBe("left");
    const jump = { ...pair[1], fromValue: 99 };
    expect(linkedTimelineKeyframe([pair[0], jump], jump, "start")).toBeUndefined();
  });
});

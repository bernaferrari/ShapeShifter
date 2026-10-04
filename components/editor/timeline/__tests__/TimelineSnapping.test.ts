import { describe, expect, it } from "vitest";
import {
  snapTimelineOffset,
  timelineSnapTargets,
  type TimelineSnapTarget,
} from "../timelineTiming";

const options = {
  offset: 97,
  anchors: [100, 400],
  range: [-100, 600] as const,
  targets: [{ time: 200.125, kind: "keyframe" }] as TimelineSnapTarget[],
  duration: 1000,
  contentWidth: 1000,
  gridStep: 50,
};
describe("magnetic timeline timing", () => {
  it("aligns to fractional keys without quantizing the target", () => {
    expect(snapTimelineOffset(options)).toEqual({ offset: 100.125, target: options.targets[0] });
  });
  it("uses a consistent eight-pixel radius through zoom", () => {
    expect(snapTimelineOffset({ ...options, offset: 94 }).target).not.toBeNull();
    expect(snapTimelineOffset({ ...options, offset: 94, contentWidth: 2000 }).target).toBeNull();
  });
  it("aligns either end of a segment and chooses the nearest candidate", () => {
    const target = { time: 500.25, kind: "playhead" as const };
    expect(
      snapTimelineOffset({ ...options, targets: [options.targets[0], target], offset: 100 }),
    ).toEqual({ offset: 100.125, target: options.targets[0] });
    expect(snapTimelineOffset({ ...options, targets: [target], offset: 97 })).toEqual({
      offset: 100.25,
      target,
    });
  });
  it("ignores unreachable magnets and clamps a shared grid offset", () => {
    expect(snapTimelineOffset({ ...options, range: [-100, 99] })).toEqual({
      offset: 99,
      target: null,
    });
    expect(snapTimelineOffset({ ...options, offset: -900 })).toEqual({
      offset: -100,
      target: null,
    });
  });
  it("Alt and disabled snapping keep millisecond precision without magnet attraction", () => {
    expect(snapTimelineOffset({ ...options, offset: 97.25, bypass: true })).toEqual({
      offset: 97,
      target: null,
    });
    expect(snapTimelineOffset({ ...options, offset: 97.25, enabled: false })).toEqual({
      offset: 97,
      target: null,
    });
  });
  it("excludes the moving endpoints while retaining keys, playhead, and boundaries", () => {
    expect(
      timelineSnapTargets(
        [
          { id: "a", startTime: 100, endTime: 300 },
          { id: "b", startTime: 500, endTime: 700 },
        ],
        1000,
        450,
        new Set(["a"]),
      ),
    ).toEqual([
      { time: 450, kind: "playhead" },
      { time: 500, kind: "keyframe" },
      { time: 700, kind: "keyframe" },
      { time: 0, kind: "boundary" },
      { time: 1000, kind: "boundary" },
    ]);
  });
});

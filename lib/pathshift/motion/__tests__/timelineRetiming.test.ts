import { describe, expect, it } from "vitest";
import type { TimelineBlock } from "../../types";
import { planTimelineMove, retimeTimelineBlocks } from "../timelineRetiming";

const block = (
  id: string,
  startTime: number,
  endTime: number,
  fromValue = 0,
  toValue = 100,
  propertyName = "rotation",
): TimelineBlock => ({
  id,
  layerId: "path",
  propertyName,
  type: "number",
  startTime,
  endTime,
  fromValue,
  toValue,
});
const times = (blocks: TimelineBlock[]) => blocks.map((item) => [item.startTime, item.endTime]);

describe("shared timeline retiming", () => {
  it("preserves subframe spacing and lengths across property tracks", () => {
    const blocks = [block("a", 17.25, 217.25), block("b", 143.75, 643.75, 1, 2, "scaleX")];
    expect(times(retimeTimelineBlocks(blocks, ["a", "b"], 83.125, 1000))).toEqual([
      [100.375, 300.375],
      [226.875, 726.875],
    ]);
  });
  it("clamps the entire selection to both document boundaries", () => {
    const blocks = [block("a", 17.25, 217.25), block("b", 143.75, 643.75, 1, 2, "scaleX")];
    expect(times(retimeTimelineBlocks(blocks, ["a", "b"], -1000, 1000))).toEqual([
      [0, 200],
      [126.5, 626.5],
    ]);
    expect(times(retimeTimelineBlocks(blocks, ["a", "b"], 1000, 1000))).toEqual([
      [373.5, 573.5],
      [500, 1000],
    ]);
  });
  it("moves adjacent selected segments together and stretches only shared external ends", () => {
    const blocks = [
      block("left", 0, 100, 0, 10),
      block("a", 100, 300, 10, 30),
      block("b", 300, 500, 30, 50),
      block("right", 500, 900, 50, 90),
    ];
    expect(times(retimeTimelineBlocks(blocks, ["a", "b"], 75.25, 1000))).toEqual([
      [0, 175.25],
      [175.25, 375.25],
      [375.25, 575.25],
      [575.25, 900],
    ]);
    expect(planTimelineMove(blocks, ["a", "b"], 1000)?.range).toEqual([-99, 399]);
  });
  it("moves both ends of an unselected linked middle segment without over-constraining the group", () => {
    const blocks = [
      block("a", 100, 200, 10, 20),
      block("middle", 200, 210, 20, 21),
      block("b", 210, 310, 21, 31),
    ];
    expect(times(retimeTimelineBlocks(blocks, ["a", "b"], 200, 1000))).toEqual([
      [300, 400],
      [400, 410],
      [410, 510],
    ]);
  });
  it("stops at unrelated same-property segments instead of creating overlap", () => {
    const blocks = [
      block("left", 0, 100),
      block("a", 200, 400, 5, 10),
      block("right", 500, 700, 50, 70),
    ];
    expect(planTimelineMove(blocks, ["a"], 1000)?.range).toEqual([-100, 100]);
    expect(times(retimeTimelineBlocks(blocks, ["a"], 800, 1000))).toEqual([
      [0, 100],
      [300, 500],
      [500, 700],
    ]);
  });
  it("keeps unrelated identities and rejects incomplete selections and invalid offsets", () => {
    const blocks = [block("a", 100, 300), block("b", 700, 900, 1, 2, "scaleX")];
    expect(retimeTimelineBlocks(blocks, ["a"], 25, 1000)[1]).toBe(blocks[1]);
    for (const offset of [0, NaN, Infinity])
      expect(retimeTimelineBlocks(blocks, ["a"], offset, 1000)).toBe(blocks);
    expect(retimeTimelineBlocks(blocks, ["a", "missing"], 25, 1000)).toBe(blocks);
  });
});

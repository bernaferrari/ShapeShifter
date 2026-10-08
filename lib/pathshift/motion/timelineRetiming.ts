import type { TimelineBlock } from "../types";
import { linkedTimelineKeyframe } from "./timelineKeyframes";

/** One offset moves every selected segment and its shared external endpoints. */
export function planTimelineMove(blocks: TimelineBlock[], ids: string[], duration: number) {
  const selected = new Set(ids);
  const edges = new Map<string, { start: boolean; end: boolean }>();
  const targets = blocks.filter((block) => selected.has(block.id));
  if (!targets.length || targets.length !== selected.size) return null;
  for (const block of targets) edges.set(block.id, { start: true, end: true });
  for (const block of targets) {
    for (const edge of ["start", "end"] as const) {
      const adjacent = linkedTimelineKeyframe(blocks, block, edge);
      if (!adjacent) continue;
      const moved = edges.get(adjacent.id) ?? { start: false, end: false };
      moved[edge === "start" ? "end" : "start"] = true;
      edges.set(adjacent.id, moved);
    }
  }

  let min = -Infinity;
  let max = Infinity;
  for (const block of blocks) {
    const moved = edges.get(block.id);
    if (!moved) continue;
    if (moved.start) min = Math.max(min, -block.startTime);
    if (moved.end) max = Math.min(max, duration - block.endTime);
    if (moved.start && !moved.end) max = Math.min(max, block.endTime - block.startTime - 1);
    if (moved.end && !moved.start) min = Math.max(min, block.startTime + 1 - block.endTime);
  }

  const tracks = new Map<string, TimelineBlock[]>();
  for (const block of blocks) {
    const key = JSON.stringify([String(block.layerId), block.propertyName]);
    const track = tracks.get(key) ?? [];
    track.push(block);
    tracks.set(key, track);
  }
  for (const track of tracks.values()) {
    track.sort((a, b) => a.startTime - b.startTime);
    for (let index = 1; index < track.length; index++) {
      const left = track[index - 1];
      const right = track[index];
      // Do not invent new overlaps or jump past an unrelated segment. Imported
      // overlaps are left intact instead of silently repairing their timing.
      if (left.endTime > right.startTime) continue;
      const leftMoves = edges.get(left.id)?.end ?? false;
      const rightMoves = edges.get(right.id)?.start ?? false;
      if (leftMoves && !rightMoves) max = Math.min(max, right.startTime - left.endTime);
      if (rightMoves && !leftMoves) min = Math.max(min, left.endTime - right.startTime);
    }
  }
  return { edges, range: [min, max] as [number, number], targets };
}

export function retimeTimelineBlocks(
  blocks: TimelineBlock[],
  ids: string[],
  offset: number,
  duration: number,
): TimelineBlock[] {
  if (!Number.isFinite(offset) || !offset) return blocks;
  const plan = planTimelineMove(blocks, ids, duration);
  if (!plan) return blocks;
  const delta = Math.max(plan.range[0], Math.min(plan.range[1], offset));
  if (!delta) return blocks;
  return blocks.map((block) => {
    const moved = plan.edges.get(block.id);
    return moved
      ? {
          ...block,
          startTime: block.startTime + (moved.start ? delta : 0),
          endTime: block.endTime + (moved.end ? delta : 0),
        }
      : block;
  });
}

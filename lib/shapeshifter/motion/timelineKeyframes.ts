import { INTERPOLATOR_CURVES } from "../interpolators";
import { colorAtTime, numberAtTime, pathDAtTime } from "../playheadResolve";
import { parsePath } from "../pathUtils";
import type { InterpolatorName, Layer, TimelineBlock } from "../types";

type Point = [number, number];
const lerp = (a: Point, b: Point, t: number): Point => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];
const curveString = (points: number[]) =>
  `cubic-bezier(${points.map((value) => Number(value.toFixed(8))).join(", ")})`;

export function interpolatorControlPoints(
  interpolator: string | undefined,
): [number, number, number, number] {
  const named = INTERPOLATOR_CURVES[interpolator as InterpolatorName];
  if (named) return named;
  const numbers = interpolator?.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number);
  return numbers?.length === 4 && numbers.every(Number.isFinite)
    ? (numbers as [number, number, number, number])
    : INTERPOLATOR_CURVES.ACCELERATE_DECELERATE;
}

/** Reparameterize a cubic timing curve when inserting a key inside its segment. */
function splitEasing(
  interpolator: string | undefined,
  time: number,
): [string | undefined, string | undefined] {
  // The Android cosine curve has no exact cubic representation. Preserve its
  // named easing on both authored segments rather than silently substituting it.
  if (!interpolator || interpolator === "ACCELERATE_DECELERATE")
    return [interpolator, interpolator];
  const custom = interpolator.match(/[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi)?.map(Number);
  const points =
    INTERPOLATOR_CURVES[interpolator as InterpolatorName] ?? (custom?.length === 4 ? custom : null);
  if (!points || interpolator === "LINEAR") return [interpolator, interpolator];
  const [x1, y1, x2, y2] = points;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const t = (lo + hi) / 2;
    const x = 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3;
    if (x < time) lo = t;
    else hi = t;
  }
  const t = (lo + hi) / 2;
  const a = lerp([0, 0], [x1, y1], t);
  const b = lerp([x1, y1], [x2, y2], t);
  const c = lerp([x2, y2], [1, 1], t);
  const d = lerp(a, b, t);
  const e = lerp(b, c, t);
  const p = lerp(d, e, t);
  if (Math.abs(p[1]) < 1e-8 || Math.abs(1 - p[1]) < 1e-8) return [interpolator, interpolator];
  return [
    curveString([a[0] / p[0], a[1] / p[1], d[0] / p[0], d[1] / p[1]]),
    curveString([
      (e[0] - p[0]) / (1 - p[0]),
      (e[1] - p[1]) / (1 - p[1]),
      (c[0] - p[0]) / (1 - p[0]),
      (c[1] - p[1]) / (1 - p[1]),
    ]),
  ];
}

export function insertTimelineKeyframe(
  block: TimelineBlock,
  time: number,
  rightId: string,
): [TimelineBlock, TimelineBlock] | null {
  if (!Number.isFinite(time) || time < block.startTime + 1 || time > block.endTime - 1) return null;
  const valueType =
    block.propertyName === "pathData" || block.type === "path"
      ? "path"
      : block.type === "color" || ["fillColor", "strokeColor"].includes(block.propertyName)
        ? "color"
        : "number";
  const layer = {
    id: block.layerId,
    from: valueType === "path" ? parsePath(String(block.fromValue)) : { subPaths: [] },
  } as Layer;
  const value =
    valueType === "number"
      ? numberAtTime(layer, [block], block.propertyName, time, block.endTime)
      : valueType === "color"
        ? colorAtTime(
            layer,
            [block],
            block.propertyName,
            time,
            block.endTime,
            String(block.fromValue),
          )
        : pathDAtTime(layer, [block], time, block.endTime, time / block.endTime);
  const [leftEasing, rightEasing] = splitEasing(
    block.interpolator,
    (time - block.startTime) / (block.endTime - block.startTime),
  );
  return [
    { ...block, endTime: time, toValue: value, interpolator: leftEasing },
    { ...block, id: rightId, startTime: time, fromValue: value, interpolator: rightEasing },
  ];
}

export function linkedTimelineKeyframe(
  blocks: TimelineBlock[],
  target: TimelineBlock,
  edge: "start" | "end",
) {
  const time = edge === "start" ? target.startTime : target.endTime;
  const value = edge === "start" ? target.fromValue : target.toValue;
  return blocks.find(
    (block) =>
      block.id !== target.id &&
      String(block.layerId) === String(target.layerId) &&
      block.propertyName === target.propertyName &&
      (edge === "start"
        ? block.endTime === time && block.toValue === value
        : block.startTime === time && block.fromValue === value),
  );
}

export function timelineKeyframeRange(
  blocks: TimelineBlock[],
  target: TimelineBlock,
  edge: "start" | "end",
  duration: number,
): [number, number] {
  if (target.startTime === target.endTime) return [0, duration];
  const adjacent = linkedTimelineKeyframe(blocks, target, edge);
  const sameTrack = blocks.filter(
    (block) =>
      block.id !== target.id &&
      block.id !== adjacent?.id &&
      String(block.layerId) === String(target.layerId) &&
      block.propertyName === target.propertyName,
  );
  const previousEnd = Math.max(
    0,
    ...sameTrack.filter((block) => block.endTime <= target.startTime).map((block) => block.endTime),
  );
  const nextStart = Math.min(
    duration,
    ...sameTrack
      .filter((block) => block.startTime >= target.endTime)
      .map((block) => block.startTime),
  );
  return edge === "start"
    ? [Math.max(previousEnd, (adjacent?.startTime ?? -1) + 1), target.endTime - 1]
    : [target.startTime + 1, Math.min(nextStart, (adjacent?.endTime ?? duration + 1) - 1)];
}

export function timelineBlockStartRange(
  blocks: TimelineBlock[],
  target: TimelineBlock,
  duration: number,
): [number, number] {
  const left = linkedTimelineKeyframe(blocks, target, "start");
  const right = linkedTimelineKeyframe(blocks, target, "end");
  return [
    Math.max(0, (left?.startTime ?? -1) + 1),
    Math.min(duration, (right?.endTime ?? duration + 1) - 1) - (target.endTime - target.startTime),
  ];
}

/** Keyframe times this close to the requested time are treated as the same keyframe. */
const KEY_EPSILON = 1;

/**
 * Set an animated property's value at `time` (Figma Motion "auto-key"): update the
 * keyframe there, or create one by splitting the covering segment or extending the
 * track. Returns null when the property has no track, so callers edit the base value.
 */
export function setTrackValueAt(
  blocks: TimelineBlock[],
  layerId: string | number,
  propertyName: string,
  time: number,
  value: TimelineBlock["fromValue"],
  newId: string,
): TimelineBlock[] | null {
  const isTrack = (block: TimelineBlock) =>
    String(block.layerId) === String(layerId) && block.propertyName === propertyName;
  const track = blocks.filter(isTrack).sort((a, b) => a.startTime - b.startTime);
  if (!track.length) return null;
  const writeAtTime = (list: TimelineBlock[]) =>
    list.map((block) => {
      if (!isTrack(block)) return block;
      const start = Math.abs(block.startTime - time) < KEY_EPSILON;
      const end = Math.abs(block.endTime - time) < KEY_EPSILON;
      return start || end
        ? { ...block, ...(start && { fromValue: value }), ...(end && { toValue: value }) }
        : block;
    });
  if (
    track.some(
      (b) => Math.abs(b.startTime - time) < KEY_EPSILON || Math.abs(b.endTime - time) < KEY_EPSILON,
    )
  )
    return writeAtTime(blocks);
  const cover = track.find((block) => time > block.startTime && time < block.endTime);
  if (cover) {
    const pair = insertTimelineKeyframe(cover, time, newId);
    if (!pair) return writeAtTime(blocks);
    return writeAtTime(blocks.flatMap((block) => (block.id === cover.id ? pair : [block])));
  }
  const first = track[0]!;
  const previous = track.filter((block) => block.endTime < time).at(-1);
  const next = track.find((block) => block.startTime > time);
  const after = Boolean(previous);
  const anchor = previous ?? next ?? first;
  const singlePose = track.length === 1 && first.startTime === first.endTime;
  return [
    ...blocks.filter((block) => !singlePose || block.id !== first.id),
    {
      ...anchor,
      id: singlePose ? first.id : newId,
      startTime: after ? anchor.endTime : time,
      endTime: after ? time : anchor.startTime,
      fromValue: after ? anchor.toValue : value,
      toValue: after ? value : anchor.fromValue,
    },
  ];
}

/**
 * The nearest keyframe time strictly before or after `time`, counting the
 * animation's start and end as stops (as Glyphrise's ‹ › transport does).
 */
export function adjacentKeyframeTime(
  blocks: readonly Pick<TimelineBlock, "startTime" | "endTime">[],
  duration: number,
  time: number,
  direction: -1 | 1,
): number | undefined {
  const epsilon = 0.5;
  const times = [0, duration, ...blocks.flatMap((block) => [block.startTime, block.endTime])];
  const candidates = times.filter((candidate) =>
    direction < 0 ? candidate < time - epsilon : candidate > time + epsilon,
  );
  if (!candidates.length) return undefined;
  return direction < 0 ? Math.max(...candidates) : Math.min(...candidates);
}

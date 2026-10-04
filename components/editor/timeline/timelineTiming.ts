/** Snapping applies to the shared offset, so imported subframe timing stays intact. */
export function snapTimeOffset(offset: number, precise = false, gridStep = 50): number {
  const step = precise ? 1 : gridStep;
  return Math.round(offset / step) * step;
}

export function shiftTimelineItems(
  items: { originalStart: number; originalEnd: number }[],
  offset: number,
  duration: number,
  precise = false,
  gridStep = 50,
): number {
  if (!items.length) return 0;
  const earliest = Math.min(...items.map((item) => item.originalStart));
  const latest = Math.max(...items.map((item) => item.originalEnd));
  return Math.max(
    -earliest,
    Math.min(duration - latest, snapTimeOffset(offset, precise, gridStep)),
  );
}

export type TimelineSnapTarget = { time: number; kind: "playhead" | "keyframe" | "boundary" };
export type TimelineSnapResult = { offset: number; target: TimelineSnapTarget | null };

/** Magnetic targets use a pixel radius, independent of zoom or clip duration.
 * Quantize the shared offset only as a fallback; never round imported endpoints.
 */
export function snapTimelineOffset({
  offset,
  anchors,
  targets,
  range,
  duration,
  contentWidth,
  gridStep,
  enabled = true,
  bypass = false,
}: {
  offset: number;
  anchors: number[];
  targets: TimelineSnapTarget[];
  range: readonly [number, number];
  duration: number;
  contentWidth: number;
  gridStep: number;
  enabled?: boolean;
  bypass?: boolean;
}): TimelineSnapResult {
  const clamp = (value: number) => Math.max(range[0], Math.min(range[1], value));
  const raw = clamp(offset);
  if (!enabled || bypass) return { offset: clamp(snapTimeOffset(raw, true)), target: null };
  const threshold = (8 * duration) / Math.max(1, contentWidth);
  let nearest: { offset: number; target: TimelineSnapTarget; distance: number } | null = null;
  for (const target of targets) {
    if (!Number.isFinite(target.time)) continue;
    for (const anchor of anchors) {
      const candidate = target.time - anchor;
      if (candidate < range[0] || candidate > range[1]) continue;
      const distance = Math.abs(candidate - raw);
      if (distance <= threshold && (!nearest || distance < nearest.distance))
        nearest = { offset: candidate, target, distance };
    }
  }
  return nearest
    ? { offset: nearest.offset, target: nearest.target }
    : { offset: clamp(snapTimeOffset(raw, false, gridStep)), target: null };
}

export function timelineSnapTargets(
  blocks: { id: string; startTime: number; endTime: number }[],
  duration: number,
  playhead?: number,
  excludedIds = new Set<string>(),
): TimelineSnapTarget[] {
  return [
    ...(playhead === undefined ? [] : [{ time: playhead, kind: "playhead" as const }]),
    ...blocks
      .filter((block) => !excludedIds.has(block.id))
      .flatMap((block) => [
        { time: block.startTime, kind: "keyframe" as const },
        { time: block.endTime, kind: "keyframe" as const },
      ]),
    { time: 0, kind: "boundary" },
    { time: duration, kind: "boundary" },
  ];
}

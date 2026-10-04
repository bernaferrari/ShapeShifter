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
